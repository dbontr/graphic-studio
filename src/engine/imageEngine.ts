import type {
  BlendMode,
  DitherAlgorithm,
  ErrorDiffusionAlgorithm,
  PalettePreset,
  StudioEdge,
  StudioFlowNode,
  StudioNodeData,
} from '../model';
import type {
  ExportOptions,
  GraphPlanNode,
  PipelineStage,
  Raster,
  RenderPlan,
} from './types';
import { transformRaster } from './transform';
import { errorDiffusion } from './diffusion';
import { BLUE_NOISE_32, BLUE_NOISE_SIDE } from './blue-noise';

export type { Raster } from './types';

const clamp = (value: number, min = 0, max = 255) =>
  Math.max(min, Math.min(max, value));

const clampByte = (value: number) => clamp(Math.round(value));

const luminance = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

const copyRaster = (raster: Raster): Raster => ({
  width: raster.width,
  height: raster.height,
  data: new Uint8ClampedArray(raster.data),
});

export function makeDemoRaster(width = 960, height = 720): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {      const index = (y * width + x) * 4;
      const nx = x / width;
      const ny = y / height;
      const wave = Math.sin(nx * 20) * Math.cos(ny * 15) * 24;
      const glow = Math.max(0, 1 - Math.hypot(nx - 0.64, ny - 0.4) * 1.8);
      data[index] = clampByte(24 + nx * 172 + glow * 68 + wave);
      data[index + 1] = clampByte(30 + ny * 158 + glow * 108 - wave * 0.3);
      data[index + 2] = clampByte(54 + (1 - nx) * 136 + glow * 52);
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

function rasterToCanvas(raster: Raster): OffscreenCanvas {
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  const pixels = new Uint8ClampedArray(raster.data);
  context.putImageData(new ImageData(pixels, raster.width, raster.height), 0, 0);
  return canvas;
}

function flattenRaster(raster: Raster, matte: string): Raster {
  const [mr, mg, mb] = parseHexColor(matte) ?? [255, 255, 255];
  const data = new Uint8ClampedArray(raster.data.length);
  for (let index = 0; index < raster.data.length; index += 4) {
    const alpha = raster.data[index + 3] / 255;
    const inverse = 1 - alpha;
    data[index] = clampByte(raster.data[index] * alpha + mr * inverse);
    data[index + 1] = clampByte(raster.data[index + 1] * alpha + mg * inverse);
    data[index + 2] = clampByte(raster.data[index + 2] * alpha + mb * inverse);
    data[index + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}

export function rasterToBitmap(raster: Raster): ImageBitmap {
  return rasterToCanvas(raster).transferToImageBitmap();
}

export async function rasterToBlob(
  raster: Raster,
  options: ExportOptions = { format: 'png', quality: 0.92, matte: '#ffffff' },
): Promise<Blob> {
  const canvas = rasterToCanvas(
    options.format === 'jpeg' ? flattenRaster(raster, options.matte) : raster,
  );
  const type = options.format === 'png' ? 'image/png' : `image/${options.format}`;
  return canvas.convertToBlob({
    type,
    quality: options.format === 'png' ? undefined : clamp(options.quality, 0.01, 1),
  });
}

export function stableStageSignature(stage: PipelineStage): string {
  const d = stage.data;
  return JSON.stringify([
    stage.id,
    d.kind,
    d.enabled,
    d.brightness,
    d.contrast,
    d.saturation,
    d.exposure,
    d.gamma,
    d.temperature,
    d.tint,
    d.curveMaster,
    d.curveRed,
    d.curveGreen,
    d.curveBlue,
    d.blendMode,
    d.opacity,
    d.rotation,
    d.flipX,
    d.flipY,
    d.cropLeft,
    d.cropTop,
    d.cropRight,
    d.cropBottom,
    d.scale,
    d.resample,
    d.pixelSize,
    d.levels,
    d.palette,
    d.customPalette,
    d.convolution,
    d.strength,
    d.algorithm,
    d.threshold,
    d.monochrome,
    d.seed,
    d.serpentine,
    d.diffusionStrength,
    d.patternScale,
    d.angle,
    d.overlayX, d.overlayY, d.overlayScale, d.overlayRotation, d.overlayAnchorX, d.overlayAnchorY, d.overlayOpacity, d.overlayBlendMode,
    d.canvasWidth, d.canvasHeight, d.textContent, d.fontFamily, d.fontSize, d.fontWeight,
    d.letterSpacing, d.lineHeight, d.textAlign, d.fillColor, d.strokeColor, d.strokeWidth, d.textOpacity,
    d.shapeType, d.cornerRadius, d.shapeLineWidth, d.polygonSides,
    d.gradientType, d.gradientStops, d.gradientAngle, d.gradientCenterX, d.gradientCenterY, d.gradientRadius,
    d.generatorType, d.generatorColorA, d.generatorColorB, d.generatorScale, d.generatorSeed, d.generatorOctaves, d.generatorIntensity,
    d.maskBlurRadius, d.maskMorphology, d.maskMorphRadius, d.maskExpand, d.maskThreshold, d.maskCurve, d.maskKeyColor, d.maskKeyTolerance, d.maskPreview,
    d.subgraphValues, d.subgraph,
  ]);
}

export function compilePipeline(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
): RenderPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, StudioEdge[]>();
  for (const edge of edges) {
    const values = incoming.get(edge.target) ?? [];
    values.push(edge);
    incoming.set(edge.target, values);
  }

  const output = nodes.find((node) => node.data.kind === 'output');
  if (!output) return { stages: [], signature: 'no-output' };

  const graphNodes: GraphPlanNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let failure = '';

  const visit = (id: string): void => {
    if (failure || visited.has(id)) return;
    if (visiting.has(id)) {
      failure = 'cycle';
      return;
    }
    const node = byId.get(id);
    if (!node) {
      failure = 'missing-node';
      return;
    }

    const allInputs = incoming.get(id) ?? [];
    let selected: StudioEdge[] = [];
    if (node.data.kind === 'source') {
      selected = [];
    } else if (node.data.kind === 'blend') {
      const base = allInputs.filter((edge) => edge.targetHandle === 'base');
      const blend = allInputs.filter((edge) => edge.targetHandle === 'blend');
      if (base.length !== 1 || (node.data.enabled !== false && blend.length !== 1)) {
        failure = 'disconnected';
        return;
      }
      selected = node.data.enabled === false ? [base[0]] : [base[0], blend[0]];
    } else {
      if (allInputs.length !== 1) {
        failure = allInputs.length ? 'ambiguous-input' : 'disconnected';
        return;
      }
      selected = [allInputs[0]];
    }

    visiting.add(id);
    for (const edge of selected) visit(edge.source);
    visiting.delete(id);
    if (failure) return;

    graphNodes.push({
      id,
      data: { ...node.data },
      inputs: selected.map((edge) => ({
        source: edge.source,
        port: edge.targetHandle ?? null,
      })),
    });
    visited.add(id);
  };

  visit(output.id);
  if (failure) return { stages: [], signature: failure };

  const activeBlend = graphNodes.some(
    (node) => node.data.kind === 'blend' && node.data.enabled !== false,
  );
  const stages = graphNodes
    .filter((node) =>
      node.data.kind !== 'source'
      && node.data.kind !== 'output'
      && node.data.enabled !== false,
    )
    .map((node) => ({ id: node.id, data: { ...node.data } }));

  if (!activeBlend) {
    return {
      stages,
      signature: stages.map(stableStageSignature).join('|'),
    };
  }

  const signature = graphNodes.map((node) => {
    const inputSignature = node.inputs
      .map((input) => `${input.port ?? 'in'}:${input.source}`)
      .join(',');
    const nodeSignature = node.data.kind === 'source' || node.data.kind === 'output'
      ? `${node.id}:${node.data.kind}`
      : stableStageSignature({ id: node.id, data: node.data });
    return `${nodeSignature}<-${inputSignature}`;
  }).join('|');

  return {
    stages,
    signature,
    graph: { outputId: output.id, nodes: graphNodes },
  };
}

function adjustRaster(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const brightness = Number(node.brightness ?? 0) * 2.55;
  const contrast = clamp(Number(node.contrast ?? 0), -100, 100) * 2.2;
  const saturation = clamp(Number(node.saturation ?? 100), 0, 300) / 100;
  const exposure = Math.pow(2, clamp(Number(node.exposure ?? 0), -4, 4));
  const gamma = clamp(Number(node.gamma ?? 1), 0.15, 4);
  const temperature = clamp(Number(node.temperature ?? 0), -100, 100) * 0.7;
  const tint = clamp(Number(node.tint ?? 0), -100, 100) * 0.45;
  const contrastFactor =
    (259 * (contrast + 255)) / (255 * (259 - contrast));
  const gammaLut = new Uint8ClampedArray(256);
  const inverseGamma = 1 / gamma;
  for (let value = 0; value < 256; value += 1) {
    gammaLut[value] = clampByte(Math.pow(value / 255, inverseGamma) * 255);
  }
  for (let i = 0; i < output.data.length; i += 4) {
    let r = output.data[i] * exposure + brightness + temperature + tint * 0.2;
    let g = output.data[i + 1] * exposure + brightness - tint;
    let b = output.data[i + 2] * exposure + brightness - temperature + tint * 0.2;

    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    const gray = luminance(r, g, b);
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;

    output.data[i] = gammaLut[clampByte(r)];
    output.data[i + 1] = gammaLut[clampByte(g)];
    output.data[i + 2] = gammaLut[clampByte(b)];
  }
  return output;
}

const identityCurve = [0, 64, 128, 192, 255] as const;

function normalizedCurve(points: number[] | undefined): number[] {
  return identityCurve.map((fallback, index) => {
    const value = Number(points?.[index] ?? fallback);
    return Number.isFinite(value) ? clamp(value) : fallback;
  });
}

export function buildCurveLut(points: number[] | undefined): Uint8ClampedArray {
  const curve = normalizedCurve(points);
  const anchors = identityCurve;
  const lut = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    const segment = value <= 64 ? 0 : value <= 128 ? 1 : value <= 192 ? 2 : 3;
    const start = anchors[segment];
    const end = anchors[segment + 1];
    const t = (value - start) / (end - start);
    lut[value] = clampByte(curve[segment] + (curve[segment + 1] - curve[segment]) * t);
  }
  return lut;
}

export function curveRaster(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const master = buildCurveLut(node.curveMaster);
  const red = buildCurveLut(node.curveRed);
  const green = buildCurveLut(node.curveGreen);
  const blue = buildCurveLut(node.curveBlue);
  for (let index = 0; index < output.data.length; index += 4) {
    output.data[index] = red[master[output.data[index]]];
    output.data[index + 1] = green[master[output.data[index + 1]]];
    output.data[index + 2] = blue[master[output.data[index + 2]]];
  }
  return output;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function blendChannel(base: number, layer: number, mode: BlendMode): number {
  switch (mode) {
    case 'multiply':
      return base * layer;
    case 'screen':
      return 1 - (1 - base) * (1 - layer);
    case 'overlay':
      return base < 0.5 ? 2 * base * layer : 1 - 2 * (1 - base) * (1 - layer);
    case 'soft-light':
      return (1 - 2 * layer) * base * base + 2 * layer * base;
    case 'hard-light':
      return layer < 0.5 ? 2 * base * layer : 1 - 2 * (1 - base) * (1 - layer);
    case 'darken':
      return Math.min(base, layer);
    case 'lighten':
      return Math.max(base, layer);
    case 'difference':
      return Math.abs(base - layer);
    case 'exclusion':
      return base + layer - 2 * base * layer;
    case 'add':
      return Math.min(1, base + layer);
    case 'subtract':
      return Math.max(0, base - layer);
    default:
      return layer;
  }
}

export function blendRaster(
  base: Raster,
  layer: Raster,
  node: StudioNodeData,
): Raster {
  const output = copyRaster(base);
  const mode = (node.blendMode ?? 'normal') as BlendMode;
  const opacity = clamp(Number(node.opacity ?? 100), 0, 100) / 100;
  if (opacity <= 0 || !layer.width || !layer.height) return output;

  for (let y = 0; y < base.height; y += 1) {
    const sourceY = Math.min(
      layer.height - 1,
      Math.floor(((y + 0.5) / base.height) * layer.height),
    );
    for (let x = 0; x < base.width; x += 1) {
      const sourceX = Math.min(
        layer.width - 1,
        Math.floor(((x + 0.5) / base.width) * layer.width),
      );
      const baseIndex = (y * base.width + x) * 4;
      const layerIndex = (sourceY * layer.width + sourceX) * 4;
      const baseAlpha = base.data[baseIndex + 3] / 255;
      const layerAlpha = (layer.data[layerIndex + 3] / 255) * opacity;
      const outputAlpha = layerAlpha + baseAlpha * (1 - layerAlpha);

      for (let channel = 0; channel < 3; channel += 1) {
        const baseValue = base.data[baseIndex + channel] / 255;
        const layerValue = layer.data[layerIndex + channel] / 255;
        const blended = clamp01(blendChannel(baseValue, layerValue, mode));
        const premultiplied = blended * layerAlpha
          + baseValue * baseAlpha * (1 - layerAlpha);
        output.data[baseIndex + channel] = clampByte(
          outputAlpha > 1e-8 ? (premultiplied / outputAlpha) * 255 : 0,
        );
      }
      output.data[baseIndex + 3] = clampByte(outputAlpha * 255);
    }
  }
  return output;
}

export function posterizeRaster(raster: Raster, levels = 5): Raster {
  const output = copyRaster(raster);
  const safeLevels = Math.max(2, Math.min(32, Math.round(levels)));
  const steps = safeLevels - 1;
  const scale = 255 / steps;
  for (let i = 0; i < output.data.length; i += 4) {
    output.data[i] = Math.round((output.data[i] / 255) * steps) * scale;
    output.data[i + 1] = Math.round((output.data[i + 1] / 255) * steps) * scale;
    output.data[i + 2] = Math.round((output.data[i + 2] / 255) * steps) * scale;
  }
  return output;
}
function pixelateRaster(raster: Raster, size = 8): Raster {
  const output = copyRaster(raster);
  const block = Math.max(1, Math.min(256, Math.round(size)));
  const width = raster.width;
  const height = raster.height;
  const source = raster.data;
  const target = output.data;

  for (let y = 0; y < height; y += block) {
    const yEnd = Math.min(height, y + block);
    const sampleY = Math.min(height - 1, y + (block >> 1));
    for (let x = 0; x < width; x += block) {
      const xEnd = Math.min(width, x + block);
      const sampleX = Math.min(width - 1, x + (block >> 1));
      const sample = (sampleY * width + sampleX) * 4;
      const r = source[sample];
      const g = source[sample + 1];
      const b = source[sample + 2];
      const a = source[sample + 3];
      for (let yy = y; yy < yEnd; yy += 1) {
        let index = (yy * width + x) * 4;
        for (let xx = x; xx < xEnd; xx += 1, index += 4) {
          target[index] = r;
          target[index + 1] = g;
          target[index + 2] = b;
          target[index + 3] = a;
        }
      }
    }
  }
  return output;
}
export const palettes: Record<Exclude<PalettePreset, 'custom'>, readonly [number, number, number][]> = {
  mono: [
    [0, 0, 0],
    [255, 255, 255],
  ],
  gameboy: [
    [15, 56, 15],
    [48, 98, 48],
    [139, 172, 15],
    [155, 188, 15],
  ],
  cga: [
    [0, 0, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 255, 255],
  ],
  pico8: [
    [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
    [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
    [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
    [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
  ],
  'grayscale-4': [
    [0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255],
  ],
  'grayscale-8': Array.from({ length: 8 }, (_, index) => {
    const value = Math.round((index / 7) * 255);
    return [value, value, value] as [number, number, number];
  }),
};
export function parseHexColor(value: string): [number, number, number] | null {
  const normalized = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(normalized);
  if (short) {
    return short[1].split('').map((part) => parseInt(part + part, 16)) as [number, number, number];
  }
  const full = /^#([0-9a-f]{6})$/.exec(normalized);
  if (!full) return null;
  return [
    parseInt(full[1].slice(0, 2), 16),
    parseInt(full[1].slice(2, 4), 16),
    parseInt(full[1].slice(4, 6), 16),
  ];
}

export function resolvePalette(node: StudioNodeData): readonly [number, number, number][] {
  if (node.palette === 'custom') {
    const colors = (node.customPalette ?? [])
      .map(parseHexColor)
      .filter((color): color is [number, number, number] => color !== null)
      .slice(0, 32);
    const unique = Array.from(new Map(colors.map((color) => [color.join(','), color])).values());
    if (unique.length >= 2) return unique;
  }
  const preset = node.palette && node.palette !== 'custom' ? node.palette : 'gameboy';
  return palettes[preset];
}

function paletteRaster(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const palette = resolvePalette(node);
  const source = raster.data;
  const target = output.data;
  for (let i = 0; i < source.length; i += 4) {
    const r = source[i];
    const g = source[i + 1];
    const b = source[i + 2];
    let best = palette[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of palette) {
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const distance = dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = color;
      }
    }
    target[i] = best[0];
    target[i + 1] = best[1];
    target[i + 2] = best[2];
  }
  return output;
}

type Kernel = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

const convolutionKernels: Record<string, Kernel> = {  blur: [
    1 / 9, 1 / 9, 1 / 9,
    1 / 9, 1 / 9, 1 / 9,
    1 / 9, 1 / 9, 1 / 9,
  ],
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  edge: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
};

function convolutionRaster(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const mode = node.convolution ?? 'sharpen';
  const kernel = convolutionKernels[mode] ?? convolutionKernels.sharpen;
  const mix = clamp(Number(node.strength ?? 100), 0, 200) / 100;
  const width = raster.width;
  const height = raster.height;
  const source = raster.data;
  const target = output.data;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let filtered = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = Math.max(0, Math.min(height - 1, y + dy));
          for (let dx = -1; dx <= 1; dx += 1, k += 1) {
            const xx = Math.max(0, Math.min(width - 1, x + dx));
            filtered += source[(yy * width + xx) * 4 + channel] * kernel[k];
          }
        }        if (mode === 'emboss') filtered += 128;
        const original = source[center + channel];
        target[center + channel] = clampByte(original + (filtered - original) * mix);
      }
    }
  }
  return output;
}

const bayer2 = [0, 2, 3, 1];
const bayer4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];
const bayer8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

