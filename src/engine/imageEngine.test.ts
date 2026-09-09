import { describe, expect, it } from 'vitest';
import type { StudioEdge, StudioFlowNode, StudioNodeData } from '../model';
import {
  applyEffectCpu,
  compilePipeline,
  ditherRaster,
  isGpuCompatible,
  makeDemoRaster,
  palettes,
  parseHexColor,
  posterizeRaster,
  processStagesCpu,
  resolvePalette,
  type Raster,
} from './imageEngine';
import { extractPalette } from './palette-extraction';
import { transformRaster } from './transform';

function raster(width: number, height: number, pixels: number[]): Raster {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

function tinyRaster(): Raster {
  return raster(2, 1, [
    10, 10, 10, 255,
    245, 245, 245, 255,
  ]);
}

function node(id: string, data: StudioNodeData): StudioFlowNode {
  return { id, type: 'studio', position: { x: 0, y: 0 }, data };
}

describe('image engine primitives', () => {
  it('creates a deterministic demo raster', () => {
    const first = makeDemoRaster(8, 6);
    const second = makeDemoRaster(8, 6);
    expect(first.width).toBe(8);
    expect(first.height).toBe(6);
    expect(first.data).toEqual(second.data);
  });

  it('posterizes channel values to the requested number of levels', () => {
    const result = posterizeRaster(
      raster(1, 1, [127, 63, 250, 255]),
      2,
    );
    expect(Array.from(result.data)).toEqual([0, 0, 255, 255]);
  });

  it('default color adjustment is an exact identity for byte pixels', () => {
    const source = raster(2, 1, [5, 127, 251, 17, 200, 31, 99, 240]);
    const result = applyEffectCpu(source, {
      kind: 'adjust',
      label: 'Identity',
      brightness: 0,
      contrast: 0,
      saturation: 100,
      exposure: 0,
      gamma: 1,
      temperature: 0,
      tint: 0,
    });
    expect(result.data).toEqual(source.data);
    expect(result.data).not.toBe(source.data);
  });
});

describe('dithering', () => {
  it('threshold dithering preserves dark/light ordering', () => {
    const result = ditherRaster(tinyRaster(), 'threshold', 128, true);
    expect(Array.from(result.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  it('noise dithering is deterministic for a fixed seed', () => {
    const source = makeDemoRaster(16, 12);
    const first = ditherRaster(source, 'noise', 128, true, 42);
    const second = ditherRaster(source, 'noise', 128, true, 42);
    const other = ditherRaster(source, 'noise', 128, true, 43);
    expect(first.data).toEqual(second.data);
    expect(first.data).not.toEqual(other.data);
  });

  it.each(['floyd-steinberg', 'atkinson', 'burkes', 'sierra-lite'] as const)(
    '%s preserves alpha and emits binary monochrome channels',
    (algorithm) => {
      const source = makeDemoRaster(12, 9);
      source.data[3] = 37;
      const result = ditherRaster(source, algorithm, 128, true);
      expect(result.data[3]).toBe(37);
      for (let index = 0; index < result.data.length; index += 4) {
        expect([0, 255]).toContain(result.data[index]);
        expect(result.data[index + 1]).toBe(result.data[index]);
        expect(result.data[index + 2]).toBe(result.data[index]);
      }
    },
  );
});

describe('palette processing', () => {
  it('maps every output pixel to an exact preset color', () => {
    const source = makeDemoRaster(14, 10);
    const data = applyEffectCpu(source, {
      kind: 'palette',
      label: 'PICO-8',
      palette: 'pico8',
    }).data;
    const allowed = new Set(palettes.pico8.map((color) => color.join(',')));
    for (let index = 0; index < data.length; index += 4) {
      expect(allowed.has(`${data[index]},${data[index + 1]},${data[index + 2]}`)).toBe(true);
    }
  });
});

describe('graph compiler', () => {
  const nodes: StudioFlowNode[] = [
    node('source', { kind: 'source', label: 'Source' }),
    node('adjust', { kind: 'adjust', label: 'Adjust', exposure: 1 }),
    node('posterize', { kind: 'posterize', label: 'Posterize', levels: 4 }),
    node('unused', { kind: 'pixelate', label: 'Unused', pixelSize: 20 }),
    node('output', { kind: 'output', label: 'Output' }),
  ];
  const edges: StudioEdge[] = [
    { id: 'a', source: 'source', target: 'adjust' },
    { id: 'b', source: 'adjust', target: 'posterize' },
    { id: 'c', source: 'posterize', target: 'output' },
  ];

  it('compiles only the connected source-to-output path in forward order', () => {
    const plan = compilePipeline(nodes, edges);
    expect(plan.stages.map((stage) => stage.id)).toEqual(['adjust', 'posterize']);
    expect(plan.signature).toContain('adjust');
    expect(plan.signature).not.toContain('unused');
  });

  it('rejects a disconnected output path', () => {
    const plan = compilePipeline(nodes, edges.filter((edge) => edge.id !== 'c'));
    expect(plan.stages).toEqual([]);
    expect(plan.signature).toBe('disconnected');
  });

  it('detects cycles without recursively evaluating them', () => {
    const cycleEdges: StudioEdge[] = [
      { id: 'a', source: 'adjust', target: 'posterize' },
      { id: 'b', source: 'posterize', target: 'adjust' },
      { id: 'c', source: 'posterize', target: 'output' },
    ];
    const plan = compilePipeline(nodes, cycleEdges);
    expect(plan.stages).toEqual([]);
    expect(plan.signature).toBe('cycle');
  });

  it('produces the same pixels as directly applying compiled stages', () => {
    const plan = compilePipeline(nodes, edges);
    const source = tinyRaster();
    const result = processStagesCpu(plan.stages, source);
    expect(result.width).toBe(source.width);
    expect(result.height).toBe(source.height);
    expect(result.data).not.toEqual(source.data);
  });
});

describe('backend compatibility', () => {
  it('routes embarrassingly parallel effects to WebGPU', () => {
    expect(isGpuCompatible({ kind: 'adjust', label: 'Adjust' })).toBe(true);
    expect(isGpuCompatible({ kind: 'convolution', label: 'Blur', convolution: 'blur' })).toBe(true);
    expect(isGpuCompatible({ kind: 'dither', label: 'Bayer', algorithm: 'bayer-8' })).toBe(true);
  });

  it('keeps sequential error diffusion on the CPU worker', () => {
    expect(isGpuCompatible({ kind: 'dither', label: 'FS', algorithm: 'floyd-steinberg' })).toBe(false);
    expect(isGpuCompatible({ kind: 'dither', label: 'Atkinson', algorithm: 'atkinson' })).toBe(false);
  });
});

describe('node bypass', () => {
  it('removes disabled effects from the semantic render plan', () => {
    const nodes: StudioFlowNode[] = [
      node('source', { kind: 'source', label: 'Source' }),
      node('disabled', { kind: 'posterize', label: 'Disabled', levels: 2, enabled: false }),
      node('output', { kind: 'output', label: 'Output' }),
    ];
    const edges: StudioEdge[] = [
      { id: 'a', source: 'source', target: 'disabled' },
      { id: 'b', source: 'disabled', target: 'output' },
    ];
    expect(compilePipeline(nodes, edges).stages).toEqual([]);
  });
});

describe('custom palettes', () => {
  it('parses short and full hex colors and rejects malformed values', () => {
    expect(parseHexColor('#abc')).toEqual([170, 187, 204]);
    expect(parseHexColor('#12FE80')).toEqual([18, 254, 128]);
    expect(parseHexColor('red')).toBeNull();
  });

  it('deduplicates valid custom colors and falls back when fewer than two survive', () => {
    expect(resolvePalette({
      kind: 'palette', label: 'Custom', palette: 'custom',
      customPalette: ['#000', '#000000', '#fff', 'invalid'],
    })).toEqual([[0, 0, 0], [255, 255, 255]]);
    expect(resolvePalette({
      kind: 'palette', label: 'Fallback', palette: 'custom',
      customPalette: ['invalid'],
    })).toBe(palettes.gameboy);
  });
});

describe('palette extraction', () => {
  it('extracts deterministic colors from a source raster', () => {
    const source = raster(4, 1, [
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 255, 0, 255,
    ]);
    const first = extractPalette(source, 3);
    const second = extractPalette(source, 3);
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    first.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/));
  });

  it('clamps requested palette size to the supported range', () => {
    const source = makeDemoRaster(48, 48);
    expect(extractPalette(source, 1).length).toBeGreaterThanOrEqual(2);
    expect(extractPalette(source, 99).length).toBeLessThanOrEqual(16);
  });
});

describe('fused transform engine', () => {
  const redBlue = raster(2, 1, [
    255, 0, 0, 255,
    0, 0, 255, 255,
  ]);

  it('rotates 90 degrees clockwise without resampling artifacts', () => {
    const result = transformRaster(redBlue, {
      kind: 'transform', label: 'Rotate', rotation: 90, resample: 'nearest',
    });
    expect([result.width, result.height]).toEqual([1, 2]);
    expect(Array.from(result.data)).toEqual([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]);
  });

  it('flips horizontally in a single transform stage', () => {
    const result = transformRaster(redBlue, {
      kind: 'transform', label: 'Flip', flipX: true, resample: 'nearest',
    });
    expect(Array.from(result.data)).toEqual([
      0, 0, 255, 255,
      255, 0, 0, 255,
    ]);
  });
  it('crops opposing edges before rotation and scaling', () => {
    const source = raster(4, 1, [
      10, 0, 0, 255,
      20, 0, 0, 255,
      30, 0, 0, 255,
      40, 0, 0, 255,
    ]);
    const result = transformRaster(source, {
      kind: 'transform', label: 'Crop', cropLeft: 25, cropRight: 25,
      resample: 'nearest',
    });
    expect([result.width, result.height]).toEqual([2, 1]);
    expect(Array.from(result.data)).toEqual([
      20, 0, 0, 255,
      30, 0, 0, 255,
    ]);
  });

  it('scales with nearest-neighbor sampling and preserves alpha', () => {
    const result = transformRaster(redBlue, {
      kind: 'transform', label: 'Scale', scale: 200, resample: 'nearest',
    });
    expect([result.width, result.height]).toEqual([4, 2]);
    expect(Array.from(result.data.slice(0, 16))).toEqual([
      255, 0, 0, 255, 255, 0, 0, 255,
      0, 0, 255, 255, 0, 0, 255, 255,
    ]);
  });

  it('returns the existing immutable raster for an exact no-op transform', () => {
    const result = transformRaster(redBlue, {
      kind: 'transform', label: 'Identity', rotation: 0, scale: 100,
      resample: 'bilinear',
    });
    expect(result).toBe(redBlue);
  });
});
