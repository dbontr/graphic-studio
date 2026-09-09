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
import { advancedMaskNeedsCpu, maskRaster } from './mask';
import { GENERATOR_NODE_KINDS, generateRaster } from './generators';
import { placeOverlay } from './overlay';
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
import type { StudioNodeData } from '../model';
import { extractPalette } from './palette-extraction';
import { computeScopes } from './scopes';

type Request =
  | { id: number; type: 'capabilities' }
  | { id: number; type: 'load-file'; file: File }
  | { id: number; type: 'source-preview' }
  | { id: number; type: 'extract-palette'; count: number }
  | { id: number; type: 'render'; plan: RenderPlan; quality?: 'interactive' | 'quality' }
  | { id: number; type: 'export'; plan: RenderPlan; options: ExportOptions }
  | { id: number; type: 'batch-item'; file: File; plan: RenderPlan; options: ExportOptions; maxDimension?: number };

type Response =
  | { id: number; ok: true; type: 'capabilities'; webgpu: boolean }
  | { id: number; ok: true; type: 'source'; meta: SourceMeta }
  | { id: number; ok: true; type: 'source-preview'; bitmap: ImageBitmap }
  | { id: number; ok: true; type: 'palette'; colors: string[] }
  | { id: number; ok: true; type: 'render'; frame: RenderedFrame }
  | { id: number; ok: true; type: 'export'; image: RenderedImage }
  | { id: number; ok: true; type: 'batch-item'; image: RenderedImage }
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
    d.maskFeather,
    d.maskBlackPoint,
    d.maskWhitePoint,
    d.maskGamma,
    d.maskBlurRadius,
    d.maskMorphology,
    d.maskMorphRadius,
    d.maskThreshold,
    d.maskKeyColor,
    d.maskKeyTolerance,
    d.maskPreview,
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

function resizeRaster(source: Raster, maxPixels: number): Raster {
  const pixels = source.width * source.height;
  if (pixels <= maxPixels) return source;
  const scale = Math.sqrt(maxPixels / pixels);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  const sourceCanvas = new OffscreenCanvas(source.width, source.height);
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) return source;
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(source.data), source.width, source.height), 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';
  context.drawImage(sourceCanvas, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8ClampedArray(image.data) };
}

function interactivePixelBudget(plan: RenderPlan): number {
  const serial = plan.stages.some((stage) =>
    stage.data.kind === 'dither'
      && !isGpuCompatible(stage.data),
  );
  const spatial = plan.stages.some((stage) =>
    stage.data.kind === 'convolution' || stage.data.kind === 'mask',
  );
  if (serial) return 520_000;
  if (spatial || plan.stages.length >= 8) return 720_000;
  if (plan.stages.length >= 4) return 1_000_000;
  return 1_600_000;
}
function scaleInteractiveData(data: StudioNodeData, scale: number): StudioNodeData {
  const next: StudioNodeData = { ...data };
  const root = GENERATOR_NODE_KINDS.has(data.kind);
  if (root) {
    next.canvasWidth = Math.max(1, Math.round(Number(data.canvasWidth ?? 1024) * scale));
    next.canvasHeight = Math.max(1, Math.round(Number(data.canvasHeight ?? 1024) * scale));
    if (data.kind === 'generator') next.generatorScale = Math.max(1, Number(data.generatorScale ?? 32) * scale);
    if (data.kind === 'text') {
      next.fontSize = Math.max(1, Number(data.fontSize ?? 96) * scale);
      next.letterSpacing = Number(data.letterSpacing ?? 0) * scale;
      next.textStrokeWidth = Number(data.textStrokeWidth ?? 0) * scale;
    }
    if (data.kind === 'shape') {
      next.shapeLineWidth = Math.max(0, Number(data.shapeLineWidth ?? 0) * scale);
      next.cornerRadius = Math.max(0, Number(data.cornerRadius ?? 0) * scale);
    }
  }
  if (data.kind === 'overlay') {
    next.overlayX = Number(data.overlayX ?? 0) * scale;
    next.overlayY = Number(data.overlayY ?? 0) * scale;
  }
  if (data.kind === 'mask') {
    next.maskFeather = Math.max(0, Number(data.maskFeather ?? 0) * scale);
    next.maskBlurRadius = Math.max(0, Number(data.maskBlurRadius ?? 0) * scale);
    next.maskMorphRadius = Math.max(0, Number(data.maskMorphRadius ?? 0) * scale);
    next.maskExpand = Number(data.maskExpand ?? 0) * scale;
  }
  if (data.kind === 'pixelate') next.pixelSize = Math.max(1, Number(data.pixelSize ?? 8) * scale);
  if (data.kind === 'dither' && data.patternScale !== undefined) {
    next.patternScale = Math.max(1, Number(data.patternScale) * scale);
  }
  return next;
}

