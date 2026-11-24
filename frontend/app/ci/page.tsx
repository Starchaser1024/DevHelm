"use client";

import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, GhostButton, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MetaRow, Panel, ReportBody, Section, TextList } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type WorkflowRun = {
  id: string;
  name: string;
  status: string;
  conclusion?: string | null;
  logs_text?: string | null;
  jobs?: Array<{ name?: string; conclusion?: string; steps?: Array<{ name?: string; conclusion?: string }> }>;
};

type CIDebug = {
  failure_summary: string;
  failure_type: string;
  plan: string[];
  executed_steps: string[];
  first_error?: string | null;
  root_cause: string;
  possible_causes: string[];
  fix_steps: string[];
  debug_steps: string[];
  related_files: string[];
  is_merge_blocking: boolean;
  blocking_reason: string;
  confidence: number;
};
type AnalyzeResponse = { analysis_id: string; result: CIDebug };

const CONCLUSION_TONES: Record<string, BadgeTone> = {
  success: "success",
  failure: "danger",
  cancelled: "neutral",
  skipped: "neutral"
};

const FAILURE_TYPE_LABELS: Record<string, string> = {
  test: "测试失败",
  build: "构建失败",
  lint: "Lint 问题",
  dependency: "依赖问题",
  permission: "权限问题",
  environment: "环境问题",
  unknown: "未知类型"
};

function DebugReport({ analysis }: { analysis: CIDebug }) {
  return (
    <ReportBody>
      <MetaRow note={`置信度 ${Math.round(analysis.confidence * 100)}%`}>
        <Badge tone="neutral">{FAILURE_TYPE_LABELS[analysis.failure_type] ?? analysis.failure_type}</Badge>
        <Badge tone={analysis.is_merge_blocking ? "danger" : "neutral"} size="sm">
          {analysis.is_merge_blocking ? "阻塞合入" : "不阻塞合入"}
        </Badge>
      </MetaRow>

      <p className="text-sm leading-6 text-ink-2">{analysis.failure_summary}</p>

      {analysis.first_error && (
        <Section title="首个报错">
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-panel px-4 py-3 font-mono text-xs leading-5 text-ink-2">{analysis.first_error}</pre>
        </Section>
      )}

      {(analysis.root_cause || analysis.blocking_reason) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {analysis.root_cause && <Panel label="根因判断">{analysis.root_cause}</Panel>}
          {analysis.blocking_reason && <Panel label="阻塞原因">{analysis.blocking_reason}</Panel>}
        </div>
      )}

      {analysis.possible_causes.length > 0 && (
        <Section title="可能原因">
          <TextList items={analysis.possible_causes} />
        </Section>
      )}

      {(analysis.fix_steps.length > 0 || analysis.debug_steps.length > 0) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {analysis.fix_steps.length > 0 && (
            <Section title="修复步骤">
              <TextList items={analysis.fix_steps} />
            </Section>
          )}
          {analysis.debug_steps.length > 0 && (
            <Section title="排查步骤">
              <TextList items={analysis.debug_steps} />
            </Section>
          )}
        </div>
      )}

      {analysis.related_files.length > 0 && (
        <Section title="相关文件">
          <div className="flex flex-col gap-2">
            {analysis.related_files.map((file, index) => (
              <div key={index} className="rounded-control border border-line bg-panel px-4 py-2.5 font-mono text-xs text-ink-2">{file}</div>
            ))}
          </div>
        </Section>
      )}
    </ReportBody>
  );
}

export default function CIPage() {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selected, setSelected] = useState<WorkflowRun | null>(null);
  const [analysis, setAnalysis] = useState<CIDebug | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((repos) => {
        if (!repos[0]) return;
        return apiGet<WorkflowRun[]>(`/api/repos/${repos[0].id}/workflow-runs`).then((items) => {
          setRuns(items);
          setSelected(items.find((item) => item.conclusion === "failure") ?? items[0] ?? null);
        });
      })
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  async function analyze() {
    if (!selected || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const data = await apiPost<AnalyzeResponse>(`/api/workflow-runs/${selected.id}/analyze`, {});
      setAnalysis(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败，请稍后重试。");
    } finally {
      setAnalyzing(false);
    }
  }

  const failedJobs = (selected?.jobs ?? []).filter((job) => job.conclusion === "failure");

  return (
    <>
      <PageTitle title="CI Debug 分析" description="聚合 GitHub Actions 运行状态和失败日志，生成失败归因、排查步骤和相关风险提示。" />
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,370px)_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">运行记录</h2>
            <Badge tone="neutral" size="sm">{`${runs.length} 次`}</Badge>
          </div>
          {loading ? (
            <Skeleton lines={5} className="mt-4" />
          ) : runs.length === 0 ? (
            <EmptyState
              title="暂无 Workflow 运行"
              description="当前仓库还没有同步到 CI 运行记录。"
              icon={<Terminal size={18} strokeWidth={1.75} />}
              className="mt-4"
            />
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {runs.map((run) => (
                <GhostButton
                  key={run.id}
                  active={selected?.id === run.id}
                  onClick={() => {
                    setSelected(run);
                    setAnalysis(null);
                    setError(null);
                  }}
                >
                  <span className="min-w-0 truncate">{run.name}</span>
                  <Badge
                    tone={run.conclusion ? CONCLUSION_TONES[run.conclusion] ?? "neutral" : "neutral"}
                    size="sm"
                    className="shrink-0"
                  >
                    {run.conclusion ?? run.status}
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
                <h2 className="text-base font-medium text-ink">{selected.name}</h2>
                <Badge
                  tone={selected.conclusion ? CONCLUSION_TONES[selected.conclusion] ?? "neutral" : "neutral"}
                  size="sm"
                  className="shrink-0"
                >
                  {selected.conclusion ?? selected.status}
                </Badge>
              </div>

              {failedJobs.length > 0 && (
                <div className="mt-4 rounded-control border border-line bg-panel px-4 py-3">
                  <div className="text-xs text-ink-2">失败 Job</div>
                  <div className="mt-2 flex flex-col gap-2">
                    {failedJobs.map((job) => (
                      <div key={job.name} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-ink">{job.name}</span>
                        {(job.steps ?? [])
                          .filter((step) => step.conclusion === "failure")
                          .map((step) => (
                            <Badge key={step.name} tone="warning" size="sm">{step.name}</Badge>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.logs_text && (
                <details className="mt-3 rounded-control border border-line bg-panel">
                  <summary className="cursor-pointer select-none px-4 py-2.5 text-xs text-ink-2">运行日志</summary>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap px-4 pb-3 font-mono text-xs leading-5 text-ink-2">{selected.logs_text}</pre>
                </details>
              )}

              <div className="mt-5">
                <PrimaryButton onClick={analyze} loading={analyzing}>分析失败原因</PrimaryButton>
              </div>

              {error && <p className="mt-4 text-sm text-danger">{error}</p>}
              {analyzing ? (
                <Skeleton lines={6} avatar className="mt-6" />
              ) : analysis ? (
                <DebugReport analysis={analysis} />
              ) : null}
            </>
          ) : loading ? (
            <Skeleton lines={6} avatar />
          ) : (
            <EmptyState
              title="选择一个 Workflow Run"
              description="从左侧列表选择一个运行记录，生成失败归因与排查建议。"
              icon={<Terminal size={18} strokeWidth={1.75} />}
            />
          )}
        </Card>
      </div>
    </>
  );
}
