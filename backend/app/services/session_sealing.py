from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import (
    ChatMessage,
    ChatSession,
    ChatSession as ChatSessionModel,
    Conversation,
    ConversationMemory,
    Repository,
    ThreadMemory,
)
from app.services.context_compression import (
    clip_to_token_budget,
    dumps_compact,
    fallback_memory_update,
    merge_memory,
    structured_memory_from_model,
)
from app.services.llm.client import LLMClient
from app.services.memory_hub import capture_memory_candidates, record_recall_event
from app.services.memory_stores import (
    EvidenceStore,
    MessageStore,
    _conversation_filter,
    _repo_filter,
    _tokens,
)


class SessionSealer:
    def __init__(self, db: Session, llm: LLMClient | None = None) -> None:
        self.db = db
        self.llm = llm or LLMClient()

    async def seal(
        self,
        *,
        repo: Repository | None,
        conversation: Conversation | None,
        user_message: ChatMessage,
        assistant_message: ChatMessage,
        route: str,
        tool_calls: list[dict[str, Any]],
        agent_events: list[dict[str, Any]] | None = None,
        model_usage: list[dict[str, Any]] | None = None,
        context_diagnostics: dict[str, Any] | None = None,
    ) -> ChatSessionModel:
        agent_events = agent_events or []
        model_usage = model_usage or []
        context_diagnostics = context_diagnostics or {}
        fallback_update = fallback_memory_update(
            user_message.content,
            assistant_message.content,
            route,
            tool_calls,
        )
        fallback_digest = str(fallback_update.get("summary") or "")
        session = ChatSession(
            repo_id=repo.id if repo else None,
            conversation_id=conversation.id if conversation else None,
            user_message_id=user_message.id,
            assistant_message_id=assistant_message.id,
            route=route,
            transcript_json={
                "messages": [
                    {"role": "user", "content": user_message.content, "created_at": self._iso(user_message.created_at)},
                    {"role": "assistant", "content": assistant_message.content, "created_at": self._iso(assistant_message.created_at)},
                ],
                "tool_calls": tool_calls,
                "agent_events": agent_events,
                "tool_use_results": [
                    event for event in agent_events if event.get("type") in {"tool_use", "tool_result"}
                ],
                "model_usage": model_usage,
                "context_diagnostics": context_diagnostics,
                "memory_update": fallback_update,
                "sealing": {"phase": "raw_persisted", "errors": []},
            },
            digest=fallback_digest,
            status="sealing",
            sealed_at=None,
        )
        self.db.add(session)
        self.db.flush()

        errors: list[str] = []
        memory_update = fallback_update
        digest = fallback_digest
        try:
            memory_update = await self._build_memory_update(
                user_message.content,
                assistant_message.content,
                route,
                tool_calls,
                fallback_digest,
                repo_id=repo.id if repo else None,
                conversation_id=conversation.id if conversation else None,
            )
            digest = str(memory_update.pop("_digest", "") or memory_update.get("summary") or fallback_digest)
        except Exception as exc:  # model/network failures must not invalidate the completed chat turn
            errors.append(f"memory_extraction_failed: {exc}")
            memory_update = fallback_update
            digest = fallback_digest

        try:
            with self.db.begin_nested():
                self._update_thread_memory(
                    repo.id if repo else None,
                    conversation.id if conversation else None,
                    digest,
                    memory_update,
                )
                capture_memory_candidates(
                    self.db,
                    repo_id=repo.id if repo else None,
                    conversation_id=conversation.id if conversation else None,
                    session_id=session.id,
                    memory_update=memory_update,
                )
                self.db.flush()
        except Exception as exc:  # keep raw ChatSession even when enrichment fails
            errors.append(f"memory_persistence_failed: {exc}")

        transcript = dict(session.transcript_json or {})
        transcript["memory_update"] = {
            key: value for key, value in memory_update.items() if not key.startswith("_")
        }
        transcript["sealing"] = {
            "phase": "completed",
            "errors": errors,
            "evidence_refresh": "deferred_to_next_request",
        }
        session.transcript_json = transcript
        session.digest = digest
        session.status = "sealed_with_warnings" if errors else "sealed"
        session.sealed_at = datetime.now(timezone.utc)
        self.db.flush()
        return session

    async def _build_memory_update(
        self,
        user_message: str,
        assistant_message: str,
        route: str,
        tool_calls: list[dict[str, Any]],
        digest: str,
        *,
        repo_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None,
    ) -> dict[str, Any]:
        fallback = fallback_memory_update(user_message, assistant_message, route, tool_calls)
        if repo_id and conversation_id:
            current_memory: ConversationMemory | ThreadMemory | None = (
                self.db.query(ConversationMemory)
                .filter(ConversationMemory.conversation_id == conversation_id)
                .first()
            )
        else:
            current_memory = (
                self.db.query(ThreadMemory)
                .filter(_repo_filter(ThreadMemory, repo_id))
                .first()
            )
        existing_memory = self._memory_state(current_memory) if current_memory else {}
        prompt = (
            "请增量更新软件工程 Agent 的数据库会话记忆。"
            "输入包含已有记忆和本轮原始记录；返回更新后的完整快照，而不是只返回本轮增量。"
            "只返回 JSON，包含 digest、summary、facts、decisions、open_questions、tasks、"
            "user_preferences、repo_context、citations。summary 必须描述当前工作状态和下一步；"
            "保留重要文件、函数、命令、错误修复和用户纠正，不要编造。"
        )
        parsed = await self.llm.chat_json(
            prompt,
            {
                "route": route,
                "digest": digest,
                "existing_memory": existing_memory,
                "user_message": user_message,
                "assistant_message": assistant_message,
                "tool_calls": tool_calls,
            },
        )
        update = structured_memory_from_model(parsed) if parsed else fallback
        if not update.get("summary"):
            update["summary"] = fallback["summary"]
        if parsed:
            update["_update_mode"] = "snapshot"
            update["_digest"] = str(parsed.get("digest") or parsed.get("summary") or digest)
        return update

    def _memory_state(self, memory: ConversationMemory | ThreadMemory) -> dict[str, Any]:
        return {
            "summary": memory.summary or "",
            "facts": getattr(memory, "facts", None) or [],
            "decisions": memory.decisions or [],
            "open_questions": memory.open_questions or [],
            "tasks": getattr(memory, "tasks", None) or [],
            "user_preferences": getattr(memory, "user_preferences", None) or [],
            "repo_context": getattr(memory, "repo_context", None) or [],
            "citations": getattr(memory, "citations", None) or [],
        }

    def _new_memory(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None) -> ConversationMemory | ThreadMemory:
        if repo_id and conversation_id:
            memory = ConversationMemory(
                repo_id=repo_id,
                conversation_id=conversation_id,
                summary="",
                facts=[],
                decisions=[],
                open_questions=[],
                tasks=[],
                user_preferences=[],
                repo_context=[],
                citations=[],
                sessions_incorporated=0,
            )
        else:
            memory = ThreadMemory(
                repo_id=repo_id,
                summary="",
                facts=[],
                decisions=[],
                open_questions=[],
                tasks=[],
                user_preferences=[],
                repo_context=[],
                citations=[],
                sessions_incorporated=0,
            )
        self.db.add(memory)
        self.db.flush()
        return memory

    def _update_thread_memory(
        self,
        repo_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None,
        digest: str,
        memory_update: dict[str, Any],
    ) -> ConversationMemory | ThreadMemory | None:
        if repo_id and conversation_id:
            memory: ConversationMemory | ThreadMemory | None = self.db.query(ConversationMemory).filter(ConversationMemory.conversation_id == conversation_id).first()
        else:
            memory = self.db.query(ThreadMemory).filter(_repo_filter(ThreadMemory, repo_id)).first()
        if not memory:
            memory = self._new_memory(repo_id, conversation_id)
        if memory_update.get("_update_mode") == "snapshot":
            merged = {
                **structured_memory_from_model(memory_update),
                "summary": clip_to_token_budget(str(memory_update.get("summary") or digest), 1100),
            }
        else:
            merged = merge_memory(self._memory_state(memory), memory_update, digest, max_tokens=1100)
        memory.summary = merged["summary"]
        memory.facts = merged["facts"]
        memory.decisions = merged["decisions"]
        memory.open_questions = merged["open_questions"]
        memory.tasks = merged["tasks"]
        memory.user_preferences = merged["user_preferences"]
        memory.repo_context = merged["repo_context"]
        memory.citations = merged["citations"]
        memory.sessions_incorporated = (memory.sessions_incorporated or 0) + 1
        return memory

    def _iso(self, value: datetime | None) -> str | None:
        return value.isoformat() if value else None


