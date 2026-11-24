"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/arc/alert/alert";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { MarkdownBlock, Panel } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type WeeklyReportResponse = {
  report_markdown: string;
};

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => {
    const date = new Date(today);
    date.setDate(date.getDate() - 6);
    return date;
  }, [today]);

  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [startDate, setStartDate] = useState(toDateInput(weekStart));
  const [endDate, setEndDate] = useState(toDateInput(today));
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  async function generateReport() {
    if (!repoId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost<WeeklyReportResponse>("/api/reports/weekly", {
        repo_id: repoId,
        start_date: startDate,
        end_date: endDate
      });
      setReport(data.report_markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="研发周报生成" description="按时间范围统计 Issues、PRs、Merged PRs、Open PRs 和失败 CI，生成适合发给团队负责人的 Markdown 周报。" />

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex flex-col gap-4">
            <Select
              label="仓库"
              placeholder="选择仓库"
              value={repoId}
              onValueChange={setRepoId}
              options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
            />
            <Input type="date" label="开始日期" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <Input type="date" label="结束日期" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <PrimaryButton loading={loading} disabled={!repoId} onClick={generateReport}>
              生成周报
            </PrimaryButton>
            {error && <Alert tone="danger" title="生成失败">{error}</Alert>}
          </div>
        </Card>

        <Card className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">Markdown 周报</h2>
            {report ? <CopyButton value={report} label="复制 Markdown" /> : null}
          </div>
          <div className="mt-4">
            {report ? (
              <MarkdownBlock content={report} />
            ) : (
              <Panel>选择仓库和时间范围后生成周报；结果会在这里以 Markdown 渲染，并可直接复制。</Panel>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
