"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, ShieldAlert } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { Select } from "@/components/arc/select/select";
import { Timeline, type TimelineEvent } from "@/components/arc/timeline/timeline";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { Panel } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type ActionDraft = {
  id: string;
  repo_id: string;
  draft_type: string;
  target_type: string;
  title: string;
  content: string;
  risk_level: string;
  status: string;
  execution_result?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  executed_at?: string | null;
};

type AuditLog = { id: string; action: string; status: string; target_type?: string | null; target_id?: string | null; created_at: string };

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  pending_confirmation: { label: "等待人工确认", tone: "warning" },
  executed: { label: "已确认并执行", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
  failed: { label: "执行失败", tone: "danger" }
};

function auditLabel(action: string) {
  if (action.startsWith("action_draft.confirm")) return "人工确认并执行草稿";
  if (action === "action_draft.create") return "创建待确认草稿";
  if (action === "action_draft.cancel") return "取消草稿";
  return action;
}

export default function ActionDraftsPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [title, setTitle] = useState("发布检查报告");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function load(repo = repoId) {
    const suffix = repo ? `?repo_id=${repo}` : "";
    const [draftItems, auditItems] = await Promise.all([
      apiGet<ActionDraft[]>(`/api/action-drafts${suffix}`),
      apiGet<AuditLog[]>(`/api/action-drafts/audit-logs${suffix}`).catch(() => [])
    ]);
    setDrafts(draftItems);
    setAudits(auditItems);
  }

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
        return load(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDraft() {
    if (!repoId || !content.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost<ActionDraft>("/api/action-drafts", {
        repo_id: repoId,
        draft_type: "send_report",
        target_type: "repository",
        title: title.trim() || "发布检查报告",
        content,
        risk_level: "medium",
        metadata: { source: "manual_review" }
      });
      setContent("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建草稿失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function changeDraft(id: string, action: "confirm" | "cancel") {
    setLoading(true);
    setError(null);
    try {
      await apiPost(`/api/action-drafts/${id}/${action}`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = useMemo(() => drafts.filter((draft) => draft.status === "pending_confirmation").length, [drafts]);
  const executedCount = useMemo(() => drafts.filter((draft) => draft.status === "executed").length, [drafts]);

  const timelineEvents: TimelineEvent[] = audits.slice(0, 10).map((item) => ({
    id: item.id,
    at: item.created_at,
    title: auditLabel(item.action),
    meta: `${item.status} · ${new Date(item.created_at).toLocaleString("zh-CN")}`,
    tone: item.status === "success" ? "success" : "danger"
  }));

  return (
    <>
      <PageTitle title="安全草稿与人工确认" description="Agent 的外部写操作先落成可审查草稿；只有具备批准权限的人确认后，系统才执行并写入审计记录。" />

      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="全部草稿" value={drafts.length} context="当前仓库的安全草稿" />
          <MetricCard label="待确认" value={pendingCount} context="等待人工确认后执行" />
          <MetricCard label="已执行" value={executedCount} context="已完成并写入审计" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="self-start">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} strokeWidth={1.75} className="text-warning" />
              <h2 className="text-sm font-medium text-ink">创建安全草稿</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-ink-2">这里只保存建议内容，不会直接写入外部系统；确认后才执行并记录审计。</p>
            <div className="mt-4 flex flex-col gap-4">
              <Select
                label="仓库"
                placeholder="选择仓库"
                value={repoId}
                onValueChange={(value) => {
                  setRepoId(value);
                  void load(value);
                }}
                options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
              />
              <Input label="标题" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Textarea
                label="待审查内容"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="输入准备发送的报告或评论内容"
              />
              <PrimaryButton loading={loading} disabled={!repoId || !content.trim()} onClick={createDraft}>
                保存为待确认草稿
              </PrimaryButton>
            </div>
          </Card>

          <div className="flex flex-col gap-4">
            {error && <Alert tone="danger" title="操作失败">{error}</Alert>}

            {drafts.map((draft) => {
              const meta = STATUS_META[draft.status] ?? { label: draft.status, tone: "neutral" as BadgeTone };
              return (
                <Card key={draft.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-medium text-ink">{draft.title || draft.draft_type}</h2>
                        <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
                        <Badge tone={draft.risk_level === "high" ? "danger" : "neutral"} size="sm">
                          {draft.risk_level === "high" ? "高风险" : "中低风险"}
                        </Badge>
                      </div>
                      <div className="mt-1.5 text-xs text-ink-2">
                        {`${draft.draft_type} · ${draft.target_type} · ${new Date(draft.created_at).toLocaleString("zh-CN")}`}
                      </div>
                    </div>
                    {draft.status === "pending_confirmation" && (
                      <div className="flex gap-2">
                        <PrimaryButton size="sm" loading={loading} onClick={() => changeDraft(draft.id, "confirm")}>
                          确认执行
                        </PrimaryButton>
                        <Button variant="secondary" size="sm" disabled={loading} onClick={() => changeDraft(draft.id, "cancel")}>
                          取消
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4">
                    <Panel className="whitespace-pre-wrap">{draft.content}</Panel>
                  </div>

                  {draft.status === "executed" && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-success">
                      <CheckCircle2 size={16} strokeWidth={1.75} />
                      人工确认完成，执行结果和操作者已经写入审计记录。
                    </p>
                  )}
                  {draft.error_message && (
                    <div className="mt-3">
                      <Alert tone="danger" title="执行失败">{draft.error_message}</Alert>
                    </div>
                  )}
                </Card>
              );
            })}

            {drafts.length === 0 && (
              <Card>
                <EmptyState
                  title="暂无安全草稿"
                  description="创建的第一份草稿会显示在这里，等待人工确认后再执行。"
                  icon={<FileText size={18} strokeWidth={1.75} />}
                />
              </Card>
            )}

            <Card>
              <h2 className="text-sm font-medium text-ink">审计时间线</h2>
              <div className="mt-3">
                {now !== null && audits.length > 0 ? (
                  <Timeline events={timelineEvents} now={now} label="审计时间线" locale="zh-CN" maxHeight={420} />
                ) : (
                  <p className="text-sm text-ink-2">暂无审计记录。</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
