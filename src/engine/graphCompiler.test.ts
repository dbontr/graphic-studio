import { describe, expect, it } from 'vitest';
import type { StudioEdge, StudioFlowNode } from '../model';
import { compileRenderGraph } from './graphCompiler';

function node(id: string, kind: StudioFlowNode['data']['kind']): StudioFlowNode {
  return {
    id,
    type: 'studio',
    position: { x: 0, y: 0 },
    data: { kind, label: id },
  };
}

describe('multi-input graph compiler', () => {
  it('preserves the flat fast path for unary graphs', () => {
    const nodes = [node('source', 'source'), node('adjust', 'adjust'), node('output', 'output')];
    const edges: StudioEdge[] = [
      { id: 'a', source: 'source', target: 'adjust' },
      { id: 'b', source: 'adjust', target: 'output' },
    ];
    const plan = compileRenderGraph(nodes, edges);
    expect(plan.graph).toBeUndefined();
    expect(plan.stages.map((stage) => stage.id)).toEqual(['adjust']);
  });

  it('compiles a mask as a true two-input graph node', () => {
    const nodes = [
      node('source', 'source'),
      node('grade', 'adjust'),
      node('mask-source', 'curves'),
      { ...node('mask', 'mask'), data: {
        kind: 'mask' as const,
        label: 'Mask',
        maskChannel: 'red' as const,
        maskStrength: 75,
      } },
      node('output', 'output'),
    ];
    const edges: StudioEdge[] = [
      { id: 's-g', source: 'source', target: 'grade' },
      { id: 's-m', source: 'source', target: 'mask-source' },
      { id: 'g-mask', source: 'grade', target: 'mask', targetHandle: 'base' },
      { id: 'm-mask', source: 'mask-source', target: 'mask', targetHandle: 'mask' },
      { id: 'mask-o', source: 'mask', target: 'output' },
    ];
    const plan = compileRenderGraph(nodes, edges);
    expect(plan.graph?.outputId).toBe('output');
    const mask = plan.graph?.nodes.find((entry) => entry.id === 'mask');
    expect(mask?.inputs).toEqual([
      { source: 'grade', port: 'base' },
      { source: 'mask-source', port: 'mask' },
    ]);
  });

  it('fails closed when an enabled mask is missing its mask input', () => {
    const nodes = [node('source', 'source'), node('mask', 'mask'), node('output', 'output')];
    const edges: StudioEdge[] = [
      { id: 'base', source: 'source', target: 'mask', targetHandle: 'base' },
      { id: 'out', source: 'mask', target: 'output' },
    ];
    expect(compileRenderGraph(nodes, edges).signature).toBe('disconnected');
  });

  it('collapses a disabled mask to its base branch', () => {
    const mask = node('mask', 'mask');
    mask.data.enabled = false;
    const nodes = [node('source', 'source'), mask, node('output', 'output')];
    const edges: StudioEdge[] = [
      { id: 'base', source: 'source', target: 'mask', targetHandle: 'base' },
      { id: 'out', source: 'mask', target: 'output' },
    ];
    const plan = compileRenderGraph(nodes, edges);
    expect(plan.signature).toBe('');
    expect(plan.graph).toBeUndefined();
  });

  it('includes mask controls in the semantic graph signature', () => {
    const baseNodes = [
      node('source', 'source'),
      node('mask-source', 'adjust'),
      node('output', 'output'),
    ];
    const makeMask = (strength: number, feather = 0): StudioFlowNode => ({
      ...node('mask', 'mask'),
      data: {
        kind: 'mask',
        label: 'Mask',
        maskChannel: 'luminance',
        maskStrength: strength,
        maskFeather: feather,
      },
    });
    const edges: StudioEdge[] = [
      { id: 'mask-source-input', source: 'source', target: 'mask-source' },
      { id: 'base', source: 'source', target: 'mask', targetHandle: 'base' },
      { id: 'mask', source: 'mask-source', target: 'mask', targetHandle: 'mask' },
      { id: 'out', source: 'mask', target: 'output' },
    ];
    const first = compileRenderGraph([...baseNodes, makeMask(25)], edges);
    const second = compileRenderGraph([...baseNodes, makeMask(80)], edges);
    const feathered = compileRenderGraph([...baseNodes, makeMask(25, 9)], edges);
    expect(first.signature).not.toBe(second.signature);
    expect(first.signature).not.toBe(feathered.signature);
  });
});
