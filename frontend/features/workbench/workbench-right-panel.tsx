import { RefreshCw } from "lucide-react";

import { CiPanel } from "./ci-panel";
import { workspaceTabs } from "./constants";
import { IssuesPanel } from "./issues-panel";
import { KnowledgeGraphWorkspace } from "./knowledge-graph-panel";
import { MemoryHubWorkspace } from "./knowledge-panel";
import { PullRequestsPanel } from "./pull-requests-panel";
import { SkillMcpWorkspace } from "./skill-mcp-panel";
import { TeamWorkspace } from "./team-panel";
import type {
  Issue,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
  KnowledgeItem,
  McpRuntime,
  MemoryNote,
  MemoryNoteDraft,
  PullRequest,
  Repository,
  SkillResponse,
  TeamMember,
  TeamMemberDraft,
  WorkflowRun,
  WorkspaceSelection,
  WorkspaceTab
} from "./types";
import { WorkspaceControls, WorkspaceDetail } from "./workbench-shared";

export function WorkbenchRightPanel({
  selectedRepo,
  syncing,
  workspaceTab,
  filteredIssues,
  filteredPrs,
  filteredRuns,
  ownerOptions,
  workspaceQuery,
  workspaceStatus,
  workspaceOwner,
  workspaceTime,
  selectedWorkspaceItem,
  selectedIssue,
  selectedPr,
  selectedRun,
  analyzingIssueId,
  analyzingPrId,
  analyzingRunId,
  collapsedGroups,
  teamMembers,
  memberDraft,
  memoryNotes,
  memoryDraft,
  knowledgeItems,
  uploadingKnowledge,
  mcpRuntime,
  skills,
  selectedSkillName,
  skillRuntimeLoading,
  skillRuntimeError,
  selectedKnowledgeGraph,
  graphLoading,
  graphError,
  graphQuery,
  selectedGraphNodeKey,
  hiddenGraphNodeTypes,
  hiddenGraphRelations,
  onSelectTab,
  onRefreshSelectedRepo,
  onQueryChange,
  onStatusChange,
  onOwnerChange,
  onTimeChange,
  onSelectWorkspaceItem,
  onToggleCategory,
  onAnalyzeIssue,
  onAnalyzePr,
  onAnalyzeRun,
  onMemberDraftChange,
  onAddTeamMember,
  onRemoveTeamMember,
  onMemoryDraftChange,
  onAddMemoryNote,
  onRemoveMemoryNote,
  onUploadKnowledgeFile,
  onRemoveKnowledgeItem,
  onRefreshKnowledge,
  onSelectSkillName,
  onRefreshSkillRuntime,
  onGraphQueryChange,
  onSelectGraphNodeKey,
  onToggleGraphNodeType,
  onToggleGraphRelation,
  onRefreshKnowledgeGraph,
  onRebuildKnowledgeGraph,
  onFocusGraphNode,
  onOpenGraphNode
}: {
  selectedRepo: Repository | undefined;
  syncing: boolean;
  workspaceTab: WorkspaceTab;
  filteredIssues: Issue[];
  filteredPrs: PullRequest[];
  filteredRuns: WorkflowRun[];
  ownerOptions: string[];
  workspaceQuery: string;
  workspaceStatus: string;
  workspaceOwner: string;
  workspaceTime: string;
  selectedWorkspaceItem: WorkspaceSelection | null;
  selectedIssue: Issue | undefined;
  selectedPr: PullRequest | undefined;
  selectedRun: WorkflowRun | undefined;
  analyzingIssueId: string | null;
  analyzingPrId: string | null;
  analyzingRunId: string | null;
  collapsedGroups: Record<string, boolean>;
  teamMembers: TeamMember[];
  memberDraft: TeamMemberDraft;
  memoryNotes: MemoryNote[];
  memoryDraft: MemoryNoteDraft;
  knowledgeItems: KnowledgeItem[];
  uploadingKnowledge: boolean;
  mcpRuntime: McpRuntime | null;
  skills: SkillResponse[];
  selectedSkillName: string;
  skillRuntimeLoading: boolean;
  skillRuntimeError: string | null;
  selectedKnowledgeGraph: KnowledgeGraphResponse | null;
  graphLoading: boolean;
  graphError: string | null;
  graphQuery: string;
  selectedGraphNodeKey: string | null;
  hiddenGraphNodeTypes: Record<string, boolean>;
  hiddenGraphRelations: Record<string, boolean>;
  onSelectTab: (tab: WorkspaceTab) => void;
  onRefreshSelectedRepo: () => void;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onSelectWorkspaceItem: (item: WorkspaceSelection | null) => void;
  onToggleCategory: (groupKey: string) => void;
  onAnalyzeIssue: (issue: Issue) => void;
  onAnalyzePr: (pr: PullRequest) => void;
  onAnalyzeRun: (run: WorkflowRun) => void;
  onMemberDraftChange: (draft: TeamMemberDraft) => void;
  onAddTeamMember: () => void;
  onRemoveTeamMember: (memberId: string) => void;
  onMemoryDraftChange: (draft: MemoryNoteDraft) => void;
  onAddMemoryNote: () => void;
  onRemoveMemoryNote: (noteId: string) => void;
  onUploadKnowledgeFile: (file: File) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
  onRefreshKnowledge: () => void;
  onSelectSkillName: (name: string) => void;
  onRefreshSkillRuntime: () => void;
  onGraphQueryChange: (value: string) => void;
  onSelectGraphNodeKey: (key: string) => void;
  onToggleGraphNodeType: (type: string) => void;
  onToggleGraphRelation: (relation: string) => void;
  onRefreshKnowledgeGraph: () => void;
  onRebuildKnowledgeGraph: () => void;
  onFocusGraphNode: (node: KnowledgeGraphNode) => void;
  onOpenGraphNode: (node: KnowledgeGraphNode) => void;
}) {
  const hasWorkspaceDetail = Boolean(selectedIssue || selectedPr || selectedRun);

  return (
    <aside className="col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-ink">工作区</h2>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-[11px] text-ink-2">
              Issue {filteredIssues.length} · PR {filteredPrs.length}
            </div>
            <button
              onClick={onRefreshSelectedRepo}
              disabled={!selectedRepo || syncing}
              className="inline-flex h-8 items-center gap-1.5 rounded-control border border-line bg-surface px-2 text-xs font-medium text-ink transition hover:bg-accent-subtle disabled:opacity-60"
              title="刷新 Issue/PR/CI"
              aria-label="刷新 Issue/PR/CI"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {workspaceTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => onSelectTab(tab)}
              className={`shrink-0 rounded-control px-3 py-1.5 text-xs font-medium transition ${
                workspaceTab === tab ? "bg-accent text-accent-ink" : "bg-panel text-ink-2 hover:bg-accent-subtle"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!hasWorkspaceDetail && (workspaceTab === "Issue" || workspaceTab === "PR" || workspaceTab === "CI") && (
          <WorkspaceControls
            query={workspaceQuery}
            status={workspaceStatus}
            owner={workspaceOwner}
            time={workspaceTime}
            owners={ownerOptions}
            activeTab={workspaceTab}
            onQueryChange={(value) => {
              onQueryChange(value);
              onSelectWorkspaceItem(null);
            }}
            onStatusChange={(value) => {
              onStatusChange(value);
              onSelectWorkspaceItem(null);
            }}
            onOwnerChange={(value) => {
              onOwnerChange(value);
              onSelectWorkspaceItem(null);
            }}
            onTimeChange={(value) => {
              onTimeChange(value);
              onSelectWorkspaceItem(null);
            }}
          />
        )}

        {hasWorkspaceDetail && (
          <WorkspaceDetail
            issue={selectedIssue}
            pr={selectedPr}
            run={selectedRun}
            analyzingIssue={Boolean(selectedIssue && analyzingIssueId === selectedIssue.id)}
            analyzingPr={Boolean(selectedPr && analyzingPrId === selectedPr.id)}
            analyzingRun={Boolean(selectedRun && analyzingRunId === selectedRun.id)}
            onAnalyzeIssue={selectedIssue ? () => onAnalyzeIssue(selectedIssue) : undefined}
            onAnalyzePr={selectedPr ? () => onAnalyzePr(selectedPr) : undefined}
            onAnalyzeRun={selectedRun ? () => onAnalyzeRun(selectedRun) : undefined}
            onClose={() => onSelectWorkspaceItem(null)}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "Issue" && (
          <IssuesPanel
            issues={filteredIssues}
            collapsedGroups={collapsedGroups}
            selectedWorkspaceItem={selectedWorkspaceItem}
            onToggleCategory={onToggleCategory}
            onSelectIssue={(id) => onSelectWorkspaceItem({ type: "issue", id })}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "PR" && (
          <PullRequestsPanel
            pullRequests={filteredPrs}
            collapsedGroups={collapsedGroups}
            selectedWorkspaceItem={selectedWorkspaceItem}
            onToggleCategory={onToggleCategory}
            onSelectPr={(id) => onSelectWorkspaceItem({ type: "pr", id })}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "CI" && (
          <CiPanel
            runs={filteredRuns}
            selectedWorkspaceItem={selectedWorkspaceItem}
            onSelectRun={(id) => onSelectWorkspaceItem({ type: "ci", id })}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "团队" && (
          <TeamWorkspace
            members={teamMembers}
            draft={memberDraft}
            onDraftChange={onMemberDraftChange}
            onAddMember={onAddTeamMember}
            onRemoveMember={onRemoveTeamMember}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "记忆&知识库" && (
          <MemoryHubWorkspace
            repoId={selectedRepo?.id}
            notes={memoryNotes}
            draft={memoryDraft}
            knowledgeItems={knowledgeItems}
            uploading={uploadingKnowledge}
            onDraftChange={onMemoryDraftChange}
            onAddNote={onAddMemoryNote}
            onRemoveNote={onRemoveMemoryNote}
            onUploadFile={onUploadKnowledgeFile}
            onRemoveKnowledgeItem={onRemoveKnowledgeItem}
            onRefreshKnowledge={onRefreshKnowledge}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "技能&MCP" && (
          <SkillMcpWorkspace
            runtime={mcpRuntime}
            skills={skills}
            selectedSkillName={selectedSkillName}
            loading={skillRuntimeLoading}
            error={skillRuntimeError}
            onSelectSkill={onSelectSkillName}
            onRefresh={onRefreshSkillRuntime}
          />
        )}

        {!hasWorkspaceDetail && workspaceTab === "图谱" && (
          <KnowledgeGraphWorkspace
            graph={selectedKnowledgeGraph}
            loading={graphLoading}
            error={graphError}
            query={graphQuery}
            selectedNodeKey={selectedGraphNodeKey}
            hiddenNodeTypes={hiddenGraphNodeTypes}
            hiddenRelations={hiddenGraphRelations}
            onQueryChange={onGraphQueryChange}
            onSelectNode={onSelectGraphNodeKey}
            onToggleNodeType={onToggleGraphNodeType}
            onToggleRelation={onToggleGraphRelation}
            onRefresh={onRefreshKnowledgeGraph}
            onRebuild={onRebuildKnowledgeGraph}
            onFocusNode={onFocusGraphNode}
            onOpenNode={onOpenGraphNode}
          />
        )}
      </div>
    </aside>
  );
}
