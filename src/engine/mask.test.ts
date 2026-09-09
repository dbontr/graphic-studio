import { describe, expect, it } from 'vitest';
import type { StudioNodeData } from '../model';
import { maskChannelValue, maskRaster } from './mask';
import type { Raster } from './types';

function raster(width: number, height: number, pixels: number[]): Raster {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

const defaults: StudioNodeData = {
  kind: 'mask',
  label: 'Mask',
  maskChannel: 'luminance',
  maskInvert: false,
  maskStrength: 100,
};

describe('mask compositor', () => {
  it('turns luminance into base alpha without changing RGB', () => {
    const base = raster(2, 1, [10, 20, 30, 255, 40, 50, 60, 200]);
    const mask = raster(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    const output = maskRaster(base, mask, defaults);
    expect(Array.from(output.data)).toEqual([
      10, 20, 30, 0,
      40, 50, 60, 200,
    ]);
  });

  it('blends mask strength continuously with the unmasked base', () => {
    const base = raster(1, 1, [90, 80, 70, 255]);
    const mask = raster(1, 1, [0, 0, 0, 255]);
    const output = maskRaster(base, mask, { ...defaults, maskStrength: 50 });
    expect(output.data[3]).toBe(128);
  });

  it('supports inversion', () => {
    const base = raster(1, 1, [1, 2, 3, 255]);
    const mask = raster(1, 1, [0, 0, 0, 255]);
    const output = maskRaster(base, mask, { ...defaults, maskInvert: true });
    expect(output.data[3]).toBe(255);
  });

  it('selects red, green, blue, and alpha channels exactly', () => {
    const pixel = new Uint8ClampedArray([64, 128, 192, 32]);
    expect(maskChannelValue(pixel, 0, 'red')).toBeCloseTo(64 / 255);
    expect(maskChannelValue(pixel, 0, 'green')).toBeCloseTo(128 / 255);
    expect(maskChannelValue(pixel, 0, 'blue')).toBeCloseTo(192 / 255);
    expect(maskChannelValue(pixel, 0, 'alpha')).toBeCloseTo(32 / 255);
  });

  it('normalizes mask geometry to the base canvas with nearest sampling', () => {
    const base = raster(4, 1, [
      1, 1, 1, 255,
      2, 2, 2, 255,
      3, 3, 3, 255,
      4, 4, 4, 255,
    ]);
    const mask = raster(2, 1, [0, 0, 0, 255, 255, 255, 255, 255]);
    const output = maskRaster(base, mask, defaults);
    expect([
      output.data[3], output.data[7], output.data[11], output.data[15],
    ]).toEqual([0, 0, 255, 255]);
  });

  it('uses the selected alpha channel independently of mask RGB', () => {
    const base = raster(1, 1, [20, 30, 40, 200]);
    const mask = raster(1, 1, [255, 255, 255, 64]);
    const output = maskRaster(base, mask, { ...defaults, maskChannel: 'alpha' });
    expect(output.data[3]).toBe(50);
  });
});