const clustered4 = [
  12, 5, 6, 13,
  4, 0, 1, 7,
  11, 3, 2, 8,
  15, 10, 9, 14,
];

function orderedDither(
  raster: Raster,
  matrix: readonly number[],
  side: number,
  threshold: number,
  monochrome: boolean,
): Raster {
  const output = copyRaster(raster);  const source = raster.data;
  const target = output.data;
  const bias = threshold - 128;
  const divisor = side * side;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = (y * raster.width + x) * 4;
      const matrixValue = matrix[(y % side) * side + (x % side)];
      const localThreshold = clamp(((matrixValue + 0.5) / divisor) * 255 + bias);
      if (monochrome) {
        const value = luminance(source[index], source[index + 1], source[index + 2]) >= localThreshold ? 255 : 0;
        target[index] = value;
        target[index + 1] = value;
        target[index + 2] = value;
      } else {
        target[index] = source[index] >= localThreshold ? 255 : 0;
        target[index + 1] = source[index + 1] >= localThreshold ? 255 : 0;
        target[index + 2] = source[index + 2] >= localThreshold ? 255 : 0;
      }
    }
  }
  return output;
}

function proceduralPatternDither(
  raster: Raster,
  node: StudioNodeData,
  algorithm: 'halftone-dot' | 'halftone-line' | 'crosshatch',
): Raster {
  const output = copyRaster(raster);
  const source = raster.data;
  const target = output.data;
  const monochrome = node.monochrome !== false;
  const bias = Number(node.threshold ?? 128) - 128;
  const scale = Math.max(2, Math.min(64, Number(node.patternScale ?? 8)));
  const radians = (Number(node.angle ?? 45) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const fract = (value: number) => value - Math.floor(value);

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const rx = (x * cos + y * sin) / scale;
      const ry = (-x * sin + y * cos) / scale;
      const ux = Math.abs(fract(rx) - 0.5) * 2;
      const uy = Math.abs(fract(ry) - 0.5) * 2;
      let pattern = 1 - ux;
      if (algorithm === 'halftone-dot') {
        pattern = 1 - Math.min(1, Math.hypot(ux, uy) / Math.SQRT2);
      } else if (algorithm === 'crosshatch') {
        pattern = Math.max(1 - ux, 1 - uy);
      }
      const localThreshold = clamp(pattern * 255 + bias);
      const index = (y * raster.width + x) * 4;
      if (monochrome) {
        const value = luminance(source[index], source[index + 1], source[index + 2]) >= localThreshold ? 255 : 0;
        target[index] = value;
        target[index + 1] = value;
        target[index + 2] = value;
      } else {
        target[index] = source[index] >= localThreshold ? 255 : 0;
        target[index + 1] = source[index + 1] >= localThreshold ? 255 : 0;
        target[index + 2] = source[index + 2] >= localThreshold ? 255 : 0;
      }
    }
  }
  return output;
}

