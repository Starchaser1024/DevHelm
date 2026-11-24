from __future__ import annotations

import json
from typing import Any

from app.core.config import settings
from app.services.agents.chat_agent_types import ConversationState
from app.services.context_compression import (
    calculate_context_pressure,
    clip_to_token_budget,
    default_context_budget,
    estimate_tokens,
)


class ChatAgentPromptDiagnosticsMixin:
    """Prompt assembly, runtime tool projection, and token usage diagnostics."""

    _server_context: Any
    _history_messages: Any
    _history_coverage: Any
    _tool_help: Any
    _registered_skills_context: Any
    _active_skill_prompt: Any
    _tool_event_transcript: Any

    def _tool_calling_system_prompt(self) -> str:
        return (
            "你是 DevHelm 的对话控制器。这个稳定前缀会被缓存。"
            "请像长任务软件 Agent 一样工作：先规划，调用工具，读取 tool_result 观察结果，修正计划，"
            "持续推进直到用户请求真正完成，或步骤预算耗尽。"
            "当需要仓库、记忆、工作区代码或写操作安全上下文时，使用原生工具调用。"
            "绝不要编造工具结果。"
            "工程结论必须说明 WHY，并区分证据、推断和不确定项；证据不足时直接说缺什么，不要硬猜。"
            "当输出审查结论时，不要用 looks good、没什么问题这类空话代替检查；必须给出风险、级别和下一步。"
            "当回答交接、总结或工作流结论时，尽量保留 What、Why、Tradeoff、Open Questions、Next Action。"
            "当用户询问负责人、已分配人员、责任人或任务分配时，只能从明确的 DevHelm team_members "
            "或工具返回的现有 GitHub assignees 中推荐人员。仓库文档、Issue 文本、代码、示例、模型名、"
            "角色设定、团队比喻和记忆片段都不能当成人，除非它们同时出现在 DevHelm team_members 中。"
            "如果没有配置团队成员，请说明这一点，并要求用户先添加开发者后再分配任务。"
            "当用户请求 GitHub 写入、关闭、打标签、评论、发布、回复或发送时，必须先调用安全工具；"
            "除非存在单独的已确认写入工具，否则只返回草稿。"
            "对于合并就绪度、当前阻塞、优先级规划，或需要 Issue + PR + CI + RAG 综合判断的跨领域工程决策，"
            "优先使用 workflow.run_engineering_review 工具。"
        )

    def _tool_calling_user_prompt(self, state: ConversationState, *, aggressive: bool = False) -> str:
        prompt_observations, prompt_events, runtime_stats = self._runtime_tool_context(
            state,
            aggressive=aggressive,
        )
        state["runtime_context_stats"] = {
            **(state.get("runtime_context_stats") or {}),
            **runtime_stats,
        }
        context = state.get("context") or {}
        server_context = self._server_context(context)
        history = self._history_messages(context)
        if aggressive:
            budget = default_context_budget()
            server_context = clip_to_token_budget(server_context, max(512, budget.available_prompt_tokens // 3))
            history = self._compress_history_for_retry(history, max(512, budget.recent_tokens // 2))
        return (
            "上下文使用规则：如果服务端提供的最近消息已经包含回答所需的完整原文，直接基于这些消息回答，"
            "不要为了展示工具调用而重复读取记忆。只有目标消息不在最近窗口、内容被截断或压缩、用户明确要求"
            "核实原话，或者问题跨越会话时，才调用一个最匹配的 MCP 记忆工具。当前会话原始消息使用 "
            "devhelm_get_thread_context；封存会话和跨会话摘要使用 devhelm_read_session_events；项目长期记忆、"
            "历史决策和仓库证据使用 devhelm_search_evidence。询问当前会话原话时，不要额外调用 "
            "devhelm_search_evidence。\n\n"
            "硬性规则：如果用户询问这个项目/仓库做什么、技术栈、架构、启动方式、依赖或源码行为，"
            "回答前必须检查工作区文件。优先读取 README、package 或 manifest 文件；如果工作区文件不可用，要明确说明。\n\n"
            "涉及源码的问题，优先使用 workspace.search_code、workspace.read_file 或 workspace.list_files。"
            "涉及已索引的仓库历史和上传知识，使用 rag.search_similar_documents 或 devhelm_search_evidence。\n\n"
            "混合 RAG 约定：服务端上下文中的 [Related Evidence] 是根据原始问题完成的调用前检索。"
            "如果这些证据不足、互相冲突，或问题包含多个子问题，请改写为更具体的 query 调用 "
            "rag.search_similar_documents；可以用不同 query 连续补查，并在最终回答前比较多次 tool_result。\n\n"
            "工作流硬性规则：如果用户请求多 Agent 审查、合并就绪度、当前阻塞、工程状态、跨 Agent 综合，"
            "或依赖 Issue、PR、CI 与仓库证据共同判断的决策，必须先调用 workflow.run_engineering_review，"
            "再给出最终建议。\n\n"
            "分配硬性规则：如果用户询问谁应该负责、处理、接手或被分配某个 Issue/PR/任务，"
            "可选人员只能来自下方列出的 DevHelm team_members，以及工具明确返回的现有 GitHub assignees。"
            "不要把仓库内容、项目角色设定、模型名、示例、作者或虚构标签当成团队成员。"
            "如果 team_members 为空且没有现有 assignee，请回答当前还没有添加项目成员，"
            "并要求用户在团队面板中添加开发者。可以说明可能需要的能力方向，但不要点名具体人员。\n\n"
            "循环约定：每次工具调用都会先记录为 tool_use，再记录为 tool_result。决定下一步前必须阅读之前的 tool_result 内容。"
            "如果目录列表里出现值得继续查看的 README、manifest、代码文件、Issue、PR 或 CI 记录，不要停在目录列表。"
            "除非新证据使重复调用有必要，不要用相同参数重复调用同一个工具。\n\n"
            f"当前 Agent 配置的运行模型：{settings.llm_model}\n\n"
            f"可用原生工具：\n{self._tool_help(state)}\n\n"
            f"已注册的 DevHelm 技能：\n{self._registered_skills_context(state.get('context') or {})}\n\n"
            f"本轮按需加载的 Skill 完整指令：\n{self._active_skill_prompt(state.get('context') or {})}\n\n"
            f"DevHelm 团队上下文：\n{self._team_assignment_context(state.get('context') or {})}\n\n"
            f"服务端上下文：\n{server_context}\n\n"
            f"上下文覆盖度：\n{json.dumps(self._history_coverage(context), ensure_ascii=False)}\n\n"
            f"最近消息：\n{json.dumps(history, ensure_ascii=False)}\n\n"
            f"已有观察结果（已按总预算投影，完整结果保存在会话转录）：\n{json.dumps(prompt_observations, ensure_ascii=False)}\n\n"
            f"工具调用/结果索引：\n{json.dumps(prompt_events, ensure_ascii=False)}\n\n"
            f"用户消息：{state.get('message') or ''}"
        )

    def _runtime_tool_context(
        self,
        state: ConversationState,
        *,
        aggressive: bool = False,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        """Project complete tool state into a bounded prompt-only view.

        The full observations and events remain in ``state`` and are sealed in
        ChatSession. Only this derived view is shortened for the next model
        call, matching separation between durable transcript and active context.
        """
        raw_observations = [item for item in state.get("observations") or [] if isinstance(item, dict)]
        budget = default_context_budget().tool_observation_tokens
        if aggressive:
            budget = max(512, budget // 4)
        per_item_budget = max(160, min(1400, budget // max(len(raw_observations), 1)))
        remaining = budget
        kept_reversed: list[dict[str, Any]] = []
        omitted = 0
        for item in reversed(raw_observations):
            next_item = dict(item)
            observation = next_item.get("observation")
            if isinstance(observation, dict):
                next_observation = dict(observation)
                preview = str(
                    next_observation.get("answer_preview")
                    or next_observation.get("answer")
                    or next_observation.get("content")
                    or ""
                )
                if preview:
                    next_observation["answer_preview"] = clip_to_token_budget(preview, per_item_budget)
                    next_observation.pop("answer", None)
                    next_observation.pop("content", None)
                next_item["observation"] = next_observation
            else:
                next_item["observation"] = clip_to_token_budget(str(observation or ""), per_item_budget)

            serialized = json.dumps(next_item, ensure_ascii=False, default=str)
            cost = estimate_tokens(serialized)
            if cost > remaining and kept_reversed:
                omitted += 1
                continue
            if cost > remaining:
                next_item = {
                    "tool_name": str(item.get("tool_name") or "tool"),
                    "observation": clip_to_token_budget(serialized, max(120, remaining)),
                    "compacted": True,
                }
                cost = estimate_tokens(json.dumps(next_item, ensure_ascii=False))
            kept_reversed.append(next_item)
            remaining = max(0, remaining - cost)
            if remaining <= 0:
                omitted += max(0, len(raw_observations) - len(kept_reversed))
                break

        prompt_observations = list(reversed(kept_reversed))
        if omitted:
            prompt_observations.insert(
                0,
                {
                    "compacted": True,
                    "omitted_old_observations": omitted,
                    "recovery": "完整工具结果保存在本轮 ChatSession transcript，可按 session 读取。",
                },
            )

        prompt_events: list[dict[str, Any]] = []
        for event in self._tool_event_transcript(state):
            summary = {
                key: value
                for key, value in event.items()
                if key
                in {
                    "type",
                    "step",
                    "id",
                    "tool_use_id",
                    "tool_name",
                    "arguments",
                    "status",
                    "route",
                    "error_kind",
                    "retryable",
                    "reason",
                }
            }
            if "arguments" in summary:
                args_text = json.dumps(summary["arguments"], ensure_ascii=False, default=str)
                if estimate_tokens(args_text) > 240:
                    summary["arguments"] = clip_to_token_budget(args_text, 240)
            prompt_events.append(summary)

        original_tokens = estimate_tokens(json.dumps(raw_observations, ensure_ascii=False, default=str))
        prompt_tokens = estimate_tokens(json.dumps(prompt_observations, ensure_ascii=False, default=str))
        return prompt_observations, prompt_events, {
            "mode": "runtime_tool_projection",
            "aggressive": aggressive,
            "observation_budget_tokens": budget,
            "original_observation_tokens": original_tokens,
            "prompt_observation_tokens": prompt_tokens,
            "estimated_tokens_saved": max(0, original_tokens - prompt_tokens),
            "source_observations": len(raw_observations),
            "prompt_observations": len(prompt_observations),
            "omitted_observations": omitted,
            "tool_event_index_entries": len(prompt_events),
        }

    def _compress_history_for_retry(
        self,
        history: list[dict[str, str]],
        max_tokens: int,
    ) -> list[dict[str, str]]:
        kept: list[dict[str, str]] = []
        used = 0
        for item in reversed(history):
            content = clip_to_token_budget(item.get("content") or "", max(120, min(700, max_tokens // 3)))
            cost = estimate_tokens(item.get("role")) + estimate_tokens(content)
            if kept and used + cost > max_tokens:
                break
            kept.append({"role": item.get("role") or "user", "content": content})
            used += cost
        return list(reversed(kept))

    def _record_prompt_diagnostics(
        self,
        state: ConversationState,
        *,
        phase: str,
        system_prompt: str,
        user_prompt: str,
    ) -> int:
        system_tokens = estimate_tokens(system_prompt)
        user_tokens = estimate_tokens(user_prompt)
        tool_schema_tokens = self._tool_schema_estimated_tokens(state)
        total = system_tokens + user_tokens + tool_schema_tokens
        pressure = calculate_context_pressure(total)
        diagnostic = {
            "phase": phase,
            "estimated_prompt_tokens": total,
            "system_tokens": system_tokens,
            "user_context_tokens": user_tokens,
            "tool_schema_tokens": tool_schema_tokens,
            "pressure": pressure.as_dict(),
        }
        state["prompt_diagnostics"] = [*(state.get("prompt_diagnostics") or []), diagnostic]
        return total

    def _tool_schema_estimated_tokens(self, state: ConversationState) -> int:
        total = 0
        for tool in (state.get("tools") or {}).values():
            total += estimate_tokens(str(getattr(tool, "name", "")))
            total += estimate_tokens(str(getattr(tool, "description", "")))
            args_schema = getattr(tool, "args_schema", None)
            try:
                schema = args_schema.model_json_schema() if args_schema else {}
            except (AttributeError, TypeError, ValueError):
                schema = {}
            total += estimate_tokens(json.dumps(schema, ensure_ascii=False, default=str))
        return total

    def _record_model_usage(
        self,
        state: ConversationState,
        response: Any,
        *,
        phase: str,
        estimated_prompt_tokens: int,
    ) -> None:
        usage = self._normalize_model_usage(response)
        usage.update(
            {
                "phase": phase,
                "estimated_prompt_tokens": estimated_prompt_tokens,
                "source": "provider" if usage.get("input_tokens") is not None else "estimate",
            }
        )
        if usage.get("input_tokens") is None:
            usage["input_tokens"] = estimated_prompt_tokens
        if usage.get("total_tokens") is None:
            usage["total_tokens"] = int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)
        state["model_usage"] = [*(state.get("model_usage") or []), usage]

    def _normalize_model_usage(self, response: Any) -> dict[str, Any]:
        raw = getattr(response, "usage_metadata", None)
        if raw is not None and not isinstance(raw, dict) and hasattr(raw, "model_dump"):
            raw = raw.model_dump()
        raw = raw if isinstance(raw, dict) else {}
        response_metadata = getattr(response, "response_metadata", None)
        response_metadata = response_metadata if isinstance(response_metadata, dict) else {}
        token_usage = response_metadata.get("token_usage") or response_metadata.get("usage") or {}
        token_usage = token_usage if isinstance(token_usage, dict) else {}
        input_details = raw.get("input_token_details") or {}
        input_details = input_details if isinstance(input_details, dict) else {}
        return {
            "input_tokens": raw.get("input_tokens", token_usage.get("prompt_tokens")),
            "output_tokens": raw.get("output_tokens", token_usage.get("completion_tokens")),
            "total_tokens": raw.get("total_tokens", token_usage.get("total_tokens")),
            "cache_read_input_tokens": input_details.get("cache_read", token_usage.get("cache_read_input_tokens", 0)),
            "cache_creation_input_tokens": input_details.get("cache_creation", token_usage.get("cache_creation_input_tokens", 0)),
            "model": response_metadata.get("model_name") or settings.llm_model,
        }

    def _runtime_metadata(self, state: ConversationState) -> dict[str, Any]:
        return {
            "model_usage": state.get("model_usage") or [],
            "context_diagnostics": {
                "prompt_calls": state.get("prompt_diagnostics") or [],
                "runtime_tool_context": state.get("runtime_context_stats") or {},
                "reactive_overflow_retry": bool(state.get("context_overflow_recovery_attempted")),
            },
        }

    def _team_assignment_context(self, context: dict[str, Any]) -> str:
        members = self._team_members(context)
        if not members:
            return "team_members: []（当前仓库还没有配置 DevHelm 团队成员。）"
        return "team_members: " + json.dumps(members, ensure_ascii=False)

    def _team_members(self, context: dict[str, Any]) -> list[dict[str, str]]:
        raw_members = context.get("team_members") or []
        if not isinstance(raw_members, list):
            return []
        members: list[dict[str, str]] = []
        for member in raw_members:
            if not isinstance(member, dict):
                continue
            name = str(member.get("name") or "").strip()
            if not name:
                continue
            members.append(
                {
                    "name": name,
                    "role": str(member.get("role") or "").strip(),
                    "strengths": str(member.get("strengths") or "").strip(),
                    "techStack": str(member.get("techStack") or member.get("tech_stack") or "").strip(),
                }
            )
        return members[:20]

    def _summarize_observation(self, observation: dict[str, Any]) -> dict[str, Any]:
        answer = str(observation.get("answer") or "")
        budget = default_context_budget()
        limit = budget.tool_observation_tokens if str(observation.get("route") or "").startswith("workspace_") else max(300, budget.tool_observation_tokens // 3)
        compressed = clip_to_token_budget(answer, limit)
        return {
            "route": observation.get("route"),
            "answer_preview": compressed,
            "compression": {
                "mode": "tool_observation_budget",
                "original_estimated_tokens": estimate_tokens(answer),
                "compressed_estimated_tokens": estimate_tokens(compressed),
                "budget_tokens": limit,
            },
            "citations_count": len(observation.get("citations", [])),
        }
