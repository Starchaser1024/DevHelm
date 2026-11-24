import { AlertTriangle, CheckCircle2, GitPullRequest, ListTodo, XCircle } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";

import type { ProjectConversation, Repository } from "./types";
import { MetricCard } from "./workbench-shared";

export function WorkbenchOverviewBar({
  selectedRepo,
  selectedConversation,
  openIssuesCount,
  openPrsCount,
  handledIssuesCount,
  rejectedIssuesCount,
  failedRunsCount,
  mergedPrsCount,
  actionError,
  onDismissActionError,
  onOpenAddProject
}: {
  selectedRepo: Repository | undefined;
  selectedConversation: ProjectConversation | undefined;
  openIssuesCount: number;
  openPrsCount: number;
  handledIssuesCount: number;
  rejectedIssuesCount: number;
  failedRunsCount: number;
  mergedPrsCount: number;
  actionError: { title: string; detail: string } | null;
  onDismissActionError: () => void;
  onOpenAddProject: () => void;
}) {
  return (
    <section className="col-start-1 row-start-1 shrink-0 border-b border-line bg-surface px-4 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold text-ink">总览</h2>
            <span className="text-xs text-ink-2">当前代码仓</span>
            <span className="truncate text-sm font-semibold text-ink">{selectedRepo?.full_name || "未选择仓库"}</span>
            {selectedConversation && <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-ink-2">会话：{selectedConversation.title}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="rounded-full border border-accent-subtle bg-accent-subtle px-3 py-1 text-xs font-medium text-accent-strong">生产工作区</div>
          <button onClick={onOpenAddProject} className="text-xs text-accent hover:underline">
            管理项目
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard icon={ListTodo} label="待处理 Issue" value={openIssuesCount} />
        <MetricCard icon={GitPullRequest} label="待 Review PR" value={openPrsCount} />
        <MetricCard icon={CheckCircle2} label="已处理 Issue" value={handledIssuesCount} />
        <MetricCard icon={XCircle} label="已拒绝 Issue" value={rejectedIssuesCount} />
        <MetricCard icon={AlertTriangle} label="失败 CI" value={failedRunsCount} />
        <MetricCard icon={CheckCircle2} label="已合并 PR" value={mergedPrsCount} />
      </div>
      <Alert
        open={actionError !== null}
        tone="danger"
        title={actionError?.title ?? ""}
        className="mt-2"
        onDismiss={onDismissActionError}
      >
        {actionError?.detail ?? ""}
      </Alert>
    </section>
  );
}