function cmykHalftone(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const source = raster.data;
  const target = output.data;
  const scale = Math.max(3, Math.min(64, Number(node.patternScale ?? 8)));
  const bias = (Number(node.threshold ?? 128) - 128) / 255;
  const angles = [15, 75, 0, 45].map((degrees) => degrees * Math.PI / 180);
  const cosines = angles.map(Math.cos);
  const sines = angles.map(Math.sin);
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const screen = (x: number, y: number, channel: number) => {
    const rx = (x * cosines[channel] + y * sines[channel]) / scale;
    const ry = (-x * sines[channel] + y * cosines[channel]) / scale;
    const ux = Math.abs((rx - Math.floor(rx)) - 0.5) * 2;
    const uy = Math.abs((ry - Math.floor(ry)) - 0.5) * 2;
    return Math.min(1, Math.hypot(ux, uy) / Math.SQRT2);
  };

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = (y * raster.width + x) * 4;
      const r = source[index] / 255;
      const g = source[index + 1] / 255;
      const b = source[index + 2] / 255;
      const k = 1 - Math.max(r, g, b);
      const denominator = Math.max(1e-6, 1 - k);
      const c = clamp01((1 - r - k) / denominator + bias);
      const m = clamp01((1 - g - k) / denominator + bias);
      const yellow = clamp01((1 - b - k) / denominator + bias);
      const black = clamp01(k + bias);
      const cInk = c >= screen(x, y, 0);
      const mInk = m >= screen(x, y, 1);
      const yInk = yellow >= screen(x, y, 2);
      const kInk = black >= screen(x, y, 3);
      target[index] = cInk || kInk ? 0 : 255;
      target[index + 1] = mInk || kInk ? 0 : 255;
      target[index + 2] = yInk || kInk ? 0 : 255;
    }
  }
  return output;
}

