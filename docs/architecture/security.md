# 安全与数据边界设计（Security）

1. **凭据加密与最小暴露**
   - LLM API Key、Webhook Secret 等系统级密钥仅从环境变量读取，绝不硬编码或写入响应体。
   - 仓库级 GitHub Access Token 持久化时经 `backend/app/core/security.py` 使用基于 SHA-256 密钥派生的 Fernet 对称加密存储（`repositories.github_token_encrypted`），日志与前端回显一律屏蔽明文。

2. **工作区只读沙箱与敏感文件隔离**
   - 对话工作区工具（`workspace.list_files`、`workspace.read_file`、`workspace.search_code`）严格校验目标路径必须位于当前仓库 Checkout 根目录内（`Path.resolve().relative_to(...)`），阻断路径穿越（`..`）。
   - 自动跳过 `.git`、`.venv`、`node_modules` 等非源码目录，并硬性拒绝读取 `.env*`、`.npmrc`、`.pypirc`、`*.pem`、`*.key`、`credentials*` 等敏感配置文件以及二进制/超长文件。
   - CI 日志在进入索引与证据库前经过 `sanitize_ci_log` 脱敏与长度截断。

3. **客户端上下文隔离与 MCP 作用域强制覆盖**
   - 服务端在接收 `/api/chat` 请求时通过 `_client_context` 剥离客户端伪造的 `repo_id`、`conversation_id`、`tools`、`server_context`、`evidence` 等服务端权威字段。
   - `ChatAgent` 调用任何 `devhelm_*` MCP 工具前，强制以服务端当前会话的 `repo_id` 与 `conversation_id` 覆盖模型传入的作用域参数，防止跨项目记忆越权召回。

4. **Skill 工具白名单与人机协同写门禁**
   - 用户显式激活某个 `SKILL.md` 时，`ChatAgent` 强制校验每一次工具调用是否属于该 Skill 声明的 `tools` 白名单，越界调用直接拒绝并记录 `skill_validation=violated`。
   - 所有对外写入意图（创建/关闭 Issue、评论 PR、外发周报）统一由 `SafetyAgent` 转化为 `ActionDraft` 并记录 `AuditLog`，未经人工确认不会向 GitHub 或外部渠道发起真实写请求。
