"use client";

import { useEffect, useState } from "react";
import { Inbox, Search } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, GhostButton, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MetaRow, Panel, ReportBody, Section, TextList } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type Issue = { id: string; number: number; title: string; state: string; labels: string[]; body?: string };

type DuplicateCandidate = { issue_id: string; title: string; score: number };
type Evidence = { source_type: string; title: string; snippet: string; reference?: string | null; confidence?: number | null };
type IssueAnalysis = {
  summary: string;
  conclusion: string;
  conclusion_reason: string;
  category: string;
  priority: string;
  complexity: string;
  suggested_owner: string;
  owner_reason: string;
  duplicate_candidates: DuplicateCandidate[];
  evidence: Evidence[];
  checklist: string[];
  action_items: string[];
  drafts: { clarification_comment?: string | null; task_breakdown?: string | null };
  confidence: number;
};
type AnalyzeResponse = { analysis_id: string; result: IssueAnalysis };

const CONCLUSION_TONES: Record<string, BadgeTone> = {
  进入开发: "success",
  等待澄清: "warning",
  关闭: "neutral",
  拆分: "info",
  合并到已有Issue: "info"
};

const PRIORITY_TONES: Record<string, BadgeTone> = {
  P0: "danger",
  P1: "warning",
  P2: "info",
  P3: "neutral"
};

function AnalysisReport({ analysis }: { analysis: IssueAnalysis }) {
  const drafts = [analysis.drafts?.clarification_comment, analysis.drafts?.task_breakdown].filter(Boolean);
  return (
    <ReportBody>
      <MetaRow note={`置信度 ${Math.round(analysis.confidence * 100)}%`}>
        <Badge tone={CONCLUSION_TONES[analysis.conclusion] ?? "neutral"}>{analysis.conclusion}</Badge>
        <Badge tone="neutral" size="sm">{analysis.category}</Badge>
        <Badge tone={PRIORITY_TONES[analysis.priority] ?? "neutral"} size="sm">{`优先级 ${analysis.priority}`}</Badge>
        <Badge tone="neutral" size="sm">{`复杂度 ${analysis.complexity}`}</Badge>
      </MetaRow>

      <p className="text-sm leading-6 text-ink-2">{analysis.summary}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel label="结论理由">{analysis.conclusion_reason}</Panel>
        <Panel label="建议负责人">
          <span className="font-medium text-ink">{analysis.suggested_owner}</span>
          {analysis.owner_reason ? ` · ${analysis.owner_reason}` : ""}
        </Panel>
      </div>

      {analysis.duplicate_candidates.length > 0 && (
        <Section title="相似历史 Issue">
          <div className="flex flex-col gap-2">
            {analysis.duplicate_candidates.map((item) => (
              <div key={item.issue_id} className="flex items-center justify-between gap-3 rounded-control border border-line bg-panel px-4 py-2.5">
                <span className="min-w-0 truncate text-sm text-ink-2">{item.title}</span>
                <Badge tone="info" size="sm">{`${Math.round(item.score * 100)}%`}</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.evidence.length > 0 && (
        <Section title="证据">
          <div className="flex flex-col gap-2">
            {analysis.evidence.map((item, index) => (
              <div key={index} className="rounded-control border border-line bg-panel px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{item.title}</span>
                  <Badge tone="neutral" size="sm">{item.source_type}</Badge>
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-2">{item.snippet}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(analysis.action_items.length > 0 || analysis.checklist.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {analysis.action_items.length > 0 && (
            <Section title="行动项">
              <TextList items={analysis.action_items} />
            </Section>
          )}
          {analysis.checklist.length > 0 && (
            <Section title="检查清单">
              <TextList items={analysis.checklist} />
            </Section>
          )}
        </div>
      )}

      {drafts.length > 0 && (
        <Section title="草稿">
          <div className="flex flex-col gap-2">
            {analysis.drafts?.clarification_comment && (
              <Panel label="澄清评论">{analysis.drafts.clarification_comment}</Panel>
            )}
            {analysis.drafts?.task_breakdown && (
              <Panel label="任务拆解">
                <p className="whitespace-pre-wrap">{analysis.drafts.task_breakdown}</p>
              </Panel>
            )}
          </div>
        </Section>
      )}
    </ReportBody>
  );
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [analysis, setAnalysis] = useState<IssueAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((repos) => {
        if (!repos[0]) return;
        return apiGet<Issue[]>(`/api/repos/${repos[0].id}/issues`).then((items) => {
          setIssues(items);
          setSelected(items[0] ?? null);
        });
      })
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, []);

  async function analyze() {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const data = await apiPost<AnalyzeResponse>(`/api/issues/${selected.id}/analyze`, {});
      setAnalysis(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <PageTitle title="Issue 智能分析" description="自动生成 Issue 分类、优先级、复杂度、负责人建议、相似问题和下一步行动项。" />
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,370px)_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">Issue 列表</h2>
            <Badge tone="neutral" size="sm">{`${issues.length} 条`}</Badge>
          </div>
          {loading ? (
            <Skeleton lines={5} className="mt-4" />
          ) : issues.length === 0 ? (
            <EmptyState
              title="暂无 Issue"
              description="当前仓库还没有同步到 Issue。"
              icon={<Inbox size={18} strokeWidth={1.75} />}
              className="mt-4"
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {issues.map((issue) => (
                <GhostButton
                  key={issue.id}
                  active={selected?.id === issue.id}
                  onClick={() => {
                    setSelected(issue);
                    setAnalysis(null);
                    setError(null);
                  }}
                >
                  <span className="min-w-0 truncate">#{issue.number} {issue.title}</span>
                  <Badge tone={issue.state === "open" ? "success" : "neutral"} size="sm" className="shrink-0">
                    {issue.state}
                  </Badge>
                </GhostButton>
              ))}
            </div>
          )}
        </Card>

        <Card>
          {selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-base font-medium text-ink">#{selected.number} {selected.title}</h2>
                <Badge tone={selected.state === "open" ? "success" : "neutral"} size="sm" className="shrink-0">
                  {selected.state}
                </Badge>
              </div>
              {selected.labels.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.labels.map((label) => (
                    <Badge key={label} tone="neutral" size="sm">{label}</Badge>
                  ))}
                </div>
              )}
              <p className="mt-3 text-sm leading-6 text-ink-2">{selected.body || "暂无正文。"}</p>

              <div className="mt-5">
                <PrimaryButton onClick={analyze} loading={analyzing}>分析当前 Issue</PrimaryButton>
              </div>

              {error && <p className="mt-4 text-sm text-danger">{error}</p>}
              {analyzing ? (
                <Skeleton lines={6} avatar className="mt-6" />
              ) : analysis ? (
                <AnalysisReport analysis={analysis} />
              ) : null}
            </>
          ) : loading ? (
            <Skeleton lines={6} avatar />
          ) : (
            <EmptyState
              title="选择一个 Issue"
              description="从左侧列表选择一个 Issue，生成分类、优先级、负责人与行动建议。"
              icon={<Search size={18} strokeWidth={1.75} />}
            />
          )}
        </Card>
      </div>
    </>
  );
}
