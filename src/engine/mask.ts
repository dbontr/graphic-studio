import type { MaskChannel, StudioNodeData } from '../model';
import type { Raster } from './types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

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
    lut[value] = clampByte(amount * 255);
  }
  return lut;
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

  const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
  const maskLut = buildMaskLut(node);

  for (let y = 0; y < base.height; y += 1) {
    const maskY = Math.min(
      mask.height - 1,
      Math.floor(((2 * y + 1) * mask.height) / (2 * base.height)),
    );
    for (let x = 0; x < base.width; x += 1) {
      const maskX = Math.min(
        mask.width - 1,
        Math.floor(((2 * x + 1) * mask.width) / (2 * base.width)),
      );
      const baseIndex = (y * base.width + x) * 4;
      const maskIndex = (maskY * mask.width + maskX) * 4;
      const sourceByte = maskChannelByte(mask.data, maskIndex, channel);
      const amountByte = maskLut[sourceByte];
      output.data[baseIndex + 3] = clampByte(
        base.data[baseIndex + 3] * amountByte / 255,
      );
    }
  }

  return output;
}
