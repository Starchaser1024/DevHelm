import type { BadgeTone } from "@/components/arc/badge/badge";

export type PullRequest = {
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

export type PRCitation = {
  source_type: "diff" | "ci" | "issue" | "doc" | "acceptance_report";
  title: string;
  locator: string;
  snippet: string;
  version_ref?: string | null;
  stale: boolean;
};

export type ReviewFinding = {
  finding_id: string;
  severity: string;
  title: string;
  evidence: string;
  required_action: string;
  blocking: boolean;
  citations: PRCitation[];
};

export type EvidenceGap = {
  gap_id: string;
  category: string;
  title: string;
  description: string;
  required_evidence: string;
  locator?: string | null;
  citations: PRCitation[];
};

export type AcceptanceSummary = {
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

export type PRReview = {
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

export type EvidenceSummary = {
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

export type AnalyzeResponse = {
  analysis_id: string;
  result: PRReview;
  evidence_summary?: EvidenceSummary;
};

export type AcceptanceReportRecord = {
  pr_id: string;
  record_id: string;
  ingested_at: string;
  report_sha256: string;
  summary: AcceptanceSummary;
  blocking_check_ids: string[];
  evidence_gap_ids: string[];
  positive_check_ids: string[];
};

export type ActionDraftCreated = {
  id: string;
  title: string;
  risk_level: string;
  status: string;
};

export type PRFeedbackLabel = "useful" | "false_positive" | "missed_issue";

export type PRFeedbackRecord = {
  id: string;
  pr_id: string;
  pr_number: number;
  label: PRFeedbackLabel;
  finding_id?: string | null;
  missed_issue_title?: string | null;
  expected_locator?: string | null;
  note?: string | null;
  created_at: string;
};

export type PRFeedbackSubmitPayload = {
  label: PRFeedbackLabel;
  finding_id?: string | null;
  missed_issue_title?: string | null;
  expected_locator?: string | null;
  note?: string | null;
};

export const RECOMMENDATION_TONES: Record<string, BadgeTone> = {
  建议合入: "success",
  修改后合入: "warning",
  暂缓: "neutral",
  拒绝: "danger"
};

export const SEVERITY_TONES: Record<string, BadgeTone> = {
  P1: "danger",
  P2: "warning",
  P3: "neutral"
};

export const STATE_TONES: Record<string, BadgeTone> = {
  open: "success",
  merged: "info",
  closed: "neutral"
};

export const SOURCE_TONES: Record<string, BadgeTone> = {
  diff: "info",
  ci: "warning",
  issue: "neutral",
  doc: "neutral",
  acceptance_report: "success"
};

export const FEEDBACK_LABELS: Record<PRFeedbackLabel, { text: string; tone: BadgeTone }> = {
  useful: { text: "有用", tone: "success" },
  false_positive: { text: "误报", tone: "warning" },
  missed_issue: { text: "遗漏", tone: "danger" }
};

export const SAMPLE_VERIFIER_REPORT = JSON.stringify(
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
