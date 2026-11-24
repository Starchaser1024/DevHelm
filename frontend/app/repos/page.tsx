"use client";

import { useEffect, useState } from "react";
import { GitBranch, RefreshCw, Trash2 } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { Card, PageTitle, PrimaryButton } from "@/components/ui/card";
import { Panel, Section } from "@/components/ui/blocks";
import { apiDelete, API_BASE_URL, apiGet, apiPost } from "@/lib/api";
import type { Repository } from "@/lib/types";

type RepoConnectResult = {
  repo_id: string;
  full_name: string;
  provider: string;
  api_base_url?: string | null;
  local_path?: string | null;
  checkout_mode?: string;
  default_branch?: string | null;
  connected: boolean;
  demo_mode: boolean;
  message: string;
};

type RepoSource = "remote" | "local";

type RepoSyncResult = {
  repo_id: string;
  status: string;
  synced: {
    issues: number;
    pull_requests: number;
    workflow_runs: number;
  };
};

const providers = [
  { value: "github", label: "GitHub", hint: "默认平台，支持 public repo 和 Personal Access Token。" },
  { value: "github_compatible", label: "自定义 GitHub-compatible API", hint: "适合 GitHub Enterprise、Gitea 或兼容 GitHub REST 的网关。" },
  { value: "gitlab", label: "GitLab", hint: "界面已预留，真实同步需要单独适配 GitLab API。" },
  { value: "gitee", label: "Gitee", hint: "界面已预留，真实同步需要单独适配 Gitee API。" }
];

const sourceOptions = [
  { value: "remote", label: "GitHub 地址" },
  { value: "local", label: "本地仓库" }
];

