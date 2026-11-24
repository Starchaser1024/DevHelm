import { ChevronDown, Folder, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Trash2 } from "lucide-react";

import { HelmMark } from "@/components/brand/helm-mark";

import { formatRelativeTime } from "./formatters";
import type { ProjectConversation, Repository } from "./types";

export function WorkbenchSidebar({
  repos,
  selectedRepo,
  conversationMap,
  expandedRepoIds,
  selectedConversationId,
  isSidebarCollapsed,
  syncing,
  onToggleCollapse,
  onOpenAddProject,
  onRefreshSelectedRepo,
  onSelectProject,
  onAddConversation,
  onRemoveRepo,
  onSelectConversation,
  onRemoveConversation
}: {
  repos: Repository[];
  selectedRepo: Repository | undefined;
  conversationMap: Record<string, ProjectConversation[]>;
  expandedRepoIds: Record<string, boolean>;
  selectedConversationId: string;
  isSidebarCollapsed: boolean;
  syncing: boolean;
  onToggleCollapse: () => void;
  onOpenAddProject: () => void;
  onRefreshSelectedRepo: () => void;
  onSelectProject: (repo: Repository) => void;
  onAddConversation: (repo: Repository) => void;
  onRemoveRepo: (repo: Repository) => void;
  onSelectConversation: (repo: Repository, conversation: ProjectConversation) => void;
  onRemoveConversation: (repo: Repository, conversation: ProjectConversation) => void;
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-panel">
      <div className={`border-b border-line ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
        <div className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-3" : "gap-3"}`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent text-accent-ink">
            <HelmMark size={20} />
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">DevHelm</div>
              <div className="truncate text-xs text-ink-2">研发团队 PR / Issue 智能协作 Agent</div>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-2 transition hover:bg-accent-subtle"
            title={isSidebarCollapsed ? "展开项目侧边栏" : "隐藏项目侧边栏"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {isSidebarCollapsed ? (
          <div className="mt-4 flex flex-col items-center gap-3">
            <button onClick={onOpenAddProject} className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink transition hover:bg-surface" title="添加项目">
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onRefreshSelectedRepo}
              disabled={!selectedRepo || syncing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ink transition hover:bg-surface disabled:opacity-50"
              title="刷新当前项目"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
          </div>
        ) : (
          <div className="mt-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">项目</h2>
            </div>
            <button onClick={onOpenAddProject} className="inline-flex items-center gap-1 rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white">
              <Plus className="h-3.5 w-3.5" />
              添加项目
            </button>
          </div>
        )}
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${isSidebarCollapsed ? "p-2" : "px-3 py-2"}`}>
        {repos.length === 0 && !isSidebarCollapsed && <div className="rounded-control bg-surface p-3 text-sm leading-6 text-ink-2">还没有项目。请先添加一个项目。</div>}
        {!isSidebarCollapsed && repos.length > 0 && <div className="mb-2 px-1 text-xs text-ink-2">项目</div>}
        {repos.map((repo) => {
          const conversations = conversationMap[repo.id] ?? [];
          const isExpanded = expandedRepoIds[repo.id] ?? selectedRepo?.id === repo.id;
          const isSelectedRepo = selectedRepo?.id === repo.id;
          return isSidebarCollapsed ? (
            <button
              key={repo.id}
              onClick={() => onSelectProject(repo)}
              className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-control transition ${
                isSelectedRepo ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:bg-surface"
              }`}
              title={repo.full_name}
            >
              <Folder className="h-4 w-4" />
            </button>
          ) : (
            <div key={repo.id} className="mb-1">
              <div className={`group flex h-9 items-center gap-1 rounded-control px-1 transition ${isSelectedRepo ? "bg-accent-subtle" : "hover:bg-surface-raised"}`}>
                <button onClick={() => onSelectProject(repo)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-2 transition hover:bg-surface">
                  <ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "" : "-rotate-90"}`} />
                </button>
                <button onClick={() => onSelectProject(repo)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Folder className="h-4 w-4 shrink-0 text-ink-2" />
                  <span className="truncate text-sm text-ink" title={repo.full_name}>
                    {repo.name || repo.full_name}
                  </span>
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddConversation(repo);
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-2 opacity-0 transition hover:bg-surface hover:text-ink group-hover:opacity-100"
                  title="添加会话"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveRepo(repo);
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-2 opacity-0 transition hover:bg-danger-subtle hover:text-danger group-hover:opacity-100"
                  title="移除项目"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {isExpanded && (
                <div className="ml-7 mt-1 space-y-0.5">
                  {conversations.length === 0 && <div className="px-2 py-1.5 text-xs text-ink-2">暂无会话</div>}
                  {conversations.map((conversation) => (
                    <div key={conversation.id} className="group/conversation flex items-center gap-1">
                      <button
                        onClick={() => onSelectConversation(repo, conversation)}
                        className={`flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-control px-2 text-left text-sm transition ${
                          selectedConversationId === conversation.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:bg-surface"
                        }`}
                        title={conversation.title}
                      >
                        <span className="truncate">{conversation.title}</span>
                        <span className="shrink-0 text-xs text-ink-2">{formatRelativeTime(conversation.updated_at)}</span>
                      </button>
                      <button
                        onClick={() => onRemoveConversation(repo, conversation)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-2 opacity-0 transition hover:bg-danger-subtle hover:text-danger group-hover/conversation:opacity-100"
                        title="删除会话"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isSidebarCollapsed && (
        <div className="border-t border-line p-3">
          <button
            onClick={onRefreshSelectedRepo}
            disabled={!selectedRepo || syncing}
            className="inline-flex w-full items-center justify-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-accent-subtle disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "刷新中..." : "刷新当前项目"}
          </button>
        </div>
      )}
    </aside>
  );
}
