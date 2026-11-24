import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
  WorkspaceSelection,
  WorkspaceTab
} from "./types";

export function knowledgeGraphNodeKey(node: KnowledgeGraphNode) {
  return `${node.type}:${node.id}`;
}

export function workspaceSelectionToGraphCenter(selection: WorkspaceSelection): { type: string; id: string } | null {
  if (selection.type === "issue") return { type: "issue", id: selection.id };
  if (selection.type === "pr") return { type: "pull_request", id: selection.id };
  if (selection.type === "ci") return { type: "ci_run", id: selection.id };
  return null;
}

export function openGraphNodeInWorkspace(
  node: KnowledgeGraphNode,
  setWorkspaceTab: (tab: WorkspaceTab) => void,
  setSelectedWorkspaceItem: (item: WorkspaceSelection | null) => void,
  preserveSelectionRef: { current: boolean }
) {
  if (node.type === "issue") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("Issue");
    setSelectedWorkspaceItem({ type: "issue", id: node.id });
    return;
  }
  if (node.type === "pull_request") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("PR");
    setSelectedWorkspaceItem({ type: "pr", id: node.id });
    return;
  }
  if (node.type === "ci_run") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("CI");
    setSelectedWorkspaceItem({ type: "ci", id: node.id });
    return;
  }
  setWorkspaceTab(node.type === "team_member" ? "团队" : "记忆&知识库");
  setSelectedWorkspaceItem(null);
}

export function graphNodeTypeLabel(type: string) {
  const labels: Record<string, string> = {
    issue: "Issue",
    pull_request: "PR",
    ci_run: "CI",
    team_member: "成员",
    memory_note: "记忆",
    document: "文档",
    code_file: "代码",
    session_decision: "决策"
  };
  return labels[type] ?? type;
}

export function graphRelationLabel(relation: string) {
  const labels: Record<string, string> = {
    resolves: "修复",
    mentions: "提及",
    assigned_to: "分配",
    blocked_by: "阻塞",
    failed_in_ci: "CI失败",
    touches_file: "改动",
    documents: "说明",
    cites: "引用",
    produced_from_session: "沉淀",
    used_as_evidence: "召回"
  };
  return labels[relation] ?? relation.replace(/_/g, " ");
}

export function graphNodeStyle(type: string) {
  const styles: Record<string, { fill: string; stroke: string }> = {
    issue: { fill: "#fef3c7", stroke: "#d97706" },
    pull_request: { fill: "#ccfbf1", stroke: "#0f766e" },
    ci_run: { fill: "#fee2e2", stroke: "#dc2626" },
    team_member: { fill: "#e0e7ff", stroke: "#4f46e5" },
    memory_note: { fill: "#fce7f3", stroke: "#be185d" },
    document: { fill: "#dbeafe", stroke: "#2563eb" },
    code_file: { fill: "#dcfce7", stroke: "#16a34a" },
    session_decision: { fill: "#f3e8ff", stroke: "#9333ea" }
  };
  return styles[type] ?? { fill: "#f1f5f9", stroke: "#64748b" };
}

export function graphRelationColor(relation: string) {
  const colors: Record<string, string> = {
    resolves: "#16a34a",
    mentions: "#64748b",
    assigned_to: "#4f46e5",
    blocked_by: "#dc2626",
    failed_in_ci: "#ef4444",
    touches_file: "#0f766e",
    documents: "#2563eb",
    cites: "#be185d",
    produced_from_session: "#9333ea",
    used_as_evidence: "#f97316"
  };
  return colors[relation] ?? "#64748b";
}

export function graphStatNumber(graph: KnowledgeGraphResponse | null, key: string, fallback: number) {
  const value = graph?.stats?.[key];
  return typeof value === "number" ? value : fallback;
}

export function clipGraphLabel(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
}

function graphNodeMatches(node: KnowledgeGraphNode, query: string) {
  const metadataText = Object.values(node.metadata ?? {})
    .slice(0, 6)
    .join(" ")
    .toLowerCase();
  return `${node.title} ${node.subtitle ?? ""} ${node.type} ${metadataText}`.toLowerCase().includes(query);
}

