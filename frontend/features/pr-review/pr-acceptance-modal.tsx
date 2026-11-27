"use client";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Textarea } from "@/components/arc/textarea/textarea";
import { PrimaryButton } from "@/components/ui/card";
import { SAMPLE_VERIFIER_REPORT } from "./types";

type PRAcceptanceModalProps = {
  open: boolean;
  reportJsonText: string;
  importing: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onChangeReportJson: (text: string) => void;
  onImport: () => void;
};

export function PRAcceptanceModal({
  open,
  reportJsonText,
  importing,
  error,
  onOpenChange,
  onChangeReportJson,
  onImport
}: PRAcceptanceModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onClick={() => onChangeReportJson(SAMPLE_VERIFIER_REPORT)}
            >
              填入示例结构
            </Button>
          </div>
          <Textarea
            label="验收报告 JSON"
            rows={10}
            value={reportJsonText}
            onChange={(e) => onChangeReportJson(e.target.value)}
            placeholder='{"report_version": 1, "task": {...}, "rule_version": {...}, "run": {...}, "checks": [...]}'
            error={error ?? undefined}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <PrimaryButton
              size="sm"
              loading={importing}
              disabled={!reportJsonText.trim()}
              onClick={onImport}
            >
              导入并重新评估 PR
            </PrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