function thresholdDither(raster: Raster, threshold: number, monochrome: boolean): Raster {
  const output = copyRaster(raster);
  const source = raster.data;
  const target = output.data;
  for (let i = 0; i < source.length; i += 4) {
    if (monochrome) {
      const value = luminance(source[i], source[i + 1], source[i + 2]) >= threshold ? 255 : 0;
      target[i] = value;
      target[i + 1] = value;
      target[i + 2] = value;    } else {
      target[i] = source[i] >= threshold ? 255 : 0;
      target[i + 1] = source[i + 1] >= threshold ? 255 : 0;
      target[i + 2] = source[i + 2] >= threshold ? 255 : 0;
    }
  }
  return output;
}

function noise01(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noiseDither(
  raster: Raster,
  threshold: number,
  monochrome: boolean,
  seed: number,
): Raster {
  const output = copyRaster(raster);
  const source = raster.data;
  const target = output.data;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = (y * raster.width + x) * 4;
      const localThreshold = clamp(threshold + (noise01(x, y, seed) - 0.5) * 192);
      if (monochrome) {
        const value = luminance(source[index], source[index + 1], source[index + 2]) >= localThreshold ? 255 : 0;
        target[index] = value;
        target[index + 1] = value;
        target[index + 2] = value;
      } else {        target[index] = source[index] >= localThreshold ? 255 : 0;
        target[index + 1] = source[index + 1] >= localThreshold ? 255 : 0;
        target[index + 2] = source[index + 2] >= localThreshold ? 255 : 0;
      }
    }
  }
  return output;
}

