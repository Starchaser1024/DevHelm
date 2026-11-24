# Agent 工作流与 Skill 运行时

## 1. 单对话推理循环（`/api/chat` & `/api/chat/stream`）

用户消息进入对话入口后，后端依次执行以下阶段：

1. **前置渐进压缩（`ProgressiveContextManager.ensure_headroom`）**：评估当前分段原始 Token 与组装后 Token 压力；若超过自动压缩阈值且 Microcompact 不足以恢复安全余量，自动生成保留关键事实的 `compact_boundary` 系统消息并写入重水合状态（工作文件、近期工具、已激活 Skill）。
2. **上下文预算组装（`ContextAssembler.assemble`）**：按系统前缀、会话记忆、预检索证据（`[Related Evidence]`）与近期消息四个预算槽位裁剪组装输入，并计算完整历史覆盖度（`history_coverage`）。
3. **Skill 按需激活（`SkillRegistry.activate`）**：支持用户显式指定或基于触发词自动匹配 `SKILL.md`；仅对命中的技能加载完整指令与受限参考文件。若为显式激活，任何不在该 Skill `tools` 白名单内的工具调用都会被运行时直接拦截。
4. **LangGraph 原生工具循环（`ChatAgent`）**：
   - **直接近期历史捷径**：若问题仅询问上一轮对话且 `history_coverage` 证明近期原文完整未裁剪，直接基于上下文回答，避免无意义工具调用。
   - **源码与实时数据分流**：源码阅读走 `workspace.list_files` / `read_file` / `search_code`；历史非结构化知识走 `rag.search_similar_documents`（支持改写查询多次补查）；跨边界转录走 MCP 工具 `devhelm_get_thread_context` / `devhelm_read_session_events`。
   - **安全门禁**：检测到写回或外发意图时，强制调用 `safety_agent.classify_action_risk` 生成待人工审批的 `ActionDraft`。
   - **循环护栏**：基于归一化参数指纹拦截连续重复工具调用，对瞬时网络/限流错误自动执行单次退避重试，并在上下文溢出时触发一次激进运行时投影重试。
5. **会话封存（`SessionSealer.seal`）**：回合结束后持久化 `ChatSession` 转录快照，增量合并结构化 `ConversationMemory`，提取待人工审核的长期知识候选（`MemoryCandidate`）。

## 2. 多 Agent 工程审查闭环（`workflow.run_engineering_review` & 计划模式）

当问题涉及 PR 合入就绪度、阻塞项排查、跨模块风险评估或用户在前端开启 **计划模式** 时：

1. **目标解析与显式约束**：`_build_engineering_workflow_runtime` 从消息中提取显式指定的 Issue / PR / Workflow Run 编号；若指定编号不存在或同类型存在多个冲突目标，立即抛出 `WorkflowTargetResolutionError` 终止规划，绝不静默回退到最新对象。
2. **任务图规划（`PlannerAgent`）**：输出 `WorkflowSpec`，为每个子任务声明依赖关系、关键性标记与目标 `Claim`。
3. **并行调度与独立 Skill 注入（`WorkflowOrchestrator`）**：按拓扑顺序并行运行无未决依赖的专项任务（`IssueAgent`、`PRReviewAgent`、`CIDebugAgent`、混合 RAG 检索、`SafetyAgent`），每个专项 Agent 独立加载自身入口对应的 `SKILL.md` 规范。
4. **观察校验与有界重规划（`ObserverAgent` -> `Replan`）**：检查关键任务失败、跨 Agent 结论矛盾、合并门禁阻塞及低置信度项；若证据不足且未超过最大重规划轮数，交回 `PlannerAgent` 追加补查任务。
5. **综合决策与审计落库（`SynthesisAgent`）**：生成包含证据、风险、阻塞项与下一步行动的统一工程备忘录，并将完整 `WorkflowSpec`、观察报告、重规划事件与各子任务耗时持久化至 `AgentWorkflowRun` 与 `AgentTaskRun`。
