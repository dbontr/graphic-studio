import type { MaskChannel, MaskMorphology, StudioNodeData } from '../model';
import type { Raster } from './types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampIndex = (value: number, size: number) => Math.max(0, Math.min(size - 1, value));

export function maskFeatherRadius(node: StudioNodeData): number {
  return Math.max(0, Math.min(64, Math.round(Number(node.maskFeather ?? 0))));
}

export function maskChannelByte(
  data: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
): number {
  if (channel === 'alpha') return data[index + 3];
  if (channel === 'red') return data[index];
  if (channel === 'green') return data[index + 1];
  if (channel === 'blue') return data[index + 2];
  return (
    13933 * data[index]
    + 46871 * data[index + 1]
    + 4732 * data[index + 2]
    + 32768
  ) >> 16;
}

export function maskChannelValue(
  data: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
): number {
  return maskChannelByte(data, index, channel) / 255;
}

const MASK_CURVE_INPUTS = [0, 64, 128, 192, 255] as const;

function sampleMaskCurve(value: number, points: number[] | undefined): number {
  const curve = MASK_CURVE_INPUTS.map((fallback, index) =>
    Math.max(0, Math.min(255, Number(points?.[index] ?? fallback))),
  );
  const input = clamp01(value) * 255;
  const segment = input <= 64 ? 0 : input <= 128 ? 1 : input <= 192 ? 2 : 3;
  const start = MASK_CURVE_INPUTS[segment];
  const end = MASK_CURVE_INPUTS[segment + 1];
  const t = (input - start) / (end - start);
  return clamp01((curve[segment] + (curve[segment + 1] - curve[segment]) * t) / 255);
}

export function shapeMaskValue(value: number, node: StudioNodeData): number {
  const black = Math.min(254 / 255, clamp01(Number(node.maskBlackPoint ?? 0) / 100));
  const white = Math.max(black + 1 / 255, clamp01(Number(node.maskWhitePoint ?? 100) / 100));
  const gamma = Math.max(0.1, Math.min(10, Number(node.maskGamma ?? 1)));
  const normalized = clamp01((value - black) / (white - black));
  return sampleMaskCurve(Math.pow(normalized, 1 / gamma), node.maskCurve);
}

export function buildMaskLut(node: StudioNodeData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const invert = Boolean(node.maskInvert);
  const strength = clamp01(Number(node.maskStrength ?? 100) / 100);
  for (let value = 0; value < 256; value += 1) {
    let amount = shapeMaskValue(value / 255, node);
    if (invert) amount = 1 - amount;
    amount = (1 - strength) + strength * amount;
    lut[value] = clampByte(amount * 255);
  }
  return lut;
}

function parseKeyColor(value: string | undefined): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (!match) return null;
  return [
    parseInt(match[1].slice(0, 2), 16),
    parseInt(match[1].slice(2, 4), 16),
    parseInt(match[1].slice(4, 6), 16),
  ];
}

function sourceMaskByte(
  data: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
  key: [number, number, number] | null,
  tolerance: number,
): number {
  if (!key || tolerance <= 0) return maskChannelByte(data, index, channel);
  const dr = data[index] - key[0];
  const dg = data[index + 1] - key[1];
  const db = data[index + 2] - key[2];
  const distance = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3 * 255 * 255);
  const normalized = 1 - clamp01(distance / Math.max(1e-6, tolerance));
  return clampByte(normalized * 255);
}

function normalizedMaskField(
  mask: Raster,
  width: number,
  height: number,
  node: StudioNodeData,
): Uint8Array {
  const field = new Uint8Array(width * height);
  const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
  const key = parseKeyColor(node.maskKeyColor);
  const tolerance = Math.max(0, Math.min(1, Number(node.maskKeyTolerance ?? 0) / 100));
  for (let y = 0; y < height; y += 1) {
    const maskY = Math.min(
      mask.height - 1,
      Math.floor(((2 * y + 1) * mask.height) / (2 * height)),
    );
    for (let x = 0; x < width; x += 1) {
      const maskX = Math.min(
        mask.width - 1,
        Math.floor(((2 * x + 1) * mask.width) / (2 * width)),
      );
      const maskIndex = (maskY * mask.width + maskX) * 4;
      field[y * width + x] = sourceMaskByte(mask.data, maskIndex, channel, key, tolerance);
    }
  }
  return field;
}

