import { useCallback, useState } from "react";

import { apiPostStream } from "@/lib/api";
import { getFriendlyError } from "@/lib/errors";

import type {
  CIAnalysisResponse,
  Issue,
  IssueAnalysisResponse,
  IssueAnalysisTraceItem,
  PRAnalysisResponse,
  PullRequest,
  WorkflowRun
} from "./types";

export function useEntityAnalysis({
  conversationId,
  isDraftConversation
}: {
  conversationId: string | undefined;
  isDraftConversation: boolean;
}) {
  const [issueAnalysisById, setIssueAnalysisById] = useState<Record<string, IssueAnalysisResponse>>({});
  const [issueAnalysisTraceById, setIssueAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalIssueId, setAnalysisModalIssueId] = useState<string | null>(null);
  const [analyzingIssueId, setAnalyzingIssueId] = useState<string | null>(null);
  const [issueAnalysisError, setIssueAnalysisError] = useState<string | null>(null);

  const [prAnalysisById, setPrAnalysisById] = useState<Record<string, PRAnalysisResponse>>({});
  const [prAnalysisTraceById, setPrAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalPrId, setAnalysisModalPrId] = useState<string | null>(null);
  const [analyzingPrId, setAnalyzingPrId] = useState<string | null>(null);
  const [prAnalysisError, setPrAnalysisError] = useState<string | null>(null);

  const [ciAnalysisById, setCiAnalysisById] = useState<Record<string, CIAnalysisResponse>>({});
  const [ciAnalysisTraceById, setCiAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalRunId, setAnalysisModalRunId] = useState<string | null>(null);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [ciAnalysisError, setCiAnalysisError] = useState<string | null>(null);

  const closeAllAnalysisModals = useCallback(() => {
    setAnalysisModalIssueId(null);
    setIssueAnalysisError(null);
    setAnalysisModalPrId(null);
    setPrAnalysisError(null);
    setAnalysisModalRunId(null);
    setCiAnalysisError(null);
  }, []);

  const analyzeIssue = useCallback(
    async (issue: Issue) => {
      setAnalysisModalIssueId(issue.id);
      setIssueAnalysisError(null);
      setIssueAnalysisById((items) => {
        const next = { ...items };
        delete next[issue.id];
        return next;
      });
      setIssueAnalysisTraceById((items) => ({
        ...items,
        [issue.id]: [
          {
            id: `${Date.now()}-start`,
            kind: "step",
            title: "准备分析",
            content: `准备分析 Issue #${issue.number}，将流式展示可见的分析过程。`,
            status: "running"
          }
        ]
      }));
      setAnalyzingIssueId(issue.id);
      try {
        const conversationQuery = conversationId && !isDraftConversation ? `?conversation_id=${conversationId}` : "";
        await apiPostStream(
          `/api/issues/${issue.id}/analyze/stream${conversationQuery}`,
          {},
          (event, data) => {
            if (event === "trace") {
              const payload = data as Omit<IssueAnalysisTraceItem, "id">;
              const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
              setIssueAnalysisTraceById((items) => ({
                ...items,
                [issue.id]: [...(items[issue.id] ?? []), item]
              }));
              return;
            }
            if (event === "thinking_delta") {
              const payload = data as { content?: string };
              const content = payload.content ?? "";
              if (!content) return;
              setIssueAnalysisTraceById((items) => {
                const current = items[issue.id] ?? [];
                const last = current[current.length - 1];
                if (last?.kind === "thinking" && last.status === "running") {
                  return {
                    ...items,
                    [issue.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                  };
                }
                return {
                  ...items,
                  [issue.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-${Math.random()}`,
                      kind: "thinking",
                      title: "LLM 公开分析过程",
                      content,
                      status: "running"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "final") {
              const result = data as IssueAnalysisResponse;
              setIssueAnalysisById((items) => ({ ...items, [issue.id]: result }));
              setIssueAnalysisTraceById((items) => {
                const current = (items[issue.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
                return {
                  ...items,
                  [issue.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-final`,
                      kind: "result",
                      title: "分析完成",
                      content: `已生成结构化结论：${result.result.conclusion}，优先级 ${result.result.priority}，复杂度 ${result.result.complexity}。`,
                      status: "done"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "error") {
              const payload = data as { message?: string };
              const errMessage = payload.message || "分析失败";
              setIssueAnalysisError(errMessage);
              setIssueAnalysisTraceById((items) => ({
                ...items,
                [issue.id]: [
                  ...(items[issue.id] ?? []),
                  { id: `${Date.now()}-error`, kind: "error", title: "分析失败", content: errMessage, status: "error" }
                ]
              }));
            }
          }
        );
      } catch (error) {
        setIssueAnalysisError(getFriendlyError(error));
        setIssueAnalysisTraceById((items) => ({
          ...items,
          [issue.id]: [
            ...(items[issue.id] ?? []),
            { id: `${Date.now()}-error`, kind: "error", title: "请求失败", content: getFriendlyError(error), status: "error" }
          ]
        }));
      } finally {
        setAnalyzingIssueId((current) => (current === issue.id ? null : current));
      }
    },
    [conversationId, isDraftConversation]
  );

  const analyzePr = useCallback(
    async (pr: PullRequest) => {
      setAnalysisModalPrId(pr.id);
      setPrAnalysisError(null);
      setPrAnalysisById((items) => {
        const next = { ...items };
        delete next[pr.id];
        return next;
      });
      setPrAnalysisTraceById((items) => ({
        ...items,
        [pr.id]: [
          {
            id: `${Date.now()}-start`,
            kind: "step",
            title: "准备分析",
            content: `准备分析 PR #${pr.number}，将按 plan-and-execute 方式展示 Review 计划、执行过程和合入建议。`,
            status: "running"
          }
        ]
      }));
      setAnalyzingPrId(pr.id);
      try {
        const conversationQuery = conversationId && !isDraftConversation ? `?conversation_id=${conversationId}` : "";
        await apiPostStream(
          `/api/pull-requests/${pr.id}/analyze/stream${conversationQuery}`,
          {},
          (event, data) => {
            if (event === "trace") {
              const payload = data as Omit<IssueAnalysisTraceItem, "id">;
              const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
              setPrAnalysisTraceById((items) => ({
                ...items,
                [pr.id]: [...(items[pr.id] ?? []), item]
              }));
              return;
            }
            if (event === "thinking_delta") {
              const payload = data as { content?: string };
              const content = payload.content ?? "";
              if (!content) return;
              setPrAnalysisTraceById((items) => {
                const current = items[pr.id] ?? [];
                const last = current[current.length - 1];
                if (last?.kind === "thinking" && last.status === "running") {
                  return {
                    ...items,
                    [pr.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                  };
                }
                return {
                  ...items,
                  [pr.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-${Math.random()}`,
                      kind: "thinking",
                      title: "LLM 公开执行过程",
                      content,
                      status: "running"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "final") {
              const result = data as PRAnalysisResponse;
              setPrAnalysisById((items) => ({ ...items, [pr.id]: result }));
              setPrAnalysisTraceById((items) => {
                const current = (items[pr.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
                return {
                  ...items,
                  [pr.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-final`,
                      kind: "result",
                      title: "分析完成",
                      content: `已生成 PR 合入建议：${result.result.merge_recommendation}，风险点 ${(result.result.risk_points ?? []).length} 个，阻塞项 ${(result.result.blocking_issues ?? []).length} 个。`,
                      status: "done"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "error") {
              const payload = data as { message?: string };
              const errMessage = payload.message || "分析失败";
              setPrAnalysisError(errMessage);
              setPrAnalysisTraceById((items) => ({
                ...items,
                [pr.id]: [
                  ...(items[pr.id] ?? []),
                  { id: `${Date.now()}-error`, kind: "error", title: "分析失败", content: errMessage, status: "error" }
                ]
              }));
            }
          }
        );
      } catch (error) {
        setPrAnalysisError(getFriendlyError(error));
        setPrAnalysisTraceById((items) => ({
          ...items,
          [pr.id]: [
            ...(items[pr.id] ?? []),
            { id: `${Date.now()}-error`, kind: "error", title: "请求失败", content: getFriendlyError(error), status: "error" }
          ]
        }));
      } finally {
        setAnalyzingPrId((current) => (current === pr.id ? null : current));
      }
    },
    [conversationId, isDraftConversation]
  );

  const analyzeCi = useCallback(
    async (run: WorkflowRun) => {
      setAnalysisModalRunId(run.id);
      setCiAnalysisError(null);
      setCiAnalysisById((items) => {
        const next = { ...items };
        delete next[run.id];
        return next;
      });
      setCiAnalysisTraceById((items) => ({
        ...items,
        [run.id]: [
          {
            id: `${Date.now()}-start`,
            kind: "step",
            title: "准备排查",
            content: `准备排查 CI「${run.name}」，将按 plan-and-execute 方式展示排查计划、执行过程、根因和阻塞判断。`,
            status: "running"
          }
        ]
      }));
      setAnalyzingRunId(run.id);
      try {
        const conversationQuery = conversationId && !isDraftConversation ? `?conversation_id=${conversationId}` : "";
        await apiPostStream(
          `/api/workflow-runs/${run.id}/analyze/stream${conversationQuery}`,
          {},
          (event, data) => {
            if (event === "trace") {
              const payload = data as Omit<IssueAnalysisTraceItem, "id">;
              const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
              setCiAnalysisTraceById((items) => ({
                ...items,
                [run.id]: [...(items[run.id] ?? []), item]
              }));
              return;
            }
            if (event === "thinking_delta") {
              const payload = data as { content?: string };
              const content = payload.content ?? "";
              if (!content) return;
              setCiAnalysisTraceById((items) => {
                const current = items[run.id] ?? [];
                const last = current[current.length - 1];
                if (last?.kind === "thinking" && last.status === "running") {
                  return {
                    ...items,
                    [run.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                  };
                }
                return {
                  ...items,
                  [run.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-${Math.random()}`,
                      kind: "thinking",
                      title: "LLM 公开排查过程",
                      content,
                      status: "running"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "final") {
              const result = data as CIAnalysisResponse;
              setCiAnalysisById((items) => ({ ...items, [run.id]: result }));
              setCiAnalysisTraceById((items) => {
                const current = (items[run.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
                return {
                  ...items,
                  [run.id]: [
                    ...current,
                    {
                      id: `${Date.now()}-final`,
                      kind: "result",
                      title: "排查完成",
                      content: `已生成 CI 根因判断：${result.result.failure_type}；${result.result.is_merge_blocking ? "阻塞合并" : "不阻塞合并"}。`,
                      status: "done"
                    }
                  ]
                };
              });
              return;
            }
            if (event === "error") {
              const payload = data as { message?: string };
              const errMessage = payload.message || "分析失败";
              setCiAnalysisError(errMessage);
              setCiAnalysisTraceById((items) => ({
                ...items,
                [run.id]: [
                  ...(items[run.id] ?? []),
                  { id: `${Date.now()}-error`, kind: "error", title: "排查失败", content: errMessage, status: "error" }
                ]
              }));
            }
          }
        );
      } catch (error) {
        setCiAnalysisError(getFriendlyError(error));
        setCiAnalysisTraceById((items) => ({
          ...items,
          [run.id]: [
            ...(items[run.id] ?? []),
            { id: `${Date.now()}-error`, kind: "error", title: "请求失败", content: getFriendlyError(error), status: "error" }
          ]
        }));
      } finally {
        setAnalyzingRunId((current) => (current === run.id ? null : current));
      }
    },
    [conversationId, isDraftConversation]
  );

  return {
    issueAnalysisById,
    issueAnalysisTraceById,
    analysisModalIssueId,
    analyzingIssueId,
    issueAnalysisError,
    setAnalysisModalIssueId,
    setIssueAnalysisError,
    prAnalysisById,
    prAnalysisTraceById,
    analysisModalPrId,
    analyzingPrId,
    prAnalysisError,
    setAnalysisModalPrId,
    setPrAnalysisError,
    ciAnalysisById,
    ciAnalysisTraceById,
    analysisModalRunId,
    analyzingRunId,
    ciAnalysisError,
    setAnalysisModalRunId,
    setCiAnalysisError,
    closeAllAnalysisModals,
    analyzeIssue,
    analyzePr,
    analyzeCi
  };
}
