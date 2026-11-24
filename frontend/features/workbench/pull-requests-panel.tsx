import { prCategoryMeta } from "./constants";
import { classifyPr } from "./formatters";
import type { PullRequest, WorkspaceSelection } from "./types";
import { CategoryGroup } from "./workbench-shared";

export function PullRequestsPanel({
  pullRequests,
  collapsedGroups,
  selectedWorkspaceItem,
  onToggleCategory,
  onSelectPr
}: {
  pullRequests: PullRequest[];
  collapsedGroups: Record<string, boolean>;
  selectedWorkspaceItem: WorkspaceSelection | null;
  onToggleCategory: (groupKey: string) => void;
  onSelectPr: (prId: string) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      {prCategoryMeta.map((category) => {
        const items = pullRequests.filter((item) => classifyPr(item) === category.key);
        const groupKey = `pr-${category.key}`;
        return (
          <CategoryGroup
            key={category.key}
            label={category.label}
            color={category.color}
            count={items.length}
            isCollapsed={collapsedGroups[groupKey] ?? false}
            onToggle={() => onToggleCategory(groupKey)}
            items={items.map((item) => ({
              id: item.id,
              title: `#${item.number} ${item.title}`,
              meta: item.merged_at ? "merged" : item.state,
              detail: item.body,
              badges: [item.author, item.head_branch].filter(Boolean) as string[],
              selected: selectedWorkspaceItem?.type === "pr" && selectedWorkspaceItem.id === item.id,
              onClick: () => onSelectPr(item.id)
            }))}
          />
        );
      })}
    </div>
  );
}
