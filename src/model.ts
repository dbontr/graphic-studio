import type { Edge, Node } from '@xyflow/react';

export type NodeKind =
  | 'source'
  | 'adjust'
  | 'curves'
  | 'blend'
  | 'mask'
  | 'overlay'
  | 'text'
  | 'shape'
  | 'gradient'
  | 'generator'
  | 'subgraph'
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
export type ShapeType = 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'line' | 'triangle' | 'polygon';
export type GradientType = 'linear' | 'radial';
export type GeneratorType = 'solid' | 'checkerboard' | 'grid' | 'noise' | 'fractal-noise' | 'scanlines' | 'stripes' | 'dot-matrix' | 'tile' | 'voronoi' | 'crt';
export type MaskMorphology = 'none' | 'dilate' | 'erode' | 'open' | 'close';
export interface GradientStop { offset: number; color: string; }
export interface SubgraphBinding {
  key: string;
  label: string;
  nodeId: string;
  property: string;
  valueType: 'number' | 'boolean' | 'string' | 'color';
  min?: number;
  max?: number;
  step?: number;
}
export interface SubgraphDefinition {
  version: 1;
  id: string;
  name: string;
  nodes: StudioFlowNode[];
  edges: StudioEdge[];
  inputNodeId: string;
  inputTargetHandle?: string | null;
  outputNodeId: string;
  outputSourceHandle?: string | null;
  bindings: SubgraphBinding[];
}

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
  maskBlurRadius?: number;
  maskMorphology?: MaskMorphology;
  maskMorphRadius?: number;
  maskExpand?: number;
  maskThreshold?: number;
  maskCurve?: number[];
  maskKeyColor?: string;
  maskKeyTolerance?: number;
  maskPreview?: 'result' | 'mask' | 'overlay';
  overlayX?: number;
  overlayY?: number;
  overlayScale?: number;
  overlayRotation?: number;
  overlayAnchorX?: number;
  overlayAnchorY?: number;
  overlayOpacity?: number;
  overlayBlendMode?: BlendMode;
  canvasWidth?: number;
  canvasHeight?: number;
  textContent?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  textOpacity?: number;
  shapeType?: ShapeType;
  cornerRadius?: number;
  shapeLineWidth?: number;
  polygonSides?: number;
  gradientType?: GradientType;
  gradientStops?: GradientStop[];
  gradientAngle?: number;
  gradientCenterX?: number;
  gradientCenterY?: number;
  gradientRadius?: number;
  generatorType?: GeneratorType;
  generatorColorA?: string;
  generatorColorB?: string;
  generatorScale?: number;
  generatorSeed?: number;
  generatorOctaves?: number;
  generatorIntensity?: number;
  subgraph?: SubgraphDefinition;
  subgraphValues?: Record<string, unknown>;
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
    maskBlurRadius: 0,
    maskMorphology: 'none',
    maskMorphRadius: 0,
    maskExpand: 0,
    maskThreshold: 0,
    maskCurve: [0, 64, 128, 192, 255],
    maskKeyColor: '#ffffff',
    maskKeyTolerance: 0,
    maskPreview: 'result',
  },
  overlay: {
    label: 'Overlay',
    overlayX: 0,
    overlayY: 0,
    overlayScale: 100,
    overlayRotation: 0,
    overlayAnchorX: 50,
    overlayAnchorY: 50,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
  },
  text: {
    label: 'Text',
    canvasWidth: 1024,
    canvasHeight: 1024,
    textContent: 'Graphic Studio',
    fontFamily: 'Inter, Arial, sans-serif',
    fontSize: 96,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.2,
    textAlign: 'center',
    fillColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    textOpacity: 100,
  },
  shape: {
    label: 'Shape',
    canvasWidth: 1024,
    canvasHeight: 1024,
    shapeType: 'rectangle',
    fillColor: '#ffffff',
    strokeColor: '#000000',
    shapeLineWidth: 0,
    cornerRadius: 64,
    polygonSides: 6,
    textOpacity: 100,
  },
  gradient: {
    label: 'Gradient',
    canvasWidth: 1024,
    canvasHeight: 1024,
    gradientType: 'linear',
    gradientStops: [{ offset: 0, color: '#111111' }, { offset: 1, color: '#f4f1ea' }],
    gradientAngle: 0,
    gradientCenterX: 50,
    gradientCenterY: 50,
    gradientRadius: 70,
  },
  generator: {
    label: 'Generator',
    canvasWidth: 1024,
    canvasHeight: 1024,
    generatorType: 'checkerboard',
    generatorColorA: '#111111',
    generatorColorB: '#f4f1ea',
    generatorScale: 32,
    generatorSeed: 1,
    generatorOctaves: 4,
    generatorIntensity: 100,
  },
  subgraph: {
    label: 'Subgraph',
    subgraphValues: {},
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
