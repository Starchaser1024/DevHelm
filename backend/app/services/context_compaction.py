from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import ChatMessage, Conversation, ConversationMemory, Repository
from app.services.context_compression import (
    COMPACT_BOUNDARY_SUBTYPE,
    COMPACT_SUMMARY_SYSTEM_PROMPT,
    adjust_keep_start_to_preserve_api_invariants,
    build_compaction_summary_payload,
    calculate_context_pressure,
    clip_to_token_budget,
    dumps_compact,
    ensure_compaction_summary_preserves_key_facts,
    estimate_tokens,
    fallback_compaction_summary,
    format_compaction_summary,
    memory_document_text,
    messages_after_compact_boundary,
    render_structured_memory,
)
from app.services.llm.client import LLMClient
from app.services.memory_stores import MessageStore


class ProgressiveContextManager:
    def __init__(self, db: Session, llm: LLMClient | None = None) -> None:
        self.db = db
        self.llm = llm or LLMClient()

    async def ensure_headroom(self, repo: Repository | None, conversation: Conversation | None, current_message: str) -> dict[str, Any]:
        if repo is None or conversation is None:
            return {"attempted": False, "reason": "no_repo_or_conversation"}
        from app.services.chat_memory import ContextAssembler

        assembled = ContextAssembler(self.db).assemble(repo, conversation, current_message)
        assembled_pressure = assembled.compression_stats.get("pressure") or {}
        micro_stats = assembled.compression_stats.get("microcompact") or {}
        raw_segment_tokens = self._raw_segment_tokens(repo.id, conversation.id) + estimate_tokens(current_message)
        assembled_tokens = int(
            assembled.compression_stats.get("assembled_prompt_estimated_tokens")
            or assembled.compression_stats.get("system_context_estimated_tokens")
            or 0
        )
        raw_pressure_state = calculate_context_pressure(raw_segment_tokens)
        assembled_pressure_state = calculate_context_pressure(assembled_tokens)
        pressure_state = calculate_context_pressure(max(raw_segment_tokens, assembled_tokens))
        pressure = {
            **pressure_state.as_dict(),
            "raw_segment_estimated_tokens": raw_segment_tokens,
            "assembled_context_estimated_tokens": assembled_tokens,
            "raw_stage": raw_pressure_state.stage,
            "assembled_stage": assembled_pressure.get("stage") or assembled_pressure_state.stage,
            "microcompact_estimated_tokens_saved": micro_stats.get("estimated_tokens_saved", 0),
            "microcompact_compacted_messages": micro_stats.get("compacted_messages", 0),
        }
        raw_stage = raw_pressure_state.stage
        prompt_stage = str(pressure.get("assembled_stage") or assembled_pressure_state.stage)
        stage = str(pressure.get("stage") or "normal")
        if not settings.context_auto_compact_enabled:
            return {"attempted": False, "reason": "auto_compact_disabled", "pressure": pressure}
        if (
            prompt_stage in {"normal", "warning"}
            and raw_stage in {"auto_compact", "aggressive", "manual_path"}
            and int(micro_stats.get("compacted_messages") or 0) > 0
        ):
            return {
                "attempted": False,
                "reason": "microcompact_sufficient",
                "pressure": pressure,
                "microcompact": micro_stats,
            }
        if stage in {"normal", "warning"}:
            return {"attempted": False, "reason": stage, "pressure": pressure}

        failures = self._consecutive_failures(repo.id, conversation.id)
        if failures >= settings.context_max_compaction_failures:
            return {
                "attempted": False,
                "reason": "circuit_breaker_open",
                "consecutive_failures": failures,
                "pressure": pressure,
            }

        try:
            result = await self._compact(repo, conversation, current_message, pressure, stage)
            return {"attempted": True, **result, "pressure": pressure, "consecutive_failures": 0}
        except Exception as exc:  # pragma: no cover - defensive circuit breaker path
            self.db.rollback()
            failure = self._record_failure(repo.id, conversation.id, current_message, stage, exc)
            self.db.flush()
            return {
                "attempted": True,
                "compacted": False,
                "reason": "compaction_failed",
                "failure_id": str(failure.id),
                "error": str(exc),
                "pressure": pressure,
                "consecutive_failures": failures + 1,
            }

    async def _compact(
        self,
        repo: Repository,
        conversation: Conversation,
        current_message: str,
        pressure: dict[str, Any],
        stage: str,
    ) -> dict[str, Any]:
        store = MessageStore(self.db)
        all_rows = store.active_for_context(repo.id, conversation.id, limit=500)
        all_messages = [self._row_to_message(row) for row in all_rows]
        segment_messages = messages_after_compact_boundary(all_messages, include_boundary=False)
        message_ids = {str(item.get("id")) for item in segment_messages if item.get("id")}
        segment_rows = [row for row in all_rows if str(row.id) in message_ids]
        candidate_rows = [
            row
            for row in segment_rows
            if row.role in {"user", "assistant", "tool", "tool_use", "tool_result"}
        ]
        plan_stages = [stage]
        if stage == "auto_compact":
            plan_stages.extend(["aggressive", "manual_path"])
        elif stage == "aggressive":
            plan_stages.append("manual_path")
        plans = [self._compaction_plan_for_stage(item) for item in plan_stages]
        if len(candidate_rows) <= min(int(item["keep_recent"]) for item in plans) + 1:
            return {"compacted": False, "reason": "not_enough_messages"}

        attempts: list[dict[str, Any]] = []
        selected: tuple[
            dict[str, Any],
            list[ChatMessage],
            list[ChatMessage],
            str,
            str,
            dict[str, Any],
            int,
        ] | None = None
        rehydration = self._rehydration_state(candidate_rows)
        for index, plan in enumerate(plans, start=1):
            keep_rows = self._messages_to_keep(candidate_rows, keep_count=int(plan["keep_recent"]))
            keep_ids = {row.id for row in keep_rows}
            summarize_rows = [row for row in candidate_rows if row.id not in keep_ids]
            if not summarize_rows:
                continue
            summary, mode, preservation_report = await self._summary_for(
                repo,
                conversation,
                summarize_rows,
                current_message,
                max_summary_tokens=int(plan["summary_tokens"]),
            )
            mode_prefix = str(plan.get("mode_prefix") or "")
            if mode_prefix:
                mode = f"{mode_prefix}_{mode}"
            post_compact_tokens = self._post_compact_tokens(
                summary,
                keep_rows,
                current_message=current_message,
                rehydration=rehydration,
            )
            post_pressure = calculate_context_pressure(post_compact_tokens)
            attempts.append(
                {
                    "attempt": index,
                    "plan": plan,
                    "post_compact_estimated_tokens": post_compact_tokens,
                    "post_compact_stage": post_pressure.stage,
                }
            )
            selected = (
                plan,
                keep_rows,
                summarize_rows,
                summary,
                mode,
                preservation_report,
                post_compact_tokens,
            )
            if post_pressure.stage in {"normal", "warning"}:
                break

        if selected is None:
            return {"compacted": False, "reason": "nothing_to_summarize"}

        plan, keep_rows, summarize_rows, summary, mode, preservation_report, post_compact_tokens = selected
        boundary = self._insert_boundary(
            repo,
            conversation,
            summary,
            mode,
            pressure,
            summarize_rows,
            keep_rows,
            preservation_report,
            rehydration,
        )
        return {
            "compacted": True,
            "mode": mode,
            "stage": stage,
            "boundary_id": str(boundary.id),
            "messages_summarized": len(summarize_rows),
            "messages_preserved": len(keep_rows),
            "post_compact_estimated_tokens": post_compact_tokens,
            "post_compact_pressure": calculate_context_pressure(post_compact_tokens).as_dict(),
            "compaction_plan": plan,
            "compaction_attempts": attempts,
            "rehydration": rehydration,
        }

    def _compaction_plan_for_stage(self, stage: str) -> dict[str, Any]:
        default_keep = max(2, settings.context_compact_keep_recent_messages)
        default_summary_tokens = max(256, settings.context_compact_summary_tokens)
        if stage == "manual_path":
            return {
                "keep_recent": max(2, min(default_keep, max(2, default_keep // 3))),
                "summary_tokens": min(default_summary_tokens, max(256, int(default_summary_tokens * 0.5))),
                "mode_prefix": "manual_path",
            }
        if stage == "aggressive":
            return {
                "keep_recent": max(2, min(default_keep, max(3, default_keep // 2))),
                "summary_tokens": min(default_summary_tokens, max(256, int(default_summary_tokens * 0.67))),
                "mode_prefix": "aggressive",
            }
        return {"keep_recent": default_keep, "summary_tokens": default_summary_tokens, "mode_prefix": ""}

    def _messages_to_keep(self, rows: list[ChatMessage], keep_count: int | None = None) -> list[ChatMessage]:
        keep = max(2, keep_count if keep_count is not None else settings.context_compact_keep_recent_messages)
        start_index = max(0, len(rows) - keep)
        start_index = adjust_keep_start_to_preserve_api_invariants(
            [self._row_to_message(row) for row in rows],
            start_index,
        )
        keep_rows = rows[start_index:]
        if (
            keep_rows
            and keep_rows[0].role == "assistant"
            and start_index > 0
            and rows[start_index - 1].role == "user"
        ):
            keep_rows = [rows[start_index - 1], *keep_rows]
        return keep_rows

    async def _summary_for(
        self,
        repo: Repository,
        conversation: Conversation,
        rows: list[ChatMessage],
        current_message: str,
        max_summary_tokens: int,
    ) -> tuple[str, str, dict[str, Any]]:
        messages = [self._row_to_message(row) for row in rows]
        memory = self.db.query(ConversationMemory).filter(ConversationMemory.conversation_id == conversation.id).first()
        if memory and memory_document_text(memory).strip():
            summary = render_structured_memory(memory, max_tokens=max_summary_tokens)
            continuation = (
                "This conversation was compacted using structured session memory. "
                "Continue from the preserved recent messages and the current user request.\n\n"
                f"{summary}"
            )
            summary, report = ensure_compaction_summary_preserves_key_facts(messages, continuation, max_summary_tokens)
            return summary, "session_memory", report

        payload = build_compaction_summary_payload(messages)
        llm_summary = await self.llm.chat_text(
            COMPACT_SUMMARY_SYSTEM_PROMPT,
            f"Current user request that triggered pressure:\n{current_message}\n\nConversation segment to compact:\n{payload}",
        )
        summary = format_compaction_summary(llm_summary)
        if not summary:
            summary = fallback_compaction_summary(messages, max_tokens=max_summary_tokens)
            summary, report = ensure_compaction_summary_preserves_key_facts(messages, summary, max_summary_tokens)
            return summary, "fallback_extractive", report
        summary, report = ensure_compaction_summary_preserves_key_facts(messages, summary, max_summary_tokens)
        return summary, "full_compaction", report

    def _insert_boundary(
        self,
        repo: Repository,
        conversation: Conversation,
        summary: str,
        mode: str,
        pressure: dict[str, Any],
        summarized_rows: list[ChatMessage],
        keep_rows: list[ChatMessage],
        preservation_report: dict[str, Any],
        rehydration: dict[str, Any],
    ) -> ChatMessage:
        now = datetime.now(timezone.utc)
        latest_source_time = max(
            (row.created_at for row in [*summarized_rows, *keep_rows] if row.created_at),
            default=None,
        )
        if latest_source_time:
            comparable_now = now if latest_source_time.tzinfo else now.replace(tzinfo=None)
            if latest_source_time >= comparable_now:
                now = latest_source_time + timedelta(microseconds=1)
        boundary = ChatMessage(
            repo_id=repo.id,
            conversation_id=conversation.id,
            role="system",
            content=summary,
            route="context_compaction",
            tool_calls=[],
            meta={
                "subtype": COMPACT_BOUNDARY_SUBTYPE,
                "trigger": "auto",
                "mode": mode,
                "pressure": pressure,
                "pre_compact_message_id": str(summarized_rows[-1].id) if summarized_rows else None,
                "summarized_from_message_id": str(summarized_rows[0].id) if summarized_rows else None,
                "summarized_to_message_id": str(summarized_rows[-1].id) if summarized_rows else None,
                "preserved_start_message_id": str(keep_rows[0].id) if keep_rows else None,
                "preserved_message_ids": [str(row.id) for row in keep_rows],
                "transcript_ref": {
                    "repo_id": str(repo.id),
                    "conversation_id": str(conversation.id),
                    "tool": "devhelm_get_thread_context",
                },
                "messages_summarized": len(summarized_rows),
                "messages_preserved": len(keep_rows),
                "summary_estimated_tokens": estimate_tokens(summary),
                "preservation": preservation_report,
                "rehydration": rehydration,
            },
            created_at=now,
        )
        self.db.add(boundary)
        self.db.flush()
        return boundary

    def _post_compact_tokens(
        self,
        summary: str,
        keep_rows: list[ChatMessage],
        *,
        current_message: str = "",
        rehydration: dict[str, Any] | None = None,
    ) -> int:
        return (
            estimate_tokens(summary)
            + sum(estimate_tokens(row.content) for row in keep_rows)
            + estimate_tokens(current_message)
            + estimate_tokens(dumps_compact(rehydration or {}))
        )

    def _rehydration_state(self, rows: list[ChatMessage]) -> dict[str, Any]:
        working_files: list[str] = []
        active_skills: list[str] = []
        recent_tools: list[str] = []

        def remember(target: list[str], value: Any, limit: int) -> None:
            clean = str(value or "").strip()
            if not clean or clean in target:
                return
            target.append(clean)
            if len(target) > limit:
                del target[0 : len(target) - limit]

        for row in rows:
            calls = [item for item in (row.tool_calls or []) if isinstance(item, dict)]
            events = [item for item in (row.meta or {}).get("agent_events") or [] if isinstance(item, dict)]
            for call in calls:
                remember(recent_tools, call.get("tool_name"), 8)
                arguments = call.get("arguments") or {}
                if isinstance(arguments, dict):
                    remember(working_files, arguments.get("path") or arguments.get("file_path"), 5)
            for event in events:
                event_type = str(event.get("type") or "")
                if event_type in {"tool_use", "tool_result"}:
                    remember(recent_tools, event.get("tool_name"), 8)
                arguments = event.get("arguments") or {}
                if isinstance(arguments, dict):
                    remember(working_files, arguments.get("path") or arguments.get("file_path"), 5)
                if event_type == "skill_activated":
                    remember(active_skills, event.get("skill_name") or event.get("skill_title"), 6)

        return {
            "working_files": working_files,
            "active_skills": active_skills,
            "recent_tools": recent_tools,
            "recovery": {
                "exact_transcript_tool": "devhelm_get_thread_context",
                "sealed_session_tool": "devhelm_read_session_events",
            },
        }

    def _raw_segment_tokens(self, repo_id: uuid.UUID, conversation_id: uuid.UUID) -> int:
        rows = MessageStore(self.db).active_for_context(repo_id, conversation_id, limit=1000)
        messages = messages_after_compact_boundary([self._row_to_message(row) for row in rows], include_boundary=False)
        total = 0
        for message in messages:
            total += estimate_tokens(str(message.get("role") or ""))
            total += estimate_tokens(str(message.get("content") or ""))
            if message.get("tool_calls"):
                total += estimate_tokens(dumps_compact(message.get("tool_calls")))
        return total

    def _row_to_message(self, row: ChatMessage) -> dict[str, Any]:
        return {
            "id": str(row.id),
            "role": row.role,
            "content": row.content,
            "route": row.route,
            "tool_calls": row.tool_calls or [],
            "meta": row.meta or {},
        }

    def _consecutive_failures(self, repo_id: uuid.UUID, conversation_id: uuid.UUID) -> int:
        boundary = MessageStore(self.db).last_compact_boundary(repo_id, conversation_id)
        query = self.db.query(ChatMessage).filter(
            ChatMessage.repo_id == repo_id,
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.role == "system",
            ChatMessage.route == "context_compaction",
        )
        if boundary and boundary.created_at:
            query = query.filter(ChatMessage.created_at > boundary.created_at)
        count = 0
        for row in query.order_by(ChatMessage.created_at.desc()).limit(settings.context_max_compaction_failures).all():
            if (row.meta or {}).get("subtype") == "compact_failure":
                count += 1
            else:
                break
        return count

    def _record_failure(self, repo_id: uuid.UUID, conversation_id: uuid.UUID, current_message: str, stage: str, exc: Exception) -> ChatMessage:
        failure = ChatMessage(
            repo_id=repo_id,
            conversation_id=conversation_id,
            role="system",
            content=clip_to_token_budget(f"Context compaction failed during {stage}: {exc}", 240),
            route="context_compaction",
            tool_calls=[],
            meta={
                "subtype": "compact_failure",
                "stage": stage,
                "current_message": clip_to_token_budget(current_message, 120),
            },
            created_at=datetime.now(timezone.utc),
        )
        self.db.add(failure)
        return failure
