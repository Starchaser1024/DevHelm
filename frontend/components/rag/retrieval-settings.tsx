"use client";

import { Check, FileSearch, Layers3, Search } from "lucide-react";

import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Slider } from "@/components/arc/slider/slider";
import { Switch } from "@/components/arc/switch/switch";
import type { KnowledgeConfig, ModelCatalog, RetrievalMethod } from "@/lib/rag";

type Props = {
  value: KnowledgeConfig;
  catalog: ModelCatalog | null;
  onChange: (value: KnowledgeConfig) => void;
  showChunking?: boolean;
};

const methods: { value: RetrievalMethod; label: string; note: string; icon: typeof Search }[] = [
  { value: "vector", label: "向量检索", note: "擅长理解语义相近的表达", icon: Layers3 },
  { value: "fulltext", label: "全文检索", note: "适合专有名词与精确关键词", icon: FileSearch },
  { value: "hybrid", label: "混合检索", note: "融合语义与关键词结果", icon: Search }
];

export function RetrievalSettings({ value, catalog, onChange, showChunking = true }: Props) {
  const update = <K extends keyof KnowledgeConfig,>(key: K, next: KnowledgeConfig[K]) => onChange({ ...value, [key]: next });

  const embeddingOptions =
    catalog?.embedding_models.map((model) => ({
      value: `${model.provider}::${model.model}`,
      label: `${model.label}${model.available ? "" : " · 未配置，自动降级"}`
    })) ?? [{ value: `${value.embedding_provider}::${value.embedding_model}`, label: value.embedding_model }];

  const rerankOptions =
    catalog?.rerank_models.map((model) => ({
      value: `${model.provider}::${model.model}`,
      label: `${model.label}${model.available ? "" : " · 未配置，自动降级"}`
    })) ?? [{ value: `${value.rerank_provider}::${value.rerank_model}`, label: value.rerank_model }];

  function pickEmbedding(selected: string) {
    const [provider, model] = selected.split("::");
    const entry = catalog?.embedding_models.find((item) => item.provider === provider && item.model === model);
    onChange({ ...value, embedding_provider: provider, embedding_model: model, embedding_dimensions: entry?.dimensions ?? value.embedding_dimensions });
  }

  return (
    <div className="flex flex-col gap-7">
      {showChunking ? (
        <section>
          <h3 className="text-sm font-medium text-ink">分段设置</h3>
          <p className="mt-1 text-xs leading-5 text-ink-2">按自然段落切分，过长段落会继续按长度拆开。</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Input label="最大分段长度" type="number" min={200} max={4000} value={value.chunk_size} onChange={(event) => update("chunk_size", Number(event.target.value))} />
            <Input label="分段重叠长度" type="number" min={0} max={1000} value={value.chunk_overlap} onChange={(event) => update("chunk_overlap", Number(event.target.value))} />
          </div>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-medium text-ink">索引方式</h3>
        <p className="mt-1 text-xs leading-5 text-ink-2">DeepSeek 官方 API 暂无 Embedding，默认使用 Qwen。</p>
        <div className="mt-3">
          <Select label="Embedding 模型" value={`${value.embedding_provider}::${value.embedding_model}`} onValueChange={pickEmbedding} options={embeddingOptions} />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-ink">检索方式</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {methods.map((method) => {
            const Icon = method.icon;
            const selected = value.retrieval_method === method.value;
            return (
              <button
                key={method.value}
                type="button"
                aria-pressed={selected}
                onClick={() => update("retrieval_method", method.value)}
                className={`relative min-h-28 rounded-control border p-3 text-left transition-colors ${
                  selected ? "border-accent bg-accent-subtle" : "border-line bg-panel hover:border-line-strong"
                }`}
              >
                {selected ? <Check size={16} strokeWidth={1.75} className="absolute right-2 top-2 text-accent-strong" /> : null}
                <Icon size={18} strokeWidth={1.75} className={selected ? "text-accent-strong" : "text-ink-2"} />
                <span className="mt-3 block text-sm font-medium text-ink">{method.label}</span>
                <span className="mt-1 block text-xs leading-5 text-ink-2">{method.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-line pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-ink">Rerank 模型</h3>
            <p className="mt-1 text-xs leading-5 text-ink-2">对召回候选重新排序，API 不可用时自动使用本地重排。</p>
          </div>
          <Switch checked={value.rerank_enabled} onCheckedChange={(next) => update("rerank_enabled", next)} aria-label="启用 Rerank" />
        </div>
        {value.rerank_enabled ? (
          <div className="mt-3">
            <Select
              label="Rerank 模型"
              value={`${value.rerank_provider}::${value.rerank_model}`}
              onValueChange={(selected) => {
                const [provider, model] = selected.split("::");
                onChange({ ...value, rerank_provider: provider, rerank_model: model });
              }}
              options={rerankOptions}
            />
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 border-t border-line pt-5 sm:grid-cols-2">
        <Slider label="Top K" min={1} max={10} value={value.top_k} onValueChange={(next) => update("top_k", next)} />
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">启用 Score 阈值</span>
            <Switch checked={value.score_threshold_enabled} onCheckedChange={(next) => update("score_threshold_enabled", next)} aria-label="启用 Score 阈值" />
          </div>
          <Slider
            label="Score 阈值"
            min={0}
            max={1}
            step={0.01}
            value={value.score_threshold}
            disabled={!value.score_threshold_enabled}
            format={(item) => item.toFixed(2)}
            onValueChange={(next) => update("score_threshold", next)}
          />
        </div>
      </section>
    </div>
  );
}
