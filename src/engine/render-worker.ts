/// <reference lib="webworker" />

import {
  applyEffectCpu,
  isGpuCompatible,
  makeDemoRaster,
  rasterToBitmap,
  rasterToBlob,
  stableStageSignature,
} from './imageEngine';
import type {
  EngineTelemetry,
  PipelineStage,
  Raster,
  RenderPlan,
  RenderedFrame,
  RenderedImage,
  SourceMeta,
} from './types';
import { WebGpuEngine } from './webgpu';
import { extractPalette } from './palette-extraction';

type Request =
  | { id: number; type: 'capabilities' }
  | { id: number; type: 'load-file'; file: File }
  | { id: number; type: 'extract-palette'; count: number }
  | { id: number; type: 'render'; plan: RenderPlan }
  | { id: number; type: 'export'; plan: RenderPlan };

type Response =
  | { id: number; ok: true; type: 'capabilities'; webgpu: boolean }
  | { id: number; ok: true; type: 'source'; meta: SourceMeta }
  | { id: number; ok: true; type: 'palette'; colors: string[] }
  | { id: number; ok: true; type: 'render'; frame: RenderedFrame }
  | { id: number; ok: true; type: 'export'; image: RenderedImage }
  | { id: number; ok: false; error: string };

const scope = self as DedicatedWorkerGlobalScope;
const gpu = new WebGpuEngine();
let gpuDisabled = false;
let previewSource = makeDemoRaster();
let sourceFile: File | null = null;
let sourceRevision = 1;

class RasterCache {
  private entries = new Map<string, Raster>();
  private bytes = 0;
  private readonly limitBytes: number;

  constructor(limitBytes: number) {
    this.limitBytes = limitBytes;
  }

  get(key: string): Raster | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, raster: Raster): void {
    const existing = this.entries.get(key);
    if (existing) this.bytes -= existing.data.byteLength;
    this.entries.delete(key);
    if (raster.data.byteLength > this.limitBytes / 2) return;
    this.entries.set(key, raster);
    this.bytes += raster.data.byteLength;
    while (this.bytes > this.limitBytes && this.entries.size > 1) {
      const oldest = this.entries.entries().next().value as [string, Raster] | undefined;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].data.byteLength;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

const cache = new RasterCache(192 * 1024 * 1024);

async function fileToRaster(
  file: File,
  maxDimension: number,
  maxPixels: number,
): Promise<Raster> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const dimensionScale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / (bitmap.width * bitmap.height)));
    const scale = Math.min(dimensionScale, pixelScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return { width, height, data: new Uint8ClampedArray(image.data) };
  } finally {
    bitmap.close();
  }
}

