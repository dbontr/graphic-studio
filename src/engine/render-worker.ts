/// <reference lib="webworker" />

import {
  applyEffectCpu,
  blendRaster,
  isGpuCompatible,
  makeDemoRaster,
  rasterToBitmap,
  rasterToBlob,
  stableStageSignature,
} from './imageEngine';
import { maskRaster } from './mask';
import { MaskGpuEngine } from './maskGpuEngine';
import type {
  EngineTelemetry,
  ExportOptions,
  GraphPlanNode,
  PipelineStage,
  Raster,
  RenderPlan,
  RenderedFrame,
  RenderedImage,
  SourceMeta,
} from './types';
import { WebGpuEngine } from './webgpu';
import { extractPalette } from './palette-extraction';
import { computeScopes } from './scopes';

type Request =
  | { id: number; type: 'capabilities' }
  | { id: number; type: 'load-file'; file: File }
  | { id: number; type: 'extract-palette'; count: number }
  | { id: number; type: 'render'; plan: RenderPlan }
  | { id: number; type: 'export'; plan: RenderPlan; options: ExportOptions };

type Response =
  | { id: number; ok: true; type: 'capabilities'; webgpu: boolean }
  | { id: number; ok: true; type: 'source'; meta: SourceMeta }
  | { id: number; ok: true; type: 'palette'; colors: string[] }
  | { id: number; ok: true; type: 'render'; frame: RenderedFrame }
  | { id: number; ok: true; type: 'export'; image: RenderedImage }
  | { id: number; ok: false; error: string };

const scope = self as DedicatedWorkerGlobalScope;
const gpu = new WebGpuEngine();
const maskGpu = new MaskGpuEngine();
let gpuDisabled = false;
let maskGpuDisabled = false;
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

function stageSignature(stage: PipelineStage): string {
  if (stage.data.kind !== 'mask') return stableStageSignature(stage);
  const d = stage.data;
  return JSON.stringify([
    stage.id,
    d.kind,
    d.enabled,
    d.maskChannel,
    d.maskInvert,
    d.maskStrength,
    d.maskBlackPoint,
    d.maskWhitePoint,
    d.maskGamma,
  ]);
}

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

interface StageExecution {
  raster: Raster;
  token: string;
  cacheHits: number;
  gpuPasses: number;
  usedGpu: boolean;
  usedCpu: boolean;
}