export function filterKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  query: string,
  hiddenNodeTypes: Record<string, boolean>,
  hiddenRelations: Record<string, boolean>
) {
  const normalizedQuery = query.trim().toLowerCase();
  const baseAllowed = new Set(
    nodes.filter((node) => !hiddenNodeTypes[node.type]).map((node) => knowledgeGraphNodeKey(node))
  );
  const matches = new Set(
    nodes
      .filter((node) => baseAllowed.has(knowledgeGraphNodeKey(node)))
      .filter((node) => !normalizedQuery || graphNodeMatches(node, normalizedQuery))
      .map((node) => knowledgeGraphNodeKey(node))
  );
  if (normalizedQuery) {
    for (const edge of edges) {
      if (hiddenRelations[edge.relation]) continue;
      const fromKey = `${edge.from_type}:${edge.from_id}`;
      const toKey = `${edge.to_type}:${edge.to_id}`;
      const relationMatches =
        graphRelationLabel(edge.relation).toLowerCase().includes(normalizedQuery) ||
        edge.relation.toLowerCase().includes(normalizedQuery);
      if (relationMatches || matches.has(fromKey) || matches.has(toKey)) {
        if (baseAllowed.has(fromKey)) matches.add(fromKey);
        if (baseAllowed.has(toKey)) matches.add(toKey);
      }
    }
  }
  const allowed = normalizedQuery ? matches : baseAllowed;
  const visibleEdges = edges.filter((edge) => {
    if (hiddenRelations[edge.relation]) return false;
    return allowed.has(`${edge.from_type}:${edge.from_id}`) && allowed.has(`${edge.to_type}:${edge.to_id}`);
  });
  return {
    nodes: nodes.filter((node) => allowed.has(knowledgeGraphNodeKey(node))),
    edges: visibleEdges
  };
}

function placeGraphRing(
  positions: Map<string, { x: number; y: number }>,
  nodes: KnowledgeGraphNode[],
  cx: number,
  cy: number,
  radius: number,
  start: number
) {
  if (nodes.length === 0) return;
  nodes.forEach((node, index) => {
    const angle = start + (Math.PI * 2 * index) / nodes.length;
    positions.set(knowledgeGraphNodeKey(node), {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    });
  });
}

export function layoutKnowledgeGraph(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[], centerKey?: string) {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;
  const degrees = new Map<string, number>();
  for (const node of nodes) degrees.set(knowledgeGraphNodeKey(node), 0);
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    degrees.set(fromKey, (degrees.get(fromKey) ?? 0) + 1);
    degrees.set(toKey, (degrees.get(toKey) ?? 0) + 1);
  }
  const requestedCenter = centerKey ? nodes.find((node) => knowledgeGraphNodeKey(node) === centerKey) : undefined;
  const resolvedCenter =
    requestedCenter ??
    [...nodes].sort((a, b) => (degrees.get(knowledgeGraphNodeKey(b)) ?? 0) - (degrees.get(knowledgeGraphNodeKey(a)) ?? 0))[0];
  const centerNodeKey = knowledgeGraphNodeKey(resolvedCenter);
  positions.set(centerNodeKey, { x: 360, y: 190 });
  const neighborKeys = new Set<string>();
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    if (fromKey === centerNodeKey) neighborKeys.add(toKey);
    if (toKey === centerNodeKey) neighborKeys.add(fromKey);
  }
  const neighbors = nodes.filter((node) => neighborKeys.has(knowledgeGraphNodeKey(node)));
  const remaining = nodes.filter(
    (node) => knowledgeGraphNodeKey(node) !== centerNodeKey && !neighborKeys.has(knowledgeGraphNodeKey(node))
  );
  placeGraphRing(positions, neighbors, 360, 190, neighbors.length > 10 ? 145 : 122, -Math.PI / 2);
  placeGraphRing(positions, remaining, 360, 190, 184, Math.PI / 9);
  return positions;
}
