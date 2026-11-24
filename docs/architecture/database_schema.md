# 数据库模型设计（Database Schema）

ORM 模型统一定义于 `backend/app/db/models.py`，结构演进通过 `backend/migrations/`（Alembic）管理，共包含 32 张核心业务与运行态追踪表，按领域划分为六组：

## 1. 仓库与 GitHub 同步域
- `users`：本地操作者与权限角色。
- `repositories`：已连接仓库元数据、托管平台类型、本地 Checkout 路径与 Fernet 加密存储的访问凭据。
- `issues` / `pull_requests` / `pr_files` / `pr_review_comments` / `workflow_runs`：同步自 GitHub 的协作实体、Diff 补丁、行级评审评论及脱敏后的失败 CI 日志与步骤树（`workflow_runs.jobs`）。

## 2. 对话、双轨记忆与上下文压缩域
- `conversations`：仓库级多会话隔离容器。
- `chat_messages`：持久化完整对话转录；其中 `role='system'` 且 `meta.subtype='compact_boundary'` 的记录作为渐进式上下文压缩边界，保存被摘要区间引用与保留消息 ID 列表。
- `chat_sessions`：每轮对话封存快照（包含原始消息、工具调用事件、Token 计量诊断与记忆提取结果）。
- `conversation_memories` / `thread_memories`：结构化增量会话记忆（`summary`、`facts`、`decisions`、`open_questions`、`tasks`、`user_preferences`、`repo_context`、`citations`）。
- `memory_candidates` / `recall_events`：待人工确认入库的长期知识候选及每次 MCP / RAG 召回的可观测记录。

## 3. 混合 RAG 与知识库域
- `knowledge_bases` / `rag_configs`：仓库知识库切片参数、Embedding 模型、混合检索权重、Rerank 开关与分数阈值配置。
- `documents` / `evidence_items`：结构化切片后的非结构化知识片段与面向关键词/混合检索的去范式化证据索引。
- `project_index_states`：本地仓库文档（README / ADR / `docs/` / manifest）指纹、索引策略（`.devhelm/index.yml`）与扫描状态。

## 4. 代码索引与项目知识图谱域
- `code_symbols` / `code_relations`：本地源码符号定义与调用/引用关系。
- `knowledge_nodes` / `knowledge_edges`：跨 Issue、PR、CI、成员、文档、记忆与代码文件的可追溯图谱节点与关系边。

## 5. Agent 运行追踪与安全治理域
- `agent_runs` / `analysis_results`：单次对话及专项 Issue / PR / CI 分析结构化产物。
- `agent_workflow_runs` / `agent_task_runs`：多 Agent 工作流规格、Observer 观察结论与子任务级执行轨迹。
- `action_drafts` / `audit_logs` / `chat_feedbacks`：待人工确认的外部写操作安全草稿、权限审计日志及用户回答质量反馈。

## 6. 评测基准域
- `eval_runs`：离线确定性评测与异步 RAGAS 0.4 回归评测的配置快照、数据集 SHA-256、逐题工具轨迹、五维指标得分及失败诊断报告。
