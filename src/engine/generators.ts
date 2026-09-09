import type { GeneratorType, GradientStop, ShapeType, StudioNodeData } from '../model';
import type { Raster } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampByte = (value: number) => clamp(Math.round(value), 0, 255);

function parseColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (!match) return fallback;
  return [
    parseInt(match[1].slice(0, 2), 16),
    parseInt(match[1].slice(2, 4), 16),
    parseInt(match[1].slice(4, 6), 16),
  ];
}

function dimensions(node: StudioNodeData): [number, number] {
  return [
    clamp(Math.round(Number(node.canvasWidth ?? 1024)), 1, 8192),
    clamp(Math.round(Number(node.canvasHeight ?? 1024)), 1, 8192),
  ];
}

function raster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function fillPixel(target: Raster, x: number, y: number, color: readonly number[], alpha = 255): void {
  const index = (y * target.width + x) * 4;
  target.data[index] = clampByte(color[0]);
  target.data[index + 1] = clampByte(color[1]);
  target.data[index + 2] = clampByte(color[2]);
  target.data[index + 3] = clampByte(alpha);
}

function hash2d(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, -2048144789);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function mixColor(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function proceduralRaster(node: StudioNodeData): Raster {
  const [width, height] = dimensions(node);
  const output = raster(width, height);
  const type = (node.generatorType ?? 'checkerboard') as GeneratorType;
  const colorA = parseColor(node.generatorColorA, [17, 17, 17]);
  const colorB = parseColor(node.generatorColorB, [244, 241, 234]);
  const scale = clamp(Number(node.generatorScale ?? 32), 1, 512);
  const seed = Math.round(Number(node.generatorSeed ?? 1));
  const octaves = clamp(Math.round(Number(node.generatorOctaves ?? 4)), 1, 8);
  const intensity = clamp(Number(node.generatorIntensity ?? 100) / 100, 0, 2);

  const cells = type === 'voronoi'
    ? Array.from({ length: Math.max(4, Math.min(196, Math.round((width * height) / (scale * scale * 5)))) }, (_, index) => ({
      x: hash2d(index, 0, seed) * width,
      y: hash2d(index, 1, seed) * height,
      value: hash2d(index, 2, seed),
    }))
    : [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let t = 0;
      if (type === 'solid') t = 0;
      else if (type === 'checkerboard') t = ((Math.floor(x / scale) + Math.floor(y / scale)) & 1) ? 1 : 0;
      else if (type === 'grid') {
        const line = Math.max(1, Math.round(scale * 0.08));
        t = x % scale < line || y % scale < line ? 1 : 0;
      } else if (type === 'noise') t = hash2d(x, y, seed);
      else if (type === 'fractal-noise') {
        let amplitude = 1;
        let frequency = 1 / scale;
        let total = 0;
        let weight = 0;
        for (let octave = 0; octave < octaves; octave += 1) {
          total += valueNoise(x * frequency, y * frequency, seed + octave * 101) * amplitude;
          weight += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }
        t = total / Math.max(1e-9, weight);
      }
      else if (type === 'scanlines') t = (y % scale) < Math.max(1, scale * 0.22) ? 1 : 0;
      else if (type === 'stripes') t = (x % scale) < scale * 0.5 ? 1 : 0;
      else if (type === 'dot-matrix') {
        const cx = (x % scale) - scale * 0.5;
        const cy = (y % scale) - scale * 0.5;
        t = Math.hypot(cx, cy) < scale * 0.26 ? 1 : 0;
      } else if (type === 'tile') {
        const edge = Math.max(1, Math.round(scale * 0.08));
        const localX = x % scale;
        const localY = y % scale;
        t = localX < edge || localY < edge || localX >= scale - edge || localY >= scale - edge ? 1 : 0;
      } else if (type === 'voronoi') {
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestValue = 0;
        for (const cell of cells) {
          const distance = (x - cell.x) ** 2 + (y - cell.y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestValue = cell.value;
          }
        }
        t = bestValue;
      } else if (type === 'crt') {
        const scan = (y % Math.max(2, Math.round(scale * 0.22))) === 0 ? 0.35 : 1;
        const phosphor = [1, 0.84, 0.7][x % 3];
        t = clamp(scan * phosphor * (0.65 + hash2d(x, y, seed) * 0.35), 0, 1);
      }
      t = clamp(0.5 + (t - 0.5) * intensity, 0, 1);
      fillPixel(output, x, y, mixColor(colorA, colorB, t));
    }
  }
  return output;
}

function normalizedStops(values: GradientStop[] | undefined): GradientStop[] {
  const fallback = [
    { offset: 0, color: '#111111' },
    { offset: 1, color: '#f4f1ea' },
  ];
  const source = values?.length ? values.slice(0, 8) : fallback;
  return source
    .map((stop) => ({ offset: clamp(Number(stop.offset), 0, 1), color: stop.color }))
    .sort((a, b) => a.offset - b.offset);
}

function sampleStops(stops: GradientStop[], value: number): [number, number, number] {
  const t = clamp(value, 0, 1);
  const first = stops[0];
  if (t <= first.offset) return parseColor(first.color, [0, 0, 0]);
  for (let index = 1; index < stops.length; index += 1) {
    const right = stops[index];
    if (t <= right.offset) {
      const left = stops[index - 1];
      const span = Math.max(1e-9, right.offset - left.offset);
      return mixColor(
        parseColor(left.color, [0, 0, 0]),
        parseColor(right.color, [255, 255, 255]),
        (t - left.offset) / span,
      );
    }
  }
  return parseColor(stops.at(-1)?.color, [255, 255, 255]);
}

