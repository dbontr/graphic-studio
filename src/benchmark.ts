import { compileRenderGraph } from './engine/graphCompiler';
import { RenderEngineClient } from './engine/render-client';
import type { EngineTelemetry, RenderPlan } from './engine/types';
import type { StudioEdge, StudioFlowNode } from './model';

export interface BenchmarkSample {
  mode: 'interactive' | 'quality' | 'export';
  wallMs: number;
  telemetry: EngineTelemetry;
  outputBytes?: number;
}

export interface BenchmarkCase {
  label: string;
  width: number;
  height: number;
  samples: BenchmarkSample[];
}

export interface BenchmarkReport {
  generatedAt: string;
  userAgent: string;
  webgpu: boolean;
  cases: BenchmarkCase[];
}

function benchmarkPlan(width: number, height: number): RenderPlan {
  const nodes: StudioFlowNode[] = [
    {
      id: 'generator', type: 'studio', position: { x: 0, y: 0 },
      data: {
        kind: 'generator', label: 'Benchmark generator', canvasWidth: width, canvasHeight: height,
        generatorType: 'fractal-noise', generatorColorA: '#10131a', generatorColorB: '#e7f4cf',
        generatorScale: 72, generatorSeed: 1337, generatorOctaves: 5, generatorIntensity: 115,
      },
    },
    {
      id: 'adjust', type: 'studio', position: { x: 300, y: 0 },
      data: {
        kind: 'adjust', label: 'Benchmark grade', exposure: 0.15, contrast: 16,
        saturation: 112, gamma: 0.92, brightness: 2, temperature: 4, tint: -2,
      },
    },
    {
      id: 'posterize', type: 'studio', position: { x: 600, y: 0 },
      data: { kind: 'posterize', label: 'Benchmark posterize', levels: 10 },
    },
    {
      id: 'dither', type: 'studio', position: { x: 900, y: 0 },
      data: { kind: 'dither', label: 'Benchmark dither', algorithm: 'bayer-8', threshold: 128, monochrome: false },
    },
    { id: 'output', type: 'studio', position: { x: 1200, y: 0 }, data: { kind: 'output', label: 'Output' } },
  ];
  const edges: StudioEdge[] = [
    { id: 'g-a', source: 'generator', target: 'adjust' },
    { id: 'a-p', source: 'adjust', target: 'posterize' },
    { id: 'p-d', source: 'posterize', target: 'dither' },
    { id: 'd-o', source: 'dither', target: 'output' },
  ];
  return compileRenderGraph(nodes, edges);
}

async function timedFrame(
  client: RenderEngineClient,
  plan: RenderPlan,
  mode: 'interactive' | 'quality',
): Promise<BenchmarkSample> {
  const started = performance.now();
  const frame = await client.render(plan, mode);
  const wallMs = performance.now() - started;
  const telemetry = frame.telemetry;
  frame.bitmap.close();
  return { mode, wallMs, telemetry };
}

async function timedExport(client: RenderEngineClient, plan: RenderPlan): Promise<BenchmarkSample> {
  const started = performance.now();
  const result = await client.export(plan, { format: 'webp', quality: 0.84, matte: '#ffffff' });
  return {
    mode: 'export',
    wallMs: performance.now() - started,
    telemetry: result.telemetry,
    outputBytes: result.blob.size,
  };
}

export async function runBenchmarkSuite(): Promise<BenchmarkReport> {
  const client = new RenderEngineClient();
  try {
    const capabilities = await client.capabilities();
    const warmup = await client.render(benchmarkPlan(640, 360), 'quality');
    warmup.bitmap.close();
    const cases: BenchmarkCase[] = [];
    for (const [label, width, height] of [
      ['1080p', 1920, 1080],
      ['4K', 3840, 2160],
      ['8K', 7680, 4320],
    ] as const) {
      const plan = benchmarkPlan(width, height);
      const samples = [
        await timedFrame(client, plan, 'interactive'),
        await timedFrame(client, plan, 'quality'),
        await timedExport(client, plan),
      ];
      cases.push({ label, width, height, samples });
    }
    return {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      webgpu: capabilities.webgpu,
      cases,
    };
  } finally {
    client.dispose();
  }
}