function blurHorizontal(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(source.length);
  const diameter = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let tap = -radius; tap <= radius; tap += 1) {
      sum += source[row + clampIndex(tap, width)];
    }
    for (let x = 0; x < width; x += 1) {
      if (x > 0) {
        const removeX = clampIndex(x - radius - 1, width);
        const addX = clampIndex(x + radius, width);
        sum += source[row + addX] - source[row + removeX];
      }
      output[row + x] = Math.floor((sum + radius) / diameter);
    }
  }
  return output;
}

function blurVertical(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const output = new Uint8Array(source.length);
  const diameter = radius * 2 + 1;
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let tap = -radius; tap <= radius; tap += 1) {
      sum += source[clampIndex(tap, height) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      if (y > 0) {
        const removeY = clampIndex(y - radius - 1, height);
        const addY = clampIndex(y + radius, height);
        sum += source[addY * width + x] - source[removeY * width + x];
      }
      output[y * width + x] = Math.floor((sum + radius) / diameter);
    }
  }
  return output;
}

function boxBlur(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return source;
  return blurVertical(blurHorizontal(source, width, height, radius), width, height, radius);
}

function gaussianApprox(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return source;
  const boxRadius = Math.max(1, Math.round(radius / 1.8));
  return boxBlur(boxBlur(boxBlur(source, width, height, boxRadius), width, height, boxRadius), width, height, boxRadius);
}

function extremeHorizontal(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  takeMax: boolean,
): Uint8Array {
  const output = new Uint8Array(source.length);
  const dequeIndex = new Int32Array(width + radius * 2 + 2);
  const dequeValue = new Uint8Array(dequeIndex.length);
  for (let y = 0; y < height; y += 1) {
    let head = 0;
    let tail = 0;
    const row = y * width;
    for (let virtual = -radius; virtual < width + radius; virtual += 1) {
      const value = source[row + clampIndex(virtual, width)];
      while (tail > head && (takeMax ? dequeValue[tail - 1] <= value : dequeValue[tail - 1] >= value)) tail -= 1;
      dequeIndex[tail] = virtual;
      dequeValue[tail] = value;
      tail += 1;
      const minimum = virtual - radius * 2;
      while (tail > head && dequeIndex[head] < minimum) head += 1;
      const x = virtual - radius;
      if (x >= 0 && x < width) output[row + x] = dequeValue[head];
    }
  }
  return output;
}

function extremeVertical(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  takeMax: boolean,
): Uint8Array {
  const output = new Uint8Array(source.length);
  const dequeIndex = new Int32Array(height + radius * 2 + 2);
  const dequeValue = new Uint8Array(dequeIndex.length);
  for (let x = 0; x < width; x += 1) {
    let head = 0;
    let tail = 0;
    for (let virtual = -radius; virtual < height + radius; virtual += 1) {
      const value = source[clampIndex(virtual, height) * width + x];
      while (tail > head && (takeMax ? dequeValue[tail - 1] <= value : dequeValue[tail - 1] >= value)) tail -= 1;
      dequeIndex[tail] = virtual;
      dequeValue[tail] = value;
      tail += 1;
      const minimum = virtual - radius * 2;
      while (tail > head && dequeIndex[head] < minimum) head += 1;
      const y = virtual - radius;
      if (y >= 0 && y < height) output[y * width + x] = dequeValue[head];
    }
  }
  return output;
}

