"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FileSearch,
  FileText,
  History,
  Play,
  Plus,
  RotateCcw,
  Save
} from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Drawer, DrawerContent, useDrawerItem } from "@/components/arc/drawer/drawer";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Textarea } from "@/components/arc/textarea/textarea";
import { RetrievalSettings } from "@/components/rag/retrieval-settings";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/ui/blocks";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
import {
  formatBytes,
  formatDate,
  formatNumber,
  statusLabel,
  type KnowledgeBase,
  type KnowledgeChunk,
  type KnowledgeConfig,
  type KnowledgeDocument,
  type ModelCatalog,
  type RetrievalHistory,
  type RetrievalResponse
} from "@/lib/rag";

type Tab = "documents" | "retrieval" | "settings";

const tabOptions = [
  { value: "documents", label: "文档" },
  { value: "retrieval", label: "召回测试" },
  { value: "settings", label: "设置" }
];

const pipelineStageLabel: Record<string, string> = {
  vector_recall: "向量召回",
  keyword_recall: "BM25 召回",
  weighted_fusion: "加权融合",
  single_retriever_selection: "单路候选",
  deduplication_and_parent_aggregation: "去重聚合",
  rerank: "重排",
  parent_expansion: "父级扩展",
  score_threshold: "分数门槛",
  context_compression: "证据压缩",
  answer_gate: "回答判断"
};

const answerGateLabel: Record<string, string> = {
  answer: "证据充足",
  ask_clarification: "需要补充范围",
  insufficient_evidence: "证据不足",
  conflict: "证据冲突"
};

function documentTone(status: string) {
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "warning" as const;
}

