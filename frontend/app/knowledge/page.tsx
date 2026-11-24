"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, Database, FileText } from "lucide-react";

import { Alert } from "@/components/arc/alert/alert";
import { Badge } from "@/components/arc/badge/badge";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { SearchField } from "@/components/arc/search-field/search-field";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Card, PageTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api";
import { formatDate, formatNumber, type KnowledgeBase } from "@/lib/rag";

export default function KnowledgeBasesPage() {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiGet<KnowledgeBase[]>("/api/rag/repositories")
      .then(setItems)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  const visible = items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <PageTitle title="项目知识" description="每个 GitHub Repository 拥有独立的文档、分段和检索配置。" />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full max-w-sm">
            <SearchField label="搜索项目" placeholder="按名称或描述搜索" value={query} onValueChange={setQuery} />
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-2 rounded-control border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-raised"
          >
            <Database size={16} strokeWidth={1.75} /> 连接仓库
          </Link>
        </div>

        {error ? <Alert tone="danger" title="读取知识库失败">{error}</Alert> : null}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <Skeleton lines={4} />
              </Card>
            ))}
          </div>
        ) : null}

        {!loading && !visible.length ? (
          <Card>
            <EmptyState
              icon={<BookOpen size={18} strokeWidth={1.75} />}
              title={query ? "没有匹配的项目" : "先连接一个 GitHub 仓库"}
              description={
                query
                  ? "换个名称或描述试试。"
                  : "Repository 是 RAG 的项目边界。连接仓库后，再上传 Markdown、PDF、DOCX 等项目资料。"
              }
            />
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <Card key={item.id} className="relative transition-colors hover:border-line-strong">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-accent-subtle text-accent-strong">
                    <BookOpen size={18} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium text-ink">{item.name}</h2>
                    <p className="mt-0.5 text-xs text-ink-2">更新于 {formatDate(item.updated_at)}</p>
                  </div>
                </div>
                <ArrowRight size={16} strokeWidth={1.75} className="mt-1 shrink-0 text-ink-2" />
              </div>
              <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-ink-2">{item.description || "暂无描述"}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle pt-3 text-xs text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={14} strokeWidth={1.75} /> {formatNumber(item.document_count)} 文档
                </span>
                <span>{formatNumber(item.chunk_count)} 分段</span>
                <Badge size="sm" tone={item.runtime.embedding.available ? "success" : "warning"}>
                  {item.runtime.embedding.available ? "模型就绪" : "降级运行"}
                </Badge>
              </div>
              <Link href={`/knowledge/${item.id}`} className="absolute inset-0" aria-label={`打开 ${item.name}`} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
