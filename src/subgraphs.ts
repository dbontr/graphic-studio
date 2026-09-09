import type {
  StudioEdge,
  StudioFlowNode,
  StudioNodeData,
  SubgraphBinding,
  SubgraphDefinition,
} from './model';

const STRUCTURAL_KEYS = new Set([
  'kind', 'label', 'enabled', 'fileName', 'subgraph', 'subgraphValues',
  'customPalette', 'gradientStops', 'curveMaster', 'curveRed', 'curveGreen', 'curveBlue',
]);

function cloneNode(node: StudioFlowNode): StudioFlowNode {
  return {
    ...node,
    selected: false,
    position: { ...node.position },
    data: structuredClone(node.data),
  };
}

function bindingRange(property: string): Pick<SubgraphBinding, 'min' | 'max' | 'step'> {
  if (/opacity|strength|saturation|threshold|tolerance|center/i.test(property)) return { min: 0, max: 100, step: 1 };
  if (/gamma|lineHeight/i.test(property)) return { min: 0.1, max: 4, step: 0.05 };
  if (/angle|rotation/i.test(property)) return { min: -180, max: 180, step: 1 };
  if (/size|radius|scale|width|height/i.test(property)) return { min: 0, max: 2048, step: 1 };
  return { min: -255, max: 255, step: 1 };
}

function inferBinding(node: StudioFlowNode, property: string, value: unknown): SubgraphBinding | null {
  if (STRUCTURAL_KEYS.has(property) || value === undefined || value === null) return null;
  let valueType: SubgraphBinding['valueType'];
  if (typeof value === 'number') valueType = 'number';
  else if (typeof value === 'boolean') valueType = 'boolean';
  else if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) valueType = 'color';
  else if (typeof value === 'string') valueType = 'string';
  else return null;
  return {
    key: `${node.id}.${property}`,
    label: `${node.data.label} · ${property.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}`,
    nodeId: node.id,
    property,
    valueType,
    ...(valueType === 'number' ? bindingRange(property) : {}),
  };
}

export interface SubgraphCollapseResult {
  nodes: StudioFlowNode[];
  edges: StudioEdge[];
  node?: StudioFlowNode;
  error?: string;
}

export function collapseSelectionToSubgraph(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
  selectedIds: Set<string>,
  id: string,
  name = 'Subgraph',
): SubgraphCollapseResult {
  if (selectedIds.size < 2) return { nodes, edges, error: 'Select at least two nodes.' };
  const selected = nodes.filter((node) => selectedIds.has(node.id));
  if (selected.some((node) => node.data.kind === 'source' || node.data.kind === 'output')) {
    return { nodes, edges, error: 'Source and Output cannot be collapsed into a subgraph.' };
  }
  const incoming = edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoing = edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  if (incoming.length !== 1 || outgoing.length !== 1) {
    return { nodes, edges, error: 'A subgraph selection needs exactly one external input and one external output.' };
  }

  const internalEdges = edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const minX = Math.min(...selected.map((node) => node.position.x));
  const minY = Math.min(...selected.map((node) => node.position.y));
  const maxX = Math.max(...selected.map((node) => node.position.x));
  const maxY = Math.max(...selected.map((node) => node.position.y));
  const bindings = selected.flatMap((node) =>
    Object.entries(node.data)
      .map(([property, value]) => inferBinding(node, property, value))
      .filter((binding): binding is SubgraphBinding => Boolean(binding)),
  );
  const values = Object.fromEntries(bindings.map((binding) => {
    const owner = selected.find((node) => node.id === binding.nodeId)!;
    return [binding.key, owner.data[binding.property]];
  }));

  const definition: SubgraphDefinition = {
    version: 1,
    id: `definition-${id}`,
    name,
    nodes: selected.map((node) => ({
      ...cloneNode(node),
      position: { x: node.position.x - minX, y: node.position.y - minY },
    })),
    edges: internalEdges.map((edge) => ({ ...edge })),
    inputNodeId: incoming[0].target,
    inputTargetHandle: incoming[0].targetHandle ?? null,
    outputNodeId: outgoing[0].source,
    outputSourceHandle: outgoing[0].sourceHandle ?? null,
    bindings,
  };

  const subgraphNode: StudioFlowNode = {
    id,
    type: 'studio',
    position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    selected: true,
    data: {
      kind: 'subgraph',
      label: name,
      subgraph: definition,
      subgraphValues: values,
    },
  };

  const remainingNodes = nodes.filter((node) => !selectedIds.has(node.id)).map((node) => ({ ...node, selected: false }));
  const remainingEdges = edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  remainingEdges.push({
    ...incoming[0],
    id: `${incoming[0].id}-subgraph`,
    target: id,
    targetHandle: null,
  });
  remainingEdges.push({
    ...outgoing[0],
    id: `${outgoing[0].id}-subgraph`,
    source: id,
    sourceHandle: null,
  });
  return { nodes: [...remainingNodes, subgraphNode], edges: remainingEdges, node: subgraphNode };
}

