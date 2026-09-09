import type { StudioNodeData } from '../model';

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PipelineStage {
  id: string;
  data: StudioNodeData;
}

export interface RenderPlan {
  stages: PipelineStage[];
  signature: string;
}

export type RenderBackend = 'webgpu' | 'hybrid' | 'cpu-worker';
export type RenderMode = 'preview' | 'export';
export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportOptions {
  format: ExportFormat;
  quality: number;
  matte: string;
}

export interface EngineTelemetry {
  backend: RenderBackend;
  durationMs: number;
  megapixelsPerSecond: number;
  width: number;
  height: number;
  stages: number;
  cacheHits: number;
  gpuPasses: number;
}

export interface HistogramData {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  samples: number;
}

export interface RenderedFrame {
  bitmap: ImageBitmap;
  telemetry: EngineTelemetry;
  histogram: HistogramData;
}

export interface RenderedImage {
  blob: Blob;
  telemetry: EngineTelemetry;
}

export interface SourceMeta {
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  fileName: string;
}
