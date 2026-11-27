"use client";

import { useMemo } from "react";
import { FileUp } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { PrimaryButton } from "@/components/ui/card";
import {
  STATE_TONES,
  type AcceptanceReportRecord,
  type AcceptanceSummary,
  type EvidenceSummary,
  type PullRequest
} from "./types";

type PREvidenceHeaderProps = {
  pr: PullRequest;
  analyzing: boolean;
  evidenceSummary: EvidenceSummary | null;
  acceptanceRecord: AcceptanceReportRecord | null;
  analysisAcceptanceSummary?: AcceptanceSummary | null;
  onOpenImportModal: () => void;
  onAnalyze: () => void;
};

export function PREvidenceHeader({
  pr,
  analyzing,
  evidenceSummary,
  acceptanceRecord,
  analysisAcceptanceSummary,
  onOpenImportModal,
  onAnalyze
}: PREvidenceHeaderProps) {
  const diffTotals = useMemo(
    () => ({
      files: pr.files.length,
      additions: pr.files.reduce((sum, item) => sum + (item.additions || 0), 0),
      deletions: pr.files.reduce((sum, item) => sum + (item.deletions || 0), 0)
    }),
    [pr.files]
  );

  const activeAcceptanceSummary =
    acceptanceRecord?.summary ?? analysisAcceptanceSummary ?? evidenceSummary?.acceptance_summary ?? null;

  const acceptanceBadge = useMemo((): { label: string; tone: BadgeTone } => {
    if (!activeAcceptanceSummary) {
      return { label: "未关联行为验收", tone: "neutral" };
    }
    const regressions =
      (activeAcceptanceSummary.counts?.regression ?? 0) + (activeAcceptanceSummary.counts?.not_met ?? 0);
    const unverifiable = activeAcceptanceSummary.counts?.unverifiable ?? 0;
    if (regressions > 0 || (acceptanceRecord?.blocking_check_ids.length ?? 0) > 0) {
      return {
        label: `行为验收阻断 (${regressions || acceptanceRecord?.blocking_check_ids.length})`,
        tone: "danger"
      };
    }
    if (
      activeAcceptanceSummary.rule_status !== "confirmed" ||
      unverifiable > 0 ||
      (acceptanceRecord?.evidence_gap_ids.length ?? 0) > 0
    ) {
      return {
        label: `行为验收待补证 (${activeAcceptanceSummary.rule_status})`,
        tone: "warning"
      };
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

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium text-ink">
              #{pr.number} {pr.title}
            </h2>
            <Badge tone={STATE_TONES[pr.state] ?? "neutral"} size="sm">
              {pr.state}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-2">
            {pr.author && <span>{`作者：${pr.author}`}</span>}
            {pr.head_branch && pr.base_branch && (
              <span className="font-mono">{`${pr.head_branch} -> ${pr.base_branch}`}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onOpenImportModal}>
            <FileUp size={14} strokeWidth={1.75} className="mr-1.5" />
            导入行为验收报告
          </Button>
          <PrimaryButton size="sm" onClick={onAnalyze} loading={analyzing}>
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

      {pr.files.length > 0 && (
        <div className="mt-4 max-h-44 overflow-auto rounded-control border border-line bg-panel">
          <div className="divide-y divide-line">
            {pr.files.map((file) => (
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
    </>
  );
}
