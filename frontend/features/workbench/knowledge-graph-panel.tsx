import { Database, Network, RefreshCw, Search, X } from "lucide-react";
import { useMemo } from "react";

import {
  clipGraphLabel,
  filterKnowledgeGraph,
  graphNodeStyle,
  graphNodeTypeLabel,
  graphRelationColor,
  graphRelationLabel,
  graphStatNumber,
  knowledgeGraphNodeKey,
  layoutKnowledgeGraph
} from "./graph-helpers";
import type { KnowledgeGraphNode, KnowledgeGraphResponse } from "./types";

export function KnowledgeGraphWorkspace({
  graph,
  loading,
  error,
  query,
  selectedNodeKey,
  hiddenNodeTypes,
  hiddenRelations,
  onQueryChange,
  onSelectNode,
  onToggleNodeType,
  onToggleRelation,
  onRefresh,
  onRebuild,
  onFocusNode,
  onOpenNode
}: {
  graph: KnowledgeGraphResponse | null;
  loading: boolean;
  error: string | null;
  query: string;
  selectedNodeKey: string | null;
  hiddenNodeTypes: Record<string, boolean>;
  hiddenRelations: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onSelectNode: (value: string) => void;
  onToggleNodeType: (type: string) => void;
  onToggleRelation: (relation: string) => void;
  onRefresh: () => void;
  onRebuild: () => void;
  onFocusNode: (node: KnowledgeGraphNode) => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
}) {
  const allNodes = useMemo(() => graph?.nodes ?? [], [graph?.nodes]);
  const allEdges = useMemo(() => graph?.edges ?? [], [graph?.edges]);
  const nodeByKey = useMemo(() => new Map(allNodes.map((node) => [knowledgeGraphNodeKey(node), node])), [allNodes]);
  const nodeTypes = useMemo(() => [...new Set(allNodes.map((node) => node.type))], [allNodes]);
  const relations = useMemo(() => [...new Set(allEdges.map((edge) => edge.relation))], [allEdges]);
  const filtered = useMemo(
    () => filterKnowledgeGraph(allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations),
    [allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations]
  );
  const centerKey = graph?.center_type && graph.center_id ? `${graph.center_type}:${graph.center_id}` : undefined;
  const positions = useMemo(() => layoutKnowledgeGraph(filtered.nodes, filtered.edges, centerKey), [filtered.nodes, filtered.edges, centerKey]);
  const selectedNode =
    (selectedNodeKey && filtered.nodes.find((node) => knowledgeGraphNodeKey(node) === selectedNodeKey)) ?? filtered.nodes[0] ?? null;
  const selectedEdges = selectedNode
    ? filtered.edges.filter(
        (edge) =>
          (edge.from_type === selectedNode.type && edge.from_id === selectedNode.id) ||
          (edge.to_type === selectedNode.type && edge.to_id === selectedNode.id)
      )
    : [];
  const showEdgeLabels = filtered.edges.length <= 8;
  const visibleNodeCount = graphStatNumber(graph, "visible_nodes", allNodes.length);
  const visibleEdgeCount = graphStatNumber(graph, "visible_edges", allEdges.length);
  const totalEdgeCount = graphStatNumber(graph, "total_edges", allEdges.length);

  return (
    <div className="space-y-3">
      <section className="rounded-control border border-line bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">项目知识图谱</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-2">把 Issue、PR、CI、成员、文档、记忆和代码文件按可追溯关系串起来。</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="刷新图谱"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-line text-ink-2 transition hover:bg-panel disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onRebuild}
              disabled={loading}
              title="重建关系边"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-line text-ink-2 transition hover:bg-panel disabled:opacity-50"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-2">
          <div className="rounded-control bg-panel px-3 py-2">节点 {visibleNodeCount}</div>
          <div className="rounded-control bg-panel px-3 py-2">关系 {visibleEdgeCount}</div>
          <div className="rounded-control bg-panel px-3 py-2">总边 {totalEdgeCount}</div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-control border border-line bg-surface px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-2" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索节点或关系..."
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button type="button" onClick={() => onQueryChange("")} className="text-ink-2 hover:text-ink-2" title="清空搜索">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {Boolean(nodeTypes.length) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nodeTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onToggleNodeType(type)}
                className={`rounded-control border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenNodeTypes[type] ? "border-line bg-surface text-ink-2" : "border-transparent bg-panel text-ink"
                }`}
              >
                {graphNodeTypeLabel(type)}
              </button>
            ))}
          </div>
        )}

        {Boolean(relations.length) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {relations.map((relation) => (
              <button
                key={relation}
                type="button"
                onClick={() => onToggleRelation(relation)}
                className={`rounded-control border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenRelations[relation] ? "border-line bg-surface text-ink-2" : "border-transparent bg-panel text-ink"
                }`}
              >
                {graphRelationLabel(relation)}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="rounded-control border border-danger-subtle bg-danger-subtle p-3 text-sm text-danger">{error}</div>}

      {!error && !loading && (!graph || graph.nodes.length === 0) && (
        <div className="rounded-control border border-line bg-surface p-4 text-sm text-ink-2">还没有可展示的项目关系。同步 Issue/PR/CI，或添加项目记忆后再重建图谱。</div>
      )}

      {loading && !graph && <div className="rounded-control border border-line bg-surface p-4 text-sm text-ink-2">正在加载项目知识图谱...</div>}

      {graph && filtered.nodes.length === 0 && (
        <div className="rounded-control border border-line bg-surface p-4 text-sm text-ink-2">当前搜索或过滤条件下没有匹配节点。</div>
      )}

      {graph && filtered.nodes.length > 0 && (
        <section className="rounded-control border border-line bg-surface p-3">
          <div className="overflow-x-auto rounded-control bg-panel">
            <svg viewBox="0 0 720 420" className="h-[360px] min-w-[680px] w-full" role="img" aria-label="项目知识图谱">
              {filtered.edges.map((edge) => {
                const from = positions.get(`${edge.from_type}:${edge.from_id}`);
                const to = positions.get(`${edge.to_type}:${edge.to_id}`);
                if (!from || !to) return null;
                const color = graphRelationColor(edge.relation);
                return (
                  <g key={edge.id}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={edge.relation === "used_as_evidence" ? 2.8 : 1.6} strokeOpacity="0.58" />
                    {showEdgeLabels && (
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} textAnchor="middle" fontSize="10" fill={color} fontWeight="700">
                        {graphRelationLabel(edge.relation)}
                      </text>
                    )}
                  </g>
                );
              })}
              {filtered.nodes.map((node) => {
                const pos = positions.get(knowledgeGraphNodeKey(node));
                if (!pos) return null;
                const selected = selectedNode ? knowledgeGraphNodeKey(selectedNode) === knowledgeGraphNodeKey(node) : false;
                const style = graphNodeStyle(node.type);
                return (
                  <g key={knowledgeGraphNodeKey(node)} role="button" tabIndex={0} onClick={() => onSelectNode(knowledgeGraphNodeKey(node))} className="cursor-pointer">
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={selected ? 19 : 15}
                      fill={node.highlighted ? "#fff7ed" : style.fill}
                      stroke={node.highlighted ? "#f97316" : selected ? "#111827" : style.stroke}
                      strokeWidth={node.highlighted || selected ? 2.6 : 1.6}
                    />
                    <text x={pos.x} y={pos.y + 34} textAnchor="middle" fontSize="11" fontWeight={selected ? "700" : "600"} fill="#334155">
                      {clipGraphLabel(node.title, 18)}
                    </text>
                    <text x={pos.x} y={pos.y + 48} textAnchor="middle" fontSize="9" fill="#64748b">
                      {graphNodeTypeLabel(node.type)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {selectedNode && (
            <div className="mt-3 rounded-control border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-accent">{graphNodeTypeLabel(selectedNode.type)}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{selectedNode.title}</div>
                  {selectedNode.subtitle && <div className="mt-1 text-xs text-ink-2">{selectedNode.subtitle}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFocusNode(selectedNode)}
                    className="rounded-control border border-line px-2 py-1 text-xs text-ink-2 transition hover:bg-panel"
                  >
                    聚焦
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenNode(selectedNode)}
                    className="rounded-control bg-accent px-2 py-1 text-xs font-medium text-white transition hover:bg-accent"
                  >
                    打开
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {selectedEdges.length === 0 && <div className="text-xs text-ink-2">这个节点暂时没有可见关系。</div>}
                {selectedEdges.slice(0, 8).map((edge) => {
                  const isOutgoing = edge.from_type === selectedNode.type && edge.from_id === selectedNode.id;
                  const other = nodeByKey.get(isOutgoing ? `${edge.to_type}:${edge.to_id}` : `${edge.from_type}:${edge.from_id}`);
                  return (
                    <div key={edge.id} className="rounded-control bg-panel px-3 py-2 text-xs text-ink-2">
                      <span className="font-medium text-ink">{isOutgoing ? "→" : "←"} {graphRelationLabel(edge.relation)}</span>
                      <span className="ml-2">{other?.title ?? edge.to_id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
