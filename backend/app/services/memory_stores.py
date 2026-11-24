from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db.models import (
    AgentRun,
    ChatMessage,
    ChatSession,
    Conversation,
    ConversationMemory,
    Document,
    EvidenceItem,
    Issue,
    PullRequest,
    Repository,
    ThreadMemory,
    WorkflowRun,
)
from app.services.context_compression import (
    extract_relevant_snippet,
    is_compact_boundary_message,
    memory_document_text,
)
from app.services.rag.indexing import CI_LOG_CHUNK_CHARS, sanitize_ci_log
from app.services.rag.retrieval import search_similar_documents
from app.services.rag.source_policy import RAG_SOURCE_TYPES
from app.services.rag.vector_store import MilvusUnavailableError


def _repo_filter(model: Any, repo_id: uuid.UUID | None) -> Any:
    return model.repo_id.is_(None) if repo_id is None else model.repo_id == repo_id


def _conversation_filter(model: Any, conversation_id: uuid.UUID | None) -> Any:
    return model.conversation_id.is_(None) if conversation_id is None else model.conversation_id == conversation_id


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9_\-\u4e00-\u9fff]+", text.lower())


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: max(0, limit - 3)].rstrip() + "..."


class MessageStore:
    def __init__(self, db: Session) -> None:
        self.db = db

    def append(
        self,
        *,
        repo_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None,
        role: str,
        content: str,
        route: str | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> ChatMessage:
        message = ChatMessage(
            repo_id=repo_id,
            conversation_id=conversation_id,
            role=role,
            content=content,
            route=route,
            tool_calls=tool_calls or [],
            meta=meta or {},
        )
        self.db.add(message)
        self.db.flush()
        return message

    def recent(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None, limit: int = 20) -> list[ChatMessage]:
        """Return the active context projection, not the complete transcript.

        New compact boundaries keep references to the original recent messages
        instead of copying them. Older databases can still contain
        ``preserved_after_compact`` copies, so this method understands both
        layouts during the migration period.
        """
        boundary = self.last_compact_boundary(repo_id, conversation_id)
        if boundary is None:
            return self.timeline(repo_id, conversation_id, limit=limit, include_system=True)

        boundary_meta = boundary.meta or {}
        preserved_ids = [
            value
            for value in boundary_meta.get("preserved_message_ids") or []
            if value
        ]
        preserved_rows: list[ChatMessage] = []
        if preserved_ids:
            parsed_ids: list[uuid.UUID] = []
            for value in preserved_ids:
                try:
                    parsed_ids.append(uuid.UUID(str(value)))
                except ValueError:
                    continue
            if parsed_ids:
                by_id = {
                    row.id: row
                    for row in self.db.query(ChatMessage)
                    .filter(
                        _repo_filter(ChatMessage, repo_id),
                        _conversation_filter(ChatMessage, conversation_id),
                        ChatMessage.id.in_(parsed_ids),
                    )
                    .all()
                }
                preserved_rows = [by_id[item] for item in parsed_ids if item in by_id]

        rows_after_boundary = (
            self.db.query(ChatMessage)
            .filter(
                _repo_filter(ChatMessage, repo_id),
                _conversation_filter(ChatMessage, conversation_id),
                ChatMessage.created_at >= boundary.created_at,
            )
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        projected = [boundary, *preserved_rows]
        projected.extend(
            row
            for row in rows_after_boundary
            if row.id != boundary.id
            and str(row.id) not in preserved_ids
            and not (
                preserved_ids
                and (row.meta or {}).get("subtype") == "preserved_after_compact"
            )
        )
        return projected[-max(1, limit) :]

    def timeline(
        self,
        repo_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None,
        *,
        limit: int | None = 500,
        include_system: bool = False,
        before_message_id: uuid.UUID | None = None,
        after_message_id: uuid.UUID | None = None,
    ) -> list[ChatMessage]:
        """Return the durable transcript while hiding compatibility copies.

        Compact boundaries change the model's active projection; they do not
        erase the transcript. This method is the authoritative read path for
        UI history and exact-memory tools.
        """
        query = self.db.query(ChatMessage).filter(
            _repo_filter(ChatMessage, repo_id),
            _conversation_filter(ChatMessage, conversation_id),
        )
        if not include_system:
            query = query.filter(ChatMessage.role != "system")

        if before_message_id:
            before = (
                self.db.query(ChatMessage)
                .filter(
                    _repo_filter(ChatMessage, repo_id),
                    _conversation_filter(ChatMessage, conversation_id),
                    ChatMessage.id == before_message_id,
                )
                .one_or_none()
            )
            if before and before.created_at:
                query = query.filter(
                    or_(
                        ChatMessage.created_at < before.created_at,
                        and_(
                            ChatMessage.created_at == before.created_at,
                            ChatMessage.id < before.id,
                        ),
                    )
                )
        if after_message_id:
            after = (
                self.db.query(ChatMessage)
                .filter(
                    _repo_filter(ChatMessage, repo_id),
                    _conversation_filter(ChatMessage, conversation_id),
                    ChatMessage.id == after_message_id,
                )
                .one_or_none()
            )
            if after and after.created_at:
                query = query.filter(
                    or_(
                        ChatMessage.created_at > after.created_at,
                        and_(
                            ChatMessage.created_at == after.created_at,
                            ChatMessage.id > after.id,
                        ),
                    )
                )

        rows = query.order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc()).all()
        durable = [
            row
            for row in rows
            if (row.meta or {}).get("subtype") != "preserved_after_compact"
        ]
        if limit is None:
            return durable
        if after_message_id and not before_message_id:
            return durable[: max(1, limit)]
        return durable[-max(1, limit) :]

    def active_for_context(
        self,
        repo_id: uuid.UUID | None,
        conversation_id: uuid.UUID | None,
        limit: int = 1000,
    ) -> list[ChatMessage]:
        return self.recent(repo_id, conversation_id, limit=limit)

    def all_for_context(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None, limit: int = 200) -> list[ChatMessage]:
        rows = (
            self.db.query(ChatMessage)
            .filter(_repo_filter(ChatMessage, repo_id), _conversation_filter(ChatMessage, conversation_id))
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
            .all()
        )
        return list(reversed(rows))

    def last_compact_boundary(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None) -> ChatMessage | None:
        rows = (
            self.db.query(ChatMessage)
            .filter(_repo_filter(ChatMessage, repo_id), _conversation_filter(ChatMessage, conversation_id), ChatMessage.role == "system")
            .order_by(ChatMessage.created_at.desc())
            .limit(50)
            .all()
        )
        for row in rows:
            if is_compact_boundary_message({"role": row.role, "meta": row.meta or {}}):
                return row
        return None


class EvidenceStore:
    def __init__(self, db: Session) -> None:
        self.db = db

    def rebuild_repo(self, repo: Repository | None, conversation: Conversation | None = None) -> None:
        repo_id = repo.id if repo else None
        conversation_id = conversation.id if conversation else None
        if conversation_id:
            self.db.query(EvidenceItem).filter(
                _repo_filter(EvidenceItem, repo_id),
                or_(EvidenceItem.conversation_id == conversation_id, EvidenceItem.conversation_id.is_(None)),
            ).delete(synchronize_session=False)
        else:
            self.db.query(EvidenceItem).filter(_repo_filter(EvidenceItem, repo_id)).delete(synchronize_session=False)

        if repo:
            self._add(
                repo_id,
                None,
                "repository",
                str(repo.id),
                repo.full_name,
                "\n".join(filter(None, [repo.description or "", f"默认分支：{repo.default_branch or '未知'}"])),
                {"anchor": f"repo:{repo.full_name}"},
            )
            for issue in self.db.query(Issue).filter(Issue.repo_id == repo.id).all():
                self._add(
                    repo.id,
                    None,
                    "issue",
                    str(issue.id),
                    f"Issue #{issue.number}: {issue.title}",
                    "\n".join(filter(None, [issue.title, issue.body or "", f"state: {issue.state}", f"labels: {', '.join(issue.labels or [])}"])),
                    {"number": issue.number, "state": issue.state},
                )
            for pr in self.db.query(PullRequest).filter(PullRequest.repo_id == repo.id).all():
                self._add(
                    repo.id,
                    None,
                    "pull_request",
                    str(pr.id),
                    f"PR #{pr.number}: {pr.title}",
                    "\n".join(filter(None, [pr.title, pr.body or "", f"state: {pr.state}", f"base: {pr.base_branch}", f"head: {pr.head_branch}"])),
                    {"number": pr.number, "state": pr.state},
                )
            for run in self.db.query(WorkflowRun).filter(WorkflowRun.repo_id == repo.id).all():
                if run.conclusion != "failure" or not (run.logs_text or "").strip():
                    continue
                sanitized_logs = sanitize_ci_log(run.logs_text or "")
                safe_logs = sanitized_logs[:CI_LOG_CHUNK_CHARS]
                self._add(
                    repo.id,
                    None,
                    "workflow_run",
                    str(run.id),
                    f"CI: {run.name}",
                    "\n".join(filter(None, [run.name, run.status, run.conclusion or "", safe_logs])),
                    {
                        "status": run.status,
                        "conclusion": run.conclusion,
                        "logs_truncated": len(sanitized_logs) > CI_LOG_CHUNK_CHARS,
                        "secrets_redacted": True,
                    },
                )
            for doc in (
                self.db.query(Document)
                .filter(Document.repo_id == repo.id, Document.source_type.in_(RAG_SOURCE_TYPES))
                .all()
            ):
                self._add(repo.id, None, doc.source_type, str(doc.source_id), doc.title, doc.content, doc.meta or {})

        memories = (
            self.db.query(ConversationMemory).filter(ConversationMemory.conversation_id == conversation_id).all()
            if conversation_id
            else self.db.query(ThreadMemory).filter(_repo_filter(ThreadMemory, repo_id)).all()
        )
        for memory in memories:
            self._add(
                repo_id,
                conversation_id,
                "memory",
                str(memory.id),
                "Thread memory",
                memory_document_text(memory),
                {"sessions_incorporated": memory.sessions_incorporated},
            )
        session_query = self.db.query(ChatSession).filter(_repo_filter(ChatSession, repo_id))
        run_query = self.db.query(AgentRun).filter(_repo_filter(AgentRun, repo_id))
        if conversation_id:
            session_query = session_query.filter(ChatSession.conversation_id == conversation_id)
            run_query = run_query.filter(AgentRun.conversation_id == conversation_id)
        for session in session_query.order_by(ChatSession.created_at.desc()).limit(30):
            self._add(repo_id, conversation_id, "session", str(session.id), f"Session digest: {session.route}", session.digest, {"route": session.route})
        for run in run_query.order_by(AgentRun.created_at.desc()).limit(30):
            self._add(repo_id, conversation_id, "agent_run", str(run.id), f"Agent run: {run.route}", f"{run.user_message}\n{run.final_answer}", {"route": run.route})
        self.db.flush()

    def search(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None, query: str, limit: int = 5) -> list[dict[str, Any]]:
        query_terms = _tokens(query)
        if not query_terms:
            return []
        results: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        if repo_id:
            try:
                rag_results = search_similar_documents(
                    self.db,
                    repo_id,
                    query,
                    source_type=None,
                    limit=max(limit, 8),
                )
            except MilvusUnavailableError:
                rag_results = []
            for item in rag_results:
                key = (str(item.get("source_type") or ""), str(item.get("source_id") or ""))
                if key in seen:
                    continue
                seen.add(key)
                results.append(
                    {
                        "title": item.get("title") or "",
                        "source_type": item.get("source_type") or "",
                        "source_id": item.get("source_id") or "",
                        "snippet": item.get("snippet") or "",
                        "score": item.get("score") or 0,
                        "metadata": item.get("metadata") or {},
                        "retrieval": item.get("retrieval") or {},
                    }
                )
                if len(results) >= limit:
                    return results
        candidates = (
            self.db.query(EvidenceItem)
            .filter(
                _repo_filter(EvidenceItem, repo_id),
                or_(EvidenceItem.conversation_id == conversation_id, EvidenceItem.conversation_id.is_(None)),
            )
            .order_by(EvidenceItem.created_at.desc())
            .limit(500)
            .all()
        )
        ranked: list[tuple[int, EvidenceItem]] = []
        for item in candidates:
            key = (item.source_type, item.source_id)
            if key in seen:
                continue
            haystack = f"{item.title}\n{item.content}".lower()
            score = sum(haystack.count(term) for term in query_terms)
            if score:
                ranked.append((score, item))
        ranked.sort(key=lambda pair: (pair[0], pair[1].created_at), reverse=True)
        for score, item in ranked:
            key = (item.source_type, item.source_id)
            if key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "title": item.title,
                    "source_type": item.source_type,
                    "source_id": item.source_id,
                    "snippet": extract_relevant_snippet(query, item.content, max_tokens=90),
                    "score": score,
                    "metadata": item.meta or {},
                    "retrieval": {"sources": ["evidence_item_keyword"]},
                }
            )
            if len(results) >= limit:
                break
        return results

    def _add(self, repo_id: uuid.UUID | None, conversation_id: uuid.UUID | None, source_type: str, source_id: str, title: str, content: str, meta: dict[str, Any]) -> None:
        if not content.strip():
            return
        self.db.add(EvidenceItem(repo_id=repo_id, conversation_id=conversation_id, source_type=source_type, source_id=source_id, title=title, content=content, meta=meta))
