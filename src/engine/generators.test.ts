import { describe, expect, it } from 'vitest';
import type { StudioNodeData } from '../model';
import { generateRaster } from './generators';

function generator(patch: Partial<StudioNodeData> = {}): StudioNodeData {
  return {
    kind: 'generator',
    label: 'Generator',
    canvasWidth: 32,
    canvasHeight: 24,
    generatorType: 'noise',
    generatorColorA: '#000000',
    generatorColorB: '#ffffff',
    generatorScale: 8,
    generatorSeed: 17,
    generatorOctaves: 4,
    generatorIntensity: 100,
    ...patch,
  };
}

describe('procedural raster generators', () => {
  it('is byte-deterministic for identical seeded noise parameters', () => {
    const first = generateRaster(generator());
    const second = generateRaster(generator());
    expect(first.width).toBe(32);
    expect(first.height).toBe(24);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('changes seeded noise when the seed changes', () => {
    const first = generateRaster(generator({ generatorSeed: 1 }));
    const second = generateRaster(generator({ generatorSeed: 2 }));
    expect(Array.from(first.data)).not.toEqual(Array.from(second.data));
  });

  it('produces repeatable multi-octave fractal noise', () => {
    const node = generator({ generatorType: 'fractal-noise', generatorOctaves: 6, generatorSeed: 321 });
    const first = generateRaster(node);
    const second = generateRaster(node);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });

  it('renders ordered linear gradient endpoints', () => {
    const gradient: StudioNodeData = {
      kind: 'gradient',
      label: 'Gradient',
      canvasWidth: 5,
      canvasHeight: 1,
      gradientType: 'linear',
      gradientAngle: 0,
      gradientStops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    const output = generateRaster(gradient);
    expect(output.data[0]).toBeLessThan(output.data[8]);
    expect(output.data[8]).toBeLessThan(output.data[16]);
    expect(output.data[3]).toBe(255);
  });

  it('creates a two-color checker pattern at the requested dimensions', () => {
    const output = generateRaster(generator({
      generatorType: 'checkerboard',
      canvasWidth: 8,
      canvasHeight: 8,
      generatorScale: 4,
      generatorColorA: '#102030',
      generatorColorB: '#f0e0d0',
    }));
    expect([output.width, output.height]).toEqual([8, 8]);
    expect(Array.from(output.data.slice(0, 3))).toEqual([16, 32, 48]);
    const opposite = 4 * 4;
    expect(Array.from(output.data.slice(opposite, opposite + 3))).toEqual([240, 224, 208]);
  });

  it('keeps alpha opaque for procedural sources', () => {
    const output = generateRaster(generator({ generatorType: 'voronoi' }));
    for (let index = 3; index < output.data.length; index += 4) {
      expect(output.data[index]).toBe(255);
    }
  });
});
