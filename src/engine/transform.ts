import type { StudioNodeData, TransformRotation } from '../model';
import type { Raster } from './types';

const MAX_OUTPUT_PIXELS = 40_000_000;
const MAX_OUTPUT_DIMENSION = 16_384;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface TransformGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: TransformRotation;
  flipX: boolean;
  flipY: boolean;
  outputWidth: number;
  outputHeight: number;
  scaleX: number;
  scaleY: number;
}
function resolveGeometry(raster: Raster, node: StudioNodeData): TransformGeometry {
  const left = Math.min(
    raster.width - 1,
    Math.floor(raster.width * clamp(Number(node.cropLeft ?? 0), 0, 95) / 100),
  );
  const right = Math.min(
    raster.width - 1 - left,
    Math.floor(raster.width * clamp(Number(node.cropRight ?? 0), 0, 95) / 100),
  );
  const top = Math.min(
    raster.height - 1,
    Math.floor(raster.height * clamp(Number(node.cropTop ?? 0), 0, 95) / 100),
  );
  const bottom = Math.min(
    raster.height - 1 - top,
    Math.floor(raster.height * clamp(Number(node.cropBottom ?? 0), 0, 95) / 100),
  );
  const width = Math.max(1, raster.width - left - right);
  const height = Math.max(1, raster.height - top - bottom);
  const rotation = [0, 90, 180, 270].includes(Number(node.rotation))
    ? Number(node.rotation) as TransformRotation
    : 0;
  const rotatedWidth = rotation === 90 || rotation === 270 ? height : width;
  const rotatedHeight = rotation === 90 || rotation === 270 ? width : height;
  const requestedScale = clamp(Number(node.scale ?? 100), 5, 400) / 100;
  const safeScale = Math.min(
    requestedScale,
    MAX_OUTPUT_DIMENSION / rotatedWidth,
    MAX_OUTPUT_DIMENSION / rotatedHeight,
    Math.sqrt(MAX_OUTPUT_PIXELS / (rotatedWidth * rotatedHeight)),
  );
  const outputWidth = Math.max(1, Math.round(rotatedWidth * safeScale));
  const outputHeight = Math.max(1, Math.round(rotatedHeight * safeScale));
  return {
    left,
    top,
    width,
    height,
    rotation,
    flipX: Boolean(node.flipX),
    flipY: Boolean(node.flipY),
    outputWidth,
    outputHeight,
    scaleX: outputWidth / rotatedWidth,
    scaleY: outputHeight / rotatedHeight,
  };
}
function inverseTransform(
  x: number,
  y: number,
  geometry: TransformGeometry,
): [number, number] {
  let sourceX = x;
  let sourceY = y;
  if (geometry.rotation === 90) {
    sourceX = y;
    sourceY = geometry.height - 1 - x;
  } else if (geometry.rotation === 180) {
    sourceX = geometry.width - 1 - x;
    sourceY = geometry.height - 1 - y;
  } else if (geometry.rotation === 270) {
    sourceX = geometry.width - 1 - y;
    sourceY = x;
  }
  if (geometry.flipX) sourceX = geometry.width - 1 - sourceX;
  if (geometry.flipY) sourceY = geometry.height - 1 - sourceY;
  return [
    geometry.left + clamp(sourceX, 0, geometry.width - 1),
    geometry.top + clamp(sourceY, 0, geometry.height - 1),
  ];
}
function sampleNearest(
  raster: Raster,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  targetIndex: number,
): void {
  const sourceIndex = (Math.round(y) * raster.width + Math.round(x)) * 4;
  target[targetIndex] = raster.data[sourceIndex];
  target[targetIndex + 1] = raster.data[sourceIndex + 1];
  target[targetIndex + 2] = raster.data[sourceIndex + 2];
  target[targetIndex + 3] = raster.data[sourceIndex + 3];
}

function sampleBilinear(
  raster: Raster,
  x: number,
  y: number,
  target: Uint8ClampedArray,
  targetIndex: number,
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * raster.width + x0) * 4;
  const i10 = (y0 * raster.width + x1) * 4;
  const i01 = (y1 * raster.width + x0) * 4;
  const i11 = (y1 * raster.width + x1) * 4;
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  for (let channel = 0; channel < 4; channel += 1) {
    target[targetIndex + channel] =
      raster.data[i00 + channel] * w00 +
      raster.data[i10 + channel] * w10 +
      raster.data[i01 + channel] * w01 +
      raster.data[i11 + channel] * w11;
  }
}

export function transformRaster(raster: Raster, node: StudioNodeData): Raster {
  const geometry = resolveGeometry(raster, node);
  const noGeometryChange =
    geometry.left === 0 && geometry.top === 0 &&
    geometry.width === raster.width && geometry.height === raster.height &&
    geometry.rotation === 0 && !geometry.flipX && !geometry.flipY &&
    geometry.outputWidth === raster.width && geometry.outputHeight === raster.height;
  if (noGeometryChange) return raster;
  const output = new Uint8ClampedArray(
    geometry.outputWidth * geometry.outputHeight * 4,
  );
  const nearest = node.resample === 'nearest';
  for (let outputY = 0; outputY < geometry.outputHeight; outputY += 1) {
    const rotatedY = (outputY + 0.5) / geometry.scaleY - 0.5;
    for (let outputX = 0; outputX < geometry.outputWidth; outputX += 1) {
      const rotatedX = (outputX + 0.5) / geometry.scaleX - 0.5;
      const [sourceX, sourceY] = inverseTransform(rotatedX, rotatedY, geometry);
      const targetIndex = (outputY * geometry.outputWidth + outputX) * 4;
      if (nearest) {
        sampleNearest(raster, sourceX, sourceY, output, targetIndex);
      } else {
        sampleBilinear(raster, sourceX, sourceY, output, targetIndex);
      }
    }
  }
  return {
    width: geometry.outputWidth,
    height: geometry.outputHeight,
    data: output,
  };
}