function gradientRaster(node: StudioNodeData): Raster {
  const [width, height] = dimensions(node);
  const output = raster(width, height);
  const stops = normalizedStops(node.gradientStops);
  const type = node.gradientType ?? 'linear';
  const angle = Number(node.gradientAngle ?? 0) * Math.PI / 180;
  const cx = clamp(Number(node.gradientCenterX ?? 50), 0, 100) / 100 * width;
  const cy = clamp(Number(node.gradientCenterY ?? 50), 0, 100) / 100 * height;
  const radius = Math.max(1, clamp(Number(node.gradientRadius ?? 70), 1, 200) / 100 * Math.max(width, height));
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const extent = Math.abs(dx) * width + Math.abs(dy) * height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = type === 'radial'
        ? Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
        : 0.5 + (((x + 0.5 - width / 2) * dx + (y + 0.5 - height / 2) * dy) / Math.max(1, extent));
      fillPixel(output, x, y, sampleStops(stops, t));
    }
  }
  return output;
}

function canvasRaster(canvas: OffscreenCanvas): Raster {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(image.data) };
}

function textRaster(node: StudioNodeData): Raster {
  const [width, height] = dimensions(node);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  const size = clamp(Number(node.fontSize ?? 96), 4, 1024);
  const weight = clamp(Math.round(Number(node.fontWeight ?? 700)), 100, 900);
  const family = String(node.fontFamily ?? 'Inter, Arial, sans-serif');
  const tracking = clamp(Number(node.letterSpacing ?? 0), -20, 100);
  const lineHeight = clamp(Number(node.lineHeight ?? 1.2), 0.5, 4) * size;
  const opacity = clamp(Number(node.textOpacity ?? 100) / 100, 0, 1);
  const fill = node.fillColor ?? '#ffffff';
  const stroke = node.strokeColor ?? '#000000';
  const strokeWidth = clamp(Number(node.strokeWidth ?? 0), 0, 64);
  const align = node.textAlign ?? 'center';
  const lines = String(node.textContent ?? 'Graphic Studio').split(/\r?\n/).slice(0, 32);
  context.font = `${weight} ${size}px ${family}`;
  context.textBaseline = 'middle';
  context.globalAlpha = opacity;
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = strokeWidth;
  context.lineJoin = 'round';

  const totalHeight = lineHeight * lines.length;
  let y = height / 2 - totalHeight / 2 + lineHeight / 2;
  for (const line of lines) {
    const widths = Array.from(line, (char) => context.measureText(char).width);
    const textWidth = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * tracking;
    let x = align === 'left' ? width * 0.08 : align === 'right' ? width * 0.92 - textWidth : (width - textWidth) / 2;
    Array.from(line).forEach((char, index) => {
      if (strokeWidth > 0) context.strokeText(char, x, y);
      context.fillText(char, x, y);
      x += widths[index] + tracking;
    });
    y += lineHeight;
  }
  return canvasRaster(canvas);
}

function shapePath(
  context: OffscreenCanvasRenderingContext2D,
  type: ShapeType,
  width: number,
  height: number,
  radius: number,
  sides: number,
): void {
  const margin = Math.max(8, Math.min(width, height) * 0.08);
  const left = margin;
  const top = margin;
  const right = width - margin;
  const bottom = height - margin;
  const w = right - left;
  const h = bottom - top;
  context.beginPath();
  if (type === 'ellipse') context.ellipse(width / 2, height / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (type === 'rounded-rectangle') context.roundRect(left, top, w, h, clamp(radius, 0, Math.min(w, h) / 2));
  else if (type === 'line') {
    context.moveTo(left, bottom);
    context.lineTo(right, top);
  } else if (type === 'triangle') {
    context.moveTo(width / 2, top);
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
  } else if (type === 'polygon') {
    const count = clamp(Math.round(sides), 3, 16);
    const rx = w / 2;
    const ry = h / 2;
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      const x = width / 2 + Math.cos(angle) * rx;
      const y = height / 2 + Math.sin(angle) * ry;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  } else {
    context.rect(left, top, w, h);
  }
}

function shapeRaster(node: StudioNodeData): Raster {
  const [width, height] = dimensions(node);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('OffscreenCanvas 2D is unavailable.');
  const type = (node.shapeType ?? 'rectangle') as ShapeType;
  const opacity = clamp(Number(node.textOpacity ?? 100) / 100, 0, 1);
  const lineWidth = clamp(Number(node.shapeLineWidth ?? 0), 0, 128);
  context.globalAlpha = opacity;
  context.fillStyle = node.fillColor ?? '#ffffff';
  context.strokeStyle = node.strokeColor ?? '#000000';
  context.lineWidth = Math.max(1, lineWidth);
  context.lineJoin = 'round';
  shapePath(
    context,
    type,
    width,
    height,
    Number(node.cornerRadius ?? 64),
    Number(node.polygonSides ?? 6),
  );
  if (type !== 'line') context.fill();
  if (lineWidth > 0 || type === 'line') context.stroke();
  return canvasRaster(canvas);
}

export function generateRaster(node: StudioNodeData): Raster {
  switch (node.kind) {
    case 'text':
      return textRaster(node);
    case 'shape':
      return shapeRaster(node);
    case 'gradient':
      return gradientRaster(node);
    case 'generator':
      return proceduralRaster(node);
    default:
      throw new Error(`Node kind ${node.kind} is not a raster generator.`);
  }
}

export const GENERATOR_NODE_KINDS = new Set(['text', 'shape', 'gradient', 'generator']);
