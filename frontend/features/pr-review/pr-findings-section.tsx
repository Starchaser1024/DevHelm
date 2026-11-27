"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldCheck
} from "lucide-react";

import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { MetaRow, Panel, Section, TextList } from "@/components/ui/blocks";
import { PrimaryButton } from "@/components/ui/card";
import {
  RECOMMENDATION_TONES,
  SEVERITY_TONES,
  SOURCE_TONES,
  type ActionDraftCreated,
  type PRCitation,
  type PRReview,
  type ReviewFinding
} from "./types";

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
        <Button type="button" variant="ghost" size="sm" onClick={() => onMarkFalsePositive(finding)}>
          标记误报
        </Button>
      </div>
    </div>
  );
}

type PRFindingsSectionProps = {
  analysis: PRReview;
  selectedFindingIds: Record<string, boolean>;
  selectedGapIds: Record<string, boolean>;
  confirmedVerdict: string;
  reviewerNote: string;
  reviewerConfirmed: boolean;
  creatingDraft: boolean;
  createdDraft: ActionDraftCreated | null;
  onToggleFinding: (findingId: string, checked: boolean) => void;
  onToggleGap: (gapId: string, checked: boolean) => void;
  onMarkFalsePositive: (finding: ReviewFinding) => void;
  onChangeVerdict: (verdict: string) => void;
  onChangeReviewerNote: (note: string) => void;
  onChangeReviewerConfirmed: (confirmed: boolean) => void;
  onCreateCommentDraft: () => void;
};

export function PRFindingsSection({
  analysis,
  selectedFindingIds,
  selectedGapIds,
  confirmedVerdict,
  reviewerNote,
  reviewerConfirmed,
  creatingDraft,
  createdDraft,
  onToggleFinding,
  onToggleGap,
  onMarkFalsePositive,
  onChangeVerdict,
  onChangeReviewerNote,
  onChangeReviewerConfirmed,
  onCreateCommentDraft
}: PRFindingsSectionProps) {
  const blockingFindings =
    analysis.blocking_findings ?? (analysis.review_findings ?? []).filter((finding) => finding.blocking);
  const advisoryFindings =
    analysis.advisory_findings ?? (analysis.review_findings ?? []).filter((finding) => !finding.blocking);
  const evidenceGaps = analysis.evidence_gaps ?? [];

  return (
    <>
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

      <Section title="一、阻塞问题" note={`${blockingFindings.length} 项（修复前不可直接放行）`}>
        {blockingFindings.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {blockingFindings.map((finding) => (
              <FindingCard
                key={finding.finding_id}
                finding={finding}
                checked={Boolean(selectedFindingIds[finding.finding_id])}
                onToggle={(next) => onToggleFinding(finding.finding_id, next)}
                onMarkFalsePositive={onMarkFalsePositive}
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
                onToggle={(next) => onToggleFinding(finding.finding_id, next)}
                onMarkFalsePositive={onMarkFalsePositive}
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
                      onCheckedChange={(state) => onToggleGap(gap.gap_id, state === true)}
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
                      <p className="mt-1 text-xs leading-5 text-ink-2">{`待补证据：${gap.required_evidence}`}</p>
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
            onValueChange={onChangeVerdict}
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
            onChange={(e) => onChangeReviewerNote(e.target.value)}
            placeholder="补充放行前提、异常处理人或灰度要求"
          />
        </div>

        <div className="mt-4">
          <Checkbox
            checked={reviewerConfirmed}
            onCheckedChange={(state) => onChangeReviewerConfirmed(state === true)}
            label="我已核对勾选条目的证据锚点与合入结论，确认生成待审批评论草稿"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <PrimaryButton
            size="sm"
            disabled={!reviewerConfirmed}
            loading={creatingDraft}
            onClick={onCreateCommentDraft}
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
    </>
  );
}
