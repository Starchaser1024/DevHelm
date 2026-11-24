"use client";

import { useEffect } from "react";

import {
  CIAnalysisOverlay,
  IssueAnalysisOverlay,
  PRAnalysisOverlay
} from "@/features/workbench/analysis-overlays";
import { ChatWorkspacePanel } from "@/features/workbench/chat-workspace-panel";
import { AddProjectOverlay } from "@/features/workbench/repo-connect-modal";
import { useEntityAnalysis } from "@/features/workbench/use-entity-analysis";
import { useWorkbenchController } from "@/features/workbench/use-workbench-controller";
import { WorkbenchOverviewBar } from "@/features/workbench/workbench-overview-bar";
import { WorkbenchRightPanel } from "@/features/workbench/workbench-right-panel";
import { WorkbenchSidebar } from "@/features/workbench/workbench-sidebar";

export default function DashboardPage() {
  const workbench = useWorkbenchController();
  const { closeAllAnalysisModals, ...entityAnalysis } = useEntityAnalysis({
    conversationId: workbench.selectedConversation?.id,
    isDraftConversation: workbench.isDraftConversation
  });

  useEffect(() => {
    closeAllAnalysisModals();
  }, [workbench.selectedRepo?.id, workbench.workspaceTab, closeAllAnalysisModals]);

  const analysisModalIssue = entityAnalysis.analysisModalIssueId
    ? workbench.issues.find((item) => item.id === entityAnalysis.analysisModalIssueId)
    : undefined;
  const analysisModalPr = entityAnalysis.analysisModalPrId
    ? workbench.prs.find((item) => item.id === entityAnalysis.analysisModalPrId)
    : undefined;
  const analysisModalRun = entityAnalysis.analysisModalRunId
    ? workbench.runs.find((item) => item.id === entityAnalysis.analysisModalRunId)
    : undefined;

  return (
    <div
      className="relative grid h-[calc(100vh-24px)] min-h-0 overflow-hidden rounded-panel border border-line bg-surface shadow-sm"
      style={{
        gridTemplateColumns: `${workbench.isSidebarCollapsed ? "56px" : "300px"} minmax(0,1fr)`,
        transition: "grid-template-columns 260ms ease"
      }}
    >
      <WorkbenchSidebar
        repos={workbench.repos}
        selectedRepo={workbench.selectedRepo}
        conversationMap={workbench.conversationMap}
        expandedRepoIds={workbench.expandedRepoIds}
        selectedConversationId={workbench.selectedConversationId}
        isSidebarCollapsed={workbench.isSidebarCollapsed}
        syncing={workbench.syncing}
        onToggleCollapse={() => workbench.setIsSidebarCollapsed((value) => !value)}
        onOpenAddProject={workbench.openAddProject}
        onRefreshSelectedRepo={() => void workbench.runGuarded("同步失败", workbench.refreshSelectedRepo)}
        onSelectProject={(repo) => void workbench.selectProject(repo)}
        onAddConversation={workbench.addConversation}
        onRemoveRepo={(repo) => void workbench.removeRepo(repo)}
        onSelectConversation={(repo, conversation) => void workbench.selectConversation(repo, conversation)}
        onRemoveConversation={(repo, conversation) =>
          void workbench.runGuarded("删除会话失败", () => workbench.removeConversation(repo, conversation))
        }
      />

      <section
        className="grid min-h-0 min-w-0 bg-panel"
        style={{
          gridTemplateColumns: `minmax(460px,1fr) 8px ${workbench.workspaceWidth}px`,
          gridTemplateRows: "auto minmax(0,1fr)"
        }}
      >
        <WorkbenchOverviewBar
          selectedRepo={workbench.selectedRepo}
          selectedConversation={workbench.selectedConversation}
          openIssuesCount={workbench.openIssues.length}
          openPrsCount={workbench.openPrs.length}
          handledIssuesCount={workbench.handledIssues.length}
          rejectedIssuesCount={workbench.rejectedIssues.length}
          failedRunsCount={workbench.failedRuns.length}
          mergedPrsCount={workbench.mergedPrs.length}
          actionError={workbench.actionError}
          onDismissActionError={() => workbench.setActionError(null)}
          onOpenAddProject={workbench.openAddProject}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整 Workspace 宽度"
          className="group col-start-2 row-span-2 row-start-1 flex cursor-col-resize items-center justify-center"
          onMouseDown={workbench.startResize}
        >
          <div className="h-14 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-accent" />
        </div>

        <WorkbenchRightPanel
          selectedRepo={workbench.selectedRepo}
          syncing={workbench.syncing}
          workspaceTab={workbench.workspaceTab}
          filteredIssues={workbench.filteredIssues}
          filteredPrs={workbench.filteredPrs}
          filteredRuns={workbench.filteredRuns}
          ownerOptions={workbench.ownerOptions}
          workspaceQuery={workbench.workspaceQuery}
          workspaceStatus={workbench.workspaceStatus}
          workspaceOwner={workbench.workspaceOwner}
          workspaceTime={workbench.workspaceTime}
          selectedWorkspaceItem={workbench.selectedWorkspaceItem}
          selectedIssue={workbench.selectedIssue}
          selectedPr={workbench.selectedPr}
          selectedRun={workbench.selectedRun}
          analyzingIssueId={entityAnalysis.analyzingIssueId}
          analyzingPrId={entityAnalysis.analyzingPrId}
          analyzingRunId={entityAnalysis.analyzingRunId}
          collapsedGroups={workbench.collapsedGroups}
          teamMembers={workbench.teamMembers}
          memberDraft={workbench.memberDraft}
          memoryNotes={workbench.memoryNotes}
          memoryDraft={workbench.memoryDraft}
          knowledgeItems={workbench.knowledgeItems}
          uploadingKnowledge={workbench.uploadingKnowledge}
          mcpRuntime={workbench.mcpRuntime}
          skills={workbench.skills}
          selectedSkillName={workbench.selectedSkillName}
          skillRuntimeLoading={workbench.skillRuntimeLoading}
          skillRuntimeError={workbench.skillRuntimeError}
          selectedKnowledgeGraph={workbench.selectedKnowledgeGraph}
          graphLoading={workbench.graphLoadingRepoId === workbench.selectedRepo?.id}
          graphError={workbench.graphError}
          graphQuery={workbench.graphQuery}
          selectedGraphNodeKey={workbench.selectedGraphNodeKey}
          hiddenGraphNodeTypes={workbench.hiddenGraphNodeTypes}
          hiddenGraphRelations={workbench.hiddenGraphRelations}
          onSelectTab={workbench.selectWorkspaceTab}
          onRefreshSelectedRepo={() => void workbench.runGuarded("同步失败", workbench.refreshSelectedRepo)}
          onQueryChange={workbench.setWorkspaceQuery}
          onStatusChange={workbench.setWorkspaceStatus}
          onOwnerChange={workbench.setWorkspaceOwner}
          onTimeChange={workbench.setWorkspaceTime}
          onSelectWorkspaceItem={workbench.setSelectedWorkspaceItem}
          onToggleCategory={workbench.toggleCategory}
          onAnalyzeIssue={(issue) => void entityAnalysis.analyzeIssue(issue)}
          onAnalyzePr={(pr) => void entityAnalysis.analyzePr(pr)}
          onAnalyzeRun={(run) => void entityAnalysis.analyzeCi(run)}
          onMemberDraftChange={workbench.setMemberDraft}
          onAddTeamMember={() => void workbench.runGuarded("添加成员失败", workbench.addTeamMember)}
          onRemoveTeamMember={(id) => void workbench.runGuarded("移除成员失败", () => workbench.removeTeamMember(id))}
          onMemoryDraftChange={workbench.setMemoryDraft}
          onAddMemoryNote={() => void workbench.runGuarded("添加记忆失败", workbench.addMemoryNote)}
          onRemoveMemoryNote={(id) => void workbench.runGuarded("删除记忆失败", () => workbench.removeMemoryNote(id))}
          onUploadKnowledgeFile={(file) => void workbench.runGuarded("上传资料失败", () => workbench.uploadKnowledgeFile(file))}
          onRemoveKnowledgeItem={(item) => void workbench.runGuarded("删除资料失败", () => workbench.removeKnowledgeItem(item))}
          onRefreshKnowledge={() =>
            workbench.selectedRepo &&
            void workbench.runGuarded("刷新知识库失败", () => workbench.loadProjectKnowledge(workbench.selectedRepo!.id))
          }
          onSelectSkillName={workbench.setSelectedSkillName}
          onRefreshSkillRuntime={() => void workbench.loadSkillRuntime()}
          onGraphQueryChange={workbench.setGraphQuery}
          onSelectGraphNodeKey={workbench.setSelectedGraphNodeKey}
          onToggleGraphNodeType={(type) => workbench.setHiddenGraphNodeTypes((items) => ({ ...items, [type]: !items[type] }))}
          onToggleGraphRelation={(relation) =>
            workbench.setHiddenGraphRelations((items) => ({ ...items, [relation]: !items[relation] }))
          }
          onRefreshKnowledgeGraph={() => workbench.selectedRepo && void workbench.loadKnowledgeGraph(workbench.selectedRepo.id)}
          onRebuildKnowledgeGraph={() => void workbench.rebuildSelectedKnowledgeGraph()}
          onFocusGraphNode={(node) =>
            workbench.selectedRepo && void workbench.loadKnowledgeGraph(workbench.selectedRepo.id, { type: node.type, id: node.id })
          }
          onOpenGraphNode={workbench.handleOpenGraphNode}
        />

        <ChatWorkspacePanel
          selectedRepo={workbench.selectedRepo}
          selectedConversation={workbench.selectedConversation}
          messages={workbench.messages}
          message={workbench.message}
          loading={workbench.loading}
          planMode={workbench.planMode}
          promptSuggestions={workbench.promptSuggestions}
          loadingPrompts={workbench.loadingPrompts}
          promptLoadingDots={workbench.promptLoadingDots}
          selectedProjectIndexState={workbench.selectedProjectIndexState}
          indexScanningRepoId={workbench.indexScanningRepoId}
          indexActionError={workbench.indexActionError}
          onMessageChange={workbench.setMessage}
          onTogglePlanMode={() => workbench.setPlanMode((value) => !value)}
          onAskAgent={(prompt) => void workbench.askAgent(prompt)}
          onCreateWorkflowPlan={(prompt) => void workbench.createWorkflowPlan(prompt)}
          onExecuteWorkflowPlan={(messageId) => void workbench.executeWorkflowPlan(messageId)}
          onStopAgentResponse={workbench.stopAgentResponse}
          onToggleAssistantTrace={workbench.toggleAssistantTrace}
          onToggleContextDiagnostics={workbench.toggleContextDiagnostics}
          onFeedbackSaved={workbench.saveMessageFeedback}
          onRefreshPromptSuggestions={() => void workbench.refreshPromptSuggestions()}
          onStartProjectIndexScan={() => void workbench.startProjectIndexScan()}
          onSnoozeProjectIndexPrompt={() => void workbench.snoozeProjectIndexPrompt()}
        />
      </section>

      {workbench.isAddProjectOpen && (
        <AddProjectOverlay
          source={workbench.projectSource}
          repoUrl={workbench.projectUrl}
          localPath={workbench.projectLocalPath}
          cloneParentDir={workbench.projectCloneParentDir}
          provider={workbench.projectProvider}
          apiBaseUrl={workbench.projectApiBaseUrl}
          token={workbench.projectToken}
          loading={workbench.connectingProject}
          status={workbench.addProjectStatus}
          onSourceChange={workbench.setProjectSource}
          onRepoUrlChange={workbench.setProjectUrl}
          onLocalPathChange={workbench.setProjectLocalPath}
          onCloneParentDirChange={workbench.setProjectCloneParentDir}
          onProviderChange={(value) => {
            workbench.setProjectProvider(value);
            if (value === "github") workbench.setProjectApiBaseUrl("https://api.github.com");
            if (value === "github_compatible") workbench.setProjectApiBaseUrl("https://api.example.com");
          }}
          onApiBaseUrlChange={workbench.setProjectApiBaseUrl}
          onTokenChange={workbench.setProjectToken}
          onConnect={() => void workbench.connectProject()}
          onClose={workbench.closeAddProject}
        />
      )}

      {analysisModalIssue && (
        <IssueAnalysisOverlay
          issue={analysisModalIssue}
          analysis={entityAnalysis.issueAnalysisById[analysisModalIssue.id]?.result}
          traceItems={entityAnalysis.issueAnalysisTraceById[analysisModalIssue.id] ?? []}
          loading={entityAnalysis.analyzingIssueId === analysisModalIssue.id}
          error={entityAnalysis.issueAnalysisError}
          onRetry={() => void entityAnalysis.analyzeIssue(analysisModalIssue)}
          onClose={() => {
            entityAnalysis.setAnalysisModalIssueId(null);
            entityAnalysis.setIssueAnalysisError(null);
          }}
        />
      )}

      {analysisModalPr && (
        <PRAnalysisOverlay
          pr={analysisModalPr}
          analysis={entityAnalysis.prAnalysisById[analysisModalPr.id]?.result}
          traceItems={entityAnalysis.prAnalysisTraceById[analysisModalPr.id] ?? []}
          loading={entityAnalysis.analyzingPrId === analysisModalPr.id}
          error={entityAnalysis.prAnalysisError}
          onRetry={() => void entityAnalysis.analyzePr(analysisModalPr)}
          onClose={() => {
            entityAnalysis.setAnalysisModalPrId(null);
            entityAnalysis.setPrAnalysisError(null);
          }}
        />
      )}

      {analysisModalRun && (
        <CIAnalysisOverlay
          run={analysisModalRun}
          analysis={entityAnalysis.ciAnalysisById[analysisModalRun.id]?.result}
          traceItems={entityAnalysis.ciAnalysisTraceById[analysisModalRun.id] ?? []}
          loading={entityAnalysis.analyzingRunId === analysisModalRun.id}
          error={entityAnalysis.ciAnalysisError}
          onRetry={() => void entityAnalysis.analyzeCi(analysisModalRun)}
          onClose={() => {
            entityAnalysis.setAnalysisModalRunId(null);
            entityAnalysis.setCiAnalysisError(null);
          }}
        />
      )}
    </div>
  );
}
