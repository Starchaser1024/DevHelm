from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool

from app.services.agents.chat_agent_types import (
    TOOL_DESCRIPTIONS,
    ConversationState,
    ConversationTool,
    GenericToolArgs,
    ToolErrorKind,
)


class ChatAgentToolExecutionMixin:
    """Tool schema binding, argument normalization, loop guard, and retry execution."""

    max_repeated_tool_calls: int
    tool_retry_attempts: int
    _append_agent_event: Any
    _event: Any
    _skill_event_metadata: Any
    _explicit_skill_tool_violation: Any
    _capture_evaluation_observation: Any
    _summarize_observation: Any
    _asks_project_overview: Any

    def _repeated_tool_call(self, tool_calls: list[dict[str, Any]], state: ConversationState) -> dict[str, Any] | None:
        counts = dict(state.get("tool_call_counts") or {})
        for tool_call in tool_calls:
            safe_action, public_action, _tool_use_id, action_input = self._tool_call_parts(tool_call, state)
            fingerprint = self._tool_call_fingerprint(safe_action, action_input)
            repeat_count = counts.get(fingerprint, 0) + 1
            counts[fingerprint] = repeat_count
            if repeat_count > self.max_repeated_tool_calls:
                state["tool_call_counts"] = counts
                return {
                    "tool_name": public_action,
                    "arguments": action_input,
                    "fingerprint": fingerprint,
                    "repeat_count": repeat_count,
                }
        state["tool_call_counts"] = counts
        return None

    def _tool_call_fingerprint(self, safe_action: str, action_input: dict[str, Any]) -> str:
        return f"{safe_action}:{json.dumps(action_input, ensure_ascii=False, sort_keys=True, default=str)}"

    def _preview_tool_use_event(self, raw_state: Any) -> dict[str, Any] | None:
        if not isinstance(raw_state, dict):
            return None
        pending = raw_state.get("pending_tool_calls")
        if not isinstance(pending, list) or not pending or not isinstance(pending[0], dict):
            return None
        safe_action, public_action, tool_use_id, action_input = self._tool_call_parts(pending[0], raw_state)
        return {
            "type": "tool_use",
            "step": raw_state.get("step", 0),
            "id": tool_use_id,
            "tool_name": public_action,
            "arguments": action_input,
            **self._skill_event_metadata(public_action, raw_state),  # type: ignore[arg-type]
        }

    async def _execute_tool_call_events(
        self,
        tool_call: dict[str, Any],
        state: ConversationState,
    ) -> AsyncIterator[dict[str, Any]]:
        safe_action, public_action, tool_use_id, action_input, tool_use_event = self._prepare_tool_call(tool_call, state)
        yield self._event("tool_use", tool_use_event)
        observation, _tool_message, tool_result_event = await self._complete_tool_call(
            safe_action,
            public_action,
            tool_use_id,
            action_input,
            state,
        )
        yield self._event("tool_result", tool_result_event)
        yield self._event("action", {"tool_name": public_action, "arguments": action_input})
        yield self._event("observation", {"tool_name": public_action, "content": observation})

    async def _execute_tool_call(
        self,
        tool_call: dict[str, Any],
        state: ConversationState,
    ) -> tuple[str, dict[str, Any], dict[str, Any], ToolMessage, dict[str, Any], dict[str, Any]]:
        safe_action, public_action, tool_use_id, action_input, tool_use_event = self._prepare_tool_call(tool_call, state)
        observation, tool_message, tool_result_event = await self._complete_tool_call(
            safe_action,
            public_action,
            tool_use_id,
            action_input,
            state,
        )
        return public_action, action_input, observation, tool_message, tool_use_event, tool_result_event

    def _prepare_tool_call(
        self,
        tool_call: dict[str, Any],
        state: ConversationState,
    ) -> tuple[str, str, str, dict[str, Any], dict[str, Any]]:
        safe_action, public_action, tool_use_id, action_input = self._tool_call_parts(tool_call, state)
        tool_use_event = self._append_agent_event(
            state,
            "tool_use",
            {"id": tool_use_id, "tool_name": public_action, "arguments": action_input, **self._skill_event_metadata(public_action, state)},
        )
        return safe_action, public_action, tool_use_id, action_input, tool_use_event

    def _tool_call_parts(
        self,
        tool_call: dict[str, Any],
        state: ConversationState | dict[str, Any],
    ) -> tuple[str, str, str, dict[str, Any]]:
        safe_action = str(tool_call.get("name") or "").strip()
        public_action = self._public_tool_name(safe_action, state)  # type: ignore[arg-type]
        tool_use_id = str(tool_call.get("id") or f"tool_use_{len(state.get('agent_events') or []) + 1}")
        raw_args = tool_call.get("args") if isinstance(tool_call, dict) else {}
        if isinstance(raw_args, str):
            try:
                raw_args = json.loads(raw_args)
            except json.JSONDecodeError:
                raw_args = {}
        action_input = self._normalize_action_input(public_action, raw_args if isinstance(raw_args, dict) else {}, state)  # type: ignore[arg-type]
        return safe_action, public_action, tool_use_id, action_input

    async def _complete_tool_call(
        self,
        safe_action: str,
        public_action: str,
        tool_use_id: str,
        action_input: dict[str, Any],
        state: ConversationState,
    ) -> tuple[dict[str, Any], ToolMessage, dict[str, Any]]:
        tools = state.get("tools") or {}
        skill_violation = self._explicit_skill_tool_violation(public_action, state)
        if skill_violation:
            error = skill_violation
            error_kind: ToolErrorKind = "permission_denied"
            observation = {
                "route": "tool_error",
                "answer": error,
                "citations": [],
                "tool_calls": [
                    {
                        "tool_name": public_action,
                        "arguments": action_input,
                        "status": "error",
                        "error": error,
                        "error_kind": error_kind,
                        "retryable": False,
                        "attempts": 1,
                        "tool_use_id": tool_use_id,
                    }
                ],
                "error_kind": error_kind,
                "retryable": False,
            }
        elif safe_action not in tools:
            error = f"未知工具：{public_action}。可用工具：{', '.join(state.get('tool_name_map', {}).values())}"
            error_kind = "unknown_tool"
            observation = {
                "route": "tool_error",
                "answer": error,
                "citations": [],
                "tool_calls": [
                    {
                        "tool_name": public_action,
                        "arguments": action_input,
                        "status": "error",
                        "error": error,
                        "error_kind": error_kind,
                        "retryable": False,
                        "attempts": 1,
                        "tool_use_id": tool_use_id,
                    }
                ],
                "error_kind": error_kind,
                "retryable": False,
            }
        else:
            observation = await self._invoke_tool_with_recovery(
                tools[safe_action],
                public_action,
                tool_use_id,
                action_input,
                state,
            )

        if not observation.get("tool_calls"):
            observation["tool_calls"] = [
                {
                    "tool_name": public_action,
                    "arguments": action_input,
                    "status": "success",
                    "tool_use_id": tool_use_id,
                    **self._skill_event_metadata(public_action, state),
                }
            ]
        for call in observation.get("tool_calls", []):
            if isinstance(call, dict):
                call.setdefault("tool_use_id", tool_use_id)
                if observation.get("attempts") is not None:
                    call.setdefault("attempts", observation.get("attempts"))
                if observation.get("error_kind") is not None:
                    call.setdefault("error_kind", observation.get("error_kind"))
                if observation.get("retryable") is not None:
                    call.setdefault("retryable", observation.get("retryable"))
                call.update(self._skill_event_metadata(str(call.get("tool_name") or public_action), state))
        self._capture_evaluation_observation(
            state,
            tool_name=public_action,
            arguments=action_input,
            observation=observation,
        )
        summary = self._summarize_observation(observation)
        status = "error" if any(call.get("status") == "error" for call in observation.get("tool_calls", []) if isinstance(call, dict)) else "success"
        tool_result_event = self._append_agent_event(
            state,
            "tool_result",
            {
                "tool_use_id": tool_use_id,
                "tool_name": public_action,
                "status": status,
                "route": observation.get("route"),
                "error_kind": observation.get("error_kind"),
                "retryable": observation.get("retryable"),
                "content": summary,
                **self._skill_event_metadata(public_action, state),
            },
        )
        state["observations"] = [
            *(state.get("observations") or []),
            {"tool_name": public_action, "arguments": action_input, "observation": summary},
        ]
        state["tool_calls"] = [*(state.get("tool_calls") or []), *observation.get("tool_calls", [])]
        state["citations"] = [*(state.get("citations") or []), *observation.get("citations", [])]
        extra_events = observation.get("agent_events")
        if isinstance(extra_events, list):
            state["agent_events"] = [*(state.get("agent_events") or []), *[event for event in extra_events if isinstance(event, dict)]]
        observation_route = str(observation.get("route") or "")
        has_successful_tool = any(call.get("status") == "success" for call in state.get("tool_calls") or [])
        if observation_route and (observation_route != "tool_error" or not has_successful_tool):
            state["route"] = observation_route

        tool_message = ToolMessage(
            content=json.dumps(summary, ensure_ascii=False),
            tool_call_id=tool_use_id,
        )
        return summary, tool_message, tool_result_event

    async def _invoke_tool_with_recovery(
        self,
        tool: StructuredTool,
        public_action: str,
        tool_use_id: str,
        action_input: dict[str, Any],
        state: ConversationState,
    ) -> dict[str, Any]:
        max_attempts = 1 + self.tool_retry_attempts
        last_error: Exception | None = None
        last_error_kind: ToolErrorKind = "tool_runtime_error"
        retryable = False
        for attempt in range(1, max_attempts + 1):
            try:
                observation = await tool.ainvoke(action_input)
                if isinstance(observation, dict):
                    observation.setdefault("attempts", attempt)
                    return observation
                return {
                    "route": public_action,
                    "answer": str(observation),
                    "citations": [],
                    "tool_calls": [],
                    "attempts": attempt,
                }
            except Exception as exc:
                last_error = exc
                last_error_kind = self._classify_tool_error(exc)
                retryable = self._is_retriable_tool_error(last_error_kind, public_action)
                if not retryable or attempt >= max_attempts:
                    break
                self._append_agent_event(
                    state,
                    "tool_retry",
                    {
                        "tool_use_id": tool_use_id,
                        "tool_name": public_action,
                        "attempt": attempt,
                        "next_attempt": attempt + 1,
                        "error_kind": last_error_kind,
                        "error": str(exc),
                    },
                )
        error_text = str(last_error or "unknown tool failure")
        return {
            "route": "tool_error",
            "answer": f"工具 {public_action} 执行失败：{error_text}",
            "citations": [],
            "tool_calls": [
                {
                    "tool_name": public_action,
                    "arguments": action_input,
                    "status": "error",
                    "error": error_text,
                    "error_kind": last_error_kind,
                    "retryable": retryable,
                    "attempts": max_attempts if retryable else 1,
                    "tool_use_id": tool_use_id,
                }
            ],
            "error_kind": last_error_kind,
            "retryable": retryable,
            "attempts": max_attempts if retryable else 1,
        }

    def _classify_tool_error(self, exc: Exception) -> ToolErrorKind:
        if isinstance(exc, TimeoutError):
            return "timeout"
        text = str(exc).lower()
        if any(token in text for token in ["timeout", "timed out", "deadline"]):
            return "timeout"
        if any(token in text for token in ["rate limit", "429", "too many requests"]):
            return "rate_limited"
        if any(token in text for token in ["connection", "temporarily", "unavailable", "reset by peer", "503", "502", "504"]):
            return "transient_network"
        if any(token in text for token in ["permission", "forbidden", "unauthorized", "401", "403"]):
            return "permission_denied"
        if any(token in text for token in ["not found", "missing", "404"]):
            return "data_not_found"
        if any(token in text for token in ["validation", "schema", "json"]):
            return "model_output_invalid"
        return "tool_runtime_error"

    def _is_retriable_tool_error(self, error_kind: ToolErrorKind, public_action: str) -> bool:
        if error_kind not in {"timeout", "rate_limited", "transient_network"}:
            return False
        if public_action in {"safety_agent.classify_action_risk", "report_agent.generate_weekly_report", "workflow.run_engineering_review"}:
            return False
        return True

    def _normalize_action_input(self, action: str, action_input: dict[str, Any], state: ConversationState) -> dict[str, Any]:
        normalized = dict(action_input)
        message = str(state.get("message") or "")
        context = state.get("context") or {}

        if action in {
            "repo_health.generate_summary",
            "rag.search_similar_documents",
            "issue_agent.analyze_issue",
            "pr_review_agent.analyze_pr",
            "ci_debug_agent.analyze_workflow_run",
            "report_agent.generate_weekly_report",
            "safety_agent.classify_action_risk",
            "workflow.run_engineering_review",
            "workspace.search_code",
        }:
            normalized.setdefault("message", message)
        if action == "workspace.search_code":
            normalized.setdefault("query", message)
        if action == "rag.search_similar_documents":
            normalized.setdefault("query", str(normalized.get("message") or message))
        if action == "workspace.read_file" and not normalized.get("path") and self._asks_project_overview(message):
            normalized["path"] = "README.md"
        if action == "devhelm_search_evidence":
            normalized.setdefault("query", message)
        if action == "devhelm_get_thread_context":
            normalized.setdefault("limit", 20)
        if action == "devhelm_read_session_events":
            normalized.setdefault("limit", 5)
        if action.startswith("devhelm_") and context.get("repo_id"):
            normalized["repo_id"] = context["repo_id"]
            normalized.pop("repo_full_name", None)
        if action.startswith("devhelm_") and context.get("conversation_id"):
            normalized["conversation_id"] = context["conversation_id"]
        return normalized

    def _build_langchain_tools(self, raw_tools: dict[str, ConversationTool], context: dict[str, Any]) -> dict[str, StructuredTool]:
        wrapped: dict[str, StructuredTool] = {}
        for name, func in raw_tools.items():
            async def call_tool(_func: ConversationTool = func, **kwargs: Any) -> dict[str, Any]:
                input_data = {key: value for key, value in kwargs.items() if value is not None}
                return await _func(input_data, context)

            safe_name = self._safe_tool_name(name)
            call_tool.__name__ = safe_name
            wrapped[safe_name] = StructuredTool.from_function(
                coroutine=call_tool,
                name=safe_name,
                description=self._tool_description(name, context),
                args_schema=GenericToolArgs,
                infer_schema=False,
            )
        return wrapped

    def _tool_name_map(self, raw_tools: dict[str, ConversationTool]) -> dict[str, str]:
        return {self._safe_tool_name(name): name for name in raw_tools}

    def _safe_tool_name(self, name: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_-]", "__", name)

    def _public_tool_name(self, safe_name: str, state: ConversationState) -> str:
        return (state.get("tool_name_map") or {}).get(safe_name, safe_name)

    def _tool_description(self, name: str, context: dict[str, Any] | None = None) -> str:
        suffixes = {}
        if context:
            raw_suffixes = context.get("skill_description_by_tool") or {}
            if isinstance(raw_suffixes, dict):
                suffixes = raw_suffixes
        return f"公开工具：{name}。{TOOL_DESCRIPTIONS.get(name, 'DevHelm 工具。')}{suffixes.get(name, '')}"

    def _tool_help(self, state: ConversationState) -> str:
        tools = state.get("tools") or {}
        return "\n".join(f"- {name}: {tool.description}" for name, tool in tools.items())
