import type {
  DitherAlgorithm,
  PalettePreset,
  StudioEdge,
  StudioFlowNode,
  StudioNodeData,
} from '../model';
import type { PipelineStage, Raster, RenderPlan } from './types';
import { transformRaster } from './transform';

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

export async function rasterToBlob(raster: Raster): Promise<Blob> {
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height),
    0,
    0,
  );
  return canvas.convertToBlob({ type: 'image/png' });
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
  ]);
}

export function compilePipeline(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
): RenderPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string>();
  for (const edge of edges) incoming.set(edge.target, edge.source);

  const output = nodes.find((node) => node.data.kind === 'output');
  if (!output) return { stages: [], signature: 'no-output' };

  const reverse: PipelineStage[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = output.id;
  let foundSource = false;
  while (currentId) {
    if (visited.has(currentId)) return { stages: [], signature: 'cycle' };
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node) break;
    if (node.data.kind === 'source') {
      foundSource = true;
      break;
    }
    if (node.data.kind !== 'output' && node.data.enabled !== false) {
      reverse.push({ id: node.id, data: { ...node.data } });
    }
    currentId = incoming.get(currentId);
  }

  if (!foundSource) return { stages: [], signature: 'disconnected' };
  const stages = reverse.reverse();
  return {
    stages,
    signature: stages.map(stableStageSignature).join('|'),
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

function orderedDither(
  raster: Raster,
  matrix: number[],
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

type DiffusionTap = readonly [dx: number, dy: number, weight: number];

const diffusionKernels: Record<
  Extract<DitherAlgorithm, 'floyd-steinberg' | 'atkinson' | 'burkes' | 'sierra-lite'>,
  readonly DiffusionTap[]
> = {
  'floyd-steinberg': [
    [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8],
    [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8],
  ],
  burkes: [
    [1, 0, 8 / 32], [2, 0, 4 / 32], [-2, 1, 2 / 32], [-1, 1, 4 / 32],
    [0, 1, 8 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32],
  ],
  'sierra-lite': [
    [1, 0, 2 / 4], [-1, 1, 1 / 4], [0, 1, 1 / 4],
  ],
};

function errorDiffusion(
  raster: Raster,
  threshold: number,
  monochrome: boolean,
  algorithm: keyof typeof diffusionKernels,
): Raster {  const output = copyRaster(raster);
  const source = raster.data;
  const target = output.data;
  const width = raster.width;
  const height = raster.height;
  const channels = monochrome ? 1 : 3;
  const rowLength = width * channels;
  let current = new Float32Array(rowLength);
  let next = new Float32Array(rowLength);
  let next2 = new Float32Array(rowLength);
  const taps = diffusionKernels[algorithm];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const rgbaIndex = pixel * 4;
      for (let channel = 0; channel < channels; channel += 1) {
        const errorIndex = x * channels + channel;
        const base = monochrome
          ? luminance(source[rgbaIndex], source[rgbaIndex + 1], source[rgbaIndex + 2])
          : source[rgbaIndex + channel];
        const oldValue = base + current[errorIndex];
        const newValue = oldValue >= threshold ? 255 : 0;
        const error = oldValue - newValue;
        if (monochrome) {
          target[rgbaIndex] = newValue;
          target[rgbaIndex + 1] = newValue;
          target[rgbaIndex + 2] = newValue;
        } else {
          target[rgbaIndex + channel] = newValue;
        }

        for (const [dx, dy, weight] of taps) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const row = dy === 0 ? current : dy === 1 ? next : next2;
          row[xx * channels + channel] += error * weight;
        }
      }
    }
    const recycle = current;
    current = next;
    next = next2;
    next2 = recycle;
    next2.fill(0);
  }
  return output;
}

export function ditherRaster(
  raster: Raster,
  algorithm: DitherAlgorithm = 'floyd-steinberg',
  threshold = 128,
  monochrome = true,
  seed = 1,
): Raster {
  if (algorithm === 'bayer-2') return orderedDither(raster, bayer2, 2, threshold, monochrome);
  if (algorithm === 'bayer-4') return orderedDither(raster, bayer4, 4, threshold, monochrome);
  if (algorithm === 'bayer-8') return orderedDither(raster, bayer8, 8, threshold, monochrome);
  if (algorithm === 'threshold') return thresholdDither(raster, threshold, monochrome);
  if (algorithm === 'noise') return noiseDither(raster, threshold, monochrome, seed);
  return errorDiffusion(raster, threshold, monochrome, algorithm);
}

export function isGpuCompatible(node: StudioNodeData): boolean {
  if (node.kind === 'adjust' || node.kind === 'pixelate' || node.kind === 'posterize') return true;
  if (node.kind === 'palette' || node.kind === 'convolution') return true;
  if (node.kind === 'dither') {
    return node.algorithm === 'bayer-2'
      || node.algorithm === 'bayer-4'
      || node.algorithm === 'bayer-8'
      || node.algorithm === 'threshold'
      || node.algorithm === 'noise';
  }
  return false;
}
export function applyEffectCpu(raster: Raster, node: StudioNodeData): Raster {
  switch (node.kind) {
    case 'adjust':
      return adjustRaster(raster, node);
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