function interactivePlan(plan: RenderPlan, maxPixels: number): RenderPlan {
  if (!plan.graph) return plan;
  const rootPixels = plan.graph.nodes
    .filter((node) => GENERATOR_NODE_KINDS.has(node.data.kind))
    .map((node) => Math.max(1, Number(node.data.canvasWidth ?? 1024))
      * Math.max(1, Number(node.data.canvasHeight ?? 1024)));
  const largest = rootPixels.length ? Math.max(...rootPixels) : 0;
  if (!largest || largest <= maxPixels) return plan;
  const scale = Math.sqrt(maxPixels / largest);
  return {
    ...plan,
    signature: `${plan.signature}|interactive-scale:${scale.toFixed(6)}`,
    stages: plan.stages.map((stage) => ({ ...stage, data: scaleInteractiveData(stage.data, scale) })),
    graph: {
      ...plan.graph,
      nodes: plan.graph.nodes.map((node) => ({ ...node, data: scaleInteractiveData(node.data, scale) })),
    },
  };
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

    if (GENERATOR_NODE_KINDS.has(node.data.kind)) {
      const stage: PipelineStage = { id: node.id, data: node.data };
      const token = `generator:${stageSignature(stage)}`;
      const pixels = Math.max(1, Number(node.data.canvasWidth ?? 1024))
        * Math.max(1, Number(node.data.canvasHeight ?? 1024));
      const preferGpu = node.data.kind === 'generator' && gpuAvailable && !gpuDisabled && pixels >= 180_000;
      let raster = cache.get(token);
      if (raster) {
        cacheHits += 1;
        usedGpu ||= preferGpu;
        usedCpu ||= !preferGpu;
      } else if (preferGpu) {
        try {
          const rendered = await gpu.runGenerator(node.data);
          raster = rendered.raster;
          gpuPasses += rendered.passes;
          usedGpu = true;
          cache.set(token, raster);
        } catch (error) {
          console.warn('Graphic Studio WebGPU generator fallback:', error);
          raster = generateRaster(node.data);
          usedCpu = true;
          cache.set(token, raster);
        }
      } else {
        raster = generateRaster(node.data);
        usedCpu = true;
        cache.set(token, raster);
      }
      const value = { raster, token };
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

    if (node.data.kind === 'overlay') {
      const layerInput = node.inputs.find((input) => input.port === 'overlay');
      if (!layerInput) throw new Error(`Overlay node ${id} is missing its Overlay input.`);
      const base = await evaluate(primaryInput.source);
      const layer = await evaluate(layerInput.source);
      const stage: PipelineStage = { id: node.id, data: node.data };
      const overlayToken = `${base.token}|overlay:${stageSignature(stage)}|layer:${layer.token}`;
      const cached = cache.get(overlayToken);
      let raster: Raster;
      if (cached) {
        raster = cached;
        cacheHits += 1;
      } else {
        const placed = placeOverlay(base.raster, layer.raster, node.data);
        usedCpu = true;
        const compositeData = {
          ...node.data,
          kind: 'blend' as const,
          blendMode: node.data.overlayBlendMode ?? 'normal',
          opacity: node.data.overlayOpacity ?? 100,
        };
        const preferGpu = gpuAvailable && !gpuDisabled && base.raster.width * base.raster.height >= 120_000;
        if (preferGpu) {
          try {
            const rendered = await gpu.runBlend(base.raster, placed, compositeData);
            raster = rendered.raster;
            gpuPasses += rendered.passes;
            usedGpu = true;
          } catch (error) {
            console.warn('Graphic Studio WebGPU overlay fallback:', error);
            gpuDisabled = true;
            raster = blendRaster(base.raster, placed, compositeData);
          }
        } else {
          raster = blendRaster(base.raster, placed, compositeData);
        }
        cache.set(overlayToken, raster);
      }
      const value = { raster, token: overlayToken };
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
      const preferGpu = !advancedMaskNeedsCpu(node.data)
        && maskGpuAvailable
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
          const rendered = await maskGpu.run(base.raster, mask.raster, node.data);
          raster = rendered.raster;
          gpuPasses += rendered.passes;
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
        || GENERATOR_NODE_KINDS.has(parent.data.kind)
        || parent.data.kind === 'blend'
        || parent.data.kind === 'mask'
        || parent.data.kind === 'overlay'
        || parent.data.kind === 'output'
        || parent.data.enabled === false
        || parentShared;
      if (boundary) {
        baseId = parentId;
        break;
      }
      cursor = parent;
    }

    const baseNode = nodes.get(baseId);
    const generatorPixels = baseNode?.data.kind === 'generator'
      ? Math.max(1, Number(baseNode.data.canvasWidth ?? 1024))
        * Math.max(1, Number(baseNode.data.canvasHeight ?? 1024))
      : 0;
    const residentGeneratorChain = baseNode?.data.kind === 'generator'
      && gpuAvailable
      && !gpuDisabled
      && generatorPixels >= 180_000
      && (children.get(baseId)?.length ?? 0) === 1
      && chain.every((stage) => isGpuCompatible(stage.data));
    if (residentGeneratorChain && baseNode) {
      const generatorStage: PipelineStage = { id: baseNode.id, data: baseNode.data };
      const token = `generator-chain:${stageSignature(generatorStage)}>${chain.map(stageSignature).join('>')}`;
      let raster = cache.get(token);
      if (raster) {
        cacheHits += 1;
      } else {
        try {
          const rendered = await gpu.runGeneratorChain(baseNode.data, chain);
          raster = rendered.raster;
          gpuPasses += rendered.passes;
          cache.set(token, raster);
        } catch (error) {
          console.warn('Graphic Studio resident generator-chain fallback:', error);
          gpuDisabled = true;
        }
      }
      if (raster) {
        usedGpu = true;
        const value = { raster, token };
        memo.set(id, value);
        return value;
      }
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

async function renderFrame(
  source: Raster,
  plan: RenderPlan,
  quality: 'interactive' | 'quality' = 'quality',
): Promise<RenderedFrame> {
  const budget = interactivePixelBudget(plan);
  const renderSource = quality === 'interactive'
    ? resizeRaster(source, budget)
    : source;
  const renderPlan = quality === 'interactive' ? interactivePlan(plan, budget) : plan;
  const rendered = await renderRaster(renderSource, renderPlan, `preview:${quality}`);
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
    const webgpu = !gpuDisabled && await gpu.available();
    if (webgpu) {
      setTimeout(() => {
        void gpu.prewarm().catch((error) => console.warn('Graphic Studio WebGPU prewarm skipped:', error));
      }, 0);
    }
    return {
      id: request.id,
      ok: true,
      type: 'capabilities',
      webgpu,
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

  if (request.type === 'source-preview') {
    return {
      id: request.id,
      ok: true,
      type: 'source-preview',
      bitmap: rasterToBitmap(previewSource),
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
      frame: await renderFrame(previewSource, request.plan, request.quality ?? 'quality'),
    };
  }

  if (request.type === 'batch-item') {
    const maxDimension = Math.max(256, Math.min(8192, Math.round(request.maxDimension ?? 8192)));
    const source = await fileToRaster(request.file, maxDimension, 24_000_000);
    return {
      id: request.id,
      ok: true,
      type: 'batch-item',
      image: await renderImage(source, request.plan, request.options),
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
      } else if (response.ok && response.type === 'source-preview') {
        scope.postMessage(response, [response.bitmap]);
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
