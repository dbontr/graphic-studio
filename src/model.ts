import type { Edge, Node } from '@xyflow/react';

export type NodeKind =
  | 'source'
  | 'adjust'
  | 'pixelate'
  | 'posterize'
  | 'dither'
  | 'output';

export type DitherAlgorithm =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'bayer-4'
  | 'bayer-8'
  | 'threshold';

export interface StudioNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  fileName?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  pixelSize?: number;
  levels?: number;
  algorithm?: DitherAlgorithm;
  threshold?: number;
  monochrome?: boolean;
}

export type StudioFlowNode = Node<StudioNodeData, 'studio'>;
export type StudioEdge = Edge;

export const initialNodes: StudioFlowNode[] = [
  {
    id: 'source-1',
    type: 'studio',
    position: { x: 80, y: 270 },
    data: { kind: 'source', label: 'Image source' },
  },
  {
    id: 'adjust-1',
    type: 'studio',
    position: { x: 400, y: 170 },
    data: {
      kind: 'adjust',
      label: 'Color + tone',
      brightness: 0,
      contrast: 12,
      saturation: 92,
    },
  },
  {
    id: 'dither-1',
    type: 'studio',
    position: { x: 730, y: 275 },
    data: {
      kind: 'dither',
      label: 'Dither',
      algorithm: 'floyd-steinberg',
      threshold: 128,
      monochrome: true,
    },
  },
  {
    id: 'output-1',
    type: 'studio',
    position: { x: 1060, y: 135 },
    data: { kind: 'output', label: 'Preview' },
  },
];

export const initialEdges: StudioEdge[] = [
  { id: 'source-adjust', source: 'source-1', target: 'adjust-1' },
  { id: 'adjust-dither', source: 'adjust-1', target: 'dither-1' },
  { id: 'dither-output', source: 'dither-1', target: 'output-1' },
];

export const effectDefaults: Record<
  Exclude<NodeKind, 'source' | 'output'>,
  Omit<StudioNodeData, 'kind'>
> = {
  adjust: {
    label: 'Color + tone',
    brightness: 0,
    contrast: 0,
    saturation: 100,
  },
  pixelate: {
    label: 'Pixelate',
    pixelSize: 8,
  },
  posterize: {
    label: 'Posterize',
    levels: 5,
  },
  dither: {
    label: 'Dither',
    algorithm: 'floyd-steinberg',
    threshold: 128,
    monochrome: true,
  },
};
