from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import (
    ChatSession,
    Conversation,
    ConversationMemory,
    Repository,
    ThreadMemory,
)
from app.services.context_compaction import ProgressiveContextManager
from app.services.context_compression import (
    calculate_context_pressure,
    clip_to_token_budget,
    compress_messages,
    default_context_budget,
    dumps_compact,
    estimate_tokens,
    memory_document_text,
    microcompact_messages,
    render_structured_memory,
)
from app.services.memory_stores import (
    EvidenceStore,
    MessageStore,
    _clip,
    _conversation_filter,
    _repo_filter,
    _tokens,
)
from app.services.session_sealing import MemoryTools, SessionSealer


@dataclass
class AssembledContext:
    system_context: str
    history_messages: list[dict[str, str]]
    evidence: list[dict[str, Any]]
    compression_stats: dict[str, Any] = field(default_factory=dict)


class ContextAssembler:
    def __init__(self, db: Session) -> None:
        self.db = db

    def assemble(self, repo: Repository | None, conversation: Conversation | None, current_message: str, limit: int = 16) -> AssembledContext:
        budget = default_context_budget()
        repo_id = repo.id if repo else None
        conversation_id = conversation.id if conversation else None
        message_store = MessageStore(self.db)
        boundary = message_store.last_compact_boundary(repo_id, conversation_id)
        memory = (
            self.db.query(ConversationMemory).filter(ConversationMemory.conversation_id == conversation_id).first()
            if conversation_id
            else self.db.query(ThreadMemory).filter(_repo_filter(ThreadMemory, repo_id)).first()
        )
        latest_session = (
            self.db.query(ChatSession)
            .filter(
                _repo_filter(ChatSession, repo_id),
                _conversation_filter(ChatSession, conversation_id),
                ChatSession.status.in_(["sealed", "sealed_with_warnings"]),
            )
            .order_by(ChatSession.created_at.desc())
            .first()
        )
        evidence = EvidenceStore(self.db).search(repo_id, conversation_id, current_message, limit=8)
        history_fetch_limit = max(limit, 30)
        recent = message_store.recent(repo_id, conversation_id, limit=history_fetch_limit)
        raw_history = [
            {
                "role": item.role,
                "content": item.content,
                "route": item.route,
                "tool_calls": item.tool_calls or [],
                "meta": item.meta or {},
            }
            for item in recent
            if item.role in {"user", "assistant"}
        ]
        micro_stats: dict[str, Any] | None = None
        raw_history_tokens = sum(
            estimate_tokens(str(item.get("role") or ""))
            + estimate_tokens(str(item.get("content") or ""))
            + (
                estimate_tokens(dumps_compact(item.get("tool_calls")))
                if item.get("tool_calls")
                else 0
            )
            for item in raw_history
        )
        current_message_in_history = bool(
            raw_history
            and raw_history[-1].get("role") == "user"
            and " ".join(str(raw_history[-1].get("content") or "").split())
            == " ".join(str(current_message or "").split())
        )
        pending_user_tokens = 0 if current_message_in_history else estimate_tokens(current_message)
        raw_history_pressure = calculate_context_pressure(raw_history_tokens + pending_user_tokens)
        history_source = raw_history
        if raw_history_pressure.should_warn:
            history_source, micro_stats = microcompact_messages(raw_history, current_message)
        history, history_stats = compress_messages(history_source, budget.recent_tokens)

        def build_context(next_history: list[dict[str, str]], next_evidence: list[dict[str, Any]]) -> str:
            system_sections: list[str] = []
            if repo:
                system_sections.append(f"[Current Repository]\n{repo.full_name}\n[/Current Repository]")
            if conversation:
                system_sections.append(f"[Current Conversation]\n{conversation.title}\n[/Current Conversation]")

            sections: list[str] = []
            stable_system = clip_to_token_budget("\n\n".join(system_sections), budget.system_tokens)
            if stable_system:
                sections.append(stable_system)

            memory_sections: list[str] = []
            if boundary and boundary.content:
                transcript_ref = (boundary.meta or {}).get("transcript_ref") or {}
                rehydration = (boundary.meta or {}).get("rehydration") or {}
                recovery_hint = (
                    "\nExact transcript recovery: call devhelm_get_thread_context with this conversation"
                    if transcript_ref
                    else ""
                )
                if rehydration:
                    memory_sections.append(
                        "[Rehydrated Working State]\n"
                        + dumps_compact(rehydration)
                        + "\n[/Rehydrated Working State]"
                    )
                memory_sections.append(
                    f"[Compaction Boundary]\n{boundary.content}{recovery_hint}\n[/Compaction Boundary]"
                )
            if memory and memory_document_text(memory).strip():
                memory_text = render_structured_memory(memory, max_tokens=max(256, budget.memory_tokens // 2))
                memory_sections.append(f"[Thread Memory: {memory.sessions_incorporated} sessions]\n{memory_text}\n[/Thread Memory]")
            if latest_session and latest_session.digest:
                memory_sections.append(f"[Previous Session Digest]\n{latest_session.digest}\n[/Previous Session Digest]")
            memory_context = clip_to_token_budget("\n\n".join(memory_sections), budget.memory_tokens)
            if memory_context:
                sections.append(memory_context)
            if next_evidence:
                evidence_budget = max(120, budget.evidence_tokens // max(len(next_evidence), 1))
                lines = ["[Related Evidence]"]
                for item in next_evidence:
                    snippet = clip_to_token_budget(item["snippet"], evidence_budget)
                    lines.append(f"- [{item['source_type']}] {item['title']}: {snippet}")
                lines.append("[/Related Evidence]")
                sections.append(clip_to_token_budget("\n".join(lines), budget.evidence_tokens))
            return "\n\n".join(sections)

        system_context = build_context(history, evidence)
        history_prompt_tokens = sum(
            estimate_tokens(item.get("role")) + estimate_tokens(item.get("content"))
            for item in history
        )
        initial_prompt_tokens = estimate_tokens(system_context) + history_prompt_tokens + pending_user_tokens
        initial_pressure = calculate_context_pressure(initial_prompt_tokens)
        if initial_pressure.should_warn and micro_stats is None:
            micro_raw_history, micro_stats = microcompact_messages(raw_history, current_message)
            history, history_stats = compress_messages(micro_raw_history, budget.recent_tokens)
            system_context = build_context(history, evidence)

        history_prompt_tokens = sum(
            estimate_tokens(item.get("role")) + estimate_tokens(item.get("content"))
            for item in history
        )
        assembled_prompt_tokens = estimate_tokens(system_context) + history_prompt_tokens + pending_user_tokens
        final_pressure = calculate_context_pressure(assembled_prompt_tokens)
        microcompacted_messages = int((micro_stats or {}).get("compacted_messages") or 0)
        history_coverage = {
            "source_messages": len(raw_history),
            "prompt_messages": len(history),
            "omitted_messages": int(history_stats.get("omitted_messages") or 0),
            "truncated_messages": int(history_stats.get("truncated_messages") or 0),
            "exact_suffix_messages": int(history_stats.get("exact_suffix_messages") or 0),
            "source_limit_reached": len(recent) >= history_fetch_limit,
            "has_compaction_boundary": boundary is not None,
            "microcompacted_messages": microcompacted_messages,
        }
        history_coverage["complete_and_exact"] = not any(
            [
                history_coverage["omitted_messages"],
                history_coverage["truncated_messages"],
                history_coverage["source_limit_reached"],
                history_coverage["has_compaction_boundary"],
                history_coverage["microcompacted_messages"],
            ]
        )

        return AssembledContext(
            system_context=system_context,
            history_messages=history,
            evidence=evidence,
            compression_stats={
                "budget": budget.__dict__,
                "history": history_stats,
                "history_coverage": history_coverage,
                "microcompact": micro_stats,
                "pressure": final_pressure.as_dict(),
                "initial_pressure": initial_pressure.as_dict(),
                "raw_history_pressure": raw_history_pressure.as_dict(),
                "compact_boundary": {
                    "id": str(boundary.id) if boundary else None,
                    "created_at": boundary.created_at.isoformat() if boundary and boundary.created_at else None,
                    "mode": (boundary.meta or {}).get("mode") if boundary else None,
                },
                "system_context_estimated_tokens": estimate_tokens(system_context),
                "history_estimated_tokens": history_prompt_tokens,
                "pending_user_estimated_tokens": pending_user_tokens,
                "assembled_prompt_estimated_tokens": assembled_prompt_tokens,
                "prompt_breakdown": {
                    "system_memory_evidence": estimate_tokens(system_context),
                    "recent_history": history_prompt_tokens,
                    "pending_user": pending_user_tokens,
                    "tool_observation_budget": budget.tool_observation_tokens,
                    "reserved_response": budget.reserved_response_tokens,
                },
                "evidence_items": len(evidence),
                "mode": "progressive_budgeted_context",
            },
        )


__all__ = [
    "AssembledContext",
    "ContextAssembler",
    "EvidenceStore",
    "MemoryTools",
    "MessageStore",
    "ProgressiveContextManager",
    "SessionSealer",
    "_clip",
    "_conversation_filter",
    "_repo_filter",
    "_tokens",
]
