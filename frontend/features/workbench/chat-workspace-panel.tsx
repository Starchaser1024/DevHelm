import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Gauge,
  ListTodo,
  RefreshCw,
  Send,
  Square
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FeedbackControls, type ChatFeedbackRecord } from "@/components/feedback-controls";

import {
  contextNumber,
  contextReasonLabel,
  contextRecord,
  contextStageLabel,
  contextString
} from "./formatters";
import { MemoryIndexPromptCard } from "./knowledge-panel";
import { MarkdownMessage } from "./markdown-message";
import type {
  ChatMessage,
  ChatTraceItem,
  ProjectConversation,
  ProjectIndexState,
  Repository,
  WorkflowPlan
} from "./types";

function WorkflowPlanCard({
  plan,
  status,
  disabled,
  onExecute
}: {
  plan: WorkflowPlan;
  status: "ready" | "executing" | "done" | "error";
  disabled: boolean;
  onExecute: () => void;
}) {
  const statusLabel = status === "executing" ? "执行中" : status === "done" ? "已执行" : status === "error" ? "执行失败" : "等待确认";
  return (
    <div className="rounded-control border border-accent-subtle bg-accent-subtle p-3 text-xs leading-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <ListTodo className="h-4 w-4 text-accent-strong" />
            <span>计划模式</span>
            <span className="rounded-control bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-2">{statusLabel}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-ink-2">{plan.goal}</div>
        </div>
        <button
          type="button"
          onClick={onExecute}
          disabled={disabled || status === "executing" || status === "done"}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control bg-accent px-3 text-xs font-medium text-white transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "executing" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          <span>{status === "done" ? "已执行" : status === "executing" ? "执行中" : "执行计划"}</span>
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {plan.tasks.map((task, index) => (
          <div key={task.id} className="rounded-control border border-accent-subtle bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                {index + 1}. {task.agent_name}
              </span>
              <span className="shrink-0 rounded-control bg-panel px-2 py-0.5 text-[11px] text-ink-2">{task.task_type}</span>
            </div>
            <div className="mt-1 text-ink-2">{task.objective}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink-2">
              {task.dependencies?.length ? <span>依赖：{task.dependencies.join(", ")}</span> : <span>无依赖</span>}
              <span>范围：{task.claim.target_type}</span>
              {task.critical && <span className="text-danger">关键任务</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextDiagnostics({
  compressionStats,
  progressiveCompaction,
  modelUsage,
  contextDiagnostics,
  collapsed,
  onToggle
}: {
  compressionStats: Record<string, unknown>;
  progressiveCompaction: Record<string, unknown>;
  modelUsage: Array<Record<string, unknown>>;
  contextDiagnostics: Record<string, unknown>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pressure = contextRecord(compressionStats.pressure);
  const rawPressure = contextRecord(compressionStats.raw_history_pressure);
  const microcompact = contextRecord(compressionStats.microcompact);
  const boundary = contextRecord(compressionStats.compact_boundary);
  const promptBreakdown = contextRecord(compressionStats.prompt_breakdown);
  const historyCoverage = contextRecord(compressionStats.history_coverage);
  const progressivePressure = contextRecord(progressiveCompaction.pressure);
  const runtimeToolContext = contextRecord(contextDiagnostics.runtime_tool_context);
  const promptCalls = Array.isArray(contextDiagnostics.prompt_calls) ? contextDiagnostics.prompt_calls : [];
  const latestPromptCall = promptCalls.length > 0 ? contextRecord(promptCalls[promptCalls.length - 1]) : {};
  const latestUsage = modelUsage.length > 0 ? contextRecord(modelUsage[modelUsage.length - 1]) : {};
  const stage = contextString(progressivePressure.stage) || contextString(pressure.stage) || "normal";
  const tokenUsage = contextNumber(progressivePressure.token_usage) || contextNumber(pressure.token_usage);
  const windowTokens = contextNumber(progressivePressure.effective_window_tokens) || contextNumber(pressure.effective_window_tokens);
  const remainingTokens = contextNumber(progressivePressure.remaining_tokens) || contextNumber(pressure.remaining_tokens);
  const utilization = windowTokens > 0 ? Math.min(100, Math.round((tokenUsage / windowTokens) * 100)) : 0;
  const attempted = progressiveCompaction.attempted === true;
  const compacted = progressiveCompaction.compacted === true;
  const reason = contextString(progressiveCompaction.reason) || (compacted ? "compacted" : "未触发正式压缩");
  const microMessages = contextNumber(microcompact.compacted_messages);
  const microSaved = contextNumber(microcompact.estimated_tokens_saved);
  const rawTokens = contextNumber(progressivePressure.raw_segment_estimated_tokens) || contextNumber(rawPressure.token_usage);
  const assembledTokens = contextNumber(progressivePressure.assembled_context_estimated_tokens) || contextNumber(compressionStats.assembled_prompt_estimated_tokens) || contextNumber(compressionStats.system_context_estimated_tokens);
  const actualInputTokens = contextNumber(latestUsage.input_tokens);
  const providerUsage = contextString(latestUsage.source) === "provider";
  const toolSchemaTokens = contextNumber(latestPromptCall.tool_schema_tokens) || contextNumber(promptBreakdown.tool_schema_tokens);
  const runtimeSaved = contextNumber(runtimeToolContext.estimated_tokens_saved);
  const exactHistory = historyCoverage.complete_and_exact === true;
  const hasBoundary = historyCoverage.has_compaction_boundary === true;
  const stageStyle =
    stage === "manual_path"
      ? "bg-danger-subtle text-danger"
      : stage === "aggressive"
        ? "bg-warning-subtle text-warning"
        : stage === "auto_compact"
          ? "bg-warning-subtle text-warning"
          : stage === "warning"
            ? "bg-warning-subtle text-warning"
            : "bg-success-subtle text-success";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left text-xs text-ink-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-semibold text-ink">上下文诊断</span>
          <span className={`shrink-0 rounded-control px-2 py-0.5 text-[11px] font-medium ${stageStyle}`}>{contextStageLabel(stage)}</span>
          {compacted && <span className="shrink-0 text-accent">已插入压缩边界</span>}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`} />
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3 rounded-control bg-panel p-3">
          <div>
            <div className="flex items-center justify-between text-[11px] text-ink-2">
              <span>上下文窗口占用</span>
              <span>{tokenUsage.toLocaleString()} / {windowTokens.toLocaleString()} tokens</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel">
              <div
                className={`h-full rounded-full ${stage === "normal" ? "bg-success" : "bg-warning"}`}
                style={{ width: `${Math.max(2, utilization)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-ink-2">
              <span>normal</span>
              <span>warning</span>
              <span>auto compact</span>
              <span>manual</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-control bg-line text-xs">
            <div className="bg-surface px-3 py-2">
              <div className="text-ink-2">原始片段</div>
              <div className="mt-1 font-semibold text-ink">{rawTokens.toLocaleString()} tokens</div>
            </div>
            <div className="bg-surface px-3 py-2">
              <div className="text-ink-2">组装后上下文</div>
              <div className="mt-1 font-semibold text-ink">{assembledTokens.toLocaleString()} tokens</div>
            </div>
            <div className="bg-surface px-3 py-2">
              <div className="text-ink-2">剩余空间</div>
              <div className="mt-1 font-semibold text-ink">{remainingTokens.toLocaleString()} tokens</div>
            </div>
          </div>

          <div className="rounded-control border border-line bg-surface px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">完整 Prompt 计量</span>
              <span className={providerUsage ? "text-success" : "text-ink-2"}>
                {providerUsage ? "供应商实际 usage" : "请求前估算"}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-ink-2 sm:grid-cols-4">
              <span>实际输入：{actualInputTokens.toLocaleString()}</span>
              <span>组装估算：{assembledTokens.toLocaleString()}</span>
              <span>近期历史：{contextNumber(promptBreakdown.recent_history).toLocaleString()}</span>
              <span>工具 Schema：{toolSchemaTokens.toLocaleString()}</span>
            </div>
            {runtimeSaved > 0 && (
              <div className="mt-1 text-accent-strong">轮内工具投影节省约 {runtimeSaved.toLocaleString()} tokens，完整结果仍保存在封存转录。</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-2">
            <span className={exactHistory ? "text-success" : "text-warning"}>
              近期历史：{exactHistory ? "完整原文" : "已裁剪或省略"}
            </span>
            {hasBoundary && <span>更早原文可通过 transcript 工具跨 Boundary 精确回查</span>}
            {contextDiagnostics.reactive_overflow_retry === true && <span className="text-warning">本轮执行过一次溢出恢复</span>}
          </div>

          {(microMessages > 0 || microSaved > 0) && (
            <div className="flex items-start justify-between gap-4 border-l-2 border-accent-subtle pl-3 text-xs leading-5">
              <div>
                <div className="font-semibold text-ink">Microcompact 轻量压缩</div>
                <div className="text-ink-2">清理 {microMessages} 条可重新获取的旧工具结果</div>
              </div>
              <div className="shrink-0 font-semibold text-accent-strong">节省约 {microSaved.toLocaleString()} tokens</div>
            </div>
          )}

          <div className="border-l-2 border-warning pl-3 text-xs leading-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">正式压缩</span>
              <span className={attempted ? "text-warning" : "text-ink-2"}>{attempted ? (compacted ? "已完成" : "已尝试") : "未执行"}</span>
            </div>
            <div className="text-ink-2">原因：{contextReasonLabel(reason)}</div>
            {compacted && (
              <div className="mt-1 text-ink-2">
                摘要 {contextNumber(progressiveCompaction.messages_summarized)} 条，保留最近 {contextNumber(progressiveCompaction.messages_preserved)} 条，压缩后约 {contextNumber(progressiveCompaction.post_compact_estimated_tokens).toLocaleString()} tokens
              </div>
            )}
            {(contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)) && (
              <div className="mt-1 truncate font-mono text-[11px] text-ink-2">
                boundary: {contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatTraceInline({
  traceItems,
  collapsed,
  responsePending,
  onToggle
}: {
  traceItems: ChatTraceItem[];
  collapsed: boolean;
  responsePending: boolean;
  onToggle: () => void;
}) {
  if (!traceItems.length) return null;
  const runningCount = traceItems.filter((item) => item.status === "running").length;
  const errorCount = traceItems.filter((item) => item.status === "error").length;
  const toolCount = traceItems.filter((item) => item.kind === "tool" || item.kind === "error").length;
  const ragPrefetch = traceItems.find((item) => item.kind === "rag_prefetch");
  const statusLabel = responsePending ? "回复中" : runningCount > 0 ? "执行中" : errorCount > 0 ? `${errorCount} 个失败` : "已完成";
  return (
    <div className="space-y-2 border-l-2 border-accent-subtle pl-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-control border border-line bg-panel px-3 py-2 text-left text-xs text-ink-2 transition hover:border-accent-subtle hover:bg-accent-subtle"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate font-semibold text-ink">工具调用过程</span>
          <span className="shrink-0 text-ink-2">
            {toolCount} 个工具 · {ragPrefetch ? `RAG 预检索 ${ragPrefetch.evidenceCount ?? 0} 条 · ` : ""}{traceItems.length} 条事件
          </span>
        </span>
        <span className={errorCount > 0 ? "shrink-0 text-danger" : responsePending || runningCount > 0 ? "shrink-0 text-accent" : "shrink-0 text-ink-2"}>
          {statusLabel}
        </span>
      </button>
      {!collapsed &&
        traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-control px-3 py-2 text-xs leading-5 ${
              item.status === "error"
                ? "bg-danger-subtle text-danger"
                : item.status === "running"
                  ? "bg-accent-subtle text-ink"
                  : item.kind === "rag_prefetch"
                    ? "border border-accent-subtle bg-accent-subtle text-ink"
                    : "bg-panel text-ink-2"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </div>
            {item.skillTitle && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 border-y border-accent-subtle py-1.5 text-[11px] text-accent-strong">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="font-semibold">Skill：{item.skillTitle}</span>
                {item.skillVersion && <span>v{item.skillVersion}</span>}
                {item.skillName && <span className="font-mono text-accent-strong">{item.skillName}</span>}
                {item.skillActivationMode && <span>· {item.skillActivationMode}</span>}
              </div>
            )}
            {item.kind === "thinking" ? (
              <MarkdownMessage content={item.content} />
            ) : (
              <div className="max-h-32 overflow-auto whitespace-pre-wrap">{item.content}</div>
            )}
            {item.skillSteps && item.skillSteps.length > 0 && (
              <div className="mt-2 border-t border-line pt-2">
                <div className="mb-1 font-semibold text-ink-2">Skill 工作流</div>
                <div className="flex flex-wrap gap-1">
                  {item.skillSteps.map((step, index) => (
                    <span key={step} className="rounded-control bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{index + 1}. {step}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

export function ChatWorkspacePanel({
  selectedRepo,
  selectedConversation,
  messages,
  message,
  loading,
  planMode,
  promptSuggestions,
  loadingPrompts,
  promptLoadingDots,
  selectedProjectIndexState,
  indexScanningRepoId,
  indexActionError,
  onMessageChange,
  onTogglePlanMode,
  onAskAgent,
  onCreateWorkflowPlan,
  onExecuteWorkflowPlan,
  onStopAgentResponse,
  onToggleAssistantTrace,
  onToggleContextDiagnostics,
  onFeedbackSaved,
  onRefreshPromptSuggestions,
  onStartProjectIndexScan,
  onSnoozeProjectIndexPrompt
}: {
  selectedRepo: Repository | undefined;
  selectedConversation: ProjectConversation | undefined;
  messages: ChatMessage[];
  message: string;
  loading: boolean;
  planMode: boolean;
  promptSuggestions: string[];
  loadingPrompts: boolean;
  promptLoadingDots: string;
  selectedProjectIndexState: ProjectIndexState | undefined;
  indexScanningRepoId: string | null;
  indexActionError: string | null;
  onMessageChange: (value: string) => void;
  onTogglePlanMode: () => void;
  onAskAgent: (prompt?: string) => void;
  onCreateWorkflowPlan: (prompt?: string) => void;
  onExecuteWorkflowPlan: (messageId: string) => void;
  onStopAgentResponse: () => void;
  onToggleAssistantTrace: (messageId: string) => void;
  onToggleContextDiagnostics: (messageId: string) => void;
  onFeedbackSaved: (chatItemId: string, feedback: ChatFeedbackRecord) => void;
  onRefreshPromptSuggestions: () => void;
  onStartProjectIndexScan: () => void;
  onSnoozeProjectIndexPrompt: () => void;
}) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const promptRowRef = useRef<HTMLDivElement>(null);
  const promptMeasureRef = useRef<HTMLDivElement>(null);
  const [visiblePromptCount, setVisiblePromptCount] = useState(5);

  const isEmptyConversation = messages.length === 0 || (messages.length === 1 && messages[0]?.id.startsWith("welcome-"));
  const indexSnoozed = Boolean(
    selectedProjectIndexState?.snoozed_until && new Date(selectedProjectIndexState.snoozed_until).getTime() > Date.now()
  );

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: loading ? "smooth" : "auto" });
  }, [messages, loading]);

  useEffect(() => {
    if (promptSuggestions.length === 0) {
      setVisiblePromptCount(5);
      return;
    }

    function updateVisiblePromptCount() {
      const row = promptRowRef.current;
      const measure = promptMeasureRef.current;
      if (!row || !measure) return;
      const rowWidth = row.clientWidth;
      const chips = Array.from(measure.querySelectorAll<HTMLButtonElement>("[data-prompt-chip-measure]"));
      if (!rowWidth || chips.length === 0) return;

      const gap = 8;
      let usedWidth = 0;
      let nextCount = 0;
      for (const chip of chips) {
        const chipWidth = Math.ceil(chip.getBoundingClientRect().width);
        const widthWithGap = chipWidth + (nextCount > 0 ? gap : 0);
        if (nextCount === 0 || usedWidth + widthWithGap <= rowWidth) {
          usedWidth += widthWithGap;
          nextCount += 1;
          continue;
        }
        break;
      }
      setVisiblePromptCount(Math.min(promptSuggestions.length, Math.max(1, nextCount)));
    }

    const frame = window.requestAnimationFrame(updateVisiblePromptCount);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && promptRowRef.current) {
      observer = new ResizeObserver(updateVisiblePromptCount);
      observer.observe(promptRowRef.current);
    }
    window.addEventListener("resize", updateVisiblePromptCount);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateVisiblePromptCount);
    };
  }, [promptSuggestions, loadingPrompts]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-panel">
      <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex w-full flex-col gap-4">
          {messages.map((item) => {
            const isWelcome = item.id.startsWith("welcome-");
            const traceItems = item.traceItems ?? [];
            const failedTools = (item.toolCalls ?? []).filter((call) => call.status === "error");
            const failedToolTitle = failedTools.map((call) => `${call.tool_name}: ${call.error ?? "failed"}`).join("\n");
            return (
              <div key={item.id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`${isWelcome ? "w-full max-w-none rounded-control" : "max-w-[80%] rounded-surface"} px-4 py-3 text-sm leading-7 shadow-sm ${
                    item.role === "user" ? "bg-accent text-accent-ink" : "border border-line bg-surface text-ink"
                  }`}
                >
                  {item.role === "assistant" ? (
                    <>
                      {item.workflowPlan && (
                        <WorkflowPlanCard
                          plan={item.workflowPlan}
                          status={item.planStatus ?? "ready"}
                          disabled={loading || Boolean(item.responsePending) || item.planStatus === "done"}
                          onExecute={() => onExecuteWorkflowPlan(item.id)}
                        />
                      )}
                      {item.content.trim() ? (
                        <div className={item.workflowPlan ? "mt-3" : ""}>
                          <MarkdownMessage content={item.content} />
                        </div>
                      ) : traceItems.length === 0 ? (
                        <div className="text-ink-2">Agent 正在分析...</div>
                      ) : null}
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap">{item.content}</div>
                  )}
                  {item.route && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2 text-xs text-ink-2">
                      <span>route: {item.route}</span>
                      <span>tools: {item.toolCalls?.length ?? 0}</span>
                      {failedTools.length > 0 && (
                        <span className="text-danger" title={failedToolTitle}>
                          failed: {failedTools.length}
                        </span>
                      )}
                    </div>
                  )}
                  {item.role === "assistant" && item.compressionStats && Object.keys(item.compressionStats).length > 0 && (
                    <ContextDiagnostics
                      compressionStats={item.compressionStats}
                      progressiveCompaction={item.progressiveCompaction ?? {}}
                      modelUsage={item.modelUsage ?? []}
                      contextDiagnostics={item.contextDiagnostics ?? {}}
                      collapsed={item.contextCollapsed !== false}
                      onToggle={() => onToggleContextDiagnostics(item.id)}
                    />
                  )}
                  {item.role === "assistant" && traceItems.length > 0 && (
                    <div className="mt-3">
                      <ChatTraceInline
                        traceItems={traceItems}
                        collapsed={item.responsePending ? false : Boolean(item.traceCollapsed)}
                        responsePending={Boolean(item.responsePending)}
                        onToggle={() => onToggleAssistantTrace(item.id)}
                      />
                    </div>
                  )}
                  {item.role === "assistant" && item.responsePending && (traceItems.length > 0 || item.content.trim()) && (
                    <div className="mt-3 flex items-center gap-2 rounded-control border border-accent-subtle bg-accent-subtle px-3 py-2 text-xs text-ink-2">
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
                      <span>Agent 正在回复，工具结果已收集，正在整理最终回答...</span>
                    </div>
                  )}
                  {item.role === "assistant" && item.messageId && !item.responsePending && selectedRepo && selectedConversation && (
                    <FeedbackControls
                      repoId={selectedRepo.id}
                      conversationId={selectedConversation.id}
                      messageId={item.messageId}
                      initialFeedback={item.feedback}
                      onSaved={(feedback) => onFeedbackSaved(item.id, feedback)}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {selectedRepo && isEmptyConversation && selectedProjectIndexState && !indexSnoozed && selectedProjectIndexState.status !== "ready" && (
            <MemoryIndexPromptCard
              repo={selectedRepo}
              state={selectedProjectIndexState}
              scanning={indexScanningRepoId === selectedRepo.id || selectedProjectIndexState.status === "building"}
              error={indexActionError}
              onStartScan={onStartProjectIndexScan}
              onSnooze={onSnoozeProjectIndexPrompt}
            />
          )}
        </div>
      </div>

      <div className="border-t border-line bg-surface p-4">
        <div className="w-full">
          {(promptSuggestions.length > 0 || loadingPrompts) && (
            <div className="mb-3 flex items-center gap-2">
              <div ref={promptRowRef} className="relative min-w-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                  {loadingPrompts && promptSuggestions.length === 0 && (
                    <span className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-ink-2">
                      推荐生成中{promptLoadingDots}
                    </span>
                  )}
                  {promptSuggestions.slice(0, visiblePromptCount).map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => onAskAgent(prompt)}
                      disabled={!selectedRepo || loading || loadingPrompts}
                      className="max-w-full shrink-0 truncate rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-ink-2 transition hover:border-accent-subtle hover:bg-accent-subtle disabled:opacity-60"
                      title={prompt}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div
                  ref={promptMeasureRef}
                  className="pointer-events-none invisible absolute -left-[9999px] top-0 flex items-center gap-2 whitespace-nowrap"
                  aria-hidden="true"
                >
                  {promptSuggestions.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      data-prompt-chip-measure
                      className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-ink-2"
                      tabIndex={-1}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
              {promptSuggestions.length > 0 && (
                <button
                  onClick={onRefreshPromptSuggestions}
                  disabled={!selectedRepo || loading || loadingPrompts}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-2 transition hover:border-accent-subtle hover:bg-accent-subtle disabled:cursor-not-allowed disabled:opacity-50"
                  title="刷新推荐提示语"
                  aria-label="刷新推荐提示语"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingPrompts ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
          )}
          <div className="flex items-stretch gap-3">
            <textarea
              className={`max-h-40 min-h-[5.5rem] flex-1 resize-none rounded-control border bg-surface px-3 py-3 text-sm leading-6 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-subtle ${
                planMode ? "border-accent-subtle" : "border-line"
              }`}
              value={message}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="输入消息，询问当前代码仓..."
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!loading) {
                    planMode ? onCreateWorkflowPlan() : onAskAgent();
                  }
                }
              }}
            />
            <div className="flex w-12 shrink-0 flex-col gap-2">
              <button
                type="button"
                onClick={onTogglePlanMode}
                disabled={loading}
                aria-pressed={planMode}
                className={`inline-flex h-8 w-12 items-center justify-center rounded-control border transition disabled:opacity-60 ${
                  planMode
                    ? "border-accent bg-accent text-accent-ink shadow-sm"
                    : "border-line bg-surface text-ink-2 hover:border-accent-subtle hover:bg-accent-subtle"
                }`}
                title={planMode ? "切换到对话模式" : "切换到计划模式"}
              >
                <ListTodo className="h-4 w-4" />
              </button>
              <button
                onClick={() => (loading ? onStopAgentResponse() : planMode ? onCreateWorkflowPlan() : onAskAgent())}
                disabled={!selectedRepo || (!loading && !message.trim())}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-control bg-accent text-accent-ink transition hover:bg-accent disabled:opacity-60"
                title={loading ? "停止响应" : "发送"}
              >
                {loading ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