export default function KnowledgeBaseDetailPage() {
  const id = String(useParams<{ id: string }>().id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("documents");
  const [knowledge, setKnowledge] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [query, setQuery] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalResponse | null>(null);
  const [history, setHistory] = useState<RetrievalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const shownDocument = useDrawerItem(selectedDocument);

  const load = useCallback(async () => {
    const [base, docs, models] = await Promise.all([
      apiGet<KnowledgeBase>(`/api/rag/repositories/${id}`),
      apiGet<KnowledgeDocument[]>(`/api/rag/repositories/${id}/documents`),
      apiGet<ModelCatalog>("/api/rag/models")
    ]);
    setKnowledge(base);
    setDocuments(docs);
    setCatalog(models);
    setConfig(base.config);
  }, [id]);

  const loadHistory = useCallback(() => {
    apiGet<RetrievalHistory[]>(`/api/rag/repositories/${id}/retrieval-tests`)
      .then(setHistory)
      .catch(() => null);
  }, [id]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (initial === "retrieval" || initial === "settings") setTab(initial);
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
    loadHistory();
  }, [load, loadHistory]);

  useEffect(() => {
    if (!documents.some((item) => !["completed", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => load().catch(() => null), 1000);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  function changeTab(next: string) {
    const value = next as Tab;
    setTab(value);
    window.history.replaceState(null, "", `${window.location.pathname}?tab=${value}`);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        await apiUpload<KnowledgeDocument>(`/api/rag/repositories/${id}/documents`, form);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openChunks(document: KnowledgeDocument) {
    setSelectedDocument(document);
    setChunks([]);
    try {
      setChunks(await apiGet<KnowledgeChunk[]>(`/api/rag/repositories/${id}/documents/${document.id}/chunks`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取分段失败");
    }
  }

  async function retry(document: KnowledgeDocument) {
    await apiPost(`/api/rag/repositories/${id}/documents/${document.id}/retry`, {});
    await load();
  }

  async function runRetrieval() {
    if (!query.trim() || !config) return;
    setTesting(true);
    setError("");
    try {
      const result = await apiPost<RetrievalResponse>(`/api/rag/repositories/${id}/retrieval-tests`, {
        query: query.trim(),
        top_k: config.top_k,
        retrieval_method: config.retrieval_method,
        rerank_enabled: config.rerank_enabled,
        score_threshold_enabled: config.score_threshold_enabled,
        score_threshold: config.score_threshold
      });
      setRetrieval(result);
      loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "召回测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    if (!config || !knowledge) return;
    setSaving(true);
    setMessage("");
    setError("");
    const reindexNeeded = config.embedding_model !== knowledge.config.embedding_model || config.embedding_provider !== knowledge.config.embedding_provider;
    try {
      const updated = await apiPatch<KnowledgeBase>(`/api/rag/repositories/${id}/config`, config);
      setKnowledge(updated);
      setConfig(updated.config);
      if (reindexNeeded && updated.chunk_count) {
        await apiPost(`/api/rag/${id}/reindex`, {});
        setMessage("设置已保存，现有分段已重新向量化。平时修改分段长度只会影响新上传的文档。");
      } else {
        setMessage("设置已保存。");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-24 text-center text-sm text-ink-2">正在加载项目知识...</div>;
  if (!knowledge || !config) {
    return (
      <div className="py-10">
        <Alert tone="danger" title="未找到仓库">{error || "请返回项目知识列表重新选择。"}</Alert>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/knowledge"
              aria-label="返回项目知识"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-control border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-raised hover:text-ink"
            >
              <ArrowLeft size={16} strokeWidth={1.75} />
            </Link>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-accent-subtle text-accent-strong">
              <BookOpen size={18} strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-medium text-ink">{knowledge.name}</h1>
              <p className="mt-0.5 truncate text-sm text-ink-2">{knowledge.full_name}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-2">
              {`${formatNumber(knowledge.document_count)} 文档 · ${formatNumber(knowledge.chunk_count)} 分段 · ${formatNumber(knowledge.character_count)} 字符`}
            </span>
            <Badge size="sm" tone={knowledge.runtime.embedding.available ? "success" : "warning"}>
              {knowledge.runtime.embedding.available ? "Embedding 就绪" : "Embedding 降级"}
            </Badge>
            <Badge size="sm" tone={knowledge.runtime.rerank.available ? "success" : "warning"}>
              {knowledge.runtime.rerank.available
                ? "Rerank 就绪"
                : knowledge.runtime.rerank.fallback === "heuristic"
                  ? "启发式重排"
                  : "Rerank 不可用"}
            </Badge>
          </div>
        </div>

        {error ? <Alert tone="danger" title="出错了" onDismiss={() => setError("")}>{error}</Alert> : null}

        <SegmentedControl options={tabOptions} value={tab} onValueChange={changeTab} label="知识库分区" className="self-start" />

        {tab === "documents" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-ink">文档</h2>
                <p className="mt-1 text-sm text-ink-2">查看解析状态和真实分段内容。</p>
              </div>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.pdf,.docx,.json,.csv,.log"
                className="hidden"
                onChange={(event) => uploadFiles(event.target.files)}
              />
              <Button loading={uploading} onClick={() => fileInput.current?.click()}>
                <Plus size={16} strokeWidth={1.75} /> 添加文件
              </Button>
            </div>

            <div className="overflow-hidden rounded-panel border border-line bg-surface">
              <div className="hidden grid-cols-[minmax(220px,1fr)_120px_100px_100px_140px_34px] gap-3 border-b border-line bg-panel px-4 py-2.5 text-xs font-medium text-ink-2 md:grid">
                <span>名称</span>
                <span>状态</span>
                <span>分段</span>
                <span>字符数</span>
                <span>上传时间</span>
                <span />
              </div>
              {documents.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => document.status === "completed" && openChunks(document)}
                  className="grid w-full gap-2 border-b border-line-subtle px-4 py-3 text-left last:border-b-0 hover:bg-surface-raised md:grid-cols-[minmax(220px,1fr)_120px_100px_100px_140px_34px] md:items-center md:gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText size={16} strokeWidth={1.75} className="shrink-0 text-ink-2" />
                    <span className="truncate text-sm font-medium text-ink">{document.name}</span>
                  </span>
                  <span>
                    <Badge size="sm" tone={documentTone(document.status)}>{statusLabel[document.status]}</Badge>
                  </span>
                  <span className="text-xs text-ink-2"><span className="md:hidden">分段 </span>{formatNumber(document.chunk_count)}</span>
                  <span className="text-xs text-ink-2"><span className="md:hidden">字符 </span>{formatNumber(document.character_count)}</span>
                  <span className="text-xs text-ink-2">{formatDate(document.created_at)}</span>
                  {document.status === "failed" ? (
                    <span
                      role="button"
                      title="重试"
                      className="grid h-7 w-7 place-items-center text-danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        void retry(document);
                      }}
                    >
                      <RotateCcw size={14} strokeWidth={1.75} />
                    </span>
                  ) : (
                    <ChevronRight size={16} strokeWidth={1.75} className="hidden text-ink-2 md:block" />
                  )}
                </button>
              ))}
              {!documents.length ? (
                <div className="py-12">
                  <EmptyState
                    icon={<FileText size={18} strokeWidth={1.75} />}
                    title="还没有文档"
                    description="添加一份 Markdown、PDF 或 DOCX 资料，开始构建项目知识库。"
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "retrieval" ? (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-sm font-medium text-ink">召回测试</h2>
              <p className="mt-1 text-sm text-ink-2">输入真实问题，观察被召回的分段、分数和排序。</p>
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.72fr)_minmax(0,1.28fr)]">
              <div className="flex flex-col gap-4">
                <Card>
                  <Textarea
                    label="查询文本"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runRetrieval();
                    }}
                    maxLength={250}
                    placeholder="例如：新员工可以请几天年假？"
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-ink-2">{query.length} / 250</span>
                    <Button loading={testing} disabled={!query.trim()} onClick={runRetrieval}>
                      <Play size={16} strokeWidth={1.75} /> 测试
                    </Button>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                      <History size={16} strokeWidth={1.75} /> 测试记录
                    </h2>
                    <span className="text-xs text-ink-2">最近 {history.length} 条</span>
                  </div>
                  <div className="mt-2 divide-y divide-line-subtle">
                    {history.map((item) => (
                      <div key={item.id} className="py-2.5">
                        <div className="truncate text-sm text-ink-2">{item.query}</div>
                        <div className="mt-1 flex gap-3 text-xs text-ink-2">
                          <span>{item.result_count} 条结果</span>
                          <span>{item.took_ms} ms</span>
                          <span>{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    ))}
                    {!history.length ? <p className="py-8 text-center text-xs text-ink-2">暂无测试记录</p> : null}
                  </div>
                </Card>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                {retrieval?.retrieval_config.pipeline?.stages?.length ? (
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-medium text-ink">检索轨迹</h2>
                      <Badge size="sm" tone={retrieval.retrieval_config.answer_gate?.decision === "answer" ? "success" : "warning"}>
                        {answerGateLabel[String(retrieval.retrieval_config.answer_gate?.decision ?? "")] ?? "等待判断"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {retrieval.retrieval_config.pipeline.stages.map((stage, index) => {
                        const name = String(stage.name ?? "unknown");
                        const outputCount = stage.output_count ?? stage.candidate_count;
                        return (
                          <span key={`${name}-${index}`} className="flex items-center gap-2">
                            {index ? <ChevronRight size={14} strokeWidth={1.75} className="text-ink-2" /> : null}
                            <span className="rounded-control border border-line bg-panel px-2 py-1 text-xs text-ink-2">
                              {pipelineStageLabel[name] ?? name}
                              {typeof outputCount === "number" ? ` · ${outputCount}` : ""}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                    {retrieval.retrieval_config.answer_gate?.reason ? (
                      <p className="mt-3 text-xs leading-5 text-ink-2">{retrieval.retrieval_config.answer_gate.reason}</p>
                    ) : null}
                  </Card>
                ) : null}

                {retrieval?.results.map((result, index) => (
                  <Card key={`${result.document_id}-${index}`}>
                    <div className="flex items-center gap-3 border-b border-line-subtle pb-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-subtle text-xs font-medium text-accent-strong">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium text-ink">{result.title}</h3>
                        <p className="mt-0.5 truncate text-xs text-ink-2">{String(result.metadata.filename ?? result.source_type)}</p>
                      </div>
                      <Badge size="sm" tone="success">{result.score.toFixed(3)}</Badge>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-2">{result.snippet}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-2">
                      <span>分段 #{String(result.metadata.chunk_index ?? index + 1)}</span>
                      <span>{result.snippet.length} 字符</span>
                      <span>{String(result.retrieval.keyword_backend ?? result.retrieval.vector_backend ?? "retrieval")}</span>
                      <span>{String(result.retrieval.fusion_method ?? retrieval.retrieval_config.fusion_method ?? config.retrieval_method)}</span>
                      <span>{String(result.retrieval.rerank_mode ?? result.retrieval.mode ?? "retrieval")}</span>
                    </div>
                  </Card>
                ))}

                {!retrieval ? (
                  <Card>
                    <EmptyState
                      icon={<FileSearch size={18} strokeWidth={1.75} />}
                      title="输入问题后查看真实召回分段"
                      description="测试会使用当前设置中的检索方式、Top K 和阈值。"
                    />
                  </Card>
                ) : null}
                {retrieval && !retrieval.results.length ? (
                  <Card>
                    <EmptyState
                      icon={<FileSearch size={18} strokeWidth={1.75} />}
                      title="没有分段通过当前检索条件"
                      description="可以放宽 Score 阈值，或换一种检索方式再试。"
                    />
                  </Card>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "settings" ? (
          <div className="mx-auto w-full max-w-3xl">
            <Card>
              <h2 className="text-sm font-medium text-ink">知识库设置</h2>
              <p className="mt-1 text-sm text-ink-2">控制后续入库和召回测试使用的模型与参数。</p>
              <div className="mt-5">
                <RetrievalSettings value={config} catalog={catalog} onChange={setConfig} />
              </div>
              {message ? (
                <div className="mt-5">
                  <Alert tone="success" title="已保存">{message}</Alert>
                </div>
              ) : null}
              <div className="mt-6 flex justify-end border-t border-line pt-5">
                <Button loading={saving} disabled={config.chunk_overlap >= config.chunk_size} onClick={saveSettings}>
                  <Save size={16} strokeWidth={1.75} /> 保存设置
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>

      <Drawer
        open={selectedDocument !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedDocument(null);
        }}
      >
        <DrawerContent
          title={shownDocument?.name ?? "文档分段"}
          description={shownDocument ? `${formatNumber(shownDocument.chunk_count)} 个分段 · ${formatBytes(shownDocument.file_size)}` : undefined}
          side="right"
        >
          <div className="flex flex-col gap-3">
            {chunks.map((chunk) => (
              <Panel key={chunk.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-accent-strong">分段 #{chunk.position}</span>
                  <span className="text-xs text-ink-2">{formatNumber(chunk.character_count)} 字符</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{chunk.content}</p>
              </Panel>
            ))}
            {!chunks.length ? <p className="py-8 text-center text-sm text-ink-2">正在读取分段...</p> : null}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
