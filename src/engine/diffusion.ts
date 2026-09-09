import type { ErrorDiffusionAlgorithm, StudioNodeData } from '../model';
import type { Raster } from './types';

type Tap = readonly [dx: number, dy: number, weight: number];

const kernel = (denominator: number, taps: readonly [number, number, number][]) =>
  taps.map(([dx, dy, weight]) => [dx, dy, weight / denominator] as Tap);

export const diffusionKernels: Record<ErrorDiffusionAlgorithm, readonly Tap[]> = {
  'floyd-steinberg': kernel(16, [
    [1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1],
  ]),
  'false-floyd-steinberg': kernel(8, [
    [1, 0, 3], [0, 1, 3], [1, 1, 2],
  ]),
  atkinson: kernel(8, [
    [1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1],
    [1, 1, 1], [0, 2, 1],
  ]),
  'jarvis-judice-ninke': kernel(48, [
    [1, 0, 7], [2, 0, 5],
    [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
    [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
  ]),
  stucki: kernel(42, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
  ]),
  burkes: kernel(32, [
    [1, 0, 8], [2, 0, 4],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
  ]),
  sierra: kernel(32, [
    [1, 0, 5], [2, 0, 3],
    [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
    [-1, 2, 2], [0, 2, 3], [1, 2, 2],
  ]),
  'two-row-sierra': kernel(16, [
    [1, 0, 4], [2, 0, 3],
    [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1],
  ]),
  'sierra-lite': kernel(4, [
    [1, 0, 2], [-1, 1, 1], [0, 1, 1],
  ]),
  'stevenson-arce': kernel(200, [
    [2, 0, 32],
    [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16],
    [-2, 2, 12], [0, 2, 26], [2, 2, 12],
    [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5],
  ]),
  fan: kernel(16, [
    [1, 0, 7], [-2, 1, 1], [-1, 1, 3], [0, 1, 5],
  ]),
  'shiau-fan': kernel(8, [
    [1, 0, 4], [-2, 1, 1], [-1, 1, 1], [0, 1, 2],
  ]),
  'shiau-fan-2': kernel(16, [
    [1, 0, 8], [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4],
  ]),
  'simple-2d': kernel(2, [
    [1, 0, 1], [0, 1, 1],
  ]),
};

const luminance = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export function errorDiffusion(
  raster: Raster,
  node: StudioNodeData,
  algorithm: ErrorDiffusionAlgorithm,
): Raster {
  const output = {
    width: raster.width,
    height: raster.height,
    data: new Uint8ClampedArray(raster.data),
  };
  const source = raster.data;
  const target = output.data;
  const width = raster.width;
  const height = raster.height;
  const monochrome = node.monochrome !== false;
  const threshold = Math.max(0, Math.min(255, Number(node.threshold ?? 128)));
  const strength = Math.max(0, Math.min(2, Number(node.diffusionStrength ?? 100) / 100));
  const serpentine = node.serpentine !== false;
  const channels = monochrome ? 1 : 3;
  const rowLength = width * channels;
  const taps = diffusionKernels[algorithm];
  const maxDy = taps.reduce((max, tap) => Math.max(max, tap[1]), 0);
  const rows = Array.from(
    { length: maxDy + 1 },
    () => new Float32Array(rowLength),
  );

  for (let y = 0; y < height; y += 1) {
    const reverse = serpentine && (y & 1) === 1;
    const start = reverse ? width - 1 : 0;
    const end = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const pixel = y * width + x;
      const rgbaIndex = pixel * 4;
      for (let channel = 0; channel < channels; channel += 1) {
        const errorIndex = x * channels + channel;
        const base = monochrome
          ? luminance(source[rgbaIndex], source[rgbaIndex + 1], source[rgbaIndex + 2])
          : source[rgbaIndex + channel];
        const oldValue = base + rows[0][errorIndex];
        const newValue = oldValue >= threshold ? 255 : 0;
        const error = (oldValue - newValue) * strength;

        if (monochrome) {
          target[rgbaIndex] = newValue;
          target[rgbaIndex + 1] = newValue;
          target[rgbaIndex + 2] = newValue;
        } else {
          target[rgbaIndex + channel] = newValue;
        }

        for (const [dx, dy, weight] of taps) {
          const xx = x + (reverse ? -dx : dx);
          if (xx < 0 || xx >= width) continue;
          rows[dy][xx * channels + channel] += error * weight;
        }
      }
    }
    const recycled = rows.shift();
    if (recycled) {
      recycled.fill(0);
      rows.push(recycled);
    }
  }
  return output;
}
