"use client";

import { GitPullRequest } from "lucide-react";

import { Badge } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Select } from "@/components/arc/select/select";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, GhostButton } from "@/components/ui/card";
import type { Repository } from "@/lib/types";
import { STATE_TONES, type PullRequest } from "./types";

type PRListSidebarProps = {
  repos: Repository[];
  repoId: string;
  prs: PullRequest[];
  selectedId: string | null;
  loading: boolean;
  onSelectRepo: (repoId: string) => void;
  onSelectPr: (pr: PullRequest) => void;
};

export function PRListSidebar({
  repos,
  repoId,
  prs,
  selectedId,
  loading,
  onSelectRepo,
  onSelectPr
}: PRListSidebarProps) {
  return (
    <Card className="self-start">
      {repos.length > 1 && (
        <div className="mb-4">
          <Select
            label="仓库"
            placeholder="选择仓库"
            value={repoId}
            onValueChange={onSelectRepo}
            options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">PR 列表</h2>
        <Badge tone="neutral" size="sm">{`${prs.length} 个`}</Badge>
      </div>

      {loading ? (
        <Skeleton lines={5} className="mt-4" />
      ) : prs.length === 0 ? (
        <EmptyState
          title="暂无 Pull Request"
          description="当前仓库还没有同步到 PR。"
          icon={<GitPullRequest size={18} strokeWidth={1.75} />}
          className="mt-4"
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {prs.map((pr) => (
            <GhostButton key={pr.id} active={selectedId === pr.id} onClick={() => onSelectPr(pr)}>
              <span className="min-w-0 truncate">
                #{pr.number} {pr.title}
              </span>
              <Badge tone={STATE_TONES[pr.state] ?? "neutral"} size="sm" className="shrink-0">
                {pr.state}
              </Badge>
            </GhostButton>
          ))}
        </div>
      )}
    </Card>
  );
}
