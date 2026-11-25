"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  GitPullRequest,
  ShieldCheck
} from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Card, GhostButton, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MetaRow, Panel, ReportBody, Section, TextList } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type PullRequest = {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  author?: string | null;
  base_branch?: string | null;
  head_branch?: string | null;
  files: { filename: string; additions: number; deletions: number }[];
};

type PRCitation = {
  source_type: "diff" | "ci" | "issue" | "doc" | "acceptance_report";
  title: string;
  locator: string;
  snippet: string;
  version_ref?: string | null;
  stale: boolean;
};

type ReviewFinding = {
  finding_id: string;
  severity: string;
  title: string;
  evidence: string;
  required_action: string;
  blocking: boolean;
  citations: PRCitation[];
};

type EvidenceGap = {
  gap_id: string;
  category: string;
  title: string;
  description: string;
  required_evidence: string;
  locator?: string | null;
  citations: PRCitation[];
};

type AcceptanceSummary = {
  report_version: number;
  task_name: string;
  rule_version?: number | string | null;
  rule_status: string;
  run_id?: number | string | null;
  run_status: string;
  headline: string;
  counts: Record<string, number>;
  total_checks: number;
  executed_checks: number;
  positive_proofs: PRCitation[];
  ingested_at?: string | null;
};

type PRReview = {
  summary: string;
  plan: string[];
  executed_steps: string[];
  merge_recommendation: "建议合入" | "修改后合入" | "暂缓" | "拒绝";
  recommendation_reason: string;
  review_findings: ReviewFinding[];
  blocking_findings: ReviewFinding[];
  advisory_findings: ReviewFinding[];
  evidence_gaps: EvidenceGap[];
  citations: PRCitation[];
  acceptance_summary?: AcceptanceSummary | null;
  key_changes: string[];
  risk_points: string[];
  blocking_issues: string[];
  review_checklist: string[];
  test_suggestions: string[];
  files_need_attention: string[];
  review_comments: string[];
  confidence: number;
};

type EvidenceSummary = {
  diff_stats?: {
    files?: number;
    additions?: number;
    deletions?: number;
    sensitive_files?: string[];
  };
  ci_status?: {
    recent_runs: number;
    failed_runs: number;
    state: "passed" | "failed" | "missing" | string;
  };
  linked_issues?: number;
  linked_documents?: number;
  review_comments?: number;
  acceptance_summary?: AcceptanceSummary | null;
};

type AnalyzeResponse = {
  analysis_id: string;
  result: PRReview;
  evidence_summary?: EvidenceSummary;
};

type AcceptanceReportRecord = {
  pr_id: string;
  record_id: string;
  ingested_at: string;
  report_sha256: string;
  summary: AcceptanceSummary;
  blocking_check_ids: string[];
  evidence_gap_ids: string[];
  positive_check_ids: string[];
};

type ActionDraftCreated = {
  id: string;
  title: string;
  risk_level: string;
  status: string;
};

type PRFeedbackRecord = {
  id: string;
  pr_id: string;
  pr_number: number;
  label: "useful" | "false_positive" | "missed_issue";
  finding_id?: string | null;
  missed_issue_title?: string | null;
  expected_locator?: string | null;
  note?: string | null;
  created_at: string;
};

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

const SOURCE_TONES: Record<string, BadgeTone> = {
  diff: "info",
  ci: "warning",
  issue: "neutral",
  doc: "neutral",
  acceptance_report: "success"
};

const FEEDBACK_LABELS: Record<PRFeedbackRecord["label"], { text: string; tone: BadgeTone }> = {
  useful: { text: "有用", tone: "success" },
  false_positive: { text: "误报", tone: "warning" },
  missed_issue: { text: "遗漏", tone: "danger" }
};