export default function ReposPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [source, setSource] = useState<RepoSource>("remote");
  const [provider, setProvider] = useState("github");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [cloneParentDir, setCloneParentDir] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("https://api.github.com");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const selectedProvider = providers.find((item) => item.value === provider) ?? providers[0];
  const supportsRealConnect = provider === "github" || provider === "github_compatible";

  async function refreshRepos(nextSelectedId?: string) {
    const items = await apiGet<Repository[]>("/api/repos");
    setRepos(items);
    setSelectedRepoId(nextSelectedId || selectedRepoId || items[0]?.id || "");
  }

  useEffect(() => {
    refreshRepos().catch(() => setRepos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function syncRepo(repoId: string) {
    const data = await apiPost<RepoSyncResult>(`/api/repos/${repoId}/sync`, {
      sync_issues: true,
      sync_pull_requests: true,
      sync_workflow_runs: true,
      limit: 50
    });
    setSelectedRepoId(repoId);
    await refreshRepos(repoId);
    return data;
  }

  async function connect() {
    if (source === "remote" && (!owner.trim() || !repo.trim())) {
      setResult(JSON.stringify({ error: "请填写 Owner / Namespace 和 Repository。" }, null, 2));
      return;
    }
    if (source === "local" && !localPath.trim()) {
      setResult(JSON.stringify({ error: "请填写本地 Git 仓库路径。" }, null, 2));
      return;
    }
    setLoading(true);
    try {
      const connected = await apiPost<RepoConnectResult>("/api/repos/connect", {
        owner: source === "remote" ? owner.trim() : undefined,
        repo: source === "remote" ? repo.trim() : undefined,
        local_path: source === "local" ? localPath.trim() : undefined,
        clone_parent_dir: source === "remote" && cloneParentDir.trim() ? cloneParentDir.trim() : undefined,
        provider,
        api_base_url: provider === "github" ? undefined : apiBaseUrl,
        token: token || undefined,
        demo_mode: false
      });
      setResult(JSON.stringify({ connected, background_sync: "scheduled" }, null, 2));
      await refreshRepos(connected.repo_id);
    } catch (error) {
      setResult(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    } finally {
      setLoading(false);
    }
  }

  async function refreshRepo(repoId: string) {
    setLoading(true);
    try {
      const synced = await syncRepo(repoId);
      setResult(JSON.stringify({ refreshed: synced }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    } finally {
      setLoading(false);
    }
  }

  async function selectRepo(repoId: string) {
    setSelectedRepoId(repoId);
    const data = await apiPost(`/api/repos/${repoId}/select`, {});
    setResult(JSON.stringify(data, null, 2));
    await refreshRepos(repoId);
  }

  async function deleteRepo(item: Repository) {
    const confirmed = window.confirm(`确认删除仓库 ${item.full_name} 及其本地同步的 Issues、PR、CI、分析结果吗？此操作只删除本系统本地数据，不会删除远程 Git 仓库。`);
    if (!confirmed) return;
    setLoading(true);
    try {
      const data = await apiDelete(`/api/repos/${item.id}`);
      setResult(JSON.stringify(data, null, 2));
      await refreshRepos();
    } catch (error) {
      setResult(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageTitle title="仓库接入" description="连接真实 Git 仓库后会立即触发后台同步；生产环境可配置 Webhook 实时触发，并通过定时同步兜底。" />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="flex">
            <SegmentedControl
              options={sourceOptions}
              value={source}
              onValueChange={(value) => setSource(value as RepoSource)}
              label="接入方式"
            />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[240px_1fr_1fr]">
            <Select
              label="托管平台"
              value={provider}
              onValueChange={(next) => {
                setProvider(next);
                if (next === "github") setApiBaseUrl("https://api.github.com");
                if (next === "github_compatible") setApiBaseUrl("https://api.example.com");
                if (next === "gitlab") setApiBaseUrl("https://gitlab.com/api/v4");
                if (next === "gitee") setApiBaseUrl("https://gitee.com/api/v5");
              }}
              options={providers.map((item) => ({ value: item.value, label: item.label }))}
            />

            {source === "remote" ? (
              <>
                <Input label="Owner / Namespace" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="296569015" />
                <Input label="Repository" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="clowder-ai" />
              </>
            ) : (
              <div className="lg:col-span-2">
                <Input
                  label="本地仓库路径"
                  value={localPath}
                  onChange={(event) => setLocalPath(event.target.value)}
                  placeholder="例如 ~/projects/my-repo 或 /workspace/repos/my-service"
                />
              </div>
            )}
          </div>

          <div className="mt-4">
            <Panel label={selectedProvider.label}>{selectedProvider.hint}</Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Input
              label="API Base URL"
              value={apiBaseUrl}
              disabled={provider === "github"}
              onChange={(event) => setApiBaseUrl(event.target.value)}
            />
            <Input
              label="Access Token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="public repo 可留空，私有仓库需要 token"
            />
            {source === "remote" ? (
              <div className="lg:col-span-2">
                <Input
                  label="下载父目录"
                  value={cloneParentDir}
                  onChange={(event) => setCloneParentDir(event.target.value)}
                  placeholder="例如 ~/projects/repos，留空则使用默认缓存目录"
                />
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <PrimaryButton
              onClick={connect}
              loading={loading}
              disabled={loading || !supportsRealConnect || (source === "remote" ? !owner.trim() || !repo.trim() : !localPath.trim())}
            >
              连接并自动同步
            </PrimaryButton>
          </div>

          {!supportsRealConnect ? (
            <div className="mt-4">
              <Alert tone="warning" title="当前平台暂不支持真实同步">
                该平台已在界面预留，但真实 API 同步尚未实现。请选择 GitHub 或 GitHub-compatible API。
              </Alert>
            </div>
          ) : null}

          {result ? (
            <div className="mt-4">
              <CodeBlock code={result} filename="connect-result.json" language="json" maxLines={14} />
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-ink">已连接仓库</h2>
            <Badge size="sm" tone="neutral">{`${repos.length} 个`}</Badge>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {repos.length === 0 ? (
              <EmptyState
                icon={<GitBranch size={18} strokeWidth={1.75} />}
                title="还没有仓库"
                description="连接一个真实 Git 仓库后，Issues、PR 和 CI 会出现在这里。"
              />
            ) : null}
            {repos.map((item) => (
              <div
                key={item.id}
                className={`rounded-panel border p-4 transition-colors ${
                  selectedRepoId === item.id ? "border-accent bg-accent-subtle" : "border-line bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{item.full_name}</div>
                    <div className="mt-1 text-xs text-ink-2">
                      {item.provider || "github"} · {item.default_branch || "main"}
                    </div>
                    {item.local_path ? (
                      <div className="mt-1 break-all text-xs text-ink-2">
                        {item.checkout_mode === "local" ? "本地仓库" : "代码路径"}：{item.local_path}
                      </div>
                    ) : null}
                  </div>
                  <Badge size="sm" tone={selectedRepoId === item.id ? "success" : "neutral"}>
                    {selectedRepoId === item.id ? "当前查看" : "已连接"}
                  </Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{item.description || "暂无仓库描述"}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => selectRepo(item.id)}>
                    设为当前查看
                  </Button>
                  <Button variant="secondary" size="sm" disabled={loading} onClick={() => refreshRepo(item.id)}>
                    <RefreshCw size={14} strokeWidth={1.75} /> 立即刷新
                  </Button>
                  <Button variant="danger" size="sm" disabled={loading} onClick={() => deleteRepo(item)}>
                    <Trash2 size={14} strokeWidth={1.75} /> 删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <Section title="生产同步策略">
          <div className="grid gap-3 md:grid-cols-3">
            <Panel label="连接后自动同步">仓库校验成功后，后端会立即调度一次后台同步。</Panel>
            <Panel label="Webhook 实时触发">
              <span className="break-all">GitHub Webhook URL：{API_BASE_URL}/api/webhooks/github</span>
            </Panel>
            <Panel label="定时同步兜底">后端启动后会定时刷新已连接仓库，默认 5 分钟一次。</Panel>
          </div>
        </Section>
      </Card>
    </>
  );
}
