import type { StudioNodeData } from '../model';
import type { Raster } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function rasterCanvas(raster: Raster): OffscreenCanvas {
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  context.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
  return canvas;
}

export function placeOverlay(base: Raster, layer: Raster, node: StudioNodeData): Raster {
  const canvas = new OffscreenCanvas(base.width, base.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  const layerCanvas = rasterCanvas(layer);
  const scale = clamp(Number(node.overlayScale ?? 100) / 100, 0.01, 20);
  const rotation = Number(node.overlayRotation ?? 0) * Math.PI / 180;
  const x = base.width / 2 + Number(node.overlayX ?? 0);
  const y = base.height / 2 + Number(node.overlayY ?? 0);
  const anchorX = layer.width * clamp(Number(node.overlayAnchorX ?? 50), 0, 100) / 100;
  const anchorY = layer.height * clamp(Number(node.overlayAnchorY ?? 50), 0, 100) / 100;
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(scale, scale);
  context.drawImage(layerCanvas, -anchorX, -anchorY);
  const image = context.getImageData(0, 0, base.width, base.height);
  return { width: base.width, height: base.height, data: new Uint8ClampedArray(image.data) };
}
