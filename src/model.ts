import type { Edge, Node } from '@xyflow/react';

export type NodeKind =
  | 'source'
  | 'adjust'
  | 'curves'
  | 'blend'
  | 'mask'
  | 'transform'
  | 'pixelate'
  | 'posterize'
  | 'palette'
  | 'convolution'
  | 'dither'
  | 'output';

export type ErrorDiffusionAlgorithm =
  | 'floyd-steinberg'
  | 'false-floyd-steinberg'
  | 'atkinson'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra'
  | 'two-row-sierra'
  | 'sierra-lite'
  | 'stevenson-arce'
  | 'fan'
  | 'shiau-fan'
  | 'shiau-fan-2'
  | 'simple-2d';

export type DitherAlgorithm =
  | ErrorDiffusionAlgorithm
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'blue-noise-32'
  | 'clustered-4'
  | 'halftone-dot'
  | 'halftone-line'
  | 'crosshatch'
  | 'cmyk-halftone'
  | 'threshold'
  | 'noise';

export const ERROR_DIFFUSION_ALGORITHMS = new Set<ErrorDiffusionAlgorithm>([
  'floyd-steinberg', 'false-floyd-steinberg', 'atkinson',
  'jarvis-judice-ninke', 'stucki', 'burkes', 'sierra',
  'two-row-sierra', 'sierra-lite', 'stevenson-arce', 'fan',
  'shiau-fan', 'shiau-fan-2', 'simple-2d',
]);

export type PalettePreset =
  | 'mono'
  | 'gameboy'
  | 'cga'
  | 'pico8'
  | 'grayscale-4'
  | 'grayscale-8'
  | 'custom';

export type ConvolutionMode = 'blur' | 'sharpen' | 'edge' | 'emboss';
export type TransformRotation = 0 | 90 | 180 | 270;
export type ResampleMode = 'nearest' | 'bilinear';
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'add'
  | 'subtract';
export type MaskChannel = 'luminance' | 'alpha' | 'red' | 'green' | 'blue';

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
  curveMaster?: number[];
  curveRed?: number[];
  curveGreen?: number[];
  curveBlue?: number[];
  curveChannel?: 'master' | 'red' | 'green' | 'blue';
  blendMode?: BlendMode;
  opacity?: number;
  maskChannel?: MaskChannel;
  maskInvert?: boolean;
  maskStrength?: number;
  maskFeather?: number;
  maskBlackPoint?: number;
  maskWhitePoint?: number;
  maskGamma?: number;
  rotation?: TransformRotation;
  flipX?: boolean;
  flipY?: boolean;
  cropLeft?: number;
  cropTop?: number;
  cropRight?: number;
  cropBottom?: number;
  scale?: number;
  resample?: ResampleMode;
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
  serpentine?: boolean;
  diffusionStrength?: number;
  patternScale?: number;
  angle?: number;
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
      serpentine: true,
      diffusionStrength: 100,
      patternScale: 8,
      angle: 45,
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
  curves: {
    label: 'Curves',
    curveMaster: [0, 64, 128, 192, 255],
    curveRed: [0, 64, 128, 192, 255],
    curveGreen: [0, 64, 128, 192, 255],
    curveBlue: [0, 64, 128, 192, 255],
    curveChannel: 'master',
  },
  blend: {
    label: 'Blend',
    blendMode: 'normal',
    opacity: 100,
  },
  mask: {
    label: 'Mask',
    maskChannel: 'luminance',
    maskInvert: false,
    maskStrength: 100,
    maskFeather: 0,
    maskBlackPoint: 0,
    maskWhitePoint: 100,
    maskGamma: 1,
  },
  transform: {
    label: 'Transform',
    rotation: 0,
    flipX: false,
    flipY: false,
    cropLeft: 0,
    cropTop: 0,
    cropRight: 0,
    cropBottom: 0,
    scale: 100,
    resample: 'bilinear',
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
    serpentine: true,
    diffusionStrength: 100,
    patternScale: 8,
    angle: 45,
  },
};
