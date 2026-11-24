"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Database, FileText, RefreshCw, Search, Send, Sparkles, Trash2, Upload } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Select } from "@/components/arc/select/select";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Card, PageTitle } from "@/components/ui/card";
import { MarkdownBlock } from "@/components/ui/blocks";
import { apiDelete, apiGet, apiPost, apiUpload } from "@/lib/api";
import type { Repository } from "@/lib/types";

type KnowledgeItem = {
  id: string;
  source_type: string;
  title: string;
  content_preview: string;
  metadata: Record<string, unknown>;
  chunk_count: number;
  created_at?: string | null;
};

type RAGSource = {
  citation: number;
  document_id: string;
  source_id: string;
  source_type: string;
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, unknown>;
  retrieval: Record<string, unknown>;
};

type RAGAnswer = {
  question: string;
  answer: string;
  sources: RAGSource[];
  retrieval_count: number;
  generation_mode: "llm" | "extractive" | "no_evidence";
  model?: string | null;
  took_ms: number;
};

type RAGSearch = {
  query: string;
  results: RAGSource[];
  result_count: number;
  took_ms: number;
};

type RAGStatus = {
  repo_id: string;
  document_count: number;
  source_count: number;
  source_types: Record<string, number>;
  embedding: { provider?: string; model?: string; dimensions?: number };
  vector_store: { backend?: string; status?: string; available?: boolean; error?: string | null; fallback?: string };
  generation: { llm_configured?: boolean; model?: string | null; fallback?: string };
  supported_files: string[];
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: RAGAnswer["generation_mode"];
  tookMs?: number;
  sourceCount?: number;
};

const sourceTypeLabels: Record<string, string> = {
  knowledge_file: "文档",
  memory_note: "笔记",
  project_doc: "项目文档",
  project_overview: "项目概览",
  issue: "Issue",
  pull_request: "PR",
  workflow_run: "CI",
  team_member: "成员",
  weekly_report: "周报"
};