class MemoryTools:
    def __init__(self, db: Session, repo: Repository | None, conversation: Conversation | None = None) -> None:
        self.db = db
        self.repo = repo
        self.repo_id = repo.id if repo else None
        self.conversation = conversation
        self.conversation_id = conversation.id if conversation else None

    async def search_evidence(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        query = str(input_data.get("query") or input_data.get("message") or "")
        results = EvidenceStore(self.db).search(self.repo_id, self.conversation_id, query, limit=int(input_data.get("limit") or 5))
        answer = "No evidence matched this query." if not results else "\n".join(
            f"- [{item['source_type']}] {item['title']}: {item['snippet']}" for item in results
        )
        citations = [{"type": item["source_type"], "id": item["source_id"], "title": item["title"]} for item in results]
        record_recall_event(
            self.db,
            repo_id=self.repo_id,
            conversation_id=self.conversation_id,
            tool_name="devhelm_search_evidence",
            query=query,
            results=results,
            citations=citations,
            scope="conversation" if self.conversation_id else "project",
            mode="hybrid",
            metadata={"limit": int(input_data.get("limit") or 5)},
        )
        return {
            "route": "memory_search",
            "tool_calls": [{"tool_name": "search_evidence", "arguments": {"query": query}, "status": "success"}],
            "answer": answer,
            "citations": citations,
            "results": results,
        }

    async def get_thread_context(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        keyword = str(input_data.get("keyword") or input_data.get("query") or "").strip().lower()
        limit = min(max(int(input_data.get("limit") or 30), 1), 100)
        message_id = self._uuid_or_none(input_data.get("message_id"))
        before_message_id = self._uuid_or_none(input_data.get("before_message_id"))
        after_message_id = self._uuid_or_none(input_data.get("after_message_id"))
        offset = max(int(input_data.get("offset") or 0), 0)
        max_chars = min(max(int(input_data.get("max_chars") or 6000), 200), 16000)

        store = MessageStore(self.db)
        if message_id:
            message = (
                self.db.query(ChatMessage)
                .filter(
                    _repo_filter(ChatMessage, self.repo_id),
                    _conversation_filter(ChatMessage, self.conversation_id),
                    ChatMessage.id == message_id,
                    ChatMessage.role.in_(["user", "assistant", "tool", "tool_result"]),
                )
                .one_or_none()
            )
            messages = [message] if message and (message.meta or {}).get("subtype") != "preserved_after_compact" else []
        else:
            messages = store.timeline(
                self.repo_id,
                self.conversation_id,
                limit=None,
                before_message_id=before_message_id,
                after_message_id=after_message_id,
            )
            if keyword:
                terms = _tokens(keyword)
                messages = [msg for msg in messages if any(term in msg.content.lower() for term in terms)]
            messages = messages[-limit:]

        lines: list[str] = []
        results: list[dict[str, Any]] = []
        remaining_chars = max_chars
        for message in messages:
            content = message.content or ""
            chunk_offset = offset if message_id else 0
            chunk = content[chunk_offset : chunk_offset + remaining_chars]
            if not chunk and content:
                continue
            chunk_end = chunk_offset + len(chunk)
            truncated = chunk_end < len(content)
            created_at = message.created_at.isoformat() if message.created_at else ""
            lines.append(
                f"[message_id={message.id} role={message.role} created_at={created_at} chars={chunk_offset}:{chunk_end}/{len(content)}]"
            )
            lines.append(chunk)
            if truncated:
                lines.append(
                    f"[内容未读完；继续调用 message_id={message.id}, offset={chunk_end}]"
                )
            results.append(
                {
                    "title": f"{message.role} message",
                    "source_type": "chat_message",
                    "source_id": str(message.id),
                    "snippet": chunk,
                    "metadata": {
                        "role": message.role,
                        "created_at": created_at,
                        "offset": chunk_offset,
                        "next_offset": chunk_end if truncated else None,
                        "total_chars": len(content),
                        "truncated": truncated,
                    },
                }
            )
            remaining_chars -= len(chunk)
            if remaining_chars <= 0:
                break

        citations = [
            {"type": "chat_message", "id": item["source_id"], "title": item["title"]}
            for item in results
        ]
        record_recall_event(
            self.db,
            repo_id=self.repo_id,
            conversation_id=self.conversation_id,
            tool_name="devhelm_get_thread_context",
            query=keyword or str(message_id or ""),
            results=results,
            citations=citations,
            scope="conversation",
            mode="exact_transcript",
            metadata={
                "limit": limit,
                "message_id": str(message_id) if message_id else None,
                "before_message_id": str(before_message_id) if before_message_id else None,
                "after_message_id": str(after_message_id) if after_message_id else None,
                "offset": offset,
                "max_chars": max_chars,
            },
        )
        return {
            "route": "thread_context",
            "tool_calls": [{"tool_name": "get_thread_context", "arguments": {"keyword": keyword, "message_id": str(message_id or "")}, "status": "success"}],
            "answer": "\n".join(lines) if lines else "当前会话还没有匹配的消息。",
            "citations": citations,
            "results": results,
        }

    async def read_session_events(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        session_id = input_data.get("session_id")
        include_transcript = bool(input_data.get("include_transcript", True))
        offset = max(int(input_data.get("offset") or 0), 0)
        max_chars = min(max(int(input_data.get("max_chars") or 8000), 400), 20000)
        query = self.db.query(ChatSession).filter(
            _repo_filter(ChatSession, self.repo_id),
            _conversation_filter(ChatSession, self.conversation_id),
        ).order_by(ChatSession.created_at.desc())
        if session_id:
            parsed_session_id = self._uuid_or_none(session_id)
            if parsed_session_id is None:
                sessions = []
            else:
                sessions = query.filter(ChatSession.id == parsed_session_id).limit(1).all()
        else:
            sessions = query.limit(min(max(int(input_data.get("limit") or 5), 1), 20)).all()
        lines: list[str] = []
        results: list[dict[str, Any]] = []
        remaining_chars = max_chars
        for session in sessions:
            header = f"Session {session.id} route={session.route} sealed_at={session.sealed_at}"
            payload = session.digest
            if include_transcript:
                payload += "\ntranscript=" + dumps_compact(session.transcript_json or {})
            chunk_offset = offset if session_id else 0
            chunk = payload[chunk_offset : chunk_offset + remaining_chars]
            chunk_end = chunk_offset + len(chunk)
            truncated = chunk_end < len(payload)
            lines.append(header)
            lines.append(chunk)
            if truncated:
                lines.append(
                    f"[会话记录未读完；继续调用 session_id={session.id}, offset={chunk_end}。]"
                )
            results.append(
                {
                    "title": f"Session {session.route}",
                    "source_type": "session",
                    "source_id": str(session.id),
                    "snippet": chunk,
                    "metadata": {
                        "sealed_at": session.sealed_at.isoformat() if session.sealed_at else None,
                        "include_transcript": include_transcript,
                        "offset": chunk_offset,
                        "next_offset": chunk_end if truncated else None,
                        "total_chars": len(payload),
                        "truncated": truncated,
                    },
                }
            )
            remaining_chars -= len(chunk)
            if remaining_chars <= 0:
                break
        citations = [
            {"type": "session", "id": item["source_id"], "title": item["title"]}
            for item in results
        ]
        record_recall_event(
            self.db,
            repo_id=self.repo_id,
            conversation_id=self.conversation_id,
            tool_name="devhelm_read_session_events",
            query=str(session_id or "latest sessions"),
            results=results,
            citations=citations,
            scope="conversation",
            mode="sealed_transcript",
            metadata={"include_transcript": include_transcript, "offset": offset, "max_chars": max_chars},
        )
        return {
            "route": "session_events",
            "tool_calls": [{"tool_name": "read_session_events", "arguments": {"session_id": str(session_id or "")}, "status": "success"}],
            "answer": "\n\n".join(lines) if lines else "No sealed sessions found yet.",
            "citations": citations,
            "results": results,
        }

    @staticmethod
    def _uuid_or_none(value: Any) -> uuid.UUID | None:
        if not value:
            return None
        try:
            return uuid.UUID(str(value))
        except (TypeError, ValueError):
            return None
