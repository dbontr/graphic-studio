import type { MaskChannel, StudioNodeData } from '../model';
import type { Raster } from './types';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function maskChannelValue(
  data: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
): number {
  if (channel === 'alpha') return data[index + 3] / 255;
  if (channel === 'red') return data[index] / 255;
  if (channel === 'green') return data[index + 1] / 255;
  if (channel === 'blue') return data[index + 2] / 255;
  return (
    0.2126 * data[index]
    + 0.7152 * data[index + 1]
    + 0.0722 * data[index + 2]
  ) / 255;
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
  const invert = Boolean(node.maskInvert);
  const strength = clamp01(Number(node.maskStrength ?? 100) / 100);

  for (let y = 0; y < base.height; y += 1) {
    const maskY = Math.min(
      mask.height - 1,
      Math.floor(((y + 0.5) / base.height) * mask.height),
    );
    for (let x = 0; x < base.width; x += 1) {
      const maskX = Math.min(
        mask.width - 1,
        Math.floor(((x + 0.5) / base.width) * mask.width),
      );
      const baseIndex = (y * base.width + x) * 4;
      const maskIndex = (maskY * mask.width + maskX) * 4;
      let amount = maskChannelValue(mask.data, maskIndex, channel);
      if (invert) amount = 1 - amount;
      amount = (1 - strength) + strength * amount;
      output.data[baseIndex + 3] = clampByte(base.data[baseIndex + 3] * amount);
    }
  }

  return output;
}
