import { describe, expect, it } from 'vitest';
import {
  ditherRaster,
  makeDemoRaster,
  posterizeRaster,
  type Raster,
} from './imageEngine';

function tinyRaster(): Raster {
  return {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      10, 10, 10, 255,
      245, 245, 245, 255,
    ]),
  };
}

describe('image engine', () => {
  it('creates a deterministic demo raster', () => {
    const first = makeDemoRaster(8, 6);
    const second = makeDemoRaster(8, 6);
    expect(first.width).toBe(8);
    expect(first.height).toBe(6);
    expect(first.data).toEqual(second.data);
  });

  it('posterizes channel values to the requested number of levels', () => {
    const result = posterizeRaster(
      {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray([127, 63, 250, 255]),
      },
      2,
    );
    expect(Array.from(result.data)).toEqual([0, 0, 255, 255]);
  });

  it('threshold dithering preserves dark/light ordering', () => {
    const result = ditherRaster(tinyRaster(), 'threshold', 128, true);
    expect(Array.from(result.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });
});
