import { effectDefaults, type NodeKind, type StudioEdge, type StudioFlowNode, type StudioNodeData, type SubgraphBinding } from './model';

export interface PresetManifest {
  schema: 'graphic-studio-preset';
  version: 1;
  id: string;
  name: string;
  description: string;
  tags: string[];
  exposedParameters: SubgraphBinding[];
  nodes: StudioFlowNode[];
  edges: StudioEdge[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'graphic-studio-presets-v1';

function effectNode(id: string, kind: Exclude<NodeKind, 'source' | 'output'>, x: number, patch: Partial<StudioNodeData> = {}): StudioFlowNode {
  return {
    id,
    type: 'studio',
    position: { x, y: 0 },
    data: { kind, ...structuredClone(effectDefaults[kind]), ...patch } as StudioNodeData,
  };
}

function linearPreset(id: string, name: string, description: string, tags: string[], nodes: StudioFlowNode[]): PresetManifest {
  const now = 'builtin';
  return {
    schema: 'graphic-studio-preset', version: 1, id, name, description, tags, exposedParameters: [], nodes,
    edges: nodes.slice(1).map((node, index) => ({ id: `${id}-edge-${index}`, source: nodes[index].id, target: node.id })),
    createdAt: now, updatedAt: now,
  };
}

export const BUILTIN_PRESETS: PresetManifest[] = [
  linearPreset('mono-floyd', 'Mono Floyd–Steinberg', 'High-quality monochrome diffusion with serpentine scanning.', ['dither', 'mono'], [
    effectNode('dither', 'dither', 0, { algorithm: 'floyd-steinberg', monochrome: true, serpentine: true, diffusionStrength: 100 }),
  ]),
  linearPreset('mono-atkinson', 'Atkinson Mono', 'Classic restrained Atkinson diffusion for punchy pixel work.', ['dither', 'pixel'], [
    effectNode('dither', 'dither', 0, { algorithm: 'atkinson', monochrome: true, serpentine: false, diffusionStrength: 100 }),
  ]),
  linearPreset('bayer-retro', 'Bayer Retro', 'Posterized ordered dither with a compact Game Boy-style palette.', ['retro', 'palette'], [
    effectNode('posterize', 'posterize', 0, { levels: 4 }),
    effectNode('palette', 'palette', 280, { palette: 'gameboy' }),
    effectNode('dither', 'dither', 560, { algorithm: 'bayer-4', monochrome: false, threshold: 128 }),
  ]),
  linearPreset('halftone-print', 'Print Halftone', 'CMYK-style print screening with a mild contrast lift.', ['halftone', 'print'], [
    effectNode('adjust', 'adjust', 0, { contrast: 12, saturation: 110 }),
    effectNode('dither', 'dither', 300, { algorithm: 'cmyk-halftone', patternScale: 10, threshold: 128 }),
  ]),
  linearPreset('sharp-poster', 'Sharp Posterize', 'Edge-preserving punch from sharpen + controlled posterization.', ['posterize', 'sharp'], [
    effectNode('sharpen', 'convolution', 0, { convolution: 'sharpen', strength: 75 }),
    effectNode('posterize', 'posterize', 300, { levels: 6 }),
  ]),
  linearPreset('pico-pixel', 'PICO-8 Pixel', 'Nearest pixel blocks mapped into the PICO-8 palette.', ['pixel', 'retro'], [
    effectNode('pixelate', 'pixelate', 0, { pixelSize: 6 }),
    effectNode('palette', 'palette', 280, { palette: 'pico8' }),
  ]),
];

const PRESET_KEYS = new Set([
  'schema', 'version', 'id', 'name', 'description', 'tags', 'exposedParameters',
  'nodes', 'edges', 'createdAt', 'updatedAt',
]);
const PRESET_NODE_KINDS = new Set<NodeKind>([
  'adjust', 'curves', 'blend', 'mask', 'overlay', 'text', 'shape', 'gradient',
  'generator', 'subgraph', 'transform', 'pixelate', 'posterize', 'palette',
  'convolution', 'dither',
]);

function validBinding(value: unknown): value is SubgraphBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<SubgraphBinding>;
  return typeof binding.key === 'string'
    && typeof binding.label === 'string'
    && typeof binding.nodeId === 'string'
    && typeof binding.property === 'string'
    && ['number', 'boolean', 'string', 'color'].includes(String(binding.valueType));
}

export function isPresetManifest(value: unknown): value is PresetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PRESET_KEYS.has(key))) return false;
  const preset = value as Partial<PresetManifest>;
  if (preset.schema !== 'graphic-studio-preset' || preset.version !== 1) return false;
  if (!preset.id || !preset.name || typeof preset.description !== 'string') return false;
  if (!Array.isArray(preset.tags) || !preset.tags.every((tag) => typeof tag === 'string')) return false;
  if (!Array.isArray(preset.exposedParameters) || !preset.exposedParameters.every(validBinding)) return false;
  if (!Array.isArray(preset.nodes) || !Array.isArray(preset.edges)) return false;
  if (typeof preset.createdAt !== 'string' || typeof preset.updatedAt !== 'string') return false;

  const ids = new Set<string>();
  for (const node of preset.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) return false;
    if (ids.has(node.id) || node.type !== 'studio' || !node.data) return false;
    if (!PRESET_NODE_KINDS.has(node.data.kind)) return false;
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) return false;
    ids.add(node.id);
  }
  return preset.edges.every((edge) =>
    Boolean(edge && typeof edge.id === 'string' && ids.has(edge.source) && ids.has(edge.target)),
  );
}

