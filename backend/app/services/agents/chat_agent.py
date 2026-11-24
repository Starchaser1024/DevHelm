from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.services.agents.base import BaseAgent
from app.services.agents.chat_agent_policies import ChatAgentPolicyMixin
from app.services.agents.chat_agent_prompts import ChatAgentPromptDiagnosticsMixin
from app.services.agents.chat_agent_skills import ChatAgentSkillEvalMixin
from app.services.agents.chat_agent_tools import ChatAgentToolExecutionMixin
from app.services.agents.chat_agent_types import (
    ConversationState,
    ConversationTool,
    GenericToolArgs,
    ToolErrorKind,
    encode_sse,
)
from app.services.context_compression import (
    is_context_overflow_error,
    prompt_cache_model_kwargs,
)
from app.services.skills import SkillRegistryError


class ChatAgent(
    ChatAgentToolExecutionMixin,
    ChatAgentPromptDiagnosticsMixin,
    ChatAgentPolicyMixin,
    ChatAgentSkillEvalMixin,
    BaseAgent,
):
    name = "chat_agent"
    description = "使用原生工具调用的对话 Agent。LLM 选择 LangChain 工具，记忆工具通过 MCP 执行。"
    available_tools = [
        "devhelm_search_evidence",
        "devhelm_get_thread_context",
        "devhelm_read_session_events",
        "workspace.list_files",
        "workspace.read_file",
        "workspace.search_code",
        "repo_health.generate_summary",
        "rag.search_similar_documents",
        "issue_agent.analyze_issue",
        "pr_review_agent.analyze_pr",
        "ci_debug_agent.analyze_workflow_run",
        "report_agent.generate_weekly_report",
        "safety_agent.classify_action_risk",
        "workflow.run_engineering_review",
    ]

    max_steps = 12
    max_repeated_tool_calls = 2
    tool_retry_attempts = 1

    def __init__(self, model: ChatOpenAI | None = None) -> None:
        self.model = model
        if self.model is None and settings.llm_api_key:
            self.model = ChatOpenAI(
                model=settings.llm_model,
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                temperature=0,
                timeout=60,
                model_kwargs=prompt_cache_model_kwargs(),
            )

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        final: dict[str, Any] | None = None
        async for event in self.run_stream(input_data, context):
            if event["event"] == "final":
                final = event["data"]
        return final or {
            "run_id": "",
            "route": "unknown",
            "tool_calls": [],
            "answer": "没有生成最终回答。",
            "citations": [],
        }

    async def run_stream(self, input_data: dict[str, Any], context: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        message = str(input_data.get("message") or "")
        runtime_context = dict(context)
        try:
            active_skills = self._activate_skills(message, runtime_context)
        except SkillRegistryError as exc:
            answer = f"Skill 激活失败：{exc}"
            async for chunk in self._stream_answer(answer):
                yield chunk
            yield self._event(
                "final",
                {
                    "run_id": "",
                    "route": "skill_error",
                    "tool_calls": [],
                    "agent_events": [{"type": "skill_activation_error", "error": str(exc)}],
                    "answer": answer,
                    "citations": [],
                    "completion": {"status": "blocked", "reason": "skill_activation_error", "steps": 0, "tool_call_count": 0, "tool_error_count": 0},
                },
            )
            return
        runtime_context["active_skills"] = active_skills
        raw_tools: dict[str, ConversationTool] = runtime_context["tools"]
        tools = self._build_langchain_tools(raw_tools, runtime_context)
        state: ConversationState = {
            "message": message,
            "context": runtime_context,
            "tools": tools,
            "tool_name_map": self._tool_name_map(raw_tools),
            "observations": [],
            "agent_events": [],
            "tool_calls": [],
            "citations": [],
            "pending_tool_calls": [],
            "stream_events": [],
            "route": "direct_answer",
            "step": 0,
            "final_answer": "",
            "stop_reason": "",
            "completion_status": "running",
            "tool_call_counts": {},
            "model_usage": [],
            "prompt_diagnostics": [],
            "runtime_context_stats": {},
            "context_overflow_recovery_attempted": False,
        }
        if context.get("evaluation_mode"):
            state["evaluation_trace"] = self._initial_evaluation_trace(message, context)
        self._append_agent_event(
            state,
            "agent_loop_start",
            {
                "mode": "langgraph_tool_calling_loop",
                "max_steps": self.max_steps,
                "available_tools": list(self._tool_name_map(raw_tools).values()),
            },
        )
        for skill in active_skills:
            activation_event = {
                key: value
                for key, value in skill.items()
                if key
                in {
                    "skill_name",
                    "skill_title",
                    "skill_version",
                    "entrypoint",
                    "tools",
                    "workflow_steps",
                    "output_contract",
                    "safety_level",
                    "activation_mode",
                    "activation_reason",
                    "instruction_digest",
                }
            }
            activation_event["resources"] = [
                {key: value for key, value in resource.items() if key != "content"}
                for resource in skill.get("resources") or []
                if isinstance(resource, dict)
            ]
            self._append_agent_event(
                state,
                "skill_activated",
                activation_event,
            )
        prefetched_evidence = context.get("evidence") if isinstance(context.get("evidence"), list) else []
        pre_retrieval_enabled = "evidence" in context
        reasoning_retrieval_enabled = "rag.search_similar_documents" in raw_tools
        pre_retrieval_sources = [
            {
                "source_id": str(item.get("source_id") or item.get("id") or ""),
                "source_type": str(item.get("source_type") or "evidence"),
                "title": str(item.get("title") or "未命名证据"),
                "score": item.get("score") if isinstance(item.get("score"), (int, float)) else None,
            }
            for item in prefetched_evidence[:8]
            if isinstance(item, dict)
        ]
        self._append_agent_event(
            state,
            "rag_strategy",
            {
                "mode": "hybrid_rag" if pre_retrieval_enabled and reasoning_retrieval_enabled else "tool_calling",
                "pre_retrieval": {
                    "enabled": pre_retrieval_enabled,
                    "evidence_count": len(prefetched_evidence),
                    "query": message,
                    "sources": pre_retrieval_sources,
                },
                "reasoning_retrieval": {
                    "enabled": reasoning_retrieval_enabled,
                    "supports_query_rewrite": reasoning_retrieval_enabled,
                    "supports_multiple_searches": reasoning_retrieval_enabled,
                },
            },
        )

        memory_policy = self._memory_context_policy(message, context)
        if memory_policy:
            self._append_agent_event(state, "context_policy", memory_policy)
        if memory_policy and memory_policy.get("mode") == "direct_recent_history":
            state["final_answer"] = await self._direct_answer_from_recent_history(state)
            answer = str(state.get("final_answer") or "").strip()
            if not answer:
                answer = self._local_recent_history_answer(state)
            self._stop_loop(state, "recent_history_available", "completed")
            self._record_skill_validation(state)
            async for chunk in self._stream_answer(answer):
                yield chunk
            yield self._event(
                "final",
                {
                    "run_id": "",
                    "route": "direct_answer",
                    "tool_calls": [],
                    "agent_events": state.get("agent_events") or [],
                    "answer": answer,
                    "citations": [],
                    "completion": self._completion_summary(state),
                    **self._runtime_metadata(state),
                    **self._evaluation_result(state),
                },
            )
            return

        required_memory_tool = str((memory_policy or {}).get("tool") or "") or None
        if required_memory_tool and required_memory_tool in raw_tools:
            async for event in self._prefetch_memory_context(state, required_memory_tool):
                yield event
            state["final_answer"] = await self._final_from_observations(state)
            answer = str(state.get("final_answer") or "").strip()
            if not answer:
                answer = await self._fallback_answer(state)
            self._stop_loop(state, "required_memory_context_loaded", self._tool_completion_status(state))
            self._record_skill_validation(state)
            async for chunk in self._stream_answer(answer):
                yield chunk
            yield self._event(
                "final",
                {
                    "run_id": "",
                    "route": state.get("route") or required_memory_tool,
                    "tool_calls": state.get("tool_calls") or [],
                    "agent_events": state.get("agent_events") or [],
                    "answer": answer,
                    "citations": state.get("citations") or [],
                    "completion": self._completion_summary(state),
                    **self._runtime_metadata(state),
                    **self._evaluation_result(state),
                },
            )
            return

        if self._asks_project_overview(message):
            async for event in self._prefetch_project_context(state):
                yield event
            state["final_answer"] = await self._final_from_observations(state)
            answer = str(state.get("final_answer") or "").strip()
            if not answer:
                answer = await self._fallback_answer(state)
            self._stop_loop(state, "project_context_loaded", self._tool_completion_status(state))
            self._record_skill_validation(state)
            async for chunk in self._stream_answer(answer):
                yield chunk
            yield self._event(
                "final",
                {
                    "run_id": "",
                    "route": state.get("route") or "workspace_read_file",
                    "tool_calls": state.get("tool_calls") or [],
                    "agent_events": state.get("agent_events") or [],
                    "answer": answer,
                    "citations": state.get("citations") or [],
                    "completion": self._completion_summary(state),
                    **self._runtime_metadata(state),
                    **self._evaluation_result(state),
                },
            )
            return

        if self.model is None:
            answer = self._local_prefetched_evidence_answer(state) or (
                "当前没有取得足够证据。请先确认仓库已连接并完成同步；开放式对话还需要配置 LLM。"
            )
            evidence = (state.get("context") or {}).get("evidence")
            has_evidence = isinstance(evidence, list) and any(isinstance(item, dict) for item in evidence)
            self._stop_loop(
                state,
                "prefetched_evidence_available" if has_evidence else "llm_not_configured",
                "completed" if has_evidence else "blocked",
            )
            self._record_skill_validation(state)
            async for chunk in self._stream_answer(answer):
                yield chunk
            yield self._event(
                "final",
                {
                    "run_id": "",
                    "route": "prefetched_evidence" if has_evidence else "direct_answer",
                    "tool_calls": [],
                    "agent_events": state.get("agent_events") or [],
                    "answer": answer,
                    "citations": self._prefetched_evidence_citations(state),
                    "completion": self._completion_summary(state),
                    **self._runtime_metadata(state),
                    **self._evaluation_result(state),
                },
            )
            return

        graph = self._build_agent_graph(self._tool_model(tools))
        async for event in self._stream_agent_graph(graph, state):
            yield event

        answer = str(state.get("final_answer") or "").strip()
        if not answer:
            answer = await self._fallback_answer(state)
        if state.get("completion_status") == "running":
            self._stop_loop(state, "fallback_answer_ready", self._tool_completion_status(state))
        self._record_skill_validation(state)
        async for chunk in self._stream_answer(answer):
            yield chunk
        yield self._event(
            "final",
            {
                "run_id": "",
                "route": state.get("route") or "direct_answer",
                "tool_calls": state.get("tool_calls") or [],
                "agent_events": state.get("agent_events") or [],
                "answer": answer,
                "citations": state.get("citations") or [],
                "completion": self._completion_summary(state),
                **self._runtime_metadata(state),
                **self._evaluation_result(state),
            },
        )

    def _build_agent_graph(self, tool_model: Any):
        async def model_decision_node(state: ConversationState) -> dict[str, Any]:
            return await self._graph_model_decision(state, tool_model)

        graph = StateGraph(ConversationState)
        graph.add_node("model_decision", model_decision_node)
        graph.add_node("tool_action", self._graph_tool_action)
        graph.add_node("max_steps_stop", self._graph_max_steps_stop)
        graph.add_edge(START, "model_decision")
        graph.add_conditional_edges(
            "model_decision",
            self._route_after_model_decision,
            {"tools": "tool_action", "end": END},
        )
        graph.add_conditional_edges(
            "tool_action",
            self._route_after_tool_action,
            {"tools": "tool_action", "model": "model_decision", "limit": "max_steps_stop"},
        )
        graph.add_edge("max_steps_stop", END)
        return graph.compile(name="chat_agent_tool_calling_graph")

    async def _stream_agent_graph(self, graph: Any, state: ConversationState) -> AsyncIterator[dict[str, Any]]:
        current_state: ConversationState = dict(state)
        config = {"recursion_limit": self.max_steps * 8 + 20}
        async for graph_event in graph.astream(current_state, config=config, stream_mode="debug"):
            if not isinstance(graph_event, dict):
                continue
            payload = graph_event.get("payload") if isinstance(graph_event.get("payload"), dict) else {}
            node_name = str(payload.get("name") or "")
            if graph_event.get("type") == "task" and node_name == "tool_action":
                preview = self._preview_tool_use_event(payload.get("input"))
                if preview:
                    yield self._event("tool_use", preview)
                continue
            if graph_event.get("type") != "task_result":
                continue
            result = payload.get("result")
            if not isinstance(result, dict):
                continue
            for key, value in result.items():
                if key != "stream_events":
                    current_state[key] = value
                    state[key] = value
            for event in result.get("stream_events") or []:
                if isinstance(event, dict):
                    yield event

    async def _graph_model_decision(self, state: ConversationState, tool_model: Any) -> dict[str, Any]:
        next_state: ConversationState = dict(state)
        step = int(next_state.get("step") or 0) + 1
        next_state["step"] = step
        self._append_agent_event(next_state, "agent_step", {"step": step, "phase": "model_decision"})
        system_prompt = self._tool_calling_system_prompt()
        user_prompt = self._tool_calling_user_prompt(next_state)
        messages: list[BaseMessage] = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
        estimated_prompt_tokens = self._record_prompt_diagnostics(
            next_state,
            phase="model_decision",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
        )
        try:
            response = await tool_model.ainvoke(messages)
        except Exception as exc:
            if not is_context_overflow_error(exc) or next_state.get("context_overflow_recovery_attempted"):
                raise
            next_state["context_overflow_recovery_attempted"] = True
            next_state["runtime_context_stats"] = {
                **(next_state.get("runtime_context_stats") or {}),
                "reactive_compaction": "aggressive_retry",
                "overflow_error": str(exc),
            }
            self._append_agent_event(
                next_state,
                "context_overflow_recovery",
                {"phase": "model_decision", "strategy": "aggressive_runtime_projection"},
            )
            user_prompt = self._tool_calling_user_prompt(next_state, aggressive=True)
            messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
            estimated_prompt_tokens = self._record_prompt_diagnostics(
                next_state,
                phase="model_decision_reactive_retry",
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
            response = await tool_model.ainvoke(messages)
        self._record_model_usage(
            next_state,
            response,
            phase="model_decision",
            estimated_prompt_tokens=estimated_prompt_tokens,
        )
        response_text = self._message_content(response).strip()
        raw_tool_calls = getattr(response, "tool_calls", None) or []
        tool_calls = [dict(call) for call in raw_tool_calls if isinstance(call, dict)]
        stream_events: list[dict[str, Any]] = []
        if response_text and tool_calls:
            self._append_agent_event(next_state, "thought", {"content": response_text})
            stream_events.append(self._event("thought", {"content": response_text}))
        if not tool_calls:
            next_state["final_answer"] = response_text
            next_state["pending_tool_calls"] = []
            self._stop_loop(next_state, "model_final_answer", "completed")
        else:
            repeated = self._repeated_tool_call(tool_calls, next_state)
            if repeated:
                next_state["pending_tool_calls"] = []
                next_state["route"] = "tool_loop_guard"
                next_state["final_answer"] = (
                    "我停止了这轮 Agent Loop，因为模型连续请求相同工具和参数，"
                    "继续执行只会重复消耗预算。请根据已有工具结果调整问题，或让我换一种检索/分析路径。"
                )
                next_state["observations"] = [
                    *(next_state.get("observations") or []),
                    {
                        "tool_name": repeated["tool_name"],
                        "arguments": repeated["arguments"],
                        "observation": {
                            "route": "tool_loop_guard",
                            "answer_preview": "Detected repeated identical tool call and stopped the loop.",
                            "repeat_count": repeated["repeat_count"],
                            "fingerprint": repeated["fingerprint"],
                        },
                    },
                ]
                self._stop_loop(
                    next_state,
                    "repeated_tool_call",
                    "blocked",
                    {
                        "tool_name": repeated["tool_name"],
                        "arguments": repeated["arguments"],
                        "repeat_count": repeated["repeat_count"],
                    },
                )
                return self._graph_state_update(next_state, stream_events)
            next_state["pending_tool_calls"] = tool_calls
        return self._graph_state_update(next_state, stream_events)

    async def _graph_tool_action(self, state: ConversationState) -> dict[str, Any]:
        next_state: ConversationState = dict(state)
        pending = list(next_state.get("pending_tool_calls") or [])
        if not pending:
            return self._graph_state_update(next_state, [])
        tool_call = pending[0]
        next_state["pending_tool_calls"] = pending[1:]
        public_action, action_input, observation, _tool_message, _tool_use_event, tool_result_event = await self._execute_tool_call(tool_call, next_state)
        stream_events = [
            self._event("tool_result", tool_result_event),
            self._event("action", {"tool_name": public_action, "arguments": action_input}),
            self._event("observation", {"tool_name": public_action, "content": observation}),
        ]
        return self._graph_state_update(next_state, stream_events)

    async def _graph_max_steps_stop(self, state: ConversationState) -> dict[str, Any]:
        next_state: ConversationState = dict(state)
        next_state["route"] = "tool_loop_budget_exhausted"
        next_state["final_answer"] = (
            "这轮 Agent Loop 已达到步骤预算上限。下面的结论只能基于已经完成的工具调用和观察结果，"
            "如果还需要继续，我会从当前证据继续缩小范围。"
        )
        self._stop_loop(next_state, "max_steps_exhausted", "budget_exhausted", {"max_steps": self.max_steps})
        return self._graph_state_update(next_state, [])

    def _route_after_model_decision(self, state: ConversationState) -> str:
        return "tools" if state.get("pending_tool_calls") else "end"

    def _route_after_tool_action(self, state: ConversationState) -> str:
        if state.get("pending_tool_calls"):
            return "tools"
        if int(state.get("step") or 0) >= self.max_steps and not str(state.get("final_answer") or "").strip():
            return "limit"
        return "model"

    def _graph_state_update(self, state: ConversationState, stream_events: list[dict[str, Any]]) -> dict[str, Any]:
        keys = [
            "observations",
            "agent_events",
            "tool_calls",
            "citations",
            "pending_tool_calls",
            "route",
            "step",
            "final_answer",
            "stop_reason",
            "completion_status",
            "tool_call_counts",
            "evaluation_trace",
            "model_usage",
            "prompt_diagnostics",
            "runtime_context_stats",
            "context_overflow_recovery_attempted",
        ]
        update = {key: state[key] for key in keys if key in state}
        update["stream_events"] = stream_events
        return update

    def _stop_loop(
        self,
        state: ConversationState,
        reason: str,
        completion_status: str,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state["stop_reason"] = reason
        state["completion_status"] = completion_status
        return self._append_agent_event(
            state,
            "agent_loop_stop",
            {"reason": reason, "completion_status": completion_status, **(extra or {})},
        )

    def _completion_summary(self, state: ConversationState) -> dict[str, Any]:
        tool_calls = [call for call in state.get("tool_calls") or [] if isinstance(call, dict)]
        error_calls = [call for call in tool_calls if call.get("status") == "error"]
        status = state.get("completion_status") or "completed"
        if status == "completed" and error_calls:
            status = "completed_with_tool_errors"
        return {
            "status": status,
            "reason": state.get("stop_reason") or "model_final_answer",
            "steps": int(state.get("step") or 0),
            "tool_call_count": len(tool_calls),
            "tool_error_count": len(error_calls),
        }

    def _tool_completion_status(self, state: ConversationState) -> str:
        calls = [call for call in state.get("tool_calls") or [] if isinstance(call, dict)]
        if calls and not any(call.get("status") == "success" for call in calls):
            return "blocked"
        return "completed"

    def _tool_model(self, tools: dict[str, StructuredTool]):
        if self.model is None:
            raise RuntimeError("ChatAgent requires an LLM for open-ended tool selection")
        return self.model.bind_tools(list(tools.values()))

    def _append_agent_event(self, state: ConversationState, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
        event = {
            "type": event_type,
            "step": state.get("step", 0),
            **data,
        }
        state["agent_events"] = [*(state.get("agent_events") or []), event]
        return event

    def _tool_event_transcript(self, state: ConversationState) -> list[dict[str, Any]]:
        return [
            event
            for event in state.get("agent_events") or []
            if event.get("type") in {"tool_use", "tool_result", "tool_retry", "agent_step", "agent_loop_stop"}
        ]

    def _message_content(self, message: BaseMessage) -> str:
        content = message.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    parts.append(str(item.get("text") or item.get("content") or ""))
            return "".join(parts)
        return str(content or "")

    async def _stream_answer(self, answer: str) -> AsyncIterator[dict[str, Any]]:
        for part in self._chunk_text(answer):
            yield self._event("delta", {"content": part})

    def _chunk_text(self, text: str, size: int = 36) -> list[str]:
        if not text:
            return []
        return [text[index : index + size] for index in range(0, len(text), size)]

    def _event(self, event: str, data: dict[str, Any]) -> dict[str, Any]:
        return {"event": event, "data": data}


__all__ = [
    "ChatAgent",
    "ConversationState",
    "ConversationTool",
    "GenericToolArgs",
    "ToolErrorKind",
    "encode_sse",
]