async function loadFilePreview(file: File): Promise<{
  raster: Raster;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const dimensionScale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const pixelScale = Math.min(1, Math.sqrt(3_200_000 / (bitmap.width * bitmap.height)));
    const scale = Math.min(dimensionScale, pixelScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    return {
      raster: { width, height, data: new Uint8ClampedArray(image.data) },
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

function shouldUseGpu(
  source: Raster,
  group: PipelineStage[],
  reachesOutput: boolean,
): boolean {
  if (!group.length) return false;
  if (reachesOutput) return true;
  const pixels = source.width * source.height;
  const hasSpatial = group.some((stage) =>
    stage.data.kind === 'convolution' || stage.data.kind === 'pixelate',
  );
  if (hasSpatial && pixels >= 250_000) return true;
  return group.length >= 3 && pixels >= 1_000_000;
}

async function executePlan(
  source: Raster,
  plan: RenderPlan,
  modeKey: string,
): Promise<{ raster: Raster; backend: EngineTelemetry['backend']; cacheHits: number; gpuPasses: number }> {
  let current = source;
  let token = `source:${sourceRevision}:${modeKey}:${source.width}x${source.height}`;
  let cacheHits = 0;
  let gpuPasses = 0;
  let usedGpu = false;
  let usedCpu = false;
  const gpuAvailable = !gpuDisabled && await gpu.available();

  let index = 0;
  while (index < plan.stages.length) {
    const stage = plan.stages[index];
    if (gpuAvailable && isGpuCompatible(stage.data)) {
      const group: PipelineStage[] = [];
      let cursor = index;
      while (cursor < plan.stages.length && isGpuCompatible(plan.stages[cursor].data)) {
        group.push(plan.stages[cursor]);
        cursor += 1;
      }
      if (shouldUseGpu(current, group, cursor === plan.stages.length)) {
        const groupToken = `${token}|gpu:${group.map(stableStageSignature).join('>')}`;
        const cached = cache.get(groupToken);
        if (cached) {
          current = cached;
          token = groupToken;
          cacheHits += 1;
          usedGpu = true;
          index = cursor;
          continue;
        }
        try {
          const rendered = await gpu.run(current, group);
          current = rendered.raster;
          gpuPasses += rendered.passes;
          usedGpu = true;
          token = groupToken;
          cache.set(token, current);
          index = cursor;
          continue;
        } catch (error) {
          console.warn('Graphic Studio WebGPU fallback:', error);
          gpuDisabled = true;
        }
      }
    }

    const stageToken = `${token}|cpu:${stableStageSignature(stage)}`;
    const cached = cache.get(stageToken);
    if (cached) {
      current = cached;
      cacheHits += 1;
    } else {
      current = applyEffectCpu(current, stage.data);
      cache.set(stageToken, current);
    }
    usedCpu = true;
    token = stageToken;
    index += 1;
  }

  const backend: EngineTelemetry['backend'] = usedGpu
    ? usedCpu ? 'hybrid' : 'webgpu'
    : 'cpu-worker';
  return { raster: current, backend, cacheHits, gpuPasses };
}

async function renderRaster(
  source: Raster,
  plan: RenderPlan,
  modeKey: string,
): Promise<{ raster: Raster; telemetry: EngineTelemetry }> {
  const started = performance.now();
  const processed = await executePlan(source, plan, modeKey);
  const durationMs = Math.max(0.01, performance.now() - started);
  const effectivePixels = source.width * source.height * Math.max(1, plan.stages.length);
  return {
    raster: processed.raster,
    telemetry: {
      backend: processed.backend,
      durationMs,
      megapixelsPerSecond: (effectivePixels / 1_000_000) / (durationMs / 1000),
      width: processed.raster.width,
      height: processed.raster.height,
      stages: plan.stages.length,
      cacheHits: processed.cacheHits,
      gpuPasses: processed.gpuPasses,
    },
  };
}

async function renderFrame(source: Raster, plan: RenderPlan): Promise<RenderedFrame> {
  const rendered = await renderRaster(source, plan, 'preview');
  return { bitmap: rasterToBitmap(rendered.raster), telemetry: rendered.telemetry };
}

async function renderImage(source: Raster, plan: RenderPlan): Promise<RenderedImage> {
  const rendered = await renderRaster(source, plan, 'export');
  return { blob: await rasterToBlob(rendered.raster), telemetry: rendered.telemetry };
}

async function handle(request: Request): Promise<Response> {
  if (request.type === 'capabilities') {
    return {
      id: request.id,
      ok: true,
      type: 'capabilities',
      webgpu: !gpuDisabled && await gpu.available(),
    };
  }

  if (request.type === 'load-file') {
    const loaded = await loadFilePreview(request.file);
    previewSource = loaded.raster;
    sourceFile = request.file;
    sourceRevision += 1;
    cache.clear();
    return {
      id: request.id,
      ok: true,
      type: 'source',
      meta: {
        width: loaded.width,
        height: loaded.height,
        previewWidth: loaded.raster.width,
        previewHeight: loaded.raster.height,
        fileName: request.file.name,
      },
    };
  }

  if (request.type === 'extract-palette') {
    return {
      id: request.id,
      ok: true,
      type: 'palette',
      colors: extractPalette(previewSource, request.count),
    };
  }

  if (request.type === 'render') {
    return {
      id: request.id,
      ok: true,
      type: 'render',
      frame: await renderFrame(previewSource, request.plan),
    };
  }

  const source = sourceFile
    ? await fileToRaster(sourceFile, 8192, 24_000_000)
    : previewSource;
  return {
    id: request.id,
    ok: true,
    type: 'export',
    image: await renderImage(source, request.plan),
  };
}

let chain = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  chain = chain.then(async () => {
    try {
      const response = await handle(request);
      if (response.ok && response.type === 'render') {
        scope.postMessage(response, [response.frame.bitmap]);
      } else {
        scope.postMessage(response);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response: Response = { id: request.id, ok: false, error: message };
      scope.postMessage(response);
    }
  });
};