function morphology(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  takeMax: boolean,
): Uint8Array {
  if (radius <= 0) return source;
  return extremeVertical(
    extremeHorizontal(source, width, height, radius, takeMax),
    width,
    height,
    radius,
    takeMax,
  );
}

function applyMorphology(
  source: Uint8Array,
  width: number,
  height: number,
  mode: MaskMorphology,
  radius: number,
): Uint8Array {
  if (mode === 'dilate') return morphology(source, width, height, radius, true);
  if (mode === 'erode') return morphology(source, width, height, radius, false);
  if (mode === 'open') return morphology(morphology(source, width, height, radius, false), width, height, radius, true);
  if (mode === 'close') return morphology(morphology(source, width, height, radius, true), width, height, radius, false);
  return source;
}

export function buildFeatheredMaskField(
  mask: Raster,
  width: number,
  height: number,
  node: StudioNodeData,
): Uint8Array {
  if (!width || !height || !mask.width || !mask.height) return new Uint8Array(width * height);
  let field = normalizedMaskField(mask, width, height, node);
  const blurRadius = Math.max(0, Math.min(64, Math.round(Number(node.maskBlurRadius ?? 0))));
  if (blurRadius) field = gaussianApprox(field, width, height, blurRadius);
  const morphologyMode = (node.maskMorphology ?? 'none') as MaskMorphology;
  const morphologyRadius = Math.max(0, Math.min(64, Math.round(Number(node.maskMorphRadius ?? 0))));
  if (morphologyMode !== 'none' && morphologyRadius) {
    field = applyMorphology(field, width, height, morphologyMode, morphologyRadius);
  }
  const expand = Math.max(-64, Math.min(64, Math.round(Number(node.maskExpand ?? 0))));
  if (expand !== 0) {
    field = morphology(field, width, height, Math.abs(expand), expand > 0);
  }
  const threshold = Math.max(0, Math.min(100, Number(node.maskThreshold ?? 0)));
  if (threshold > 0) {
    const thresholdByte = Math.round((threshold / 100) * 255);
    for (let index = 0; index < field.length; index += 1) {
      field[index] = field[index] >= thresholdByte ? 255 : 0;
    }
  }
  const featherRadius = maskFeatherRadius(node);
  if (featherRadius) field = boxBlur(field, width, height, featherRadius);
  return field;
}

export function maskRaster(
  base: Raster,
  mask: Raster,
  node: StudioNodeData,
): Raster {
  const output: Raster = {
    width: base.width,
    height: base.height,
    data: new Uint8ClampedArray(base.data),
  };
  if (!base.width || !base.height || !mask.width || !mask.height) return output;

  const maskLut = buildMaskLut(node);
  const field = buildFeatheredMaskField(mask, base.width, base.height, node);
  const preview = node.maskPreview ?? 'result';
  for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
    const baseIndex = pixel * 4;
    const amountByte = maskLut[field[pixel]];
    if (preview === 'mask') {
      output.data[baseIndex] = amountByte;
      output.data[baseIndex + 1] = amountByte;
      output.data[baseIndex + 2] = amountByte;
      output.data[baseIndex + 3] = 255;
      continue;
    }
    if (preview === 'overlay') {
      const tint = (255 - amountByte) / 255 * 0.62;
      output.data[baseIndex] = clampByte(base.data[baseIndex] * (1 - tint) + 255 * tint);
      output.data[baseIndex + 1] = clampByte(base.data[baseIndex + 1] * (1 - tint));
      output.data[baseIndex + 2] = clampByte(base.data[baseIndex + 2] * (1 - tint));
      output.data[baseIndex + 3] = base.data[baseIndex + 3];
      continue;
    }
    output.data[baseIndex + 3] = clampByte(
      base.data[baseIndex + 3] * amountByte / 255,
    );
  }
  return output;
}

export function advancedMaskNeedsCpu(node: StudioNodeData): boolean {
  return Number(node.maskKeyTolerance ?? 0) > 0
    || (node.maskPreview ?? 'result') !== 'result';
}