export function parsePreset(text: string): PresetManifest {
  const parsed = JSON.parse(text) as unknown;
  if (!isPresetManifest(parsed)) throw new Error('This file is not a valid Graphic Studio preset.');
  return parsed;
}

export function serializePreset(preset: PresetManifest): string {
  return JSON.stringify(preset, null, 2);
}

export function loadUserPresets(): PresetManifest[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPresetManifest) : [];
  } catch {
    return [];
  }
}

function persistUserPresets(presets: PresetManifest[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function upsertUserPreset(preset: PresetManifest): PresetManifest[] {
  const existing = loadUserPresets().filter((item) => item.id !== preset.id);
  const next = [preset, ...existing].slice(0, 100);
  persistUserPresets(next);
  return next;
}

export function deleteUserPreset(id: string): PresetManifest[] {
  const next = loadUserPresets().filter((item) => item.id !== id);
  persistUserPresets(next);
  return next;
}

export function createPresetFromSelection(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
  selectedIds: Set<string>,
  name: string,
): PresetManifest {
  const chosen = nodes.filter((node) => selectedIds.has(node.id) && node.data.kind !== 'source' && node.data.kind !== 'output');
  if (!chosen.length) throw new Error('Select one or more processing nodes first.');
  const minX = Math.min(...chosen.map((node) => node.position.x));
  const minY = Math.min(...chosen.map((node) => node.position.y));
  const now = new Date().toISOString();
  const id = `preset-${Date.now().toString(36)}`;
  return {
    schema: 'graphic-studio-preset',
    version: 1,
    id,
    name,
    description: 'Saved from Graphic Studio selection.',
    tags: ['custom'],
    exposedParameters: chosen.flatMap((node) => node.data.subgraph?.bindings ?? []),
    nodes: chosen.map((node) => ({
      ...structuredClone(node),
      selected: false,
      position: { x: node.position.x - minX, y: node.position.y - minY },
    })),
    edges: edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map((edge) => ({ ...edge })),
    createdAt: now,
    updatedAt: now,
  };
}

export function instantiatePreset(
  preset: PresetManifest,
  nonce: string,
  origin = { x: 360, y: 220 },
): { nodes: StudioFlowNode[]; edges: StudioEdge[] } {
  const ids = new Map(preset.nodes.map((node) => [node.id, `${nonce}-${node.id}`]));
  return {
    nodes: preset.nodes.map((node) => ({
      ...structuredClone(node),
      id: ids.get(node.id)!,
      selected: true,
      position: { x: origin.x + node.position.x, y: origin.y + node.position.y },
    })),
    edges: preset.edges.map((edge) => ({
      ...edge,
      id: `${nonce}-${edge.id}`,
      source: ids.get(edge.source) ?? edge.source,
      target: ids.get(edge.target) ?? edge.target,
    })),
  };
}
