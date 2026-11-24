import { issueCategoryMeta } from "./constants";
import { classifyIssue } from "./formatters";
import type { Issue, WorkspaceSelection } from "./types";
import { CategoryGroup } from "./workbench-shared";

export function IssuesPanel({
  issues,
  collapsedGroups,
  selectedWorkspaceItem,
  onToggleCategory,
  onSelectIssue
}: {
  issues: Issue[];
  collapsedGroups: Record<string, boolean>;
  selectedWorkspaceItem: WorkspaceSelection | null;
  onToggleCategory: (groupKey: string) => void;
  onSelectIssue: (issueId: string) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      {issueCategoryMeta.map((category) => {
        const items = issues.filter((item) => classifyIssue(item) === category.key);
        const groupKey = `issue-${category.key}`;
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
              meta: item.state,
              detail: item.body,
              badges: item.labels,
              selected: selectedWorkspaceItem?.type === "issue" && selectedWorkspaceItem.id === item.id,
              onClick: () => onSelectIssue(item.id)
            }))}
          />
        );
      })}
    </div>
  );
}
