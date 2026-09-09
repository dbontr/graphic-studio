import type { Edge, Node } from '@xyflow/react';

export type NodeKind =
  | 'source'
  | 'adjust'
  | 'pixelate'
  | 'posterize'
  | 'palette'
  | 'convolution'
  | 'dither'
  | 'output';

export type DitherAlgorithm =
  | 'floyd-steinberg'
  | 'atkinson'
  | 'burkes'
  | 'sierra-lite'
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'threshold'
  | 'noise';

export type PalettePreset =
  | 'mono'
  | 'gameboy'
  | 'cga'
  | 'pico8'
  | 'grayscale-4'
  | 'grayscale-8'
  | 'custom';

export type ConvolutionMode = 'blur' | 'sharpen' | 'edge' | 'emboss';

export interface StudioNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  enabled?: boolean;
  fileName?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  exposure?: number;
  gamma?: number;
  temperature?: number;
  tint?: number;
  pixelSize?: number;
  levels?: number;
  palette?: PalettePreset;
  customPalette?: string[];
  convolution?: ConvolutionMode;
  strength?: number;
  algorithm?: DitherAlgorithm;
  threshold?: number;
  monochrome?: boolean;
  seed?: number;
}

export type StudioFlowNode = Node<StudioNodeData, 'studio'>;
export type StudioEdge = Edge;

export const initialNodes: StudioFlowNode[] = [
  {
    id: 'source-1',
    type: 'studio',
    position: { x: 70, y: 270 },
    data: { kind: 'source', label: 'Image source' },
  },
  {
    id: 'adjust-1',
    type: 'studio',
    position: { x: 385, y: 120 },
    data: {
      kind: 'adjust',
      label: 'Color + tone',
      brightness: 0,
      contrast: 8,
      saturation: 100,
      exposure: 0,
      gamma: 1,
      temperature: 0,
      tint: 0,
    },
  },
  {
    id: 'dither-1',
    type: 'studio',
    position: { x: 715, y: 255 },
    data: {
      kind: 'dither',
      label: 'Dither',
      algorithm: 'floyd-steinberg',
      threshold: 128,
      monochrome: true,
      seed: 1,
    },
  },
  {
    id: 'output-1',
    type: 'studio',
    position: { x: 1045, y: 120 },
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
    exposure: 0,
    gamma: 1,
    temperature: 0,
    tint: 0,
  },
  pixelate: {
    label: 'Pixelate',
    pixelSize: 8,
  },
  posterize: {
    label: 'Posterize',
    levels: 5,
  },
  palette: {
    label: 'Palette map',
    palette: 'gameboy',
    customPalette: ['#111111', '#f4f1ea'],
  },
  convolution: {
    label: 'Convolution',
    convolution: 'sharpen',
    strength: 100,
  },
  dither: {
    label: 'Dither',
    algorithm: 'floyd-steinberg',
    threshold: 128,
    monochrome: true,
    seed: 1,
  },
};
