"use client";

import { useEffect, useState } from "react";
import { GitPullRequest } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, GhostButton, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MetaRow, Panel, ReportBody, Section, TextList } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  state: string;
  files: { filename: string; additions: number; deletions: number }[];
};

type ReviewFinding = { severity: string; title: string; evidence: string; required_action: string; blocking: boolean };
type PRReview = {
  summary: string;
  plan: string[];
  executed_steps: string[];
  merge_recommendation: string;
  recommendation_reason: string;
  review_findings: ReviewFinding[];
  key_changes: string[];
  risk_points: string[];
  blocking_issues: string[];
  review_checklist: string[];
  test_suggestions: string[];
  files_need_attention: string[];
  review_comments: string[];
  confidence: number;
};
type AnalyzeResponse = { analysis_id: string; result: PRReview };

const RECOMMENDATION_TONES: Record<string, BadgeTone> = {
  建议合入: "success",
  修改后合入: "warning",
  暂缓: "neutral",
  拒绝: "danger"
};

const SEVERITY_TONES: Record<string, BadgeTone> = {
  P1: "danger",
  P2: "warning",
  P3: "neutral"
};

const STATE_TONES: Record<string, BadgeTone> = {
  open: "success",
  merged: "info",
  closed: "neutral"
};

function ReviewReport({ analysis }: { analysis: PRReview }) {
  return (
    <ReportBody>
      <MetaRow note={`置信度 ${Math.round(analysis.confidence * 100)}%`}>
        <Badge tone={RECOMMENDATION_TONES[analysis.merge_recommendation] ?? "neutral"}>
          {analysis.merge_recommendation}
        </Badge>
      </MetaRow>

      <p className="text-sm leading-6 text-ink-2">{analysis.summary}</p>

      <Panel label="推荐理由">{analysis.recommendation_reason}</Panel>

      {analysis.review_findings.length > 0 && (
        <Section title="审查发现">
          <div className="flex flex-col gap-2">
            {analysis.review_findings.map((finding, index) => (
              <div key={index} className="rounded-control border border-line bg-panel px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONES[finding.severity] ?? "neutral"} size="sm">{finding.severity}</Badge>
                  <span className="text-sm font-medium text-ink">{finding.title}</span>
                  {finding.blocking && <Badge tone="danger" size="sm">阻塞</Badge>}
                </div>
                <p className="mt-1.5 text-sm leading-6 text-ink-2">{finding.evidence}</p>
                {finding.required_action && (
                  <p className="mt-1 text-sm leading-6 text-ink-2">{`要求：${finding.required_action}`}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {analysis.blocking_issues.length > 0 && (
        <Section title="阻塞问题">
          <TextList items={analysis.blocking_issues} />
        </Section>
      )}

      {(analysis.key_changes.length > 0 || analysis.risk_points.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {analysis.key_changes.length > 0 && (
            <Section title="关键变更">
              <TextList items={analysis.key_changes} />
            </Section>
          )}
          {analysis.risk_points.length > 0 && (
            <Section title="风险点">
              <TextList items={analysis.risk_points} />
            </Section>
          )}
        </div>
      )}

      {(analysis.review_checklist.length > 0 || analysis.test_suggestions.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {analysis.review_checklist.length > 0 && (
            <Section title="审查清单">
              <TextList items={analysis.review_checklist} />
            </Section>
          )}
          {analysis.test_suggestions.length > 0 && (
            <Section title="测试建议">
              <TextList items={analysis.test_suggestions} />
            </Section>
          )}
        </div>
      )}

      {analysis.files_need_attention.length > 0 && (
        <Section title="需要注意的文件">
          <div className="flex flex-col gap-2">
            {analysis.files_need_attention.map((file, index) => (
              <div key={index} className="rounded-control border border-line bg-panel px-4 py-2.5 font-mono text-xs text-ink-2">{file}</div>
            ))}
          </div>
        </Section>
      )}

      {analysis.review_comments.length > 0 && (
        <Section title="审查评论">
          <div className="flex flex-col gap-2">
            {analysis.review_comments.map((comment, index) => (
              <Panel key={index}>{comment}</Panel>
            ))}
          </div>
        </Section>
      )}
    </ReportBody>
  );
}

export default function PullRequestsPage() {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [analysis, setAnalysis] = useState<PRReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((repos) => {
        if (!repos[0]) return;
        return apiGet<PullRequest[]>(`/api/repos/${repos[0].id}/pull-requests`).then((items) => {
          setPrs(items);
          setSelected(items[0] ?? null);
        });
      })
      .catch(() => setPrs([]))
      .finally(() => setLoading(false));
  }, []);

  async function analyze() {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const data = await apiPost<AnalyzeResponse>(`/api/pull-requests/${selected.id}/analyze`, {});
      setAnalysis(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <>
      <PageTitle title="PR Review 助手" description="读取 changed files 和 diff，生成 PR 摘要、风险点、Review Checklist 与测试建议。" />
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,370px)_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">PR 列表</h2>
            <Badge tone="neutral" size="sm">{`${prs.length} 个`}</Badge>
          </div>
          {loading ? (
            <Skeleton lines={5} className="mt-4" />
          ) : prs.length === 0 ? (
            <EmptyState
              title="暂无 Pull Request"
              description="当前仓库还没有同步到 PR。"
              icon={<GitPullRequest size={18} strokeWidth={1.75} />}
              className="mt-4"
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {prs.map((pr) => (
                <GhostButton
                  key={pr.id}
                  active={selected?.id === pr.id}
                  onClick={() => {
                    setSelected(pr);
                    setAnalysis(null);
                    setError(null);
                  }}
                >
                  <span className="min-w-0 truncate">#{pr.number} {pr.title}</span>
                  <Badge tone={STATE_TONES[pr.state] ?? "neutral"} size="sm" className="shrink-0">
                    {pr.state}
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
                <Badge tone={STATE_TONES[selected.state] ?? "neutral"} size="sm" className="shrink-0">
                  {selected.state}
                </Badge>
              </div>

              {selected.files.length > 0 && (
                <div className="mt-4 max-h-56 overflow-auto rounded-control border border-line bg-panel">
                  <div className="divide-y divide-line">
                    {selected.files.map((file) => (
                      <div key={file.filename} className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-xs text-ink-2">
                        <span className="min-w-0 truncate">{file.filename}</span>
                        <span className="shrink-0 whitespace-nowrap">
                          <span className="text-success">{`+${file.additions}`}</span>
                          {" "}
                          <span className="text-danger">{`-${file.deletions}`}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5">
                <PrimaryButton onClick={analyze} loading={analyzing}>生成 PR 分析</PrimaryButton>
              </div>

              {error && <p className="mt-4 text-sm text-danger">{error}</p>}
              {analyzing ? (
                <Skeleton lines={6} avatar className="mt-6" />
              ) : analysis ? (
                <ReviewReport analysis={analysis} />
              ) : null}
            </>
          ) : loading ? (
            <Skeleton lines={6} avatar />
          ) : (
            <EmptyState
              title="选择一个 Pull Request"
              description="从左侧列表选择一个 PR，生成 Review 报告与测试建议。"
              icon={<GitPullRequest size={18} strokeWidth={1.75} />}
            />
          )}
        </Card>
      </div>
    </>
  );
}