async function executeStages(
  source: Raster,
  stages: PipelineStage[],
  startToken: string,
  gpuAvailable: boolean,
  terminal: boolean,
): Promise<StageExecution> {
  let current = source;
  let token = startToken;
  let cacheHits = 0;
  let gpuPasses = 0;
  let usedGpu = false;
  let usedCpu = false;
  let index = 0;

  while (index < stages.length) {
    const stage = stages[index];
    if (gpuAvailable && !gpuDisabled && isGpuCompatible(stage.data)) {
      const group: PipelineStage[] = [];
      let cursor = index;
      while (cursor < stages.length && isGpuCompatible(stages[cursor].data)) {
        group.push(stages[cursor]);
        cursor += 1;
      }
      if (shouldUseGpu(current, group, terminal && cursor === stages.length)) {
        const groupToken = `${token}|gpu:${group.map(stageSignature).join('>')}`;
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

    const stageToken = `${token}|cpu:${stageSignature(stage)}`;
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

  return { raster: current, token, cacheHits, gpuPasses, usedGpu, usedCpu };
}

function backendFor(usedGpu: boolean, usedCpu: boolean): EngineTelemetry['backend'] {
  return usedGpu ? (usedCpu ? 'hybrid' : 'webgpu') : 'cpu-worker';
}

async function executePlan(
  source: Raster,
  plan: RenderPlan,
  modeKey: string,
): Promise<{ raster: Raster; backend: EngineTelemetry['backend']; cacheHits: number; gpuPasses: number }> {
  const gpuAvailable = !gpuDisabled && await gpu.available();
  const sourceToken = `source:${sourceRevision}:${modeKey}:${source.width}x${source.height}`;
  const executed = await executeStages(source, plan.stages, sourceToken, gpuAvailable, true);
  return {
    raster: executed.raster,
    backend: backendFor(executed.usedGpu, executed.usedCpu),
    cacheHits: executed.cacheHits,
    gpuPasses: executed.gpuPasses,
  };
}

interface GraphValue {
  raster: Raster;
  token: string;
}

async function executeGraph(
  source: Raster,
  plan: RenderPlan,
  modeKey: string,
): Promise<{ raster: Raster; backend: EngineTelemetry['backend']; cacheHits: number; gpuPasses: number }> {
  const graph = plan.graph;
  if (!graph) return executePlan(source, plan, modeKey);

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) {
    for (const input of node.inputs) {
      const values = children.get(input.source) ?? [];
      values.push(node.id);
      children.set(input.source, values);
    }
  }

  const gpuAvailable = !gpuDisabled && await gpu.available();
  const maskGpuAvailable = !maskGpuDisabled && await maskGpu.available();
  const sourceToken = `source:${sourceRevision}:${modeKey}:${source.width}x${source.height}`;
  const memo = new Map<string, GraphValue>();
  let cacheHits = 0;
  let gpuPasses = 0;
  let usedGpu = false;
  let usedCpu = false;

  const addExecution = (execution: StageExecution) => {
    cacheHits += execution.cacheHits;
    gpuPasses += execution.gpuPasses;
    usedGpu ||= execution.usedGpu;
    usedCpu ||= execution.usedCpu;
  };

  const evaluate = async (id: string): Promise<GraphValue> => {
    const existing = memo.get(id);
    if (existing) return existing;
    const node = nodes.get(id);
    if (!node) throw new Error(`Render graph node ${id} is missing.`);

    if (node.data.kind === 'source') {
      const value = { raster: source, token: sourceToken };
      memo.set(id, value);
      return value;
    }

    const primaryInput = node.inputs.find((input) => input.port === 'base') ?? node.inputs[0];
    if (!primaryInput) throw new Error(`Render graph node ${id} has no input.`);

    if (node.data.kind === 'output' || node.data.enabled === false) {
      const value = await evaluate(primaryInput.source);
      memo.set(id, value);
      return value;
    }

    if (node.data.kind === 'blend') {
      const layerInput = node.inputs.find((input) => input.port === 'blend');
      if (!layerInput) throw new Error(`Blend node ${id} is missing its Blend input.`);
      // The main WebGPU engine reuses shared ping-pong buffers, so branch evaluation
      // remains serialized. Independent branch results are still memoized.
      const base = await evaluate(primaryInput.source);
      const layer = await evaluate(layerInput.source);
      const stage: PipelineStage = { id: node.id, data: node.data };
      const blendToken = `${base.token}|blend:${stageSignature(stage)}|layer:${layer.token}`;
      const cached = cache.get(blendToken);
      const preferGpu = gpuAvailable
        && !gpuDisabled
        && base.raster.width * base.raster.height >= 120_000;
      let raster: Raster;
      if (cached) {
        raster = cached;
        cacheHits += 1;
        usedGpu ||= preferGpu;
        usedCpu ||= !preferGpu;
      } else if (preferGpu) {
        try {
          const rendered = await gpu.runBlend(base.raster, layer.raster, node.data);
          raster = rendered.raster;
          gpuPasses += rendered.passes;
          usedGpu = true;
          cache.set(blendToken, raster);
        } catch (error) {
          console.warn('Graphic Studio WebGPU blend fallback:', error);
          gpuDisabled = true;
          raster = blendRaster(base.raster, layer.raster, node.data);
          usedCpu = true;
          cache.set(blendToken, raster);
        }
      } else {
        raster = blendRaster(base.raster, layer.raster, node.data);
        usedCpu = true;
        cache.set(blendToken, raster);
      }
      const value = { raster, token: blendToken };
      memo.set(id, value);
      return value;
    }

    if (node.data.kind === 'mask') {
      const maskInput = node.inputs.find((input) => input.port === 'mask');
      if (!maskInput) throw new Error(`Mask node ${id} is missing its Mask input.`);
      const base = await evaluate(primaryInput.source);
      const mask = await evaluate(maskInput.source);
      const stage: PipelineStage = { id: node.id, data: node.data };
      const maskToken = `${base.token}|mask:${stageSignature(stage)}|source:${mask.token}`;
      const cached = cache.get(maskToken);
      const preferGpu = maskGpuAvailable
        && !maskGpuDisabled
        && base.raster.width * base.raster.height >= 120_000;
      let raster: Raster;
      if (cached) {
        raster = cached;
        cacheHits += 1;
        usedGpu ||= preferGpu;
        usedCpu ||= !preferGpu;
      } else if (preferGpu) {
        try {
          raster = await maskGpu.run(base.raster, mask.raster, node.data);
          gpuPasses += 1;
          usedGpu = true;
          cache.set(maskToken, raster);
        } catch (error) {
          console.warn('Graphic Studio WebGPU mask fallback:', error);
          maskGpuDisabled = true;
          raster = maskRaster(base.raster, mask.raster, node.data);
          usedCpu = true;
          cache.set(maskToken, raster);
        }
      } else {
        raster = maskRaster(base.raster, mask.raster, node.data);
        usedCpu = true;
        cache.set(maskToken, raster);
      }
      const value = { raster, token: maskToken };
      memo.set(id, value);
      return value;
    }

    const chain: PipelineStage[] = [];
    let cursor: GraphPlanNode = node;
    let baseId = primaryInput.source;
    while (true) {
      chain.unshift({ id: cursor.id, data: cursor.data });
      const parentId = cursor.inputs[0]?.source;
      if (!parentId) throw new Error(`Render graph node ${cursor.id} has no input.`);
      const parent = nodes.get(parentId);
      if (!parent) throw new Error(`Render graph node ${parentId} is missing.`);
      const parentShared = (children.get(parentId)?.length ?? 0) > 1;
      const boundary = parent.data.kind === 'source'
        || parent.data.kind === 'blend'
        || parent.data.kind === 'mask'
        || parent.data.kind === 'output'
        || parent.data.enabled === false
        || parentShared;
      if (boundary) {
        baseId = parentId;
        break;
      }
      cursor = parent;
    }

    const base = await evaluate(baseId);
    const terminal = (children.get(id) ?? []).includes(graph.outputId);
    const execution = await executeStages(
      base.raster,
      chain,
      base.token,
      gpuAvailable,
      terminal,
    );
    addExecution(execution);
    const value = { raster: execution.raster, token: execution.token };
    memo.set(id, value);
    return value;
  };

  const result = await evaluate(graph.outputId);
  return {
    raster: result.raster,
    backend: backendFor(usedGpu, usedCpu),
    cacheHits,
    gpuPasses,
  };
}

async function renderRaster(
  source: Raster,
  plan: RenderPlan,
  modeKey: string,
): Promise<{ raster: Raster; telemetry: EngineTelemetry }> {
  const started = performance.now();
  const processed = await executeGraph(source, plan, modeKey);
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
  return {
    bitmap: rasterToBitmap(rendered.raster),
    telemetry: rendered.telemetry,
    scopes: computeScopes(rendered.raster),
  };
}

async function renderImage(
  source: Raster,
  plan: RenderPlan,
  options: ExportOptions,
): Promise<RenderedImage> {
  const rendered = await renderRaster(source, plan, 'export');
  return {
    blob: await rasterToBlob(rendered.raster, options),
    telemetry: rendered.telemetry,
  };
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
    image: await renderImage(source, request.plan, request.options),
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
