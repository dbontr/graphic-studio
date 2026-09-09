import { describe, expect, it } from 'vitest';
import type { StudioNodeData } from '../model';
import {
  buildMaskLut,
  maskChannelByte,
  maskChannelValue,
  maskRaster,
  shapeMaskValue,
} from './mask';
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
  maskFeather: 0,
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

  it('feathers normalized mask edges with a separable clamped box blur', () => {
    const base = raster(5, 1, [
      1, 1, 1, 255,
      2, 2, 2, 255,
      3, 3, 3, 255,
      4, 4, 4, 255,
      5, 5, 5, 255,
    ]);
    const mask = raster(5, 1, [
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    const output = maskRaster(base, mask, { ...defaults, maskFeather: 1 });
    expect([output.data[3], output.data[7], output.data[11], output.data[15], output.data[19]])
      .toEqual([0, 85, 170, 255, 255]);
  });

  it('feathers vertically with the same integer rounding semantics', () => {
    const base = raster(3, 3, Array.from({ length: 9 }, () => [10, 20, 30, 255]).flat());
    const pixels = Array.from({ length: 9 }, (_, index) =>
      index === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    ).flat();
    const output = maskRaster(base, raster(3, 3, pixels), { ...defaults, maskFeather: 1 });
    const alphas = Array.from({ length: 9 }, (_, index) => output.data[index * 4 + 3]);
    expect(alphas).toEqual(Array(9).fill(28));
  });

  it('uses an integer Rec.709 luminance byte for cross-backend determinism', () => {
    const pixel = new Uint8ClampedArray([64, 128, 192, 255]);
    expect(maskChannelByte(pixel, 0, 'luminance')).toBe(119);
    expect(maskChannelValue(pixel, 0, 'luminance')).toBeCloseTo(119 / 255);
  });

  it('shapes mask levels with black point, white point, and gamma', () => {
    expect(shapeMaskValue(0.25, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBe(0);
    expect(shapeMaskValue(0.5, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBeCloseTo(0.5);
    expect(shapeMaskValue(0.75, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBe(1);
    expect(shapeMaskValue(0.25, { ...defaults, maskGamma: 2 })).toBeCloseTo(0.5);
  });

  it('compiles shaping to a deterministic 256-entry byte LUT', () => {
    const lut = buildMaskLut({ ...defaults, maskBlackPoint: 25, maskWhitePoint: 75, maskGamma: 2 });
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[128]).toBeGreaterThan(175);
  });

  it('applies mask shaping before inversion and strength', () => {
    const base = raster(1, 1, [50, 60, 70, 200]);
    const mask = raster(1, 1, [128, 128, 128, 255]);
    const output = maskRaster(base, mask, {
      ...defaults,
      maskBlackPoint: 50,
      maskWhitePoint: 100,
      maskInvert: true,
      maskStrength: 50,
    });
    expect(output.data[3]).toBeGreaterThanOrEqual(198);
  });

  it('uses the selected alpha channel independently of mask RGB', () => {
    const base = raster(1, 1, [20, 30, 40, 200]);
    const mask = raster(1, 1, [255, 255, 255, 64]);
    const output = maskRaster(base, mask, { ...defaults, maskChannel: 'alpha' });
    expect(output.data[3]).toBe(50);
  });
});