export function ditherRaster(
  raster: Raster,
  algorithm: DitherAlgorithm = 'floyd-steinberg',
  threshold = 128,
  monochrome = true,
  seed = 1,
  options: Partial<StudioNodeData> = {},
): Raster {
  const node: StudioNodeData = {
    kind: 'dither',
    label: 'Dither',
    algorithm,
    threshold,
    monochrome,
    seed,
    ...options,
  };
  if (algorithm === 'bayer-2') return orderedDither(raster, bayer2, 2, threshold, monochrome);
  if (algorithm === 'bayer-4') return orderedDither(raster, bayer4, 4, threshold, monochrome);
  if (algorithm === 'bayer-8') return orderedDither(raster, bayer8, 8, threshold, monochrome);
  if (algorithm === 'blue-noise-32') {
    return orderedDither(raster, BLUE_NOISE_32, BLUE_NOISE_SIDE, threshold, monochrome);
  }
  if (algorithm === 'clustered-4') return orderedDither(raster, clustered4, 4, threshold, monochrome);
  if (algorithm === 'halftone-dot' || algorithm === 'halftone-line' || algorithm === 'crosshatch') {
    return proceduralPatternDither(raster, node, algorithm);
  }
  if (algorithm === 'cmyk-halftone') return cmykHalftone(raster, node);
  if (algorithm === 'threshold') return thresholdDither(raster, threshold, monochrome);
  if (algorithm === 'noise') return noiseDither(raster, threshold, monochrome, seed);
  return errorDiffusion(raster, node, algorithm as ErrorDiffusionAlgorithm);
}