const SAMPLE_VERIFIER_REPORT = JSON.stringify(
  {
    report_version: 1,
    generated_at: "2026-04-12T10:30:00+08:00",
    task: {
      id: 1,
      name: "订单接口权限与契约验收",
      requirement: "非归属用户读取订单详情应返回 403",
      baseline_url: "http://127.0.0.1:18001",
      candidate_url: "http://127.0.0.1:18002"
    },
    rule_version: {
      id: 1,
      version: 1,
      status: "confirmed",
      note: "已确认对比规则"
    },
    run: {
      id: 12,
      status: "completed",
      started_at: "2026-04-12T10:29:00+08:00",
      finished_at: "2026-04-12T10:29:03+08:00",
      error: null
    },
    summary: {
      headline: "关键接口行为对比完成",
      total_checks: 1,
      executed_checks: 1,
      counts: { satisfied: 1 }
    },
    checks: [
      {
        id: "read-other-order-denied",
        name: "非归属用户访问订单详情被拒绝",
        category: "existing_behavior",
        expectation: "HTTP 403",
        classification: {
          code: "satisfied",
          label: "已满足",
          reason: "基准与候选环境均返回 403"
        },
        diff_summary: "HTTP 403 一致"
      }
    ]
  },
  null,
  2
);

function CitationChipList({ citations }: { citations: PRCitation[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {citations.map((citation, idx) => {
          const key = `${citation.source_type}:${citation.locator}:${idx}`;
          const expanded = expandedKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setExpandedKey(expanded ? null : key)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 py-1 text-left text-xs text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              {expanded ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
              <Badge tone={SOURCE_TONES[citation.source_type] ?? "neutral"} size="sm">
                {citation.source_type}
              </Badge>
              <span className="truncate font-mono text-[11px] text-ink">{citation.locator}</span>
              {citation.stale && (
                <Badge tone="warning" size="sm">
                  已过期资料
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {citations.map((citation, idx) => {
        const key = `${citation.source_type}:${citation.locator}:${idx}`;
        if (expandedKey !== key) return null;
        return (
          <div key={`${key}-snippet`} className="rounded-control border border-line bg-surface px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-ink-2">
              <span className="font-medium text-ink">{citation.title}</span>
              {citation.version_ref && <span className="font-mono text-[11px]">{citation.version_ref}</span>}
            </div>
            <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-ink-2">
              {citation.snippet}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function FindingCard({
  finding,
  checked,
  onToggle,
  onMarkFalsePositive
}: {
  finding: ReviewFinding;
  checked: boolean;
  onToggle: (next: boolean) => void;
  onMarkFalsePositive: (finding: ReviewFinding) => void;
}) {
  return (
    <div className="rounded-control border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="pt-0.5">
            <Checkbox
              checked={checked}
              onCheckedChange={(state) => onToggle(state === true)}
              aria-label={`纳入评论草稿：${finding.title}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONES[finding.severity] ?? "neutral"} size="sm">
                {finding.severity}
              </Badge>
              {finding.blocking ? (
                <Badge tone="danger" size="sm">
                  阻塞问题
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm">
                  一般建议
                </Badge>
              )}
              <span className="text-sm font-medium text-ink">{finding.title}</span>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-ink-2">{finding.evidence}</p>
            {finding.required_action && (
              <p className="mt-1 text-xs leading-5 text-ink-2">{`要求动作：${finding.required_action}`}</p>
            )}
            <CitationChipList citations={finding.citations ?? []} />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onMarkFalsePositive(finding)}
        >
          标记误报
        </Button>
      </div>
    </div>
  );
}

export default function PullRequestsPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [selected, setSelected] = useState<PullRequest | null>(null);

  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PRReview | null>(null);
  const [evidenceSummary, setEvidenceSummary] = useState<EvidenceSummary | null>(null);
  const [acceptanceRecord, setAcceptanceRecord] = useState<AcceptanceReportRecord | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<PRFeedbackRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acceptance report dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [reportJsonText, setReportJsonText] = useState("");
  const [importingReport, setImportingReport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Reviewer confirmation & ActionDraft state
  const [selectedFindingIds, setSelectedFindingIds] = useState<Record<string, boolean>>({});
  const [selectedGapIds, setSelectedGapIds] = useState<Record<string, boolean>>({});
  const [confirmedVerdict, setConfirmedVerdict] = useState<string>("暂缓");
  const [reviewerNote, setReviewerNote] = useState("");
  const [reviewerConfirmed, setReviewerConfirmed] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [createdDraft, setCreatedDraft] = useState<ActionDraftCreated | null>(null);

  // Inline feedback controls state
  const [activeFeedbackMode, setActiveFeedbackMode] = useState<"false_positive" | "missed_issue" | null>(null);
  const [feedbackFindingId, setFeedbackFindingId] = useState<string>("");
  const [missedIssueTitle, setMissedIssueTitle] = useState("");
  const [expectedLocator, setExpectedLocator] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const applyAnalysisState = useCallback((data: AnalyzeResponse | null) => {
    if (!data) {
      setAnalysisId(null);
      setAnalysis(null);
      setEvidenceSummary(null);
      setSelectedFindingIds({});
      setSelectedGapIds({});
      setReviewerConfirmed(false);
      setCreatedDraft(null);
      return;
    }
    setAnalysisId(String(data.analysis_id));
    setAnalysis(data.result);
    setEvidenceSummary(data.evidence_summary ?? null);
    setConfirmedVerdict(data.result.merge_recommendation);
    const nextFindings: Record<string, boolean> = {};
    for (const item of data.result.review_findings ?? []) {
      if (item.finding_id) nextFindings[item.finding_id] = true;
    }
    const nextGaps: Record<string, boolean> = {};
    for (const gap of data.result.evidence_gaps ?? []) {
      if (gap.gap_id) nextGaps[gap.gap_id] = true;
    }
    setSelectedFindingIds(nextFindings);
    setSelectedGapIds(nextGaps);
    setReviewerConfirmed(false);
    setCreatedDraft(null);
  }, []);

  const loadPrAuxiliaryData = useCallback(
    async (prId: string) => {
      const [latestAnalysis, latestAcceptance, feedbacks] = await Promise.all([
        apiGet<AnalyzeResponse>(`/api/pull-requests/${prId}/latest-analysis`).catch(() => null),
        apiGet<AcceptanceReportRecord>(`/api/pull-requests/${prId}/acceptance-report`).catch(() => null),
        apiGet<PRFeedbackRecord[]>(`/api/pull-requests/${prId}/feedback`).catch(() => [])
      ]);
      applyAnalysisState(latestAnalysis);
      setAcceptanceRecord(latestAcceptance);
      setFeedbackHistory(feedbacks);
      setFeedbackMessage(null);
      setActiveFeedbackMode(null);
    },
    [applyAnalysisState]
  );

  const loadRepoPullRequests = useCallback(
    async (targetRepoId: string) => {
      if (!targetRepoId) {
        setPrs([]);
        setSelected(null);
        return;
      }
      setLoading(true);
      try {
        const items = await apiGet<PullRequest[]>(`/api/repos/${targetRepoId}/pull-requests`);
        setPrs(items);
        const first = items[0] ?? null;
        setSelected(first);
        if (first) {
          await loadPrAuxiliaryData(first.id);
        } else {
          applyAnalysisState(null);
          setAcceptanceRecord(null);
          setFeedbackHistory([]);
        }
      } catch {
        setPrs([]);
        setSelected(null);
      } finally {
        setLoading(false);
      }
    },
    [applyAnalysisState, loadPrAuxiliaryData]
  );

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((repoList) => {
        setRepos(repoList);
        const initialRepo = repoList[0]?.id ?? "";
        setRepoId(initialRepo);
        return loadRepoPullRequests(initialRepo);
      })
      .catch(() => {
        setRepos([]);
        setLoading(false);
      });
  }, [loadRepoPullRequests]);

  async function analyze() {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const data = await apiPost<AnalyzeResponse>(`/api/pull-requests/${selected.id}/analyze`, {});
      applyAnalysisState(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleImportAcceptanceReport() {
    if (!selected || !reportJsonText.trim() || importingReport) return;
    setImportingReport(true);
    setImportError(null);
    try {
      const parsed = JSON.parse(reportJsonText);
      const saved = await apiPost<AcceptanceReportRecord>(
        `/api/pull-requests/${selected.id}/acceptance-report`,
        parsed
      );
      setAcceptanceRecord(saved);
      setImportOpen(false);
      setReportJsonText("");
      // Automatically re-run PR merge-readiness analysis so acceptance findings take effect immediately
      const refreshed = await apiPost<AnalyzeResponse>(`/api/pull-requests/${selected.id}/analyze`, {});
      applyAnalysisState(refreshed);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setImportError("JSON 格式解析失败，请粘贴完整的 report_version=1 JSON 报告。");
      } else {
        setImportError(err instanceof Error ? err.message : "导入行为验收报告失败。");
      }
    } finally {
      setImportingReport(false);
    }
  }

  async function handleCreateCommentDraft() {
    if (!selected || !analysis || !reviewerConfirmed || creatingDraft) return;
    setCreatingDraft(true);
    setError(null);
    try {
      const confirmedFindingIds = Object.entries(selectedFindingIds)
        .filter(([, checked]) => checked)
        .map(([id]) => id);
      const confirmedGapIds = Object.entries(selectedGapIds)
        .filter(([, checked]) => checked)
        .map(([id]) => id);

      const draft = await apiPost<ActionDraftCreated>(`/api/pull-requests/${selected.id}/comment-draft`, {
        analysis_id: analysisId,
        reviewer_confirmed: true,
        confirmed_merge_recommendation: confirmedVerdict,
        confirmed_finding_ids: confirmedFindingIds,
        confirmed_gap_ids: confirmedGapIds,
        reviewer_note: reviewerNote.trim() || null
      });
      setCreatedDraft(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建评论草稿失败。");
    } finally {
      setCreatingDraft(false);
    }
  }

  async function submitFeedback(
    label: "useful" | "false_positive" | "missed_issue",
    overrideFindingId?: string
  ) {
    if (!selected || submittingFeedback) return;
    setSubmittingFeedback(true);
    setError(null);
    setFeedbackMessage(null);
    try {
      const created = await apiPost<PRFeedbackRecord>(`/api/pull-requests/${selected.id}/feedback`, {
        label,
        analysis_id: analysisId,
        finding_id: overrideFindingId || feedbackFindingId.trim() || null,
        missed_issue_title: label === "missed_issue" ? missedIssueTitle.trim() || null : null,
        expected_locator: expectedLocator.trim() || null,
        note: feedbackNote.trim() || (overrideFindingId ? `人工标记发现项 ${overrideFindingId} 为误报` : null)
      });
      setFeedbackHistory((prev) => [created, ...prev]);
      setActiveFeedbackMode(null);
      setFeedbackFindingId("");
      setMissedIssueTitle("");
      setExpectedLocator("");
      setFeedbackNote("");
      setFeedbackMessage(`已记录「${FEEDBACK_LABELS[label].text}」反馈，自动纳入离线 PR 合入回归评测集。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交反馈失败。");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  const diffTotals = useMemo(() => {
    if (!selected) return { files: 0, additions: 0, deletions: 0 };
    return {
      files: selected.files.length,
      additions: selected.files.reduce((sum, item) => sum + (item.additions || 0), 0),
      deletions: selected.files.reduce((sum, item) => sum + (item.deletions || 0), 0)
    };
  }, [selected]);

  const activeAcceptanceSummary = acceptanceRecord?.summary ?? analysis?.acceptance_summary ?? evidenceSummary?.acceptance_summary ?? null;

  const acceptanceBadge = useMemo((): { label: string; tone: BadgeTone } => {
    if (!activeAcceptanceSummary) {
      return { label: "未关联行为验收", tone: "neutral" };
    }
    const regressions = (activeAcceptanceSummary.counts?.regression ?? 0) + (activeAcceptanceSummary.counts?.not_met ?? 0);
    const unverifiable = activeAcceptanceSummary.counts?.unverifiable ?? 0;
    if (regressions > 0 || (acceptanceRecord?.blocking_check_ids.length ?? 0) > 0) {
      return { label: `行为验收阻断 (${regressions || acceptanceRecord?.blocking_check_ids.length})`, tone: "danger" };
    }
    if (activeAcceptanceSummary.rule_status !== "confirmed" || unverifiable > 0 || (acceptanceRecord?.evidence_gap_ids.length ?? 0) > 0) {
      return { label: `行为验收待补证 (${activeAcceptanceSummary.rule_status})`, tone: "warning" };
    }
    return { label: `行为验收通过 (${activeAcceptanceSummary.executed_checks})`, tone: "success" };
  }, [acceptanceRecord, activeAcceptanceSummary]);

  const ciBadge = useMemo((): { label: string; tone: BadgeTone } => {
    const ci = evidenceSummary?.ci_status;
    if (!ci) return { label: "CI 待核验", tone: "neutral" };
    if (ci.state === "failed" || ci.failed_runs > 0) {
      return { label: `CI 失败 (${ci.failed_runs})`, tone: "danger" };
    }
    if (ci.state === "passed") {
      return { label: `CI 通过 (${ci.recent_runs})`, tone: "success" };
    }
    return { label: "缺少 CI 记录", tone: "warning" };
  }, [evidenceSummary]);

  const blockingFindings = analysis?.blocking_findings ?? (analysis?.review_findings ?? []).filter((f) => f.blocking);
  const advisoryFindings = analysis?.advisory_findings ?? (analysis?.review_findings ?? []).filter((f) => !f.blocking);
  const evidenceGaps = analysis?.evidence_gaps ?? [];

  return (
    <>
      <PageTitle
        title="PR 合入就绪度工作流"
        description="围绕“这个 PR 现在能否安全合入”，聚合 Diff 行级锚点、CI 状态、项目文档新鲜度与行为对比验收证据，经人工确认后生成可审计评论草稿。"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(310px,360px)_minmax(0,1fr)]">
        <Card className="self-start">
          {repos.length > 1 && (
            <div className="mb-4">
              <Select
                label="仓库"
                placeholder="选择仓库"
                value={repoId}
                onValueChange={(nextRepoId) => {
                  setRepoId(nextRepoId);
                  void loadRepoPullRequests(nextRepoId);
                }}
                options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
              />
            </div>
          )}

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
                    setError(null);
                    void loadPrAuxiliaryData(pr.id);
                  }}
                >
                  <span className="min-w-0 truncate">
                    #{pr.number} {pr.title}
                  </span>
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
              {/* 1. Evidence Aggregation Header */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-medium text-ink">
                      #{selected.number} {selected.title}
                    </h2>
                    <Badge tone={STATE_TONES[selected.state] ?? "neutral"} size="sm">
                      {selected.state}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    {selected.author && <span>{`作者：${selected.author}`}</span>}
                    {selected.head_branch && selected.base_branch && (
                      <span className="font-mono">{`${selected.head_branch} -> ${selected.base_branch}`}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setImportError(null);
                      setImportOpen(true);
                    }}
                  >
                    <FileUp size={14} strokeWidth={1.75} className="mr-1.5" />
                    导入行为验收报告
                  </Button>
                  <PrimaryButton size="sm" onClick={analyze} loading={analyzing}>
                    运行合入就绪度审查
                  </PrimaryButton>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-control border border-line bg-panel px-3.5 py-2.5 text-xs">
                <Badge tone="info" size="sm">
                  {`Diff ${diffTotals.files} 文件 (+${diffTotals.additions} / -${diffTotals.deletions})`}
                </Badge>
                <Badge tone={ciBadge.tone} size="sm">
                  {ciBadge.label}
                </Badge>
                <Badge tone="neutral" size="sm">
                  {`关联 Issue ${evidenceSummary?.linked_issues ?? 0} · 文档 ${evidenceSummary?.linked_documents ?? 0}`}
                </Badge>
                <Badge tone={acceptanceBadge.tone} size="sm">
                  {acceptanceBadge.label}
                </Badge>
                {activeAcceptanceSummary?.task_name && (
                  <span className="ml-auto truncate text-ink-2">
                    {`验收任务：${activeAcceptanceSummary.task_name}（规则 v${activeAcceptanceSummary.rule_version ?? 1}）`}
                  </span>
                )}
              </div>

              {selected.files.length > 0 && (
                <div className="mt-4 max-h-44 overflow-auto rounded-control border border-line bg-panel">
                  <div className="divide-y divide-line">
                    {selected.files.map((file) => (
                      <div
                        key={file.filename}
                        className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-xs text-ink-2"
                      >
                        <span className="min-w-0 truncate">{file.filename}</span>
                        <span className="shrink-0 whitespace-nowrap">
                          <span className="text-success">{`+${file.additions}`}</span>{" "}
                          <span className="text-danger">{`-${file.deletions}`}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4">
                  <Alert tone="danger" title="操作异常">
                    {error}
                  </Alert>
                </div>
              )}

              {analyzing ? (
                <Skeleton lines={7} avatar className="mt-6" />
              ) : analysis ? (
                <ReportBody>
                  {/* Verdict Summary */}
                  <MetaRow note={`证据置信度 ${Math.round(analysis.confidence * 100)}% · 引用锚点 ${(analysis.citations ?? []).length} 处`}>
                    <Badge tone={RECOMMENDATION_TONES[analysis.merge_recommendation] ?? "neutral"}>
                      {analysis.merge_recommendation}
                    </Badge>
                    <Badge tone={blockingFindings.length > 0 ? "danger" : "success"} size="sm">
                      {`阻塞问题 ${blockingFindings.length}`}
                    </Badge>
                    <Badge tone="neutral" size="sm">
                      {`一般建议 ${advisoryFindings.length}`}
                    </Badge>
                    <Badge tone={evidenceGaps.length > 0 ? "warning" : "neutral"} size="sm">
                      {`证据不足 ${evidenceGaps.length}`}
                    </Badge>
                  </MetaRow>

                  <p className="text-sm leading-6 text-ink-2">{analysis.summary}</p>
                  <Panel label="合入判定依据">{analysis.recommendation_reason}</Panel>

                  {/* 2. Three-Bucket Verdict View */}
                  <Section title="一、阻塞问题" note={`${blockingFindings.length} 项（修复前不可直接放行）`}>
                    {blockingFindings.length > 0 ? (
                      <div className="flex flex-col gap-2.5">
                        {blockingFindings.map((finding) => (
                          <FindingCard
                            key={finding.finding_id}
                            finding={finding}
                            checked={Boolean(selectedFindingIds[finding.finding_id])}
                            onToggle={(next) =>
                              setSelectedFindingIds((prev) => ({ ...prev, [finding.finding_id]: next }))
                            }
                            onMarkFalsePositive={(target) => {
                              setFeedbackFindingId(target.finding_id);
                              void submitFeedback("false_positive", target.finding_id);
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <Panel>当前未检出阻断合入的 P1/P2 问题。</Panel>
                    )}
                  </Section>

                  <Section title="二、一般建议" note={`${advisoryFindings.length} 项（非阻断改进与已验证说明）`}>
                    {advisoryFindings.length > 0 ? (
                      <div className="flex flex-col gap-2.5">
                        {advisoryFindings.map((finding) => (
                          <FindingCard
                            key={finding.finding_id}
                            finding={finding}
                            checked={Boolean(selectedFindingIds[finding.finding_id])}
                            onToggle={(next) =>
                              setSelectedFindingIds((prev) => ({ ...prev, [finding.finding_id]: next }))
                            }
                            onMarkFalsePositive={(target) => {
                              setFeedbackFindingId(target.finding_id);
                              void submitFeedback("false_positive", target.finding_id);
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <Panel>无额外一般建议。</Panel>
                    )}
                  </Section>

                  <Section title="三、证据不足项" note={`${evidenceGaps.length} 项（存在缺口时自动降级为暂缓）`}>
                    {evidenceGaps.length > 0 ? (
                      <div className="flex flex-col gap-2.5">
                        {evidenceGaps.map((gap) => (
                          <div key={gap.gap_id} className="rounded-control border border-line bg-panel px-4 py-3">
                            <div className="flex items-start gap-2.5">
                              <div className="pt-0.5">
                                <Checkbox
                                  checked={Boolean(selectedGapIds[gap.gap_id])}
                                  onCheckedChange={(state) =>
                                    setSelectedGapIds((prev) => ({ ...prev, [gap.gap_id]: state === true }))
                                  }
                                  aria-label={`纳入评论草稿：${gap.title}`}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <AlertTriangle size={14} className="text-warning" />
                                  <Badge tone="warning" size="sm">
                                    {gap.category}
                                  </Badge>
                                  <span className="text-sm font-medium text-ink">{gap.title}</span>
                                </div>
                                <p className="mt-1.5 text-sm leading-6 text-ink-2">{gap.description}</p>
                                {gap.required_evidence && (
                                  <p className="mt-1 text-xs leading-5 text-ink-2">
                                    {`待补证据：${gap.required_evidence}`}
                                  </p>
                                )}
                                <CitationChipList citations={gap.citations ?? []} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Panel>当前 Diff、CI、关联文档与验收上下文齐备，未发现证据缺口。</Panel>
                    )}
                  </Section>

                  {(analysis.review_checklist.length > 0 || analysis.test_suggestions.length > 0) && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      {analysis.review_checklist.length > 0 && (
                        <Section title="合入前检查清单">
                          <TextList items={analysis.review_checklist} />
                        </Section>
                      )}
                      {analysis.test_suggestions.length > 0 && (
                        <Section title="测试与验证建议">
                          <TextList items={analysis.test_suggestions} />
                        </Section>
                      )}
                    </div>
                  )}

                  {/* 3. Reviewer Confirmation -> ActionDraft */}
                  <div className="rounded-panel border border-line bg-panel p-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={17} strokeWidth={1.75} className="text-ink" />
                      <h3 className="text-sm font-medium text-ink">人工确认并生成 PR 评论草稿</h3>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-ink-2">
                      仅勾选上方已核实的审查发现与证据缺口；系统不会直接写回 GitHub，而是生成带风险分级的待确认安全草稿。
                    </p>

                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Select
                        label="确认后的合入结论"
                        value={confirmedVerdict}
                        onValueChange={setConfirmedVerdict}
                        options={[
                          { value: "建议合入", label: "建议合入" },
                          { value: "修改后合入", label: "修改后合入" },
                          { value: "暂缓", label: "暂缓" },
                          { value: "拒绝", label: "拒绝" }
                        ]}
                      />
                      <Input
                        label="人工复核备注（可选）"
                        value={reviewerNote}
                        onChange={(e) => setReviewerNote(e.target.value)}
                        placeholder="补充放行前提、异常处理人或灰度要求"
                      />
                    </div>

                    <div className="mt-4">
                      <Checkbox
                        checked={reviewerConfirmed}
                        onCheckedChange={(state) => setReviewerConfirmed(state === true)}
                        label="我已核对勾选条目的证据锚点与合入结论，确认生成待审批评论草稿"
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <PrimaryButton
                        size="sm"
                        disabled={!reviewerConfirmed}
                        loading={creatingDraft}
                        onClick={handleCreateCommentDraft}
                      >
                        确认结论并生成评论草稿
                      </PrimaryButton>
                      {createdDraft && (
                        <Link
                          href="/action-drafts"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink underline underline-offset-4"
                        >
                          <CheckCircle2 size={14} className="text-success" />
                          {`草稿已创建（风险等级：${createdDraft.risk_level}），前往安全草稿箱审批执行`}
                          <ExternalLink size={13} />
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* 4. Inline Feedback Controls */}
                  <div className="rounded-panel border border-line bg-panel p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium text-ink">审查反馈与回归评测沉淀</h3>
                        <p className="mt-0.5 text-xs text-ink-2">
                          标记本次 PR 审查是否有用、误报或遗漏关键风险；反馈样本将自动编译进离线 PR 合入就绪度回归集。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={submittingFeedback && activeFeedbackMode === null}
                          onClick={() => void submitFeedback("useful")}
                        >
                          有用
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setActiveFeedbackMode(activeFeedbackMode === "false_positive" ? null : "false_positive")
                          }
                        >
                          误报
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setActiveFeedbackMode(activeFeedbackMode === "missed_issue" ? null : "missed_issue")
                          }
                        >
                          遗漏
                        </Button>
                      </div>
                    </div>

                    {activeFeedbackMode && (
                      <div className="mt-3 flex flex-col gap-3 rounded-control border border-line bg-surface p-3.5">
                        {activeFeedbackMode === "missed_issue" ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input
                              label="遗漏的关键风险标题"
                              value={missedIssueTitle}
                              onChange={(e) => setMissedIssueTitle(e.target.value)}
                              placeholder="例如：导出路由缺少权限校验"
                            />
                            <Input
                              label="期望命中的证据锚点（可选）"
                              value={expectedLocator}
                              onChange={(e) => setExpectedLocator(e.target.value)}
                              placeholder="例如：backend/app/api/routes/export.py#L18-L24"
                            />
                          </div>
                        ) : (
                          <Input
                            label="误报发现项 ID（可选）"
                            value={feedbackFindingId}
                            onChange={(e) => setFeedbackFindingId(e.target.value)}
                            placeholder="例如：finding-1"
                          />
                        )}
                        <Textarea
                          label="期望判定说明"
                          rows={2}
                          value={feedbackNote}
                          onChange={(e) => setFeedbackNote(e.target.value)}
                          placeholder={
                            activeFeedbackMode === "missed_issue"
                              ? "说明该 PR 应当阻断合入的具体原因，供回归评测校验召回率"
                              : "说明为何该提示不构成阻塞，供回归评测压降误报率"
                          }
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveFeedbackMode(null)}
                          >
                            取消
                          </Button>
                          <PrimaryButton
                            size="sm"
                            loading={submittingFeedback}
                            disabled={
                              activeFeedbackMode === "missed_issue" &&
                              !missedIssueTitle.trim() &&
                              !feedbackNote.trim()
                            }
                            onClick={() => void submitFeedback(activeFeedbackMode)}
                          >
                            保存回归反馈
                          </PrimaryButton>
                        </div>
                      </div>
                    )}

                    {feedbackMessage && <p className="mt-2.5 text-xs text-success">{feedbackMessage}</p>}

                    {feedbackHistory.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-xs text-ink-2">
                        <span>已存反馈：</span>
                        {feedbackHistory.slice(0, 6).map((fb) => (
                          <Badge key={fb.id} tone={FEEDBACK_LABELS[fb.label].tone} size="sm">
                            {`${FEEDBACK_LABELS[fb.label].text}${fb.missed_issue_title ? `：${fb.missed_issue_title}` : ""}`}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </ReportBody>
              ) : (
                <EmptyState
                  title="尚未运行合入就绪度审查"
                  description="点击右上角「运行合入就绪度审查」，或先导入 change-verifier 行为对比报告再执行综合核验。"
                  icon={<GitPullRequest size={18} strokeWidth={1.75} />}
                  className="mt-6"
                />
              )}
            </>
          ) : loading ? (
            <Skeleton lines={6} avatar />
          ) : (
            <EmptyState
              title="选择一个 Pull Request"
              description="从左侧列表选择一个 PR，查看合入证据聚合、分级发现与安全评论草稿。"
              icon={<GitPullRequest size={18} strokeWidth={1.75} />}
            />
          )}
        </Card>
      </div>

      {/* Acceptance Report Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent
          title="导入 change-verifier 行为验收报告"
          description="粘贴 report_version=1 的 JSON 对比报告。回归与未达标项将自动转为 P1 阻塞问题，草稿规则与无法判断项将记入证据缺口。"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-2">支持脱敏后的基准/候选 HTTP 行为对比 JSON</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReportJsonText(SAMPLE_VERIFIER_REPORT)}
              >
                填入示例结构
              </Button>
            </div>
            <Textarea
              label="验收报告 JSON"
              rows={10}
              value={reportJsonText}
              onChange={(e) => setReportJsonText(e.target.value)}
              placeholder='{"report_version": 1, "task": {...}, "rule_version": {...}, "run": {...}, "checks": [...]}'
              error={importError ?? undefined}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setImportOpen(false)}>
                取消
              </Button>
              <PrimaryButton
                size="sm"
                loading={importingReport}
                disabled={!reportJsonText.trim()}
                onClick={handleImportAcceptanceReport}
              >
                导入并重新评估 PR
              </PrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
