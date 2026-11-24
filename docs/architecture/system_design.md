# 系统设计概览（System Design）

DevHelm 采用前后端分离与分层自治架构，将 **GitHub 协作事件流**、**本地代码工作区**、**双轨会话记忆**、**混合向量检索** 与 **多 Agent 编排运行时** 解耦为边界清晰的独立模块。

## 分层职责

1. **前端交互层（`frontend/`）**
   - `app/`：Next.js App Router 路由入口，负责页面级装配（研发协作工作台、仓库接入、RAG 工作室、知识库详情、研发周报、安全草稿审批、RAGAS 评测台）。
   - `features/workbench/`：工作台核心领域模块，按职责拆分为状态控制 Hook（`use-workbench-controller.ts`、`use-entity-analysis.ts`）、流式对话与上下文诊断面板（`chat-workspace-panel.tsx`）、领域视图面板（Issue / PR / CI / 团队 / 记忆&知识库 / 技能&MCP / 知识图谱）及无副作用纯函数工具（`formatters.ts`、`graph-helpers.ts`）。
   - `components/arc/`：统一设计系统与基础交互原语。

2. **API 与流式传输层（`backend/app/api/routes/`）**
   - 提供标准 REST 接口与基于 SSE（`text/event-stream`）的增量事件流，实时推送 `thought`、`tool_use`、`tool_result`、`delta` 与 `final` 事件，支持前端随时取消（AbortSignal）与工具轨迹可视化。

3. **对话与多 Agent 编排层（`backend/app/services/agents/` & `chat_runtime/`）**
   - `ChatAgent`：单轮内基于 LangGraph 驱动原生工具调用，按需激活 `SKILL.md` 并对显式技能执行工具白名单校验。
   - `WorkflowOrchestrator`：面向复杂跨领域工程问题，运行 `Planner -> Specialist -> Observer -> Replan -> Synthesis` 有向无环任务图，强制校验目标 Claim，防止跨对象误读或静默回退。

4. **上下文工程与记忆层（`chat_memory.py` / `memory_stores.py` / `context_compaction.py` / `session_sealing.py`）**
   - 区分 **持久化完整转录** 与 **模型活跃投影**：通过 Microcompact 与渐进式压缩边界控制输入 Token 预算，同时通过独立 stdio MCP Server（`backend/app/mcp/memory_server.py`）提供跨压缩边界的逐字回查能力。

5. **混合检索与知识图谱层（`rag/` & `knowledge_graph.py`）**
   - 结合 PostgreSQL 关键词匹配、Milvus 稠密向量召回与 Qwen Rerank 重排，配合项目知识图谱将 Issue、PR、CI、代码文件、团队成员与历史决策关联为可追溯图结构。
