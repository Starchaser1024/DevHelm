import type { WorkflowRun, WorkspaceSelection } from "./types";
import { EmptyWorkspaceState, WorkspaceItemButton } from "./workbench-shared";

export function CiPanel({
  runs,
  selectedWorkspaceItem,
  onSelectRun
}: {
  runs: WorkflowRun[];
  selectedWorkspaceItem: WorkspaceSelection | null;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <div className="mt-4 space-y-2">
      {runs.length === 0 && <EmptyWorkspaceState label="暂无 Workflow Run" />}
      {runs.map((item) => (
        <WorkspaceItemButton
          key={item.id}
          item={{
            id: item.id,
            title: item.name,
            meta: item.conclusion || item.status,
            detail: item.logs_text,
            selected: selectedWorkspaceItem?.type === "ci" && selectedWorkspaceItem.id === item.id,
            onClick: () => onSelectRun(item.id)
          }}
        />
      ))}
    </div>
  );
}
