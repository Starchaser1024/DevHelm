from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import settings
from app.services.agents.chat_agent_types import ConversationState


class ChatAgentPolicyMixin:
    """Memory/history routing policies, project prefetch, and local fallback synthesis."""

    model: Any
    _record_prompt_diagnostics: Any
    _record_model_usage: Any
    _message_content: Any
    _execute_tool_call_events: Any
    _runtime_tool_context: Any
    _team_assignment_context: Any
    _render_evaluation_context: Any

    def _asks_project_overview(self, message: str) -> bool:
        lowered = message.lower()
        if any(token in lowered for token in ["issue", "pull request", "pr #", "ci", "未关闭", "待处理"]):
            return False
        return any(
            token in lowered
            for token in [
                "what is this project",
                "what does this project",
                "project about",
                "repository about",
                "tech stack",
                "architecture",
                "setup",
                "项目介绍",
                "项目概览",
                "这个项目",
                "该项目",
                "这个仓库",
                "该仓库",
                "做什么",
                "架构",
                "技术栈",
            ]
        )

    def _required_memory_tool(self, message: str, context: dict[str, Any] | None = None) -> str | None:
        policy = self._memory_context_policy(message, context or {})
        return str((policy or {}).get("tool") or "") or None

    def _memory_context_policy(self, message: str, context: dict[str, Any]) -> dict[str, Any] | None:
        lowered = message.lower()
        for tool_name in [
            "devhelm_search_evidence",
            "devhelm_get_thread_context",
            "devhelm_read_session_events",
        ]:
            if tool_name in lowered:
                return {"mode": "required_tool", "tool": tool_name, "reason": "explicit_tool_request"}
        if any(token in lowered for token in ["历史证据", "历史决策", "项目记忆", "historical evidence", "past decision"]):
            return {"mode": "required_tool", "tool": "devhelm_search_evidence", "reason": "project_history_request"}
        if any(
            token in lowered
            for token in [
                "封存会话",
                "会话摘要",
                "上次会话",
                "上个会话",
                "跨会话",
                "session digest",
                "session events",
                "previous session",
                "previous conversation",
            ]
        ):
            return {"mode": "required_tool", "tool": "devhelm_read_session_events", "reason": "cross_session_request"}

        immediate_recall = any(
            token in lowered
            for token in [
                "刚刚说",
                "刚才说",
                "上一条消息",
                "上一句话",
                "上一句",
                "what did i just say",
                "my last message",
            ]
        )
        broad_recall = immediate_recall or any(
            token in lowered
            for token in [
                "之前说过",
                "上次讨论",
                "聊天历史",
                "会话历史",
                "你记得",
                "前面说过",
                "what did we say",
                "earlier in this chat",
            ]
        )
        if not broad_recall:
            return None

        requires_exact_verification = any(
            token in lowered
            for token in ["原话", "逐字", "准确核实", "精确核实", "审计", "verbatim", "exact quote", "verify the record"]
        )
        if requires_exact_verification:
            return {"mode": "required_tool", "tool": "devhelm_get_thread_context", "reason": "exact_verification_requested"}

        if self._recent_history_can_answer(message, context, immediate=immediate_recall):
            return {
                "mode": "direct_recent_history",
                "tool": None,
                "reason": "exact_recent_messages_available",
            }
        return {"mode": "required_tool", "tool": "devhelm_get_thread_context", "reason": "recent_history_incomplete"}

    def _recent_history_can_answer(self, message: str, context: dict[str, Any], *, immediate: bool) -> bool:
        history = self._history_messages(context)
        prior_user_index = self._last_prior_user_index(history, message)
        if prior_user_index is None:
            return False
        coverage = self._history_coverage(context)
        if not coverage:
            return True
        if immediate:
            exact_suffix = int(coverage.get("exact_suffix_messages") or 0)
            distance_from_end = len(history) - prior_user_index
            return exact_suffix >= distance_from_end
        return bool(coverage.get("complete_and_exact"))

    def _last_prior_user_index(self, history: list[dict[str, str]], message: str) -> int | None:
        normalized_current = self._normalize_history_text(message)
        indexes = [index for index, item in enumerate(history) if item.get("role") == "user"]
        if indexes and self._normalize_history_text(history[indexes[-1]].get("content") or "") == normalized_current:
            indexes.pop()
        return indexes[-1] if indexes else None

    def _normalize_history_text(self, value: str) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().lower())

    async def _direct_answer_from_recent_history(self, state: ConversationState) -> str:
        if self.model is None:
            return self._local_recent_history_answer(state)
        history = self._history_messages(state.get("context") or {})
        try:
            system_prompt = (
                "请直接根据提供的近期原始消息回答，不要声称调用了任何工具。"
                "最后一条与当前问题相同的 user 消息是本轮问题，不要把它当成用户要回忆的上一条内容。"
                "只回答上下文能证明的内容；如果用户问上一条消息，优先简洁复述上一条 user 消息。"
            )
            user_prompt = (
                f"近期原始消息：{json.dumps(history, ensure_ascii=False)}\n"
                f"当前用户问题：{state.get('message') or ''}"
            )
            estimated = self._record_prompt_diagnostics(
                state,
                phase="direct_recent_history",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            response = await self.model.ainvoke(
                [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
            )
            self._record_model_usage(
                state,
                response,
                phase="direct_recent_history",
                estimated_prompt_tokens=estimated,
            )
            return self._message_content(response).strip() or self._local_recent_history_answer(state)
        except Exception:
            return self._local_recent_history_answer(state)

    def _local_recent_history_answer(self, state: ConversationState) -> str:
        history = self._history_messages(state.get("context") or {})
        prior_user_index = self._last_prior_user_index(history, str(state.get("message") or ""))
        if prior_user_index is None:
            return "当前上下文里没有可确认的上一条用户消息。"
        content = history[prior_user_index].get("content") or ""
        return f"你刚刚说的是：{content}"

    def _history_coverage(self, context: dict[str, Any]) -> dict[str, Any]:
        compression_stats = context.get("compression_stats") or {}
        if not isinstance(compression_stats, dict):
            return {}
        coverage = compression_stats.get("history_coverage") or {}
        return coverage if isinstance(coverage, dict) else {}

    async def _prefetch_memory_context(self, state: ConversationState, public_name: str) -> AsyncIterator[dict[str, Any]]:
        tools = state.get("tools") or {}
        tool_names = state.get("tool_name_map") or {}
        safe_name = next((safe for safe, public in tool_names.items() if public == public_name), None)
        if not safe_name or safe_name not in tools:
            return
        message = str(state.get("message") or "")
        args: dict[str, Any]
        if public_name == "devhelm_search_evidence":
            args = {"query": message, "limit": 5}
        elif public_name == "devhelm_get_thread_context":
            args = {"keyword": "", "limit": 20}
        else:
            args = {"limit": 5}
        async for event in self._execute_tool_call_events(
            {"name": safe_name, "args": args, "id": f"required_{public_name}_{len(state.get('agent_events') or [])}"},
            state,
        ):
            yield event

    async def _prefetch_project_context(self, state: ConversationState) -> AsyncIterator[dict[str, Any]]:
        tools = state.get("tools") or {}
        tool_names = state.get("tool_name_map") or {}
        safe_by_public = {public: safe for safe, public in tool_names.items()}

        async def call(public_name: str, args: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
            safe_name = safe_by_public.get(public_name)
            if not safe_name or safe_name not in tools:
                return
            async for event in self._execute_tool_call_events(
                {"name": safe_name, "args": args, "id": f"prefetch_{public_name}_{len(state.get('agent_events') or [])}"},
                state,
            ):
                yield event

        async for event in call("workspace.list_files", {"path": ".", "limit": 120}):
            yield event
        observed_paths: set[str] = set()
        for item in state.get("observations") or []:
            if not isinstance(item, dict) or not isinstance(item.get("observation"), dict):
                continue
            preview = str(item["observation"].get("answer_preview") or "")
            observed_paths.update(token.strip("'\"`[](),").lower() for token in preview.split())
        for path in ["README.md", "README.zh-CN.md", "package.json", "SETUP.md"]:
            if path.lower() in observed_paths:
                async for event in call("workspace.read_file", {"path": path, "line_count": 220}):
                    yield event

    async def _final_from_observations(self, state: ConversationState) -> str:
        if self.model is None:
            return self._local_observation_answer(state)
        try:
            system_prompt = (
                "请使用用户的语言回答，并且只能基于观察结果、tool_result 记录和上下文。"
                "关键判断要说明 WHY；把证据、推断、不确定项和下一步区分开。"
                "如果是审查或合并建议，不能用 looks good、没什么问题一笔带过，必须保留风险和阻塞项。"
                "对于负责人、已分配人员、责任人或任务分配问题，只能从明确的 DevHelm team_members "
                "或工具返回的现有 GitHub assignees 中推荐人员。仓库文档、Issue 文本、代码、示例、"
                "角色设定、模型名和团队比喻都不能当成人。如果没有配置团队成员，也没有观察到现有 assignee，"
                "请说明当前还没有添加项目成员，并要求用户在团队面板中添加开发者。"
            )
            prompt_observations, prompt_events, runtime_stats = self._runtime_tool_context(state)
            state["runtime_context_stats"] = {**(state.get("runtime_context_stats") or {}), **runtime_stats}
            user_prompt = (
                f"用户消息：{state.get('message') or ''}\n"
                f"当前 Agent 配置的运行模型：{settings.llm_model}\n"
                f"DevHelm 团队上下文：{self._team_assignment_context(state.get('context') or {})}\n"
                f"上下文：{self._server_context(state.get('context') or {})}\n"
                f"观察结果：{json.dumps(prompt_observations, ensure_ascii=False)}\n"
                f"工具调用/结果索引：{json.dumps(prompt_events, ensure_ascii=False)}"
            )
            estimated = self._record_prompt_diagnostics(
                state,
                phase="final_from_observations",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            response = await self.model.ainvoke(
                [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
            )
            self._record_model_usage(
                state,
                response,
                phase="final_from_observations",
                estimated_prompt_tokens=estimated,
            )
            return self._message_content(response)
        except Exception:
            return self._local_observation_answer(state)

    def _local_observation_answer(self, state: ConversationState) -> str:
        observations = state.get("observations") or []
        excerpts: list[str] = []
        for item in observations:
            if not isinstance(item, dict):
                continue
            value = item.get("answer") or item.get("content") or item.get("result") or item.get("message")
            if not value and isinstance(item.get("observation"), dict):
                nested = item["observation"]
                if nested.get("route") == "tool_error":
                    continue
                value = nested.get("answer_preview") or nested.get("answer") or nested.get("content")
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            text = " ".join(str(value or "").split())
            if text:
                excerpts.append(text[:600])
        if not excerpts:
            evidence_answer = self._local_prefetched_evidence_answer(state)
            if evidence_answer:
                return evidence_answer
            context_text = " ".join(self._server_context(state.get("context") or {}).split())
            if context_text:
                return "已读取当前仓库上下文。\n\n" + context_text[:1200]
            return "当前没有取得足够证据。请先确认仓库已连接并完成同步；开放式对话还需要配置 LLM。"
        return "已读取当前仓库证据。\n\n" + "\n\n".join(
            f"{index + 1}. {excerpt}" for index, excerpt in enumerate(excerpts[:4])
        )

    def _local_prefetched_evidence_answer(self, state: ConversationState) -> str:
        context = state.get("context") or {}
        raw_evidence = context.get("evidence")
        if not isinstance(raw_evidence, list):
            return ""
        evidence = [item for item in raw_evidence if isinstance(item, dict)]
        if not evidence:
            return ""

        message = str(state.get("message") or "").lower()
        asks_open_issues = "issue" in message and any(
            token in message for token in ["未关闭", "待处理", "open", "开放"]
        )
        if asks_open_issues:
            open_issues = [
                item
                for item in evidence
                if str(item.get("source_type") or "") == "issue"
                and str((item.get("metadata") or {}).get("state") or "").lower() == "open"
            ]
            if open_issues:
                lines = ["根据本轮预检索证据，当前仓库有这些未关闭的 Issue："]
                for item in open_issues[:8]:
                    title = str(item.get("title") or "未命名 Issue").strip()
                    snippet = " ".join(str(item.get("snippet") or "").split())
                    lines.append(f"- {title}" + (f"：{snippet[:240]}" if snippet else ""))
                lines.append("\n数据来自当前仓库已同步的 Issue 证据；本轮没有调用工作区源码工具。")
                return "\n".join(lines)

        rendered = [self._render_evaluation_context(item) for item in evidence[:8]]
        rendered = [item for item in rendered if item]
        if not rendered:
            return ""
        return "根据当前仓库已同步的证据：\n\n" + "\n\n".join(
            f"{index + 1}. {item}" for index, item in enumerate(rendered)
        )

    def _prefetched_evidence_citations(self, state: ConversationState) -> list[dict[str, str]]:
        context = state.get("context") or {}
        evidence = context.get("evidence")
        if not isinstance(evidence, list):
            return []
        return [
            {
                "type": str(item.get("source_type") or "evidence"),
                "id": str(item.get("source_id") or item.get("id") or ""),
                "title": str(item.get("title") or "未命名证据"),
            }
            for item in evidence[:8]
            if isinstance(item, dict)
        ]

    async def _fallback_answer(self, state: ConversationState) -> str:
        return await self._final_from_observations(state)

    def _history_messages(self, context: dict[str, Any]) -> list[dict[str, str]]:
        raw_messages = context.get("server_messages") or context.get("messages") or []
        if not isinstance(raw_messages, list):
            return []
        messages: list[dict[str, str]] = []
        for item in raw_messages:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            content = item.get("content")
            if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
                messages.append({"role": role, "content": content})
        return messages

    def _server_context(self, context: dict[str, Any]) -> str:
        value = context.get("server_context")
        return str(value) if value else ""
