import { Folder, X } from "lucide-react";

import { parseRepositoryInput } from "./formatters";
import type { AddProjectSource, AddProjectStatus } from "./types";

export function AddProjectOverlay({
  source,
  repoUrl,
  localPath,
  cloneParentDir,
  provider,
  apiBaseUrl,
  token,
  loading,
  status,
  onSourceChange,
  onRepoUrlChange,
  onLocalPathChange,
  onCloneParentDirChange,
  onProviderChange,
  onApiBaseUrlChange,
  onTokenChange,
  onConnect,
  onClose
}: {
  source: AddProjectSource;
  repoUrl: string;
  localPath: string;
  cloneParentDir: string;
  provider: string;
  apiBaseUrl: string;
  token: string;
  loading: boolean;
  status: AddProjectStatus | null;
  onSourceChange: (value: AddProjectSource) => void;
  onRepoUrlChange: (value: string) => void;
  onLocalPathChange: (value: string) => void;
  onCloneParentDirChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
  onClose: () => void;
}) {
  const parsed = source === "remote" ? parseRepositoryInput(repoUrl) : null;
  const canConnect = source === "local" ? Boolean(localPath.trim()) : Boolean(repoUrl.trim());

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--foreground)_40%,transparent)] p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        className="flex max-h-[calc(100%-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-overlay"
      >
        <div className="flex items-start justify-between gap-4 border-b border-accent-subtle bg-surface px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">添加项目</div>
            <h2 id="add-project-title" className="mt-1 text-xl font-semibold text-ink">
              添加项目
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-2 transition hover:bg-accent-subtle disabled:opacity-60"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
            <section className="rounded-control border border-line bg-surface p-4 shadow-sm">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 overflow-hidden rounded-control border border-line bg-panel p-1">
                  <button
                    type="button"
                    onClick={() => onSourceChange("remote")}
                    className={`h-9 rounded-control px-3 text-sm font-medium transition ${
                      source === "remote" ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    GitHub 地址
                  </button>
                  <button
                    type="button"
                    onClick={() => onSourceChange("local")}
                    className={`h-9 rounded-control px-3 text-sm font-medium transition ${
                      source === "local" ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    本地仓库
                  </button>
                </div>

                {source === "remote" ? (
                  <div className="grid gap-4">
                    <label className="text-sm font-medium text-ink">
                      GitHub 地址
                      <input
                        value={repoUrl}
                        onChange={(event) => onRepoUrlChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onConnect();
                          }
                        }}
                        placeholder="https://github.com/owner/repository 或 owner/repository"
                        className="mt-2 h-11 w-full rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
                      />
                    </label>

                    <label className="text-sm font-medium text-ink">
                      下载父目录
                      <input
                        value={cloneParentDir}
                        onChange={(event) => onCloneParentDirChange(event.target.value)}
                        placeholder="例如 ~/projects/repos，留空则使用默认缓存目录"
                        className="mt-2 h-10 w-full rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
                      />
                    </label>
                  </div>
                ) : (
                  <label className="text-sm font-medium text-ink">
                    本地仓库路径
                    <div className="mt-2 flex gap-2">
                      <input
                        value={localPath}
                        onChange={(event) => onLocalPathChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onConnect();
                          }
                        }}
                        placeholder="例如 ~/projects/my-repo 或 /workspace/repos/my-service"
                        className="h-11 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
                      />
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-2">
                        <Folder className="h-4 w-4" />
                      </span>
                    </div>
                  </label>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-medium text-ink">
                    托管平台
                    <select
                      value={provider}
                      onChange={(event) => onProviderChange(event.target.value)}
                      className="mt-2 h-10 w-full rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
                    >
                      <option value="github">GitHub</option>
                      <option value="github_compatible">GitHub-compatible API</option>
                    </select>
                  </label>

                  <label className="text-sm font-medium text-ink">
                    API Base URL
                    <input
                      value={apiBaseUrl}
                      disabled={provider === "github"}
                      onChange={(event) => onApiBaseUrlChange(event.target.value)}
                      className="mt-2 h-10 w-full rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle disabled:bg-panel disabled:text-ink-2"
                    />
                  </label>
                </div>

                <label className="text-sm font-medium text-ink">
                  Access Token
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => onTokenChange(event.target.value)}
                    placeholder="public repo 可留空，私有仓库需要 token"
                    className="mt-2 h-10 w-full rounded-control border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle"
                  />
                </label>

                {status && (
                  <div
                    className={`rounded-control border px-3 py-2 text-sm leading-6 ${
                      status.type === "success" ? "border-success-subtle bg-success-subtle text-success" : "border-danger-subtle bg-danger-subtle text-danger"
                    }`}
                  >
                    <div className="font-semibold">{status.title}</div>
                    {status.detail && <div className="mt-1 break-words">{status.detail}</div>}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={onConnect}
                    disabled={loading || !canConnect}
                    className="inline-flex h-10 items-center justify-center rounded-control bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent disabled:opacity-60"
                  >
                    {loading ? "连接并同步中..." : "连接并同步"}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={loading}
                    className="inline-flex h-10 items-center justify-center rounded-control border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-panel disabled:opacity-60"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-control border border-line bg-surface p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-ink">识别结果</h3>
              <div className="mt-3 rounded-control bg-panel p-3 text-sm leading-7 text-ink-2">
                {source === "remote" ? (
                  <>
                    <div>
                      Owner: <span className="font-medium text-ink">{parsed?.owner || "待识别"}</span>
                    </div>
                    <div>
                      Repository: <span className="font-medium text-ink">{parsed?.repo || "待识别"}</span>
                    </div>
                    <div>
                      下载到: <span className="break-all font-medium text-ink">{cloneParentDir.trim() || "默认缓存目录"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      本地路径: <span className="break-all font-medium text-ink">{localPath.trim() || "待选择"}</span>
                    </div>
                    <div>
                      远程仓库: <span className="font-medium text-ink">提交后从 origin 识别</span>
                    </div>
                  </>
                )}
              </div>
              <div className="mt-4 space-y-2 text-xs leading-6 text-ink-2">
                {source === "remote" ? (
                  <div>支持 `https://github.com/owner/repo`、`git@github.com:owner/repo.git`、`owner/repo`。</div>
                ) : (
                  <div>本地仓库需要已配置 `origin` 远程地址。</div>
                )}
                <div>连接成功后会同步 GitHub 数据，并在后台索引代码用于代码 RAG 和风险分析。</div>
                <div>如果连接失败，会直接显示后端返回的原因，不再展开原始 JSON。</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
