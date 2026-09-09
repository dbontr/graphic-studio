import type { MaskChannel, StudioNodeData } from '../model';
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
  ) >> 16;}

export function maskChannelValue(
  data: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
): number {
  return maskChannelByte(data, index, channel) / 255;
}

export function shapeMaskValue(value: number, node: StudioNodeData): number {
  const black = Math.min(254 / 255, clamp01(Number(node.maskBlackPoint ?? 0) / 100));
  const white = Math.max(black + 1 / 255, clamp01(Number(node.maskWhitePoint ?? 100) / 100));
  const gamma = Math.max(0.1, Math.min(10, Number(node.maskGamma ?? 1)));
  const normalized = clamp01((value - black) / (white - black));
  return Math.pow(normalized, 1 / gamma);
}

export function buildMaskLut(node: StudioNodeData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const invert = Boolean(node.maskInvert);
  const strength = clamp01(Number(node.maskStrength ?? 100) / 100);
  for (let value = 0; value < 256; value += 1) {
    let amount = shapeMaskValue(value / 255, node);
    if (invert) amount = 1 - amount;
    amount = (1 - strength) + strength * amount;
    lut[value] = clampByte(amount * 255);  }
  return lut;
}

function normalizedMaskField(
  mask: Raster,
  width: number,
  height: number,
  channel: MaskChannel,
): Uint8Array {
  const field = new Uint8Array(width * height);
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
      field[y * width + x] = maskChannelByte(mask.data, maskIndex, channel);
    }
  }
  return field;
}

function blurHorizontal(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {  const output = new Uint8Array(source.length);
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
    }    for (let y = 0; y < height; y += 1) {
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

export function buildFeatheredMaskField(
  mask: Raster,
  width: number,
  height: number,
  node: StudioNodeData,
): Uint8Array {
  if (!width || !height || !mask.width || !mask.height) return new Uint8Array(width * height);
  const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
  const field = normalizedMaskField(mask, width, height, channel);
  const radius = maskFeatherRadius(node);
  if (!radius) return field;
  return blurVertical(blurHorizontal(field, width, height, radius), width, height, radius);
}

export function maskRaster(
  base: Raster,
  mask: Raster,
  node: StudioNodeData,
): Raster {  const output: Raster = {
    width: base.width,
    height: base.height,
    data: new Uint8ClampedArray(base.data),
  };
  if (!base.width || !base.height || !mask.width || !mask.height) return output;

  const maskLut = buildMaskLut(node);
  const feathered = buildFeatheredMaskField(mask, base.width, base.height, node);
  for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
    const baseIndex = pixel * 4;
    const amountByte = maskLut[feathered[pixel]];
    output.data[baseIndex + 3] = clampByte(
      base.data[baseIndex + 3] * amountByte / 255,
    );
  }
  return output;
}
