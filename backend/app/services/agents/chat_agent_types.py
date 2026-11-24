from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypedDict

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

ConversationTool = Callable[[dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]
ToolErrorKind = Literal[
    "unknown_tool",
    "timeout",
    "rate_limited",
    "transient_network",
    "permission_denied",
    "data_not_found",
    "model_output_invalid",
    "tool_runtime_error",
]

TOOL_DESCRIPTIONS: dict[str, str] = {
    "devhelm_search_evidence": "MCP 记忆工具。搜索持久记忆、会话摘要、仓库证据、Issue、PR、CI 和 Agent 运行记录。",
    "devhelm_get_thread_context": "MCP 记忆工具。跨压缩边界读取当前仓库会话的完整原始聊天转录，支持消息 UUID 和字符偏移分页。",
    "devhelm_read_session_events": "MCP 记忆工具。读取已封存的会话摘要、原始消息和工具事件。",
    "workspace.list_files": "列出所选仓库本地 checkout 下的文件。只读，用于探索源码树。",
    "workspace.read_file": "从所选仓库 checkout 中读取文本文件，可指定 start_line 和 line_count。只读。",
    "workspace.search_code": "在所选仓库 checkout 中搜索代码或文档文本。只读。",
    "repo_health.generate_summary": "总结当前仓库健康状态。",
    "rag.search_similar_documents": "搜索项目历史与非结构化知识，包括 Issue 描述、PR 说明与 Review 讨论、失败 CI 日志、项目文档、上传知识和已批准的长期记忆。可传入改写后的 query，并用不同 query 连续调用以补查和交叉验证。源码优先使用 workspace 工具，团队成员和实时状态使用对应结构化工具。",
    "issue_agent.analyze_issue": "分析最新同步的 Issue。",
    "pr_review_agent.analyze_pr": "分析最新同步的 PR。",
    "ci_debug_agent.analyze_workflow_run": "分析最新失败的 CI 运行。",
    "report_agent.generate_weekly_report": "生成仓库报告。",
    "safety_agent.classify_action_risk": "安全起草有风险的写操作或外部发送动作。",
    "workflow.run_engineering_review": "运行 Planner -> 专用 Agent -> Observer -> Synthesis 工作流，用于 PR 就绪度、阻塞项、优先级和多 Agent 仓库审查等跨领域工程决策。",
}


class GenericToolArgs(BaseModel):
    model_config = ConfigDict(extra="allow")

    message: str | None = Field(default=None, description="原始用户消息")
    query: str | None = Field(default=None, description="搜索查询")
    keyword: str | None = Field(default=None, description="关键词过滤")
    limit: int | None = Field(default=None, description="结果数量上限")
    repo_id: str | None = Field(default=None, description="仓库 UUID")
    repo_full_name: str | None = Field(default=None, description="仓库完整名称")
    conversation_id: str | None = Field(default=None, description="会话 UUID")
    session_id: str | None = Field(default=None, description="会话片段 UUID")
    message_id: str | None = Field(default=None, description="需要精确读取的消息 UUID")
    before_message_id: str | None = Field(default=None, description="只读取该消息之前的记录")
    after_message_id: str | None = Field(default=None, description="只读取该消息之后的记录")
    offset: int | None = Field(default=None, description="从消息正文的字符偏移量开始读取")
    max_chars: int | None = Field(default=None, description="本次最多返回的正文字符数")
    include_transcript: bool | None = Field(default=None, description="读取封存会话时是否包含原始 transcript")
    route: str | None = Field(default=None, description="仓库路由或意图")
    path: str | None = Field(default=None, description="相对工作区的文件或目录路径")
    pattern: str | None = Field(default=None, description="文本或 glob 模式")
    start_line: int | None = Field(default=None, description="读取文件时从第几行开始，行号从 1 开始")
    line_count: int | None = Field(default=None, description="最多读取多少行")


class ConversationState(TypedDict, total=False):
    message: str
    context: dict[str, Any]
    tools: dict[str, StructuredTool]
    tool_name_map: dict[str, str]
    observations: list[dict[str, Any]]
    agent_events: list[dict[str, Any]]
    tool_calls: list[dict[str, Any]]
    citations: list[dict[str, Any]]
    pending_tool_calls: list[dict[str, Any]]
    stream_events: list[dict[str, Any]]
    route: str
    step: int
    final_answer: str
    stop_reason: str
    completion_status: str
    tool_call_counts: dict[str, int]
    evaluation_trace: dict[str, Any]
    model_usage: list[dict[str, Any]]
    prompt_diagnostics: list[dict[str, Any]]
    runtime_context_stats: dict[str, Any]
    context_overflow_recovery_attempted: bool


def encode_sse(event: dict[str, Any]) -> str:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"
