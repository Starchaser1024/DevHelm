"use client";

import { GitPullRequest } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { ReportBody } from "@/components/ui/blocks";
import { Card, PageTitle } from "@/components/ui/card";
import { PRAcceptanceModal } from "@/features/pr-review/pr-acceptance-modal";
import { PREvidenceHeader } from "@/features/pr-review/pr-evidence-header";
import { PRFeedbackBar } from "@/features/pr-review/pr-feedback-bar";
import { PRFindingsSection } from "@/features/pr-review/pr-findings-section";
import { PRListSidebar } from "@/features/pr-review/pr-list-sidebar";
import { usePRReviewWorkbench } from "@/features/pr-review/use-pr-review-workbench";

export default function PullRequestsPage() {
  const wb = usePRReviewWorkbench();

  return (
    <>
      <PageTitle
        title="PR 合入就绪度工作流"
        description="围绕“这个 PR 现在能否安全合入”，聚合 Diff 行级锚点、CI 状态、项目文档新鲜度与行为对比验收证据，经人工确认后生成可审计评论草稿。"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(310px,360px)_minmax(0,1fr)]">
        <PRListSidebar
          repos={wb.repos}
          repoId={wb.repoId}
          prs={wb.prs}
          selectedId={wb.selected?.id ?? null}
          loading={wb.loading}
          onSelectRepo={(nextId) => void wb.selectRepo(nextId)}
          onSelectPr={(pr) => void wb.selectPr(pr)}
        />

        <Card>
          {wb.selected ? (
            <>
              <PREvidenceHeader
                pr={wb.selected}
                analyzing={wb.analyzing}
                evidenceSummary={wb.evidenceSummary}
                acceptanceRecord={wb.acceptanceRecord}
                analysisAcceptanceSummary={wb.analysis?.acceptance_summary}
                onOpenImportModal={() => {
                  wb.setImportError(null);
                  wb.setImportOpen(true);
                }}
                onAnalyze={() => void wb.analyze()}
              />

              {wb.error && (
                <div className="mt-4">
                  <Alert tone="danger" title="操作异常">
                    {wb.error}
                  </Alert>
                </div>
              )}

              {wb.analyzing ? (
                <Skeleton lines={7} avatar className="mt-6" />
              ) : wb.analysis ? (
                <ReportBody>
                  <PRFindingsSection
                    analysis={wb.analysis}
                    selectedFindingIds={wb.selectedFindingIds}
                    selectedGapIds={wb.selectedGapIds}
                    confirmedVerdict={wb.confirmedVerdict}
                    reviewerNote={wb.reviewerNote}
                    reviewerConfirmed={wb.reviewerConfirmed}
                    creatingDraft={wb.creatingDraft}
                    createdDraft={wb.createdDraft}
                    onToggleFinding={(id, next) => wb.setSelectedFindingIds((prev) => ({ ...prev, [id]: next }))}
                    onToggleGap={(id, next) => wb.setSelectedGapIds((prev) => ({ ...prev, [id]: next }))}
                    onMarkFalsePositive={(target) =>
                      void wb.submitFeedback({
                        label: "false_positive",
                        finding_id: target.finding_id,
                        note: `人工标记发现项 ${target.finding_id} 为误报`
                      })
                    }
                    onChangeVerdict={wb.setConfirmedVerdict}
                    onChangeReviewerNote={wb.setReviewerNote}
                    onChangeReviewerConfirmed={wb.setReviewerConfirmed}
                    onCreateCommentDraft={() => void wb.createCommentDraft()}
                  />

                  <PRFeedbackBar
                    feedbackHistory={wb.feedbackHistory}
                    submitting={wb.submittingFeedback}
                    feedbackMessage={wb.feedbackMessage}
                    onSubmitFeedback={wb.submitFeedback}
                  />
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
          ) : wb.loading ? (
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

      <PRAcceptanceModal
        open={wb.importOpen}
        reportJsonText={wb.reportJsonText}
        importing={wb.importingReport}
        error={wb.importError}
        onOpenChange={wb.setImportOpen}
        onChangeReportJson={wb.setReportJsonText}
        onImport={() => void wb.importAcceptanceReport()}
      />
    </>
  );
}