function sourceLabel(value: string) {
  return sourceTypeLabels[value] ?? value.replaceAll("_", " ");
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function RAGPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoId, setRepoId] = useState("");
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [status, setStatus] = useState<RAGStatus | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sources, setSources] = useState<RAGSource[]>([]);
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [sourceType, setSourceType] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const qaScrollRef = useRef<HTMLDivElement>(null);

  const availableSourceTypes = useMemo(() => Object.keys(status?.source_types ?? {}).sort(), [status]);

  async function loadRepos(preferredId?: string) {
    const items = await apiGet<Repository[]>("/api/rag/repositories");
    setRepos(items);
    const nextId =
      preferredId && items.some((item) => item.id === preferredId)
        ? preferredId
        : repoId && items.some((item) => item.id === repoId)
          ? repoId
          : items[0]?.id ?? "";
    setRepoId(nextId);
  }

  async function loadKnowledge(id: string) {
    const [nextKnowledge, nextStatus] = await Promise.all([
      apiGet<KnowledgeItem[]>(`/api/repos/${id}/knowledge`),
      apiGet<RAGStatus>(`/api/rag/${id}/status`)
    ]);
    setKnowledge(nextKnowledge);
    setStatus(nextStatus);
  }

  useEffect(() => {
    loadRepos().catch((loadError) => setError(errorMessage(loadError)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!repoId) {
      setKnowledge([]);
      setStatus(null);
      return;
    }
    setError(null);
    loadKnowledge(repoId).catch((loadError) => setError(errorMessage(loadError)));
  }, [repoId]);

  useEffect(() => {
    const node = qaScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function uploadFile(file?: File) {
    if (!file || !repoId) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiUpload(`/api/rag/repositories/${repoId}/documents`, body);
      setNotice("文件已提交，正在解析、分段并建立索引");
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await loadKnowledge(repoId);
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeKnowledge(item: KnowledgeItem) {
    if (!repoId || !window.confirm(`删除“${item.title}”及其全部切片？`)) return;
    setBusy(`delete:${item.id}`);
    setError(null);
    try {
      await apiDelete(`/api/rag/repositories/${repoId}/documents/${item.id}`);
      await loadKnowledge(repoId);
      setNotice("资料已从索引中删除");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(null);
    }
  }

  async function reindex() {
    if (!repoId) return;
    setBusy("reindex");
    setError(null);
    try {
      const result = await apiPost<{ indexed_documents: number }>(`/api/rag/${repoId}/reindex`, {});
      await loadKnowledge(repoId);
      setNotice(`已重建 ${result.indexed_documents} 个文档向量`);
    } catch (reindexError) {
      setError(errorMessage(reindexError));
    } finally {
      setBusy(null);
    }
  }

  function queryBody() {
    return { question: question.trim(), top_k: topK, source_types: sourceType ? [sourceType] : [] };
  }

  async function ask() {
    const prompt = question.trim();
    if (!repoId || !prompt || busy) return;
    setTurns((current) => [...current, { id: crypto.randomUUID(), role: "user", content: prompt }]);
    setQuestion("");
    setBusy("ask");
    setError(null);
    try {
      const result = await apiPost<RAGAnswer>(`/api/rag/${repoId}/ask`, { ...queryBody(), question: prompt });
      setSources(result.sources);
      setTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          mode: result.generation_mode,
          tookMs: result.took_ms,
          sourceCount: result.retrieval_count
        }
      ]);
    } catch (askError) {
      setError(errorMessage(askError));
      setTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: "请求失败，请检查后端配置后重试。", mode: "no_evidence" }
      ]);
    } finally {
      setBusy(null);
    }
  }

  async function searchOnly() {
    if (!repoId || !question.trim() || busy) return;
    setBusy("search");
    setError(null);
    try {
      const result = await apiPost<RAGSearch>(`/api/rag/${repoId}/search`, queryBody());
      setSources(result.results);
      setNotice(`召回 ${result.result_count} 条证据，耗时 ${result.took_ms} ms`);
    } catch (searchError) {
      setError(errorMessage(searchError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle title="RAG 工作室" description="上传资料、调试召回，并用当前知识库回答问题。" />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full max-w-sm">
            <Select
              label="仓库"
              placeholder="选择仓库"
              value={repoId}
              onValueChange={(value) => {
                setRepoId(value);
                setTurns([]);
                setSources([]);
              }}
              options={repos.map((repo) => ({ value: repo.id, label: repo.full_name }))}
            />
          </div>
          <div className="flex items-center gap-2">
            {repoId ? (
              <Link
                href={`/knowledge/${repoId}`}
                className="inline-flex h-10 items-center gap-2 rounded-control border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-raised"
              >
                管理项目知识
              </Link>
            ) : null}
            <Button variant="secondary" aria-label="刷新" title="刷新" onClick={() => repoId && loadKnowledge(repoId)}>
              <RefreshCw size={16} strokeWidth={1.75} />
            </Button>
          </div>
        </div>

        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatusItem label="资料" value={`${status?.source_count ?? 0} 份`} />
            <StatusItem label="切片" value={`${status?.document_count ?? 0} 条`} />
            <StatusItem label="Embedding" value={status ? `${status.embedding.provider ?? "-"} · ${status.embedding.dimensions ?? "-"}d` : "-"} />
            <StatusItem
              label="向量索引"
              value={
                status?.vector_store
                  ? `${status.vector_store.backend ?? "vector"} · ${status.vector_store.available === false ? "degraded" : status.vector_store.status ?? "ready"}`
                  : "-"
              }
            />
            <StatusItem label="生成" value={status?.generation.llm_configured ? status.generation.model ?? "LLM" : "本地证据模式"} />
          </div>
        </Card>

        {error ? (
          <Alert tone="danger" title="出错了" onDismiss={() => setError(null)}>{error}</Alert>
        ) : notice ? (
          <Alert tone="success" title="提示" onDismiss={() => setNotice(null)}>{notice}</Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <section className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:h-[calc(100vh-400px)] lg:min-h-[520px]">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                <Database size={16} strokeWidth={1.75} /> 知识库
              </h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label="重建向量索引"
                title="重建向量索引"
                loading={busy === "reindex"}
                disabled={!repoId}
                onClick={reindex}
              >
                <RefreshCw size={14} strokeWidth={1.75} />
              </Button>
            </div>
            <div className="border-b border-line p-3">
              <input
                ref={fileInput}
                type="file"
                accept={(status?.supported_files ?? []).join(",")}
                className="hidden"
                onChange={(event) => uploadFile(event.target.files?.[0])}
              />
              <Button variant="secondary" className="w-full" loading={busy === "upload"} disabled={!repoId} onClick={() => fileInput.current?.click()}>
                <Upload size={16} strokeWidth={1.75} /> {busy === "upload" ? "解析与入库中" : "上传资料"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {knowledge.map((item) => (
                <div key={`${item.source_type}:${item.id}`} className="group rounded-control border border-line bg-panel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink" title={item.title}>
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs text-ink-2">
                        {sourceLabel(item.source_type)} · {item.chunk_count} 切片 {formatDate(item.created_at)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="删除资料"
                      title="删除资料"
                      loading={busy === `delete:${item.id}`}
                      onClick={() => removeKnowledge(item)}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </Button>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-ink-2">{item.content_preview}</p>
                </div>
              ))}
              {knowledge.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={<FileText size={18} strokeWidth={1.75} />}
                    title="知识库为空"
                    description="上传第一份资料开始构建索引。"
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:h-[calc(100vh-400px)] lg:min-h-[520px]">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                <Sparkles size={16} strokeWidth={1.75} /> 问答
              </h2>
              {turns.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setTurns([]);
                    setSources([]);
                  }}
                  className="text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  清空会话
                </button>
              ) : null}
            </div>
            <div ref={qaScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <div className="flex flex-col gap-4">
                {turns.length === 0 ? (
                  <EmptyState
                    icon={<BookOpen size={18} strokeWidth={1.75} />}
                    title={status?.document_count ? "输入问题开始检索" : "上传资料后开始提问"}
                    description={status?.document_count ? "回答会引用检索到的真实证据。" : "RAG 会先检索知识库，再基于证据回答。"}
                  />
                ) : null}
                {turns.map((turn) => (
                  <div key={turn.id} className={turn.role === "user" ? "max-w-[85%] self-end" : "w-full max-w-[92%]"}>
                    {turn.role === "user" ? (
                      <div className="rounded-panel bg-accent px-4 py-2.5 text-sm leading-6 text-accent-ink">{turn.content}</div>
                    ) : (
                      <div className="rounded-panel border border-line bg-panel px-4 py-3">
                        <MarkdownBlock content={turn.content} />
                      </div>
                    )}
                    {turn.role === "assistant" ? (
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-ink-2">
                        <span>{turn.mode === "llm" ? "LLM 生成" : turn.mode === "extractive" ? "证据提取" : "无证据"}</span>
                        <span>{turn.sourceCount ?? 0} 个引用</span>
                        {typeof turn.tookMs === "number" ? <span>{turn.tookMs} ms</span> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                {busy === "ask" ? <p className="text-sm text-ink-2">正在检索并生成回答...</p> : null}
              </div>
            </div>
            <div className="border-t border-line p-3">
              <Textarea
                label="向知识库提问"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask();
                  }
                }}
                placeholder="例如：发布流程是怎样的？"
                rows={3}
              />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <Select
                    label="资料类型"
                    placeholder="全部资料"
                    value={sourceType}
                    onValueChange={setSourceType}
                    options={[{ value: "", label: "全部资料" }, ...availableSourceTypes.map((type) => ({ value: type, label: sourceLabel(type) }))]}
                  />
                </div>
                <div className="w-24">
                  <Select
                    label="Top K"
                    value={String(topK)}
                    onValueChange={(value) => setTopK(Number(value))}
                    options={[3, 5, 8, 10].map((value) => ({ value: String(value), label: String(value) }))}
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    aria-label="只检索证据"
                    title="只检索证据"
                    loading={busy === "search"}
                    disabled={!repoId || !question.trim() || Boolean(busy)}
                    onClick={searchOnly}
                  >
                    <Search size={16} strokeWidth={1.75} />
                  </Button>
                  <Button loading={busy === "ask"} disabled={!repoId || !question.trim() || Boolean(busy)} onClick={ask}>
                    <Send size={16} strokeWidth={1.75} /> 提问
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col overflow-hidden rounded-panel border border-line bg-surface lg:h-[calc(100vh-400px)] lg:min-h-[520px]">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                <Search size={16} strokeWidth={1.75} /> 检索证据
              </h2>
              <span className="text-xs text-ink-2">{sources.length} 条</span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {sources.map((source) => (
                <article key={`${source.document_id}:${source.citation}`} className="rounded-control border border-line bg-panel p-3">
                  <div className="flex items-start gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-subtle text-xs font-medium text-accent-strong">
                      {source.citation}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-medium leading-5 text-ink">{source.title}</h3>
                      <div className="mt-1 text-xs text-ink-2">
                        {sourceLabel(source.source_type)} · {(source.score * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded bg-surface-muted">
                    <div className="h-full bg-accent" style={{ width: `${Math.max(3, Math.min(100, source.score * 100))}%` }} />
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-ink-2">{source.snippet}</p>
                  {Boolean(source.metadata.filename || source.metadata.path) ? (
                    <div className="mt-2 break-all border-t border-line pt-2 text-[11px] text-ink-2">
                      {String(source.metadata.filename ?? source.metadata.path)}
                    </div>
                  ) : null}
                </article>
              ))}
              {sources.length === 0 ? (
                <div className="py-6">
                  <EmptyState
                    icon={<Search size={18} strokeWidth={1.75} />}
                    title="暂无检索结果"
                    description="提问或只检索证据后，引用来源会显示在这里。"
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium text-ink" title={value}>
        {value}
      </div>
    </div>
  );
}