function applyBindings(data: StudioNodeData, definition: SubgraphDefinition, values: Record<string, unknown>): StudioNodeData {
  const patch: Record<string, unknown> = {};
  for (const binding of definition.bindings) {
    if (binding.nodeId === (data as { __subgraphNodeId?: string }).__subgraphNodeId && binding.key in values) {
      patch[binding.property] = values[binding.key];
    }
  }
  const clean = { ...data, ...patch } as Record<string, unknown>;
  delete clean.__subgraphNodeId;
  return clean as StudioNodeData;
}

export interface ExpandedGraph {
  nodes: StudioFlowNode[];
  edges: StudioEdge[];
  error?: string;
}

function expandOne(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
  outer: StudioFlowNode,
): ExpandedGraph {
  const definition = outer.data.subgraph;
  if (!definition || definition.version !== 1) return { nodes, edges, error: `Subgraph ${outer.id} has no valid definition.` };
  const prefix = `${outer.id}::`;
  const values = outer.data.subgraphValues ?? {};
  const internalNodes = definition.nodes.map((node) => {
    const tagged = { ...structuredClone(node.data), __subgraphNodeId: node.id } as StudioNodeData;
    return {
      ...cloneNode(node),
      id: `${prefix}${node.id}`,
      data: applyBindings(tagged, definition, values),
    };
  });
  const internalEdges = definition.edges.map((edge) => ({
    ...edge,
    id: `${prefix}${edge.id}`,
    source: `${prefix}${edge.source}`,
    target: `${prefix}${edge.target}`,
  }));
  const outerIncoming = edges.filter((edge) => edge.target === outer.id);
  const outerOutgoing = edges.filter((edge) => edge.source === outer.id);
  if (outerIncoming.length !== 1 || outerOutgoing.length < 1) {
    return { nodes, edges, error: `Subgraph ${outer.id} is disconnected.` };
  }
  const bridgedIncoming: StudioEdge = {
    ...outerIncoming[0],
    id: `${prefix}external-in`,
    target: `${prefix}${definition.inputNodeId}`,
    targetHandle: definition.inputTargetHandle ?? null,
  };
  const bridgedOutgoing = outerOutgoing.map((edge, index) => ({
    ...edge,
    id: `${prefix}external-out-${index}`,
    source: `${prefix}${definition.outputNodeId}`,
    sourceHandle: definition.outputSourceHandle ?? null,
  }));
  return {
    nodes: [...nodes.filter((node) => node.id !== outer.id), ...internalNodes],
    edges: [
      ...edges.filter((edge) => edge.target !== outer.id && edge.source !== outer.id),
      ...internalEdges,
      bridgedIncoming,
      ...bridgedOutgoing,
    ],
  };
}

export function expandSubgraphs(nodes: StudioFlowNode[], edges: StudioEdge[]): ExpandedGraph {
  let currentNodes = nodes.map(cloneNode);
  let currentEdges = edges.map((edge) => ({ ...edge }));
  for (let depth = 0; depth < 8; depth += 1) {
    const subgraph = currentNodes.find((node) => node.data.kind === 'subgraph');
    if (!subgraph) return { nodes: currentNodes, edges: currentEdges };
    const expanded = expandOne(currentNodes, currentEdges, subgraph);
    if (expanded.error) return expanded;
    currentNodes = expanded.nodes;
    currentEdges = expanded.edges;
  }
  return { nodes: currentNodes, edges: currentEdges, error: 'Subgraph nesting exceeds eight levels.' };
}
