# DevHelm 界面术语表

界面文案以**中文为主**。下面这些领域缩写是产品核心竞争力所在，**保留英文**；除此之外的可见文案统一使用中文。

## 保留英文（不翻译）

| 术语 | 说明 |
| --- | --- |
| Issue | GitHub Issue 实体，含状态、标签、负责人等字段 |
| PR | Pull Request 实体与相关视图（PR 列表、PR Review） |
| CI | 持续集成运行（失败 CI、CI 排障），也指 GitHub Actions workflow run |
| Agent | 具备独立职责的智能体（Issue 分析 Agent、PR 合入就绪度 Agent、CI 根因分析 Agent） |
| Skill | `SKILL.md` 形式的技能包与 Skill Runtime |
| MCP | Model Context Protocol 及其运行时（技能&MCP 面板） |
| RAG | 检索增强问答链路（RAG 工作室） |
| Token | 访问凭据（GitHub / LLM / Embedding Token） |
| RAGAS 指标名 | Context Precision、Context Recall、Faithfulness、Answer Relevancy、Agent Goal Accuracy 等评测指标原名，避免翻译后与论文/文档对不上 |
| 字段名 | 追踪轨迹里的 `source_type`、`status`、`model` 等原始字段值按后端返回原样展示 |

## 必须中文

| 中文 | 不要写 | 位置 |
| --- | --- | --- |
| 工作台 | Workspace（导航项） | 顶部导航 |
| 工作区 | Workspace（面板标题） | 首页右侧面板 |
| 生产工作区 | Production Workspace | 首页状态徽章 |
| 项目 | Projects | 首页左侧项目列表 |
| 添加项目 | Add Project | 项目弹窗、按钮 |
| 思考轨迹 | Thinking Trace | 分析过程面板 |
| 检索轨迹 | Retrieval Trace | 知识库检索面板 |
| 运行记录 | Workflow Runs | CI 页面列表 |
| PR 列表 | Pull Requests | PR 页面列表 |
| 协议 / 传输 / 入口文件 / 安全等级 | Protocol / Transport / Entrypoint / Safety | 技能&MCP 面板运行时信息 |

## 判定规则

1. **导航、按钮、标题、空状态、错误提示、状态标签**一律中文。
2. 缩写只在**作为实体名或领域专名**时保留英文；一旦它只是普通描述（如 "Projects"、"Trace"、"Readiness"）就翻译。
3. 混排遵循「英文缩写 + 中文说明 + 保留的英文专名」顺序，例如 `PR 合入就绪度 Agent`、`CI 根因分析 Agent`。
4. 英文与中文之间加一个半角空格（`RAG 工作室`、`Issue 分析 Agent`），与全站既有排版一致。
5. `components/arc/**` 是内置设计系统，其内部默认文案（Copy/Copied、Clear all 等，多数为无障碍或宽度测量文本）不属于应用文案范围，如需本地化应整体改造 Arc 而不是逐处打补丁。

## 变更约定

改动界面文案前先对照本表：新出现的缩写要先加进「保留英文」清单，再写进代码，避免同一个概念在不同页面各写一套。
