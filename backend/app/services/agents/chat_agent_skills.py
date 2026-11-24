from __future__ import annotations

from typing import Any

from app.services.agents.chat_agent_types import ConversationState
from app.services.context_compression import clip_to_token_budget
from app.services.skills import SkillRegistry


class ChatAgentSkillEvalMixin:
    """Skill activation, allowlist verification, and evaluation trace recording."""

    _append_agent_event: Any
    _tool_event_transcript: Any

    def _registered_skills_context(self, context: dict[str, Any]) -> str:
        value = context.get("registered_skills")
        return str(value) if value else "当前没有注册 DevHelm 技能。"

    def _activate_skills(self, message: str, context: dict[str, Any]) -> list[dict[str, Any]]:
        registry = context.get("_skill_registry")
        if not isinstance(registry, SkillRegistry):
            return []
        requested_name = context.get("requested_skill") or context.get("skill_name")
        activations = registry.activate(
            message,
            requested_name=str(requested_name).strip() if requested_name else None,
        )
        return [activation.model_dump(mode="json") for activation in activations]

    def _active_skills(self, context: dict[str, Any]) -> list[dict[str, Any]]:
        skills = context.get("active_skills") or []
        return [item for item in skills if isinstance(item, dict)] if isinstance(skills, list) else []

    def _active_skill_prompt(self, context: dict[str, Any]) -> str:
        skills = self._active_skills(context)
        if not skills:
            return "本轮没有匹配到需要加载完整正文的 Skill；仅保留轻量目录摘要。"
        blocks = []
        for skill in skills:
            resources = skill.get("resources") if isinstance(skill.get("resources"), list) else []
            resource_sections = []
            for resource in resources:
                if not isinstance(resource, dict) or not str(resource.get("content") or "").strip():
                    continue
                resource_sections.append(f"### 资源：{resource.get('path')}\n{resource.get('content')}")
            resource_text = "\n\n按需读取的资源：\n" + "\n\n".join(resource_sections) if resource_sections else ""
            blocks.append(
                f"## {skill.get('skill_title')} ({skill.get('skill_name')} v{skill.get('skill_version')})\n"
                f"激活方式：{skill.get('activation_mode')}；原因：{skill.get('activation_reason')}\n"
                f"允许工具：{', '.join(str(item) for item in skill.get('tools') or []) or '无'}\n"
                f"输出契约：{skill.get('output_contract')}；安全级别：{skill.get('safety_level')}\n\n"
                f"{str(skill.get('instructions') or '').strip()}"
                f"{resource_text}"
            )
        return clip_to_token_budget("\n\n".join(blocks), 6000, suffix="\n[Skill 指令因上下文预算被截断]")

    def _explicit_skill_tool_violation(self, tool_name: str, state: ConversationState) -> str | None:
        context = state.get("context") or {}
        explicit = [
            skill
            for skill in self._active_skills(context)
            if skill.get("activation_mode") == "explicit"
        ]
        if not explicit:
            return None
        allowed = {
            str(tool)
            for skill in explicit
            for tool in skill.get("tools") or []
        }
        if tool_name in allowed:
            return None
        skill_names = "、".join(str(skill.get("skill_name")) for skill in explicit)
        return f"工具 {tool_name} 不在显式 Skill（{skill_names}）声明的允许工具列表中，已拒绝执行。"

    def _record_skill_validation(self, state: ConversationState) -> None:
        context = state.get("context") or {}
        active = self._active_skills(context)
        if not active:
            return
        observed_tools = [
            str(event.get("tool_name") or "")
            for event in state.get("agent_events") or []
            if isinstance(event, dict) and event.get("type") == "tool_use" and event.get("tool_name")
        ]
        successful_tools = [
            str(event.get("tool_name") or "")
            for event in state.get("agent_events") or []
            if isinstance(event, dict)
            and event.get("type") == "tool_result"
            and event.get("status") == "success"
            and event.get("tool_name")
        ]
        explicit_allowed = {
            str(tool)
            for skill in active
            if skill.get("activation_mode") == "explicit"
            for tool in skill.get("tools") or []
        }
        explicit_violations = [tool for tool in observed_tools if explicit_allowed and tool not in explicit_allowed]
        for skill in active:
            allowed = {str(tool) for tool in skill.get("tools") or []}
            used = [tool for tool in observed_tools if tool in allowed]
            entrypoint_called = str(skill.get("entrypoint") or "") in used
            successful_used = [tool for tool in successful_tools if tool in allowed]
            entrypoint_succeeded = str(skill.get("entrypoint") or "") in successful_used
            delegated_tasks = [
                event
                for event in state.get("agent_events") or []
                if isinstance(event, dict)
                and event.get("type") == "workflow_task_result"
                and event.get("skill_name") == skill.get("skill_name")
                and event.get("status") == "success"
            ]
            if explicit_violations and skill.get("activation_mode") == "explicit":
                status = "violated"
            elif entrypoint_succeeded or successful_used or delegated_tasks:
                status = "completed"
            elif used:
                status = "failed"
            else:
                status = "not_executed"
            self._append_agent_event(
                state,
                "skill_validation",
                {
                    "skill_name": skill.get("skill_name"),
                    "skill_title": skill.get("skill_title"),
                    "skill_version": skill.get("skill_version"),
                    "status": status,
                    "instructions_loaded": bool(str(skill.get("instructions") or "").strip()),
                    "instruction_digest": skill.get("instruction_digest"),
                    "declared_steps": skill.get("workflow_steps") or [],
                    "observed_tools": used,
                    "entrypoint_called": entrypoint_called,
                    "entrypoint_succeeded": entrypoint_succeeded,
                    "delegated_task_ids": [str(event.get("task_id") or "") for event in delegated_tasks],
                    "tool_contract_violations": explicit_violations if skill.get("activation_mode") == "explicit" else [],
                    "step_verification": (
                        "entrypoint_completed"
                        if entrypoint_succeeded
                        else "delegated_entrypoint_completed"
                        if delegated_tasks
                        else "supporting_tools_observed"
                        if successful_used
                        else "skill_tool_failed"
                        if used
                        else "no_skill_tool_observed"
                    ),
                },
            )

    def _skill_event_metadata(self, tool_name: str, state: ConversationState) -> dict[str, Any]:
        context = state.get("context") or {}
        active = self._active_skills(context)
        selected = next((skill for skill in active if skill.get("entrypoint") == tool_name), None)
        if selected is None:
            selected = next((skill for skill in active if tool_name in (skill.get("tools") or [])), None)
        if selected is None:
            selected = next((skill for skill in active if skill.get("activation_mode") == "explicit"), None)
        if selected is not None:
            return {
                "skill_name": selected.get("skill_name"),
                "skill_title": selected.get("skill_title"),
                "skill_version": selected.get("skill_version"),
                "skill_steps": selected.get("workflow_steps") or [],
                "skill_activation_mode": selected.get("activation_mode"),
                "skill_activation_reason": selected.get("activation_reason"),
                "skill_instruction_digest": selected.get("instruction_digest"),
            }
        mapping = context.get("skill_trace_by_tool") or {}
        if not isinstance(mapping, dict):
            return {}
        metadata = mapping.get(tool_name)
        if not isinstance(metadata, dict):
            return {}
        return {
            key: value
            for key, value in metadata.items()
            if key in {"skill_name", "skill_title", "skill_version", "skill_steps"}
        }

    def _initial_evaluation_trace(self, message: str, context: dict[str, Any]) -> dict[str, Any]:
        evidence = context.get("evidence") if isinstance(context.get("evidence"), list) else []
        contexts: list[str] = []
        sources: list[dict[str, Any]] = []
        for item in evidence:
            if not isinstance(item, dict):
                continue
            rendered_context = self._render_evaluation_context(item)
            if rendered_context:
                contexts.append(rendered_context)
            sources.append(
                {
                    "id": str(item.get("id") or ""),
                    "source_id": str(item.get("source_id") or ""),
                    "source_type": str(item.get("source_type") or ""),
                    "title": str(item.get("title") or ""),
                    "score": item.get("score"),
                }
            )
        retrievals = []
        if contexts or sources:
            retrievals.append(
                {
                    "stage": "prefetch",
                    "query": message,
                    "contexts": contexts,
                    "sources": sources,
                }
            )
        return {
            "target": "ChatAgent",
            "retrievals": retrievals,
            "tool_observations": [],
        }

    def _capture_evaluation_observation(
        self,
        state: ConversationState,
        *,
        tool_name: str,
        arguments: dict[str, Any],
        observation: dict[str, Any],
    ) -> None:
        if not (state.get("context") or {}).get("evaluation_mode"):
            return
        trace = dict(state.get("evaluation_trace") or {})
        tool_observations = list(trace.get("tool_observations") or [])
        tool_observations.append(
            {
                "tool_name": tool_name,
                "arguments": arguments,
                "status": "error"
                if any(
                    call.get("status") == "error"
                    for call in observation.get("tool_calls", [])
                    if isinstance(call, dict)
                )
                else "success",
                "content": str(observation.get("answer") or ""),
            }
        )
        trace["tool_observations"] = tool_observations

        raw_sources = observation.get("retrieval_results")
        sources = [dict(item) for item in raw_sources if isinstance(item, dict)] if isinstance(raw_sources, list) else []
        contexts = [self._render_evaluation_context(item) for item in sources]
        contexts = [item for item in contexts if item]
        if not contexts:
            contexts = [
                str(item).strip()
                for item in observation.get("retrieved_contexts", [])
                if str(item).strip()
            ]
        if tool_name == "rag.search_similar_documents" or contexts or sources:
            retrievals = list(trace.get("retrievals") or [])
            retrievals.append(
                {
                    "stage": "agent_tool",
                    "query": str(arguments.get("query") or arguments.get("message") or ""),
                    "contexts": contexts,
                    "sources": sources,
                }
            )
            trace["retrievals"] = retrievals
        state["evaluation_trace"] = trace

    @staticmethod
    def _render_evaluation_context(item: dict[str, Any]) -> str:
        """Render the same title/source/snippet evidence shape shown to ChatAgent."""
        source_type = str(item.get("source_type") or "").strip()
        title = str(item.get("title") or "").strip()
        snippet = str(item.get("snippet") or item.get("content") or "").strip()
        heading = " ".join(part for part in ([f"[{source_type}]" if source_type else "", title]) if part)
        if heading and snippet:
            return f"{heading}: {snippet}"
        return heading or snippet

    def _evaluation_result(self, state: ConversationState) -> dict[str, Any]:
        if not (state.get("context") or {}).get("evaluation_mode"):
            return {}
        trace = dict(state.get("evaluation_trace") or {})
        contexts: list[str] = []
        seen: set[str] = set()
        for retrieval in trace.get("retrievals") or []:
            if not isinstance(retrieval, dict):
                continue
            for item in retrieval.get("contexts") or []:
                text = str(item).strip()
                if text and text not in seen:
                    seen.add(text)
                    contexts.append(text)
        trace["retrieved_contexts"] = contexts
        trace["agent_events"] = self._tool_event_transcript(state)
        return {"evaluation_trace": trace}
