import type { WorkspaceTab } from "./types";

export const workspaceTabs: readonly WorkspaceTab[] = [
  "Issue",
  "PR",
  "CI",
  "团队",
  "记忆&知识库",
  "技能&MCP",
  "图谱"
] as const;

export const DRAFT_CONVERSATION_PREFIX = "draft:";

export const issueCategoryMeta = [
  { key: "unanswered", label: "未回复", color: "text-danger" },
  { key: "discussing", label: "讨论中", color: "text-accent-strong" },
  { key: "decision", label: "待决策", color: "text-warning" },
  { key: "accepted", label: "已处理", color: "text-success" },
  { key: "rejected", label: "已拒绝", color: "text-ink-2" },
  { key: "closed", label: "已关闭", color: "text-ink-2" }
] as const;

export const prCategoryMeta = [
  { key: "reviewing", label: "审核中", color: "text-accent-strong" },
  { key: "needsOwner", label: "需主审", color: "text-warning" },
  { key: "conflict", label: "有冲突", color: "text-danger" },
  { key: "done", label: "已完成", color: "text-success" },
  { key: "rejected", label: "已拒绝", color: "text-ink-2" }
] as const;
