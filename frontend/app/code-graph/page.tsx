"use client";

import { useEffect, useState } from "react";
import { GitBranch, Search } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { Panel, Section } from "@/components/ui/blocks";
import { apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  head_branch?: string | null;
};

type CodeGraph = {
  query: string;
  symbols: Array<{ id: string; path: string; name: string; kind: string; start_line?: number | null; pr_number?: number | null }>;
  relations: Array<{ id: string; source_name?: string | null; target_name: string; relation_type: string; path?: string | null; pr_number?: number | null }>;
  documents: Array<{ id: string; title: string; path?: string; snippet: string; pr_number?: number | null }>;
};

type PrSnapshot = {
  status: string;
  message?: string | null;
  snapshot_name?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  pr_id?: string | null;
  pr_number?: number | null;
  indexed_symbols?: number | null;
};

function snapshotTone(status: string): BadgeTone {
  if (status === "ready") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

export default function CodeGraphPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [prId, setPrId] = useState("");
  const [query, setQuery] = useState("");
  const [graph, setGraph] = useState<CodeGraph | null>(null);
  const [snapshot, setSnapshot] = useState<PrSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadPrs(id: string) {
    if (!id) return;
    const items = await apiGet<PullRequest[]>(`/api/repos/${id}/pull-requests`).catch(() => []);
    setPrs(items);
    setPrId(items[0]?.id || "");
    setSnapshot(null);
  }

  useEffect(() => {
    apiGet<Repository[]>("/api/repos")
      .then((items) => {
        setRepos(items);
        setRepoId(items[0]?.id || "");
        return loadPrs(items[0]?.id || "");
      })
      .catch(() => setRepos([]));
  }, []);

  async function searchGraph(snapshotPrId?: string) {
    if (!repoId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query });
      const activeSnapshotPrId = snapshotPrId ?? (snapshot?.status === "ready" ? prId : "");
      if (activeSnapshotPrId) params.set("pr_id", activeSnapshotPrId);
      setGraph(await apiGet<CodeGraph>(`/api/repos/${repoId}/code-graph/search?${params.toString()}`));
    } finally {
      setLoading(false);
    }
  }

  async function prepareSnapshot() {
    if (!prId) return;
    setLoading(true);
    try {
      const nextSnapshot = await apiPost<PrSnapshot>(`/api/pull-requests/${prId}/snapshot`, {});
      setSnapshot(nextSnapshot);
      await searchGraph(nextSnapshot.status === "ready" ? prId : undefined);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="代码图谱" description="检索代码 symbol、调用/导入关系，并为 PR 准备独立分支快照。" />

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <Select
            label="仓库"
            placeholder="选择仓库"
            value={repoId}
            onValueChange={(value) => {
              setRepoId(value);
              setGraph(null);
              void loadPrs(value);
            }}
            options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
          />
          <div className="mt-4">
            <Input
              label="搜索 symbol / path"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchGraph();
              }}
              placeholder="例如 RepoService 或 services/repo.py"
            />
          </div>
          <div className="mt-3">
            <PrimaryButton disabled={!repoId || loading} loading={loading} onClick={() => searchGraph()}>
              搜索图谱
            </PrimaryButton>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <Section title="PR 分支快照" note={snapshot ? undefined : "在同一份代码版本上检索"}>
              <Select
                label="Pull Request"
                placeholder={prs.length ? "选择 PR" : "暂无 PR"}
                value={prId}
                onValueChange={(value) => {
                  setPrId(value);
                  setSnapshot(null);
                  setGraph(null);
                }}
                options={prs.map((pr) => ({ value: pr.id, label: `#${pr.number} ${pr.title}` }))}
              />
              <div className="mt-3">
                <Button variant="secondary" disabled={!prId || loading} loading={loading} onClick={prepareSnapshot}>
                  准备 PR 快照
                </Button>
              </div>
              {snapshot ? (
                <div className="mt-3">
                  <Panel label={snapshot.snapshot_name || "PR 分支快照"}>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span>状态：</span>
                        <Badge size="sm" tone={snapshotTone(snapshot.status)}>{snapshot.status}</Badge>
                      </div>
                      {snapshot.branch ? <div>分支：{snapshot.branch}</div> : null}
                      {snapshot.commit_sha ? <div>Commit：{snapshot.commit_sha.slice(0, 12)}</div> : null}
                      {typeof snapshot.indexed_symbols === "number" ? <div>代码图符号：{snapshot.indexed_symbols}</div> : null}
                      {snapshot.message ? <div className="text-ink-2">{snapshot.message}</div> : null}
                    </div>
                  </Panel>
                </div>
              ) : null}
            </Section>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <Section title="Symbols" note={graph ? `${graph.symbols.length} 个` : undefined}>
              <div className="flex flex-col gap-2">
                {(graph?.symbols || []).map((item) => (
                  <div key={item.id} className="rounded-control border border-line bg-panel px-3 py-2">
                    <span className="text-sm font-medium text-ink">{item.name}</span>
                    <span className="ml-2 text-xs text-ink-2">
                      {item.kind} · {item.path}:{item.start_line || 1}
                      {item.pr_number ? ` · PR #${item.pr_number}` : ""}
                    </span>
                  </div>
                ))}
                {!graph ? (
                  <EmptyState
                    icon={<Search size={18} strokeWidth={1.75} />}
                    title="还没有搜索结果"
                    description="索引代码后可搜索 symbol 和文件路径。"
                  />
                ) : null}
                {graph && !graph.symbols.length ? <p className="text-sm text-ink-2">没有匹配的 symbol。</p> : null}
              </div>
            </Section>
          </Card>

          <Card>
            <Section title="Relations" note={graph ? `${Math.min(graph.relations.length, 30)} 条` : undefined}>
              <div className="flex flex-col gap-2">
                {(graph?.relations || []).slice(0, 30).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-line bg-panel px-3 py-2 text-sm text-ink-2">
                    <span className="font-medium text-ink">{item.source_name || item.path || "module"}</span>
                    <span className="text-xs text-ink-2">{item.relation_type}</span>
                    <span className="font-medium text-ink">{item.target_name}</span>
                    {item.pr_number ? <span className="text-xs text-ink-2">PR #{item.pr_number}</span> : null}
                  </div>
                ))}
                {graph && !graph.relations.length ? <p className="text-sm text-ink-2">当前结果没有关系边。</p> : null}
                {!graph ? <p className="text-sm text-ink-2">搜索后展示调用、导入和继承关系。</p> : null}
              </div>
            </Section>
          </Card>

          <Card>
            <Section title="相关代码片段" note={graph ? `${graph.documents.length} 段` : undefined}>
              <div className="flex flex-col gap-3">
                {(graph?.documents || []).map((item) => (
                  <CodeBlock key={item.id} code={item.snippet} filename={item.title} language="text" maxLines={12} />
                ))}
                {graph && !graph.documents.length ? <p className="text-sm text-ink-2">没有相关代码片段。</p> : null}
                {!graph ? (
                  <EmptyState
                    icon={<GitBranch size={18} strokeWidth={1.75} />}
                    title="等待搜索"
                    description="搜索结果里的代码片段会显示在这里。"
                  />
                ) : null}
              </div>
            </Section>
          </Card>
        </div>
      </div>
    </>
  );
}
