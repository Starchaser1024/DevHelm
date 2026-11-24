import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatFeedbackRecord } from "@/components/feedback-controls";
import { apiGet, apiPost, apiPostStream } from "@/lib/api";
import { getFriendlyError } from "@/lib/errors";

import {
  finalizedTraceItems,
  makeToolResultTrace,
  makeToolUseTrace,
  summarizeConversationTitle,
  traceItemsFromAgentEvents
} from "./formatters";
import type {
  ChatHistoryMessage,
  ChatMessage,
  ChatPlanResponse,
  ChatStreamDelta,
  ChatStreamFinal,
  ChatStreamToolResult,
  ChatStreamToolUse,
  ChatTraceItem,
  MemoryNote,
  ProjectConversation,
  PromptRecommendationsResponse,
  PromptSuggestionState,
  Repository,
  TeamMember
} from "./types";

function welcomeMessage(repo: Repository, conversation?: ProjectConversation): ChatMessage {
  return {
    id: `welcome-${repo.id}-${conversation?.id ?? "default"}`,
    role: "assistant",
    content: `已切换到仓库 ${repo.full_name}${conversation ? ` / ${conversation.title}` : ""}。你可以直接问我 Issue、PR、CI 或周报相关问题。`
  };
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useChatSession({
  selectedRepo,
  selectedConversation,
  isDraftConversation,
  teamMembers,
  memoryNotes,
  onConversationCreated,
  onConversationUpdated,
  onWeeklyReportGenerated
}: {
  selectedRepo: Repository | undefined;
  selectedConversation: ProjectConversation | undefined;
  isDraftConversation: boolean;
  teamMembers: TeamMember[];
  memoryNotes: MemoryNote[];
  onConversationCreated: (repoId: string, conversation: ProjectConversation) => void;
  onConversationUpdated: (repoId: string) => void;
  onWeeklyReportGenerated: (repoId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [promptStateByRepo, setPromptStateByRepo] = useState<Record<string, PromptSuggestionState>>({});
  const [loadingPromptRepoId, setLoadingPromptRepoId] = useState<string | null>(null);
  const [promptLoadingDots, setPromptLoadingDots] = useState(".");

  const skipHistoryLoadRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const loadedPromptReposRef = useRef<Set<string>>(new Set());

  const selectedPromptState = selectedRepo ? promptStateByRepo[selectedRepo.id] : undefined;
  const promptSuggestions = useMemo(() => selectedPromptState?.suggestions ?? [], [selectedPromptState?.suggestions]);
  const promptExclude = useMemo(() => selectedPromptState?.exclude ?? [], [selectedPromptState?.exclude]);
  const loadingPrompts = Boolean(selectedRepo?.id && loadingPromptRepoId === selectedRepo.id);

  const loadPromptSuggestions = useCallback(async (repoId: string, exclude: string[] = []) => {
    loadedPromptReposRef.current.add(repoId);
    setLoadingPromptRepoId(repoId);
    try {
      const result = await apiPost<PromptRecommendationsResponse>("/api/chat/recommendations", {
        repo_id: repoId,
        exclude,
        limit: 5
      });
      const nextSuggestions = result.suggestions;
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            suggestions: nextSuggestions.length ? nextSuggestions : current.suggestions,
            exclude: nextSuggestions.length ? [...exclude, ...nextSuggestions] : []
          }
        };
      });
    } catch {
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            exclude
          }
        };
      });
    } finally {
      setLoadingPromptRepoId((current) => (current === repoId ? null : current));
    }
  }, []);

  const clearRepoPromptState = useCallback((repoId: string) => {
    loadedPromptReposRef.current.delete(repoId);
    setPromptStateByRepo((items) => {
      const next = { ...items };
      delete next[repoId];
      return next;
    });
  }, []);

  const loadChatHistory = useCallback(async (repo: Repository, conversation: ProjectConversation) => {
    async function loadCompleteHistory() {
      const pageSize = 500;
      const history: ChatHistoryMessage[] = [];
      let beforeMessageId: string | undefined;
      while (true) {
        const cursor = beforeMessageId ? `&before_message_id=${beforeMessageId}` : "";
        const page = await apiGet<ChatHistoryMessage[]>(
          `/api/chat/history?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=${pageSize}${cursor}`
        );
        history.unshift(...page);
        if (page.length < pageSize) break;
        const nextCursor = page[0]?.id;
        if (!nextCursor || nextCursor === beforeMessageId) break;
        beforeMessageId = nextCursor;
      }
      return history;
    }

    const [history, feedbackRows] = await Promise.all([
      loadCompleteHistory(),
      apiGet<ChatFeedbackRecord[]>(`/api/chat/feedback?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=200`)
    ]);
    if (!history.length) {
      setMessages([welcomeMessage(repo, conversation)]);
      return;
    }
    const feedbackByMessage = new Map(feedbackRows.map((item) => [item.assistant_message_id, item]));
    setMessages(
      history
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({
          id: item.id,
          messageId: item.id,
          role: item.role,
          content: item.content,
          route: item.route ?? undefined,
          toolCalls: item.tool_calls ?? [],
          traceItems: traceItemsFromAgentEvents(item.agent_events ?? []),
          traceCollapsed: true,
          compressionStats: item.compression_stats,
          progressiveCompaction: item.progressive_compaction,
          modelUsage: item.model_usage,
          contextDiagnostics: item.context_diagnostics,
          contextCollapsed: true,
          responsePending: false,
          feedback: feedbackByMessage.get(item.id)
        }))
    );
  }, []);

  useEffect(() => {
    if (selectedRepo?.id) {
      if (!loadedPromptReposRef.current.has(selectedRepo.id)) {
        loadPromptSuggestions(selectedRepo.id).catch(() => undefined);
      }
    } else {
      setMessages([]);
    }
  }, [selectedRepo?.id, loadPromptSuggestions]);

  useEffect(() => {
    if (!loadingPrompts) {
      setPromptLoadingDots(".");
      return;
    }
    const timer = window.setInterval(() => {
      setPromptLoadingDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 360);
    return () => window.clearInterval(timer);
  }, [loadingPrompts]);

  useEffect(() => {
    if (isDraftConversation) return;
    if (skipHistoryLoadRef.current) {
      skipHistoryLoadRef.current = false;
      return;
    }
    if (selectedRepo && selectedConversation) {
      loadChatHistory(selectedRepo, selectedConversation).catch(() => setMessages([welcomeMessage(selectedRepo, selectedConversation)]));
    }
  }, [selectedRepo, selectedConversation, isDraftConversation, loadChatHistory]);

  async function refreshPromptSuggestions() {
    if (!selectedRepo || loadingPrompts) return;
    await loadPromptSuggestions(selectedRepo.id, promptExclude);
  }

  function stopAgentResponse() {
    streamAbortRef.current?.abort();
  }

  function markAssistantStopped(assistantId: string) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const content = item.content.trim() ? `${item.content.trim()}\n\n已停止响应。` : "已停止响应。";
        return { ...item, content, responsePending: false, traceCollapsed: true };
      })
    );
  }

  function appendAssistantTrace(assistantId: string, traceItem: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) =>
        item.id === assistantId
          ? { ...item, traceItems: [...(item.traceItems ?? []), traceItem], traceCollapsed: false, responsePending: true }
          : item
      )
    );
  }

  function updateAssistantToolTrace(assistantId: string, result: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const traceItems = item.traceItems ?? [];
        const existingIndex = result.toolUseId ? traceItems.findIndex((trace) => trace.toolUseId === result.toolUseId) : -1;
        if (existingIndex < 0) {
          return { ...item, traceItems: [...traceItems, result], traceCollapsed: false, responsePending: true };
        }
        return {
          ...item,
          traceCollapsed: false,
          responsePending: true,
          traceItems: traceItems.map((trace, index) =>
            index === existingIndex ? { ...trace, ...result, id: trace.id } : trace
          )
        };
      })
    );
  }

  function toggleAssistantTrace(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, traceCollapsed: !item.traceCollapsed } : item
      )
    );
  }

  function toggleContextDiagnostics(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, contextCollapsed: !item.contextCollapsed } : item
      )
    );
  }

  function saveMessageFeedback(chatItemId: string, feedback: ChatFeedbackRecord) {
    setMessages((current) =>
      current.map((chatItem) => (chatItem.id === chatItemId ? { ...chatItem, feedback } : chatItem))
    );
  }

  function resetComposerAndMessages() {
    setMessages([]);
    setMessage("");
  }

  function recentChatHistory() {
    return messages
      .filter((item) => !item.id.startsWith("welcome-") && item.content.trim())
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));
  }

  function chatRequestContext(chatHistory: Array<{ role: string; content: string }>) {
    return {
      time_range: "7d",
      messages: chatHistory,
      team_members: teamMembers.map(({ name, role, strengths, techStack }) => ({ name, role, strengths, techStack })),
      project_memory: memoryNotes.map(({ title, content }) => ({ title, content }))
    };
  }

  async function ensureActiveConversation(initialMessage: string) {
    if (!selectedRepo) return null;
    let activeConversation = selectedConversation;
    if (!activeConversation) {
      activeConversation = await apiPost<ProjectConversation>(`/api/repos/${selectedRepo.id}/conversations`, {
        title: summarizeConversationTitle(initialMessage)
      });
      skipHistoryLoadRef.current = true;
      onConversationCreated(selectedRepo.id, activeConversation);
    }
    return activeConversation;
  }

  async function askAgent(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmedText };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [...items, userMessage]);
    setMessage("");
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    try {
      setMessages((items) => [
        ...items,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          traceCollapsed: false,
          responsePending: true
        }
      ]);
      await apiPostStream(
        "/api/chat/stream",
        {
          repo_id: selectedRepo.id,
          conversation_id: activeConversation.id,
          message: trimmedText,
          context: chatRequestContext(chatHistory)
        },
        (event, rawData) => {
          if (event === "thought") {
            const data = rawData as { content?: string };
            if (data.content?.trim()) {
              appendAssistantTrace(assistantId, {
                id: crypto.randomUUID(),
                kind: "thinking",
                title: "公开思路",
                content: data.content,
                status: "done"
              });
            }
            return;
          }
          if (event === "tool_use") {
            appendAssistantTrace(assistantId, makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()));
            return;
          }
          if (event === "tool_result") {
            updateAssistantToolTrace(assistantId, makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()));
            return;
          }
          if (event === "delta") {
            const data = rawData as ChatStreamDelta;
            if (!data.content) return;
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId ? { ...item, content: item.content + data.content, responsePending: true } : item
              )
            );
            return;
          }
          if (event === "final") {
            const data = rawData as ChatStreamFinal;
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: data.answer,
                      route: data.route,
                      toolCalls: data.tool_calls,
                      traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                      compressionStats: data.compression_stats,
                      progressiveCompaction: data.progressive_compaction,
                      modelUsage: data.model_usage,
                      contextDiagnostics: data.context_diagnostics,
                      messageId: data.message_id,
                      contextCollapsed: true,
                      traceCollapsed: true,
                      responsePending: false
                    }
                  : item
              )
            );
            if (data.route === "weekly_report") {
              onWeeklyReportGenerated(selectedRepo.id);
            }
            onConversationUpdated(selectedRepo.id);
          }
        },
        { signal: abortController.signal }
      );
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(assistantId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId ? { ...item, content: `请求失败：${getFriendlyError(error)}`, responsePending: false, traceCollapsed: true } : item
        )
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId ? { ...item, traceCollapsed: true, responsePending: false } : item
        )
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  async function createWorkflowPlan(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmedText };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [
      ...items,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "正在创建执行计划...",
        route: "engineering_plan",
        traceCollapsed: false,
        responsePending: true
      }
    ]);
    setMessage("");
    setLoading(true);
    try {
      const data = await apiPost<ChatPlanResponse>("/api/chat/plan", {
        repo_id: selectedRepo.id,
        conversation_id: activeConversation.id,
        message: trimmedText,
        context: chatRequestContext(chatHistory)
      });
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: data.answer,
                route: data.route,
                toolCalls: data.tool_calls,
                traceItems: traceItemsFromAgentEvents(data.agent_events ?? []),
                workflowPlan: data.plan,
                planSourceMessage: trimmedText,
                planStatus: "ready",
                traceCollapsed: true,
                responsePending: false
              }
            : item
        )
      );
      onConversationUpdated(selectedRepo.id);
    } catch (error) {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: `创建计划失败：${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true
              }
            : item
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function executeWorkflowPlan(messageId: string) {
    if (!selectedRepo || loading) return;
    const planMessage = messages.find((item) => item.id === messageId);
    const workflowPlan = planMessage?.workflowPlan;
    const sourceMessage = planMessage?.planSourceMessage;
    if (!workflowPlan || !sourceMessage) return;
    const activeConversation = await ensureActiveConversation(sourceMessage);
    if (!activeConversation) return;

    const chatHistory = recentChatHistory();
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId
          ? {
              ...item,
              content: "",
              route: "engineering_workflow",
              traceItems: [],
              traceCollapsed: false,
              responsePending: true,
              planStatus: "executing"
            }
          : item
      )
    );
    try {
      await apiPostStream(
        "/api/chat/plan/execute/stream",
        {
          repo_id: selectedRepo.id,
          conversation_id: activeConversation.id,
          message: sourceMessage,
          workflow_spec: workflowPlan,
          context: chatRequestContext(chatHistory)
        },
        (event, rawData) => {
          if (event === "tool_use") {
            appendAssistantTrace(messageId, makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()));
            return;
          }
          if (event === "tool_result") {
            updateAssistantToolTrace(messageId, makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()));
            return;
          }
          if (event === "delta") {
            const data = rawData as ChatStreamDelta;
            if (!data.content) return;
            setMessages((items) =>
              items.map((item) =>
                item.id === messageId ? { ...item, content: item.content + data.content, responsePending: true } : item
              )
            );
            return;
          }
          if (event === "final") {
            const data = rawData as ChatStreamFinal;
            setMessages((items) =>
              items.map((item) =>
                item.id === messageId
                  ? {
                      ...item,
                      content: data.answer,
                      route: data.route,
                      toolCalls: data.tool_calls,
                      traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                      messageId: data.message_id,
                      traceCollapsed: true,
                      responsePending: false,
                      planStatus: data.route === "error" ? "error" : "done"
                    }
                  : item
              )
            );
            onConversationUpdated(selectedRepo.id);
          }
        },
        { signal: abortController.signal }
      );
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(messageId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId
            ? {
                ...item,
                content: `执行计划失败：${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true
              }
            : item
        )
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId ? { ...item, traceCollapsed: true, responsePending: false } : item
        )
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  return {
    message,
    setMessage,
    messages,
    loading,
    planMode,
    setPlanMode,
    promptSuggestions,
    loadingPrompts,
    promptLoadingDots,
    loadPromptSuggestions,
    clearRepoPromptState,
    refreshPromptSuggestions,
    resetComposerAndMessages,
    askAgent,
    createWorkflowPlan,
    executeWorkflowPlan,
    stopAgentResponse,
    toggleAssistantTrace,
    toggleContextDiagnostics,
    saveMessageFeedback
  };
}
