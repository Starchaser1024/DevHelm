import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { apiDelete, apiGet, apiPost, apiUpload } from "@/lib/api";
import { getFriendlyError } from "@/lib/errors";

import {
  classifyIssue,
  isDraftConversationId,
  makeDraftConversationId,
  matchesOwner,
  matchesQuery,
  matchesStatus,
  matchesTime,
  parseRepositoryInput,
  wait
} from "./formatters";
import {
  knowledgeGraphNodeKey,
  openGraphNodeInWorkspace,
  workspaceSelectionToGraphCenter
} from "./graph-helpers";
import type {
  AddProjectSource,
  AddProjectStatus,
  ConversationDeleteResult,
  Issue,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
  KnowledgeItem,
  McpRuntime,
  MemoryNote,
  MemoryNoteDraft,
  ProjectConversation,
  ProjectIndexState,
  PullRequest,
  RepoConnectResult,
  Repository,
  SkillResponse,
  TeamMember,
  TeamMemberDraft,
  WorkflowRun,
  WorkspaceSelection,
  WorkspaceTab
} from "./types";
import { useChatSession } from "./use-chat-session";

export function useWorkbenchController() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [conversationMap, setConversationMap] = useState<Record<string, ProjectConversation[]>>({});
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("Issue");
  const [workspaceWidth, setWorkspaceWidth] = useState(420);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("all");
  const [workspaceOwner, setWorkspaceOwner] = useState("all");
  const [workspaceTime, setWorkspaceTime] = useState("all");
  const [selectedWorkspaceItem, setSelectedWorkspaceItem] = useState<WorkspaceSelection | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [memberDraft, setMemberDraft] = useState<TeamMemberDraft>({ name: "", role: "", strengths: "", techStack: "" });
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<MemoryNoteDraft>({ title: "", content: "" });
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);
  const [mcpRuntime, setMcpRuntime] = useState<McpRuntime | null>(null);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [selectedSkillName, setSelectedSkillName] = useState("project-investigation");
  const [skillRuntimeLoading, setSkillRuntimeLoading] = useState(false);
  const [skillRuntimeError, setSkillRuntimeError] = useState<string | null>(null);
  const [projectIndexByRepo, setProjectIndexByRepo] = useState<Record<string, ProjectIndexState>>({});
  const [indexScanningRepoId, setIndexScanningRepoId] = useState<string | null>(null);
  const [indexActionError, setIndexActionError] = useState<string | null>(null);
  const [knowledgeGraphByRepo, setKnowledgeGraphByRepo] = useState<Record<string, KnowledgeGraphResponse | null>>({});
  const [graphLoadingRepoId, setGraphLoadingRepoId] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphQuery, setGraphQuery] = useState("");
  const [selectedGraphNodeKey, setSelectedGraphNodeKey] = useState<string | null>(null);
  const [hiddenGraphNodeTypes, setHiddenGraphNodeTypes] = useState<Record<string, boolean>>({});
  const [hiddenGraphRelations, setHiddenGraphRelations] = useState<Record<string, boolean>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [projectSource, setProjectSource] = useState<AddProjectSource>("remote");
  const [projectUrl, setProjectUrl] = useState("");
  const [projectLocalPath, setProjectLocalPath] = useState("");
  const [projectCloneParentDir, setProjectCloneParentDir] = useState("");
  const [projectProvider, setProjectProvider] = useState("github");
  const [projectApiBaseUrl, setProjectApiBaseUrl] = useState("https://api.github.com");
  const [projectToken, setProjectToken] = useState("");
  const [addProjectStatus, setAddProjectStatus] = useState<AddProjectStatus | null>(null);
  const [connectingProject, setConnectingProject] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionError, setActionError] = useState<{ title: string; detail: string } | null>(null);

  const preserveWorkspaceSelectionRef = useRef(false);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId) ?? repos[0], [repos, selectedRepoId]);
  const selectedRepoConversations = useMemo(
    () => (selectedRepo ? conversationMap[selectedRepo.id] ?? [] : []),
    [selectedRepo, conversationMap]
  );
  const isDraftConversation = isDraftConversationId(selectedConversationId);
  const selectedConversation = isDraftConversation
    ? undefined
    : selectedRepoConversations.find((item) => item.id === selectedConversationId) ?? selectedRepoConversations[0];
  const selectedProjectIndexState = selectedRepo ? projectIndexByRepo[selectedRepo.id] : undefined;
  const selectedKnowledgeGraph = selectedRepo ? knowledgeGraphByRepo[selectedRepo.id] ?? null : null;

  const loadRepos = useCallback(async () => {
    const items = await apiGet<Repository[]>("/api/repos");
    setRepos(items);
    const pairs = await Promise.all(
      items.map(async (repo) => [repo.id, await apiGet<ProjectConversation[]>(`/api/repos/${repo.id}/conversations`).catch(() => [])] as const)
    );
    const nextMap = Object.fromEntries(pairs);
    setConversationMap(nextMap);
    setExpandedRepoIds((current) => {
      const firstRepoId = items[0]?.id;
      return firstRepoId && Object.keys(current).length === 0 ? { [firstRepoId]: true } : current;
    });
    setSelectedRepoId((current) => current || items[0]?.id || "");
    setSelectedConversationId((current) => current || (items[0] ? nextMap[items[0].id]?.[0]?.id ?? "" : ""));
  }, []);

  const loadRepoConversations = useCallback(async (repoId: string) => {
    const conversations = await apiGet<ProjectConversation[]>(`/api/repos/${repoId}/conversations`).catch(() => []);
    setConversationMap((items) => ({ ...items, [repoId]: conversations }));
    return conversations;
  }, []);

  const loadRepoData = useCallback(async (repoId: string) => {
    const [issueItems, prItems, runItems] = await Promise.all([
      apiGet<Issue[]>(`/api/repos/${repoId}/issues`).catch(() => []),
      apiGet<PullRequest[]>(`/api/repos/${repoId}/pull-requests`).catch(() => []),
      apiGet<WorkflowRun[]>(`/api/repos/${repoId}/workflow-runs`).catch(() => [])
    ]);
    setIssues(issueItems);
    setPrs(prItems);
    setRuns(runItems);
  }, []);

  const loadSkillRuntime = useCallback(async () => {
    setSkillRuntimeLoading(true);
    setSkillRuntimeError(null);
    try {
      const [skillList, runtime] = await Promise.all([
        apiGet<{ skills: SkillResponse[] }>("/api/skills"),
        apiGet<McpRuntime>("/api/skills/mcp-status")
      ]);
      setSkills(skillList.skills);
      setMcpRuntime(runtime);
      setSelectedSkillName((current) =>
        skillList.skills.some((item) => item.manifest.name === current)
          ? current
          : skillList.skills[0]?.manifest.name ?? ""
      );
    } catch (error) {
      setSkillRuntimeError(getFriendlyError(error));
    } finally {
      setSkillRuntimeLoading(false);
    }
  }, []);

  const loadProjectKnowledge = useCallback(async (repoId: string) => {
    const [members, knowledge] = await Promise.all([
      apiGet<TeamMember[]>(`/api/repos/${repoId}/team-members`).catch(() => []),
      apiGet<KnowledgeItem[]>(`/api/repos/${repoId}/knowledge`).catch(() => [])
    ]);
    setTeamMembers(members);
    setKnowledgeItems(knowledge);
    setMemoryNotes(
      knowledge
        .filter((item) => item.source_type === "memory_note")
        .map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content_preview
        }))
    );
  }, []);

  const loadProjectIndexState = useCallback(async (repoId: string) => {
    const state = await apiGet<ProjectIndexState>(`/api/repos/${repoId}/memory-index/state`).catch(() => null);
    if (state) {
      setProjectIndexByRepo((items) => ({ ...items, [repoId]: state }));
    }
    return state;
  }, []);

  const loadKnowledgeGraph = useCallback(async (repoId: string, center?: { type: string; id: string }) => {
    setGraphLoadingRepoId(repoId);
    setGraphError(null);
    try {
      const params = new URLSearchParams({ depth: "1" });
      if (center?.type && center.id) {
        params.set("center_type", center.type);
        params.set("center_id", center.id);
      }
      const graph = await apiGet<KnowledgeGraphResponse>(`/api/repos/${repoId}/knowledge/graph?${params.toString()}`);
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: graph }));
      const preferred = center ? graph.nodes.find((node) => node.type === center.type && node.id === center.id) : graph.nodes[0];
      setSelectedGraphNodeKey(preferred ? knowledgeGraphNodeKey(preferred) : null);
      return graph;
    } catch (error) {
      setGraphError(getFriendlyError(error));
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: null }));
      return null;
    } finally {
      setGraphLoadingRepoId((current) => (current === repoId ? null : current));
    }
  }, []);

  const handleConversationCreated = useCallback((repoId: string, conversation: ProjectConversation) => {
    setConversationMap((items) => {
      const existing = items[repoId] ?? [];
      return {
        ...items,
        [repoId]: [conversation, ...existing.filter((item) => item.id !== conversation.id)]
      };
    });
    setExpandedRepoIds((items) => ({ ...items, [repoId]: true }));
    setSelectedConversationId(conversation.id);
  }, []);

  const handleConversationUpdated = useCallback(
    (repoId: string) => {
      void loadRepoConversations(repoId);
    },
    [loadRepoConversations]
  );

  const handleWeeklyReportGenerated = useCallback(
    (repoId: string) => {
      void loadProjectKnowledge(repoId);
    },
    [loadProjectKnowledge]
  );

  const chatSession = useChatSession({
    selectedRepo,
    selectedConversation,
    isDraftConversation,
    teamMembers,
    memoryNotes,
    onConversationCreated: handleConversationCreated,
    onConversationUpdated: handleConversationUpdated,
    onWeeklyReportGenerated: handleWeeklyReportGenerated
  });

  useEffect(() => {
    loadRepos().catch(() => setRepos([]));
  }, [loadRepos]);

  useEffect(() => {
    if (workspaceTab === "技能&MCP" && !mcpRuntime && !skillRuntimeLoading) {
      void loadSkillRuntime();
    }
  }, [workspaceTab, mcpRuntime, skillRuntimeLoading, loadSkillRuntime]);

  useEffect(() => {
    if (selectedRepo?.id) {
      void loadRepoData(selectedRepo.id);
      void loadProjectKnowledge(selectedRepo.id);
      void loadProjectIndexState(selectedRepo.id);
      void loadKnowledgeGraph(selectedRepo.id);
    } else {
      setTeamMembers([]);
      setMemoryNotes([]);
      setKnowledgeItems([]);
      setKnowledgeGraphByRepo({});
      setSelectedGraphNodeKey(null);
    }
  }, [selectedRepo?.id, loadRepoData, loadProjectKnowledge, loadProjectIndexState, loadKnowledgeGraph]);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    if (isDraftConversation) return;
    const conversations = conversationMap[selectedRepo.id] ?? [];
    if (conversations.length === 0) {
      void loadRepoConversations(selectedRepo.id).then((items) => {
        setSelectedConversationId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
      });
      return;
    }
    if (!conversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [selectedRepo?.id, conversationMap, selectedConversationId, isDraftConversation, loadRepoConversations]);

  useEffect(() => {
    setWorkspaceQuery("");
    setWorkspaceStatus("all");
    setWorkspaceOwner("all");
    setWorkspaceTime("all");
    if (preserveWorkspaceSelectionRef.current) {
      preserveWorkspaceSelectionRef.current = false;
    } else {
      setSelectedWorkspaceItem(null);
    }
    setGraphQuery("");
    setHiddenGraphNodeTypes({});
    setHiddenGraphRelations({});
    setCollapsedGroups({});
  }, [selectedRepo?.id, workspaceTab]);

  function startResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspaceWidth;

    function onMove(moveEvent: globalThis.MouseEvent) {
      const delta = startX - moveEvent.clientX;
      setWorkspaceWidth(Math.min(640, Math.max(360, startWidth + delta)));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleCategory(key: string) {
    setCollapsedGroups((items) => ({ ...items, [key]: !items[key] }));
  }

  async function selectProject(repo: Repository) {
    setActionError(null);
    setSelectedRepoId(repo.id);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: !items[repo.id] }));
    const conversations = conversationMap[repo.id]?.length ? conversationMap[repo.id] : await loadRepoConversations(repo.id);
    setSelectedConversationId((current) => (conversations.some((item) => item.id === current) ? current : conversations[0]?.id || ""));
  }

  async function selectConversation(repo: Repository, conversation: ProjectConversation) {
    setSelectedRepoId(repo.id);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedConversationId(conversation.id);
    await apiPost(`/api/repos/${repo.id}/select`, {});
  }

  function addConversation(repo: Repository) {
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedRepoId(repo.id);
    setSelectedConversationId(makeDraftConversationId(repo.id));
    chatSession.resetComposerAndMessages();
  }

  async function removeConversation(repo: Repository, conversation: ProjectConversation) {
    const confirmed = window.confirm(`确定删除会话“${conversation.title}”吗？\n\n只会删除这个会话的聊天上下文，不会删除项目知识库。`);
    if (!confirmed) return;
    const result = await apiDelete<ConversationDeleteResult>(`/api/repos/${repo.id}/conversations/${conversation.id}`);
    setConversationMap((items) => ({ ...items, [repo.id]: result.conversations }));
    if (selectedConversationId === conversation.id) {
      setSelectedRepoId(repo.id);
      setSelectedConversationId(result.active_conversation_id);
    }
  }

  async function addTeamMember() {
    if (!selectedRepo || !memberDraft.name.trim()) return;
    const created = await apiPost<TeamMember>(`/api/repos/${selectedRepo.id}/team-members`, {
      name: memberDraft.name.trim(),
      role: memberDraft.role.trim(),
      strengths: memberDraft.strengths.trim(),
      techStack: memberDraft.techStack.trim()
    });
    setTeamMembers((items) => [...items.filter((item) => item.id !== created.id), created]);
    setMemberDraft({ name: "", role: "", strengths: "", techStack: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeTeamMember(memberId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/team-members/${memberId}`);
    setTeamMembers((items) => items.filter((item) => item.id !== memberId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function addMemoryNote() {
    if (!selectedRepo || (!memoryDraft.title.trim() && !memoryDraft.content.trim())) return;
    await apiPost<KnowledgeItem>(`/api/repos/${selectedRepo.id}/knowledge/notes`, {
      title: memoryDraft.title.trim(),
      content: memoryDraft.content.trim()
    });
    setMemoryDraft({ title: "", content: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeMemoryNote(noteId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/knowledge/${noteId}?source_type=memory_note`);
    setMemoryNotes((items) => items.filter((item) => item.id !== noteId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function uploadKnowledgeFile(file: File) {
    if (!selectedRepo) return;
    setUploadingKnowledge(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiUpload(`/api/repos/${selectedRepo.id}/knowledge/upload`, formData);
      await loadProjectKnowledge(selectedRepo.id);
      await loadKnowledgeGraph(selectedRepo.id);
    } finally {
      setUploadingKnowledge(false);
    }
  }

  async function removeKnowledgeItem(item: KnowledgeItem) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/knowledge/${item.id}?source_type=${encodeURIComponent(item.source_type)}`);
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function runGuarded(title: string, action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError({ title, detail: getFriendlyError(error) });
    }
  }

  async function refreshSelectedRepo() {
    if (!selectedRepo) return;
    setSyncing(true);
    try {
      await apiPost(`/api/repos/${selectedRepo.id}/sync`, {
        sync_issues: true,
        sync_pull_requests: true,
        sync_workflow_runs: true,
        limit: 50
      });
      await Promise.all([
        loadRepos(),
        loadRepoData(selectedRepo.id),
        loadProjectKnowledge(selectedRepo.id),
        loadProjectIndexState(selectedRepo.id),
        loadKnowledgeGraph(selectedRepo.id),
        loadRepoConversations(selectedRepo.id)
      ]);
      chatSession.clearRepoPromptState(selectedRepo.id);
      await chatSession.loadPromptSuggestions(selectedRepo.id);
    } finally {
      setSyncing(false);
    }
  }

  async function rebuildSelectedKnowledgeGraph() {
    if (!selectedRepo) return;
    setGraphLoadingRepoId(selectedRepo.id);
    setGraphError(null);
    try {
      await apiPost(`/api/repos/${selectedRepo.id}/knowledge/graph/rebuild`, {});
      await loadKnowledgeGraph(selectedRepo.id);
    } catch (error) {
      setGraphError(getFriendlyError(error));
    } finally {
      setGraphLoadingRepoId((current) => (current === selectedRepo.id ? null : current));
    }
  }

  async function startProjectIndexScan() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    setIndexActionError(null);
    setIndexScanningRepoId(repoId);
    setProjectIndexByRepo((items) => ({
      ...items,
      [repoId]: {
        repo_id: repoId,
        status: "building",
        fingerprint: items[repoId]?.fingerprint ?? "",
        docs_indexed: items[repoId]?.docs_indexed ?? 0,
        docs_total: items[repoId]?.docs_total ?? 0,
        error_message: null,
        summary_json: items[repoId]?.summary_json ?? null,
        snoozed_until: null,
        last_scan_at: items[repoId]?.last_scan_at ?? null
      }
    }));
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/scan`, {});
      let latest: ProjectIndexState | null = null;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await wait(1200);
        latest = await loadProjectIndexState(repoId);
        if (!latest || latest.status !== "building") break;
      }
      if (latest?.status === "ready") {
        await loadProjectKnowledge(repoId);
        await loadKnowledgeGraph(repoId);
      }
      if (latest?.status === "failed") {
        setIndexActionError(latest.error_message || "记忆索引扫描失败");
      }
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
      await loadProjectIndexState(repoId);
    } finally {
      setIndexScanningRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function snoozeProjectIndexPrompt() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/snooze`, { days: 7 });
      await loadProjectIndexState(repoId);
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
    }
  }

  function openAddProject() {
    setIsAddProjectOpen(true);
    setAddProjectStatus(null);
  }

  function closeAddProject() {
    if (connectingProject) return;
    setIsAddProjectOpen(false);
  }

  async function connectProject() {
    const isLocalSource = projectSource === "local";
    const parsed = isLocalSource ? null : parseRepositoryInput(projectUrl);
    if (!isLocalSource && !parsed) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail: "请输入 GitHub 仓库地址，或 owner/repo 格式，例如 https://github.com/openai/codex。"
      });
      return;
    }
    if (isLocalSource && !projectLocalPath.trim()) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail: "请输入本地 Git 仓库路径。"
      });
      return;
    }

    setConnectingProject(true);
    setAddProjectStatus(null);
    try {
      const connected = await apiPost<RepoConnectResult>("/api/repos/connect", {
        owner: parsed?.owner,
        repo: parsed?.repo,
        local_path: isLocalSource ? projectLocalPath.trim() : undefined,
        clone_parent_dir: !isLocalSource && projectCloneParentDir.trim() ? projectCloneParentDir.trim() : undefined,
        provider: projectProvider,
        api_base_url: projectProvider === "github" ? undefined : projectApiBaseUrl.trim(),
        token: projectToken.trim() || undefined,
        demo_mode: false
      });
      await Promise.all([
        loadRepos(),
        loadRepoData(connected.repo_id),
        loadProjectKnowledge(connected.repo_id),
        loadProjectIndexState(connected.repo_id)
      ]);
      const conversations = await loadRepoConversations(connected.repo_id);
      setSelectedRepoId(connected.repo_id);
      setSelectedConversationId(conversations[0]?.id || "");
      setExpandedRepoIds((items) => ({ ...items, [connected.repo_id]: true }));
      setProjectUrl("");
      setProjectLocalPath("");
      setProjectCloneParentDir("");
      setProjectToken("");
      const synced = connected.synced ?? {};
      const syncDetail =
        connected.sync_status === "completed"
          ? `已同步 ${synced.issues ?? 0} 个 Issue、${synced.pull_requests ?? 0} 个 PR、${synced.workflow_runs ?? 0} 条 CI 记录`
          : connected.sync_status === "fallback"
            ? `已使用本地缓存模式连接。${connected.message}`
            : "已连接仓库";
      const codePathDetail = connected.local_path ? `代码路径：${connected.local_path}` : "代码同步和代码图分析已在后台启动";
      setAddProjectStatus({
        type: "success",
        title: "连接成功",
        detail: `${connected.full_name} 已添加为当前项目，${syncDetail}。${codePathDetail}。`
      });
    } catch (error) {
      setAddProjectStatus({
        type: "error",
        title: "连接失败",
        detail: getFriendlyError(error)
      });
    } finally {
      setConnectingProject(false);
    }
  }

  async function removeRepo(repo: Repository) {
    const confirmed = window.confirm(`确定移除项目「${repo.full_name}」吗？\n\n这会删除本地保存的项目、Issue、PR、CI、分析结果和对话记录。`);
    if (!confirmed) return;

    try {
      await apiDelete(`/api/repos/${repo.id}`);
    } catch (error) {
      window.alert(`删除项目失败：${getFriendlyError(error)}`);
      return;
    }

    const remainingRepos = repos.filter((item) => item.id !== repo.id);
    setRepos(remainingRepos);
    chatSession.clearRepoPromptState(repo.id);
    setConversationMap((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    setExpandedRepoIds((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    if (selectedRepoId === repo.id) {
      setSelectedRepoId(remainingRepos[0]?.id || "");
      setSelectedConversationId(remainingRepos[0] ? conversationMap[remainingRepos[0].id]?.[0]?.id || "" : "");
      setIssues([]);
      setPrs([]);
      setRuns([]);
      chatSession.resetComposerAndMessages();
    }
  }

  function selectWorkspaceTab(tab: WorkspaceTab) {
    if (tab === "图谱" && selectedRepo && selectedWorkspaceItem) {
      const center = workspaceSelectionToGraphCenter(selectedWorkspaceItem);
      if (center) void loadKnowledgeGraph(selectedRepo.id, center);
    }
    setWorkspaceTab(tab);
  }

  function handleOpenGraphNode(node: KnowledgeGraphNode) {
    openGraphNodeInWorkspace(node, setWorkspaceTab, setSelectedWorkspaceItem, preserveWorkspaceSelectionRef);
  }

  const ownerOptions = useMemo(() => {
    const people = new Set<string>();
    issues.forEach((issue) => {
      issue.assignees?.forEach((assignee) => people.add(assignee));
      if (issue.author) people.add(issue.author);
    });
    prs.forEach((pr) => {
      if (pr.author) people.add(pr.author);
    });
    return Array.from(people).sort((a, b) => a.localeCompare(b));
  }, [issues, prs]);

  const filteredIssues = useMemo(
    () =>
      issues.filter((issue) => {
        const people = [...(issue.assignees ?? []), issue.author ?? ""];
        return (
          matchesQuery(workspaceQuery, [issue.title, issue.body, issue.state, ...(issue.labels ?? [])]) &&
          matchesStatus(workspaceStatus, issue.state) &&
          matchesOwner(workspaceOwner, people) &&
          matchesTime(workspaceTime, issue.updated_at ?? issue.created_at)
        );
      }),
    [issues, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const filteredPrs = useMemo(
    () =>
      prs.filter((pr) => {
        const derivedStatus = pr.merged_at ? "merged" : pr.state;
        const fileNames = pr.files?.map((file) => file.filename) ?? [];
        return (
          matchesQuery(workspaceQuery, [pr.title, pr.body, derivedStatus, pr.author, pr.base_branch, pr.head_branch, ...fileNames]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesOwner(workspaceOwner, [pr.author ?? ""]) &&
          matchesTime(workspaceTime, pr.updated_at ?? pr.created_at ?? pr.merged_at)
        );
      }),
    [prs, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        const derivedStatus = run.conclusion ?? run.status;
        return (
          matchesQuery(workspaceQuery, [run.name, run.status, run.conclusion, run.logs_text]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesTime(workspaceTime, run.updated_at ?? run.created_at)
        );
      }),
    [runs, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const openIssues = useMemo(() => issues.filter((item) => item.state === "open"), [issues]);
  const openPrs = useMemo(() => prs.filter((item) => item.state === "open"), [prs]);
  const failedRuns = useMemo(() => runs.filter((item) => item.conclusion === "failure"), [runs]);
  const mergedPrs = useMemo(() => prs.filter((item) => item.merged_at), [prs]);
  const rejectedIssues = useMemo(() => issues.filter((item) => classifyIssue(item) === "rejected"), [issues]);
  const handledIssues = useMemo(() => issues.filter((item) => ["accepted", "closed"].includes(classifyIssue(item))), [issues]);
  const selectedIssue = selectedWorkspaceItem?.type === "issue" ? issues.find((item) => item.id === selectedWorkspaceItem.id) : undefined;
  const selectedPr = selectedWorkspaceItem?.type === "pr" ? prs.find((item) => item.id === selectedWorkspaceItem.id) : undefined;
  const selectedRun = selectedWorkspaceItem?.type === "ci" ? runs.find((item) => item.id === selectedWorkspaceItem.id) : undefined;

  return {
    repos,
    selectedRepo,
    conversationMap,
    selectedConversationId,
    selectedConversation,
    isDraftConversation,
    expandedRepoIds,
    issues,
    prs,
    runs,
    filteredIssues,
    filteredPrs,
    filteredRuns,
    ownerOptions,
    openIssues,
    openPrs,
    failedRuns,
    mergedPrs,
    rejectedIssues,
    handledIssues,
    selectedIssue,
    selectedPr,
    selectedRun,
    ...chatSession,
    workspaceTab,
    selectWorkspaceTab,
    workspaceWidth,
    startResize,
    workspaceQuery,
    setWorkspaceQuery,
    workspaceStatus,
    setWorkspaceStatus,
    workspaceOwner,
    setWorkspaceOwner,
    workspaceTime,
    setWorkspaceTime,
    selectedWorkspaceItem,
    setSelectedWorkspaceItem,
    collapsedGroups,
    toggleCategory,
    teamMembers,
    memberDraft,
    setMemberDraft,
    addTeamMember,
    removeTeamMember,
    memoryNotes,
    memoryDraft,
    setMemoryDraft,
    addMemoryNote,
    removeMemoryNote,
    knowledgeItems,
    uploadingKnowledge,
    uploadKnowledgeFile,
    removeKnowledgeItem,
    loadProjectKnowledge,
    mcpRuntime,
    skills,
    selectedSkillName,
    setSelectedSkillName,
    skillRuntimeLoading,
    skillRuntimeError,
    loadSkillRuntime,
    selectedProjectIndexState,
    indexScanningRepoId,
    indexActionError,
    startProjectIndexScan,
    snoozeProjectIndexPrompt,
    selectedKnowledgeGraph,
    graphLoadingRepoId,
    graphError,
    graphQuery,
    setGraphQuery,
    selectedGraphNodeKey,
    setSelectedGraphNodeKey,
    hiddenGraphNodeTypes,
    setHiddenGraphNodeTypes,
    hiddenGraphRelations,
    setHiddenGraphRelations,
    loadKnowledgeGraph,
    rebuildSelectedKnowledgeGraph,
    handleOpenGraphNode,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isAddProjectOpen,
    openAddProject,
    closeAddProject,
    projectSource,
    setProjectSource,
    projectUrl,
    setProjectUrl,
    projectLocalPath,
    setProjectLocalPath,
    projectCloneParentDir,
    setProjectCloneParentDir,
    projectProvider,
    setProjectProvider,
    projectApiBaseUrl,
    setProjectApiBaseUrl,
    projectToken,
    setProjectToken,
    addProjectStatus,
    connectingProject,
    connectProject,
    syncing,
    refreshSelectedRepo,
    actionError,
    setActionError,
    runGuarded,
    selectProject,
    selectConversation,
    addConversation,
    removeConversation,
    removeRepo
  };
}
