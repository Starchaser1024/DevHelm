import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  GitPullRequest,
  ListTodo,
  Search,
  type LucideIcon
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { formatDate } from "./formatters";
import { MarkdownMessage } from "./markdown-message";
import type {
  Issue,
  IssueAnalysisTraceItem,
  PullRequest,
  WorkflowRun,
  WorkspaceItem,
  WorkspaceTab
} from "./types";

export function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-ink-2">{label}</div>
        <Icon className="h-3.5 w-3.5 text-accent" />
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

export function WorkspaceControls({
  query,
  status,
  owner,
  time,
  owners,
  activeTab,
  onQueryChange,
  onStatusChange,
  onOwnerChange,
  onTimeChange
}: {
  query: string;
  status: string;
  owner: string;
  time: string;
  owners: string[];
  activeTab: WorkspaceTab;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="关键词搜索标题、正文、标签"
          className="h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectFilter value={status} onChange={onStatusChange} label="状态">
          <option value="all">全部状态</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
          {activeTab === "PR" && <option value="merged">merged</option>}
          {activeTab === "CI" && <option value="failure">failure</option>}
          {activeTab === "CI" && <option value="success">success</option>}
        </SelectFilter>
        <SelectFilter value={owner} onChange={onOwnerChange} label="负责人" disabled={activeTab === "CI"}>
          <option value="all">全部负责人</option>
          <option value="unassigned">未分配</option>
          {owners.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter value={time} onChange={onTimeChange} label="时间">
          <option value="all">全部时间</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </SelectFilter>
      </div>
    </div>
  );
}

export function SelectFilter({
  value,
  label,
  disabled,
  children,
  onChange
}: {
  value: string;
  label: string;
  disabled?: boolean;
  children: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-control border border-line bg-surface px-2 pr-7 text-xs text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle disabled:bg-panel disabled:text-ink-2"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-2" />
    </label>
  );
}

export function CategoryGroup({
  label,
  color,
  count,
  items,
  isCollapsed,
  onToggle
}: {
  label: string;
  color: string;
  count: number;
  items: WorkspaceItem[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <button type="button" onClick={onToggle} className="flex h-7 w-full items-center justify-between">
        <div className={`flex items-center gap-2 text-sm font-semibold ${color}`}>
          <span>{label}</span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-medium text-ink-2">{count}</span>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-ink-2 transition ${isCollapsed ? "-rotate-90" : ""}`} />
      </button>
      {!isCollapsed && items.length > 0 && (
        <div className="mt-2 space-y-2">
          {items.map((item) => (
            <WorkspaceItemButton key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

export function WorkspaceItemButton({ item }: { item: WorkspaceItem }) {
  return (
    <button
      onClick={item.onClick}
      className={`w-full rounded-control border bg-surface p-3 text-left transition ${
        item.selected ? "border-accent ring-2 ring-accent-subtle" : "border-line hover:border-accent-subtle hover:bg-accent-subtle"
      }`}
    >
      <div className="line-clamp-2 text-sm font-medium text-ink">{item.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
        <span>{item.meta}</span>
        {item.badges?.slice(0, 3).map((badge) => (
          <span key={badge} className="rounded-full bg-panel px-2 py-0.5">
            {badge}
          </span>
        ))}
      </div>
      {item.detail && <div className="mt-2 line-clamp-2 text-xs leading-5 text-ink-2">{item.detail}</div>}
    </button>
  );
}

export function WorkspaceDetail({
  issue,
  pr,
  run,
  analyzingIssue,
  analyzingPr,
  analyzingRun,
  onAnalyzeIssue,
  onAnalyzePr,
  onAnalyzeRun,
  onClose
}: {
  issue?: Issue;
  pr?: PullRequest;
  run?: WorkflowRun;
  analyzingIssue?: boolean;
  analyzingPr?: boolean;
  analyzingRun?: boolean;
  onAnalyzeIssue?: () => void;
  onAnalyzePr?: () => void;
  onAnalyzeRun?: () => void;
  onClose: () => void;
}) {
  const title = issue ? `#${issue.number} ${issue.title}` : pr ? `#${pr.number} ${pr.title}` : run?.name ?? "";
  const body = issue?.body ?? pr?.body ?? run?.logs_text ?? "暂无详情内容";
  const status = issue?.state ?? (pr?.merged_at ? "merged" : pr?.state) ?? run?.conclusion ?? run?.status ?? "";
  const owner = issue?.assignees?.join(", ") || issue?.author || pr?.author || "未分配";
  const updatedAt = issue?.updated_at ?? issue?.created_at ?? pr?.updated_at ?? pr?.created_at ?? run?.updated_at ?? run?.created_at;

  return (
    <div className="mb-4 rounded-control border border-accent-subtle bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">详情</div>
          <h3 className="mt-1 text-sm font-semibold leading-6 text-ink">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {issue && (
            <button
              onClick={onAnalyzeIssue}
              disabled={!onAnalyzeIssue || analyzingIssue}
              className="inline-flex items-center gap-1 rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-accent disabled:opacity-60"
            >
              <ListTodo className="h-3.5 w-3.5" />
              {analyzingIssue ? "分析中..." : "分析当前 Issue"}
            </button>
          )}
          {pr && (
            <button
              onClick={onAnalyzePr}
              disabled={!onAnalyzePr || analyzingPr}
              className="inline-flex items-center gap-1 rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-accent disabled:opacity-60"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {analyzingPr ? "分析中..." : "分析当前 PR"}
            </button>
          )}
          {run && (
            <button
              onClick={onAnalyzeRun}
              disabled={!onAnalyzeRun || analyzingRun}
              className="inline-flex items-center gap-1 rounded-control bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-accent disabled:opacity-60"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {analyzingRun ? "排查中..." : "分析当前 CI"}
            </button>
          )}
          <button onClick={onClose} className="rounded-control border border-line px-2 py-1 text-xs text-ink-2 transition hover:bg-panel">
            关闭
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <MetaPill label="状态" value={status} />
        <MetaPill label="负责人" value={owner} />
        <MetaPill label="更新时间" value={formatDate(updatedAt)} />
      </div>
      {(issue?.labels?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue?.labels?.map((label) => (
            <span key={label} className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs text-accent-strong">
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 whitespace-pre-wrap rounded-control bg-panel p-3 text-xs leading-6 text-ink">{body}</div>
      {pr?.files && pr.files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {pr.files.map((file) => (
            <div key={file.id} className="rounded-control border border-line bg-surface px-2 py-1.5 text-xs text-ink-2">
              <span className="font-medium text-ink">{file.filename}</span>
              <span className="ml-2 text-success">+{file.additions}</span>
              <span className="ml-1 text-danger">-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-ink-2">
      {label}: {value}
    </span>
  );
}

export function EmptyWorkspaceState({ label }: { label: string }) {
  return <div className="rounded-control border border-line bg-surface p-4 text-sm text-ink-2">{label}</div>;
}

export function AnalysisBulletList({
  title,
  items,
  emptyLabel,
  tone = "default"
}: {
  title?: string;
  items: string[];
  emptyLabel: string;
  tone?: "default" | "warn" | "danger";
}) {
  const iconClass = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warning" : "text-accent";
  const Icon = tone === "default" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="rounded-control bg-panel p-3">
      {title && <div className="text-xs font-semibold text-ink-2">{title}</div>}
      {items.length === 0 ? (
        <div className={`${title ? "mt-2" : ""} text-sm text-ink-2`}>{emptyLabel}</div>
      ) : (
        <ul className={`${title ? "mt-2" : ""} space-y-2 text-sm leading-6 text-ink`}>
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <Icon className={`mt-1 h-4 w-4 shrink-0 ${iconClass}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AgentTraceAside({
  eyebrow,
  title,
  description,
  emptyLabel,
  traceItems
}: {
  eyebrow: string;
  title: string;
  description: string;
  emptyLabel: string;
  traceItems: IssueAnalysisTraceItem[];
}) {
  const traceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = traceScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [traceItems]);

  return (
    <aside className="order-2 flex max-h-[28vh] min-h-0 flex-col overflow-hidden rounded-panel border border-accent-subtle bg-surface shadow-overlay xl:order-1 xl:h-[86vh] xl:max-h-[86vh]">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</div>
        <h3 className="mt-1 text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-ink-2">{description}</p>
      </div>
      <div ref={traceScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {traceItems.length === 0 && (
          <div className="rounded-control border border-dashed border-line bg-panel p-3 text-xs leading-5 text-ink-2">{emptyLabel}</div>
        )}
        {traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-control border p-3 text-xs leading-5 shadow-sm ${
              item.kind === "error"
                ? "border-danger-subtle bg-danger-subtle text-danger"
                : item.kind === "thinking"
                  ? "border-accent-subtle bg-accent-subtle text-ink"
                  : "border-line bg-surface text-ink-2"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </div>
            {item.kind === "thinking" ? <MarkdownMessage content={item.content} /> : <div className="whitespace-pre-wrap">{item.content}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}
