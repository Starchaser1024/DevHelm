"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, GitBranch, Workflow } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { Select } from "@/components/arc/select/select";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, GhostButton, PageTitle } from "@/components/ui/card";
import { MetaRow, Panel, Section } from "@/components/ui/blocks";
import { apiGet } from "@/lib/api";
import type { Repository } from "@/lib/types";

type WorkflowTask = {
  id: string;
  task_id: string;
  agent_name: string;
  task_type: string;
  status: string;
  summary: string;
  error?: string | null;
};

type WorkflowRun = {
  id: string;
  repo_id?: string | null;
  goal: string;
  status: string;
  spec: { workflow_id?: string; tasks?: Array<{ id: string; dependencies?: string[] }> };
  observation: { status?: string; confidence?: number; findings?: Array<{ severity?: string; message?: string }> };
  final_answer: string;
  metrics: Record<string, number | string>;
  created_at?: string | null;
  completed_at?: string | null;
  tasks: WorkflowTask[];
};

const STATUS_LABELS: Record<string, string> = {
  success: "运行成功",
  completed: "运行成功",
  failed: "运行失败",
  running: "运行中"
};

const STATUS_TONES: Record<string, BadgeTone> = {
  success: "success",
  completed: "success",
  failed: "danger",
  running: "info"
};

function taskIcon(status: string) {
  if (status === "success" || status === "completed") return <CheckCircle2 size={16} strokeWidth={1.75} className="text-success" />;
  if (status === "failed" || status === "error") return <AlertTriangle size={16} strokeWidth={1.75} className="text-danger" />;
  return <Clock3 size={16} strokeWidth={1.75} className="text-ink-2" />;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function WorkflowRunsPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    if (!repoId) return;
    setLoading(true);
    apiGet<WorkflowRun[]>(`/api/chat/workflow-runs?repo_id=${repoId}`)
      .then((items) => {
        setRuns(items);
        setSelectedId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
      })
      .finally(() => setLoading(false));
  }, [repoId]);

  const selected = useMemo(() => runs.find((item) => item.id === selectedId) ?? runs[0], [runs, selectedId]);
  const completedTasks = selected?.tasks.filter((task) => task.status === "success" || task.status === "completed").length ?? 0;
  const findings = selected?.observation.findings ?? [];

  return (
    <>
      <PageTitle title="工作流运行记录" description="按一次工程目标查看 Planner 任务图、各 Agent 执行结果、Observer 发现和最终综合结论。" />

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          <div className="max-w-sm">
            <Select label="仓库" placeholder="选择仓库" value={repoId} onValueChange={setRepoId} options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard label="工作流" value={runs.length} context="当前仓库的运行记录" />
            <MetricCard label="完成任务" value={completedTasks} context={`${selected?.tasks.length ?? 0} 个任务中的完成数`} />
            <MetricCard label="Observer 发现" value={findings.length} context="交叉检查发现的问题" />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(300px,340px)_minmax(0,1fr)]">
          <Card className="self-start">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-ink">运行列表</h2>
              <Badge tone="neutral" size="sm">{`${runs.length} 条`}</Badge>
            </div>
            {loading ? (
              <Skeleton lines={5} className="mt-4" />
            ) : runs.length === 0 ? (
              <EmptyState
                title="暂无工作流运行记录"
                description="从 Workspace 发起一次工程分析后，运行记录会出现在这里。"
                icon={<Workflow size={18} strokeWidth={1.75} />}
                className="mt-4"
              />
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                {runs.map((run) => (
                  <GhostButton key={run.id} active={selected?.id === run.id} onClick={() => setSelectedId(run.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium">{run.goal}</span>
                      <span className="mt-1.5 flex items-center justify-between gap-3 text-xs text-ink-2">
                        <span>{STATUS_LABELS[run.status] || run.status}</span>
                        <span>{formatTime(run.created_at)}</span>
                      </span>
                    </span>
                  </GhostButton>
                ))}
              </div>
            )}
          </Card>

          <Card>
            {selected ? (
              <>
                <MetaRow note={selected.created_at ? `创建于 ${formatTime(selected.created_at)}` : undefined}>
                  <Badge tone={STATUS_TONES[selected.status] ?? "neutral"}>{STATUS_LABELS[selected.status] || selected.status}</Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                    <GitBranch size={14} strokeWidth={1.75} />
                    {selected.spec?.workflow_id || selected.id.slice(0, 8)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                    <Database size={14} strokeWidth={1.75} />
                    已持久化
                  </span>
                </MetaRow>
                <h2 className="mt-3 text-base font-medium text-ink">{selected.goal}</h2>

                <div className="mt-6">
                  <Section title="Agent 执行链" note={`${completedTasks}/${selected.tasks.length} 完成`}>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {selected.tasks.map((task, index) => (
                        <div key={task.id} className="rounded-control border border-line bg-panel p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface text-xs font-medium text-ink-2">{index + 1}</span>
                            {taskIcon(task.status)}
                          </div>
                          <div className="mt-2.5 text-sm font-medium text-ink">{task.agent_name}</div>
                          <div className="mt-0.5 text-xs text-ink-2">{task.task_type}</div>
                          <p className="mt-2 text-xs leading-5 text-ink-2">{task.summary || "任务已完成"}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                </div>

                <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
                  <Panel label="Synthesis 最终结论">
                    <p className="leading-7">{selected.final_answer || "暂无最终结论。"}</p>
                  </Panel>
                  <Panel label="Observer 交叉检查">
                    {typeof selected.observation?.confidence === "number" && (
                      <p className="text-xs text-ink-2">{`置信度 ${Math.round(selected.observation.confidence * 100)}%`}</p>
                    )}
                    {findings.length > 0 ? (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        {findings.map((finding, index) => (
                          <p key={index}>{finding.message}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1.5">没有发现明显问题。</p>
                    )}
                  </Panel>
                </div>
              </>
            ) : loading ? (
              <Skeleton lines={6} avatar />
            ) : (
              <EmptyState
                title="选择一条运行记录"
                description="从左侧选择工作流运行，查看任务图、综合结论和交叉检查结果。"
                icon={<Workflow size={18} strokeWidth={1.75} />}
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
