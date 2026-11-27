"use client";

import { useState } from "react";

import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { PrimaryButton } from "@/components/ui/card";
import {
  FEEDBACK_LABELS,
  type PRFeedbackRecord,
  type PRFeedbackSubmitPayload
} from "./types";

type PRFeedbackBarProps = {
  feedbackHistory: PRFeedbackRecord[];
  submitting: boolean;
  feedbackMessage: string | null;
  onSubmitFeedback: (payload: PRFeedbackSubmitPayload) => Promise<boolean>;
};

export function PRFeedbackBar({
  feedbackHistory,
  submitting,
  feedbackMessage,
  onSubmitFeedback
}: PRFeedbackBarProps) {
  const [activeMode, setActiveMode] = useState<"false_positive" | "missed_issue" | null>(null);
  const [findingId, setFindingId] = useState("");
  const [missedIssueTitle, setMissedIssueTitle] = useState("");
  const [expectedLocator, setExpectedLocator] = useState("");
  const [note, setNote] = useState("");

  async function handleFormSubmit(mode: "false_positive" | "missed_issue") {
    const ok = await onSubmitFeedback({
      label: mode,
      finding_id: findingId.trim() || null,
      missed_issue_title: mode === "missed_issue" ? missedIssueTitle.trim() || null : null,
      expected_locator: expectedLocator.trim() || null,
      note: note.trim() || null
    });
    if (ok) {
      setActiveMode(null);
      setFindingId("");
      setMissedIssueTitle("");
      setExpectedLocator("");
      setNote("");
    }
  }

  return (
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
            loading={submitting && activeMode === null}
            onClick={() => void onSubmitFeedback({ label: "useful" })}
          >
            有用
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setActiveMode(activeMode === "false_positive" ? null : "false_positive")}
          >
            误报
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setActiveMode(activeMode === "missed_issue" ? null : "missed_issue")}
          >
            遗漏
          </Button>
        </div>
      </div>

      {activeMode && (
        <div className="mt-3 flex flex-col gap-3 rounded-control border border-line bg-surface p-3.5">
          {activeMode === "missed_issue" ? (
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
              value={findingId}
              onChange={(e) => setFindingId(e.target.value)}
              placeholder="例如：finding-1"
            />
          )}
          <Textarea
            label="期望判定说明"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              activeMode === "missed_issue"
                ? "说明该 PR 应当阻断合入的具体原因，供回归评测校验召回率"
                : "说明为何该提示不构成阻塞，供回归评测压降误报率"
            }
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveMode(null)}>
              取消
            </Button>
            <PrimaryButton
              size="sm"
              loading={submitting}
              disabled={activeMode === "missed_issue" && !missedIssueTitle.trim() && !note.trim()}
              onClick={() => void handleFormSubmit(activeMode)}
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
  );
}
