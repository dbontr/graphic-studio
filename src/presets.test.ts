import { describe, expect, it } from 'vitest';
import type { StudioEdge, StudioFlowNode } from './model';
import {
  BUILTIN_PRESETS,
  createPresetFromSelection,
  instantiatePreset,
  isPresetManifest,
  parsePreset,
  serializePreset,
} from './presets';

function node(id: string, kind: StudioFlowNode['data']['kind'], x: number): StudioFlowNode {
  return { id, type: 'studio', position: { x, y: 20 }, data: { kind, label: id } };
}

describe('portable presets', () => {
  it('ships a useful built-in starter library', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(BUILTIN_PRESETS.every(isPresetManifest)).toBe(true);
  });

  it('round-trips versioned preset JSON', () => {
    const preset = BUILTIN_PRESETS[0];
    const parsed = parsePreset(serializePreset(preset));
    expect(parsed).toEqual(preset);
  });

  it('rejects malformed or wrong-schema JSON', () => {
    expect(() => parsePreset(JSON.stringify({ version: 1, name: 'wrong' }))).toThrow(/valid Graphic Studio preset/i);
  });

  it('rejects unknown top-level fields and dangling preset edges', () => {
    const preset = structuredClone(BUILTIN_PRESETS[0]);
    expect(isPresetManifest({ ...preset, unexpected: true })).toBe(false);
    preset.edges.push({ id: 'bad', source: preset.nodes[0].id, target: 'missing-node' });
    expect(isPresetManifest(preset)).toBe(false);
  });

  it('records exposed subgraph controls in saved preset metadata', () => {
    const subgraph = node('group', 'subgraph', 120);
    subgraph.data.subgraph = {
      version: 1,
      id: 'definition-group',
      name: 'Group',
      nodes: [],
      edges: [],
      inputNodeId: 'a',
      outputNodeId: 'b',
      bindings: [{ key: 'a.contrast', label: 'Contrast', nodeId: 'a', property: 'contrast', valueType: 'number' }],
    };
    const preset = createPresetFromSelection([subgraph], [], new Set(['group']), 'Group preset');
    expect(preset.exposedParameters.map((binding) => binding.key)).toEqual(['a.contrast']);
  });
  it('captures only selected internal edges and normalizes positions', () => {
    const nodes = [node('a', 'adjust', 120), node('b', 'posterize', 420), node('c', 'output', 700)];
    const edges: StudioEdge[] = [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c' },
    ];
    const preset = createPresetFromSelection(nodes, edges, new Set(['a', 'b']), 'Saved look');
    expect(preset.nodes.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(preset.edges.map((entry) => entry.id)).toEqual(['ab']);
    expect(Math.min(...preset.nodes.map((entry) => entry.position.x))).toBe(0);
  });

  it('instantiates repeated presets with isolated node and edge IDs', () => {
    const preset = BUILTIN_PRESETS.find((entry) => entry.nodes.length > 1)!;
    const first = instantiatePreset(preset, 'one');
    const second = instantiatePreset(preset, 'two');
    expect(new Set(first.nodes.map((entry) => entry.id))).not.toEqual(new Set(second.nodes.map((entry) => entry.id)));
    expect(first.edges.every((edge) => first.nodes.some((node) => node.id === edge.source))).toBe(true);
    expect(first.edges.every((edge) => first.nodes.some((node) => node.id === edge.target))).toBe(true);
  });
});
