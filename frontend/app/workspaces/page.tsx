"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MarkdownBlock, Panel } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type Workspace = {
  id: string;
  name: string;
  description?: string | null;
  repo_ids: string[];
};

type MultiRepoReport = {
  report_markdown: string;
  metrics: Record<string, number>;
  repo_summaries: Array<Record<string, unknown>>;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function WorkspacesPage() {
  const today = useMemo(() => new Date(), []);
  const start = useMemo(() => {
    const value = new Date(today);
    value.setDate(value.getDate() - 6);
    return value;
  }, [today]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState("研发团队");
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [startDate, setStartDate] = useState(toDateInput(start));
  const [endDate, setEndDate] = useState(toDateInput(today));
  const [report, setReport] = useState<MultiRepoReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [repoItems, workspaceItems] = await Promise.all([apiGet<Repository[]>("/api/repos"), apiGet<Workspace[]>("/api/workspaces")]);
    setRepos(repoItems);
    setWorkspaces(workspaceItems);
    setSelectedRepos(repoItems.slice(0, 2).map((repo) => repo.id));
    setWorkspaceId(workspaceItems[0]?.id || "");
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createWorkspace() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost<Workspace>("/api/workspaces", { name, repo_ids: selectedRepos });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建 Workspace 失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<MultiRepoReport>("/api/workspaces/multi-repo-report", {
        workspace_id: workspaceId || undefined,
        repo_ids: workspaceId ? [] : selectedRepos,
        start_date: startDate,
        end_date: endDate
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="团队工作区" description="把多个仓库聚合成 workspace，生成跨仓库研发周报和风险概览。" />

      <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <Input label="Workspace 名称" value={name} onChange={(event) => setName(event.target.value)} />

          <div className="mt-5">
            <div className="text-sm text-ink-2">关联仓库</div>
            <div className="mt-2 divide-y divide-line rounded-control border border-line">
              {repos.map((repo) => (
                <div key={repo.id} className="px-4 py-2.5">
                  <Checkbox
                    label={repo.full_name}
                    checked={selectedRepos.includes(repo.id)}
                    onCheckedChange={(checked) => {
                      setSelectedRepos((current) => (checked === true ? [...current, repo.id] : current.filter((id) => id !== repo.id)));
                    }}
                  />
                </div>
              ))}
              {repos.length === 0 && <div className="px-4 py-3 text-sm text-ink-2">暂无可用仓库。</div>}
            </div>
          </div>

          <Button className="mt-4" variant="secondary" size="md" loading={loading} disabled={selectedRepos.length === 0} onClick={createWorkspace}>
            创建 Workspace
          </Button>

          <div className="mt-6 border-t border-line pt-5">
            <div className="flex flex-col gap-4">
              <Select
                label="报表范围"
                placeholder="使用上方勾选仓库"
                value={workspaceId}
                onValueChange={setWorkspaceId}
                options={[{ value: "", label: "使用上方勾选仓库" }, ...workspaces.map((item) => ({ value: item.id, label: item.name }))]}
              />
              <Input type="date" label="开始日期" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              <Input type="date" label="结束日期" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              <PrimaryButton loading={loading} disabled={!workspaceId && selectedRepos.length === 0} onClick={generateReport}>
                生成多仓库周报
              </PrimaryButton>
            </div>
          </div>

          {error && (
            <div className="mt-4">
              <Alert tone="danger" title="操作失败">{error}</Alert>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-sm font-medium text-ink">Workspace 列表</h2>
            <div className="mt-3 flex flex-col gap-2">
              {workspaces.map((item) => (
                <Panel key={item.id}>{`${item.name} · ${item.repo_ids.length} 个仓库`}</Panel>
              ))}
              {workspaces.length === 0 && <Panel>暂无 workspace。</Panel>}
            </div>
          </Card>

          <Card className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-ink">多仓库周报</h2>
              {report ? <CopyButton value={report.report_markdown} label="复制 Markdown" /> : null}
            </div>
            <div className="mt-4">
              {report ? (
                <MarkdownBlock content={report.report_markdown} />
              ) : (
                <Panel>创建 workspace 或勾选仓库后生成周报；结果会在这里以 Markdown 渲染。</Panel>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
