import { describe, expect, it } from 'vitest';
import type { StudioEdge, StudioFlowNode } from './model';
import { collapseSelectionToSubgraph, expandSubgraphs } from './subgraphs';

function node(id: string, kind: StudioFlowNode['data']['kind'], x: number, data: Record<string, unknown> = {}): StudioFlowNode {
  return {
    id,
    type: 'studio',
    position: { x, y: 40 },
    data: { kind, label: id, ...data } as StudioFlowNode['data'],
  };
}

const nodes = [
  node('source', 'source', 0),
  node('adjust', 'adjust', 250, { brightness: 12, contrast: 8 }),
  node('posterize', 'posterize', 500, { levels: 5 }),
  node('output', 'output', 750),
];

const edges: StudioEdge[] = [
  { id: 'a', source: 'source', target: 'adjust' },
  { id: 'b', source: 'adjust', target: 'posterize' },
  { id: 'c', source: 'posterize', target: 'output' },
];

describe('reusable subgraphs', () => {
  it('collapses a one-in one-out selection and reconnects the outer graph', () => {
    const result = collapseSelectionToSubgraph(nodes, edges, new Set(['adjust', 'posterize']), 'subgraph-1', 'Look');
    expect(result.error).toBeUndefined();
    expect(result.node?.data.kind).toBe('subgraph');
    expect(result.node?.data.subgraph?.nodes).toHaveLength(2);
    expect(result.edges.some((edge) => edge.source === 'source' && edge.target === 'subgraph-1')).toBe(true);
    expect(result.edges.some((edge) => edge.source === 'subgraph-1' && edge.target === 'output')).toBe(true);
  });

  it('expands a collapsed subgraph back into renderable internal nodes', () => {
    const collapsed = collapseSelectionToSubgraph(nodes, edges, new Set(['adjust', 'posterize']), 'subgraph-1', 'Look');
    const expanded = expandSubgraphs(collapsed.nodes, collapsed.edges);
    expect(expanded.error).toBeUndefined();
    expect(expanded.nodes.some((entry) => entry.id === 'subgraph-1')).toBe(false);
    expect(expanded.nodes.some((entry) => entry.id === 'subgraph-1::adjust')).toBe(true);
    expect(expanded.nodes.some((entry) => entry.id === 'subgraph-1::posterize')).toBe(true);
    expect(expanded.edges.some((edge) => edge.source === 'source' && edge.target === 'subgraph-1::adjust')).toBe(true);
    expect(expanded.edges.some((edge) => edge.source === 'subgraph-1::posterize' && edge.target === 'output')).toBe(true);
  });

  it('applies exposed subgraph values to the matching internal parameter', () => {
    const collapsed = collapseSelectionToSubgraph(nodes, edges, new Set(['adjust', 'posterize']), 'subgraph-1', 'Look');
    const outer = collapsed.nodes.find((entry) => entry.id === 'subgraph-1')!;
    const brightnessBinding = outer.data.subgraph!.bindings.find((binding) => binding.property === 'brightness')!;
    outer.data.subgraphValues = {
      ...(outer.data.subgraphValues ?? {}),
      [brightnessBinding.key]: 77,
    };
    const expanded = expandSubgraphs(collapsed.nodes, collapsed.edges);
    const adjust = expanded.nodes.find((entry) => entry.id === 'subgraph-1::adjust');
    expect(adjust?.data.brightness).toBe(77);
  });

  it('rejects selections with ambiguous external topology', () => {
    const branchedNodes = [...nodes, node('extra', 'adjust', 500)];
    const branchedEdges: StudioEdge[] = [
      ...edges,
      { id: 'extra-in', source: 'source', target: 'extra' },
      { id: 'extra-out', source: 'extra', target: 'output' },
    ];
    const result = collapseSelectionToSubgraph(
      branchedNodes,
      branchedEdges,
      new Set(['adjust', 'posterize', 'extra']),
      'bad',
    );
    expect(result.error).toMatch(/exactly one external input/i);
  });

  it('rejects Source and Output inside a subgraph selection', () => {
    const result = collapseSelectionToSubgraph(nodes, edges, new Set(['source', 'adjust']), 'bad');
    expect(result.error).toMatch(/Source and Output/i);
  });
});