export function isGpuCompatible(node: StudioNodeData): boolean {
  if (
    node.kind === 'adjust'
    || node.kind === 'curves'
    || node.kind === 'pixelate'
    || node.kind === 'posterize'
  ) return true;
  if (node.kind === 'palette' || node.kind === 'convolution') return true;
  if (node.kind === 'dither') {
    return node.algorithm === 'bayer-2'
      || node.algorithm === 'bayer-4'
      || node.algorithm === 'bayer-8'
      || node.algorithm === 'blue-noise-32'
      || node.algorithm === 'clustered-4'
      || node.algorithm === 'halftone-dot'
      || node.algorithm === 'halftone-line'
      || node.algorithm === 'crosshatch'
      || node.algorithm === 'cmyk-halftone'
      || node.algorithm === 'threshold'
      || node.algorithm === 'noise';
  }
  return false;
}
export function applyEffectCpu(raster: Raster, node: StudioNodeData): Raster {
  switch (node.kind) {
    case 'adjust':
      return adjustRaster(raster, node);
    case 'curves':
      return curveRaster(raster, node);
    case 'transform':
      return transformRaster(raster, node);
    case 'pixelate':
      return pixelateRaster(raster, Number(node.pixelSize ?? 8));
    case 'posterize':
      return posterizeRaster(raster, Number(node.levels ?? 5));
    case 'palette':
      return paletteRaster(raster, node);
    case 'convolution':
      return convolutionRaster(raster, node);
    case 'dither':
      return ditherRaster(
        raster,
        node.algorithm ?? 'floyd-steinberg',
        Number(node.threshold ?? 128),
        Boolean(node.monochrome ?? true),
        Number(node.seed ?? 1),
        node,
      );
    default:
      return copyRaster(raster);
  }
}

export function processStagesCpu(stages: PipelineStage[], source: Raster): Raster {
  let current = source;
  for (const stage of stages) current = applyEffectCpu(current, stage.data);
  return current === source ? copyRaster(source) : current;
}

export function processGraph(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
  source: Raster,
): Raster {
  const plan = compilePipeline(nodes, edges);
  return processStagesCpu(plan.stages, source);
}
