import type { StudioEdge, StudioFlowNode, StudioNodeData } from '../model';

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const clamp = (value: number, min = 0, max = 255) =>
  Math.max(min, Math.min(max, value));

const luminance = (r: number, g: number, b: number) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export function makeDemoRaster(width = 760, height = 760): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const nx = x / width;
      const ny = y / height;
      const wave = Math.sin(nx * 18) * Math.cos(ny * 15) * 22;
      const glow = Math.max(
        0,
        1 - Math.hypot(nx - 0.62, ny - 0.42) * 1.7,
      );
      data[index] = clamp(28 + nx * 170 + glow * 62 + wave);
      data[index + 1] = clamp(32 + ny * 155 + glow * 105 - wave * 0.35);
      data[index + 2] = clamp(52 + (1 - nx) * 135 + glow * 48);
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

export function imageElementToRaster(
  image: HTMLImageElement,
  maxDimension = 1600,
): Raster {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is not available.');
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

export function rasterToDataUrl(raster: Raster): string {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(raster.data),
      raster.width,
      raster.height,
    ),
    0,
    0,
  );
  return canvas.toDataURL('image/png');
}

export function downloadRaster(raster: Raster, fileName: string): void {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(raster.data),
      raster.width,
      raster.height,
    ),
    0,
    0,
  );
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

const copyRaster = (raster: Raster): Raster => ({
  width: raster.width,
  height: raster.height,
  data: new Uint8ClampedArray(raster.data),
});

function adjustRaster(raster: Raster, node: StudioNodeData): Raster {
  const output = copyRaster(raster);
  const brightness = Number(node.brightness ?? 0) * 2.55;
  const contrast = Number(node.contrast ?? 0) * 2.2;
  const saturation = Number(node.saturation ?? 100) / 100;
  const contrastFactor =
    (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < output.data.length; i += 4) {
    let r = contrastFactor * (output.data[i] - 128) + 128 + brightness;
    let g = contrastFactor * (output.data[i + 1] - 128) + 128 + brightness;
    let b = contrastFactor * (output.data[i + 2] - 128) + 128 + brightness;
    const gray = luminance(r, g, b);
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;
    output.data[i] = clamp(r);
    output.data[i + 1] = clamp(g);
    output.data[i + 2] = clamp(b);
  }
  return output;
}

export function posterizeRaster(raster: Raster, levels = 5): Raster {
  const output = copyRaster(raster);
  const safeLevels = Math.max(2, Math.min(16, Math.round(levels)));
  const steps = safeLevels - 1;
  for (let i = 0; i < output.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      output.data[i + c] =
        Math.round((output.data[i + c] / 255) * steps) * (255 / steps);
    }
  }
  return output;
}

function pixelateRaster(raster: Raster, size = 8): Raster {
  const output = copyRaster(raster);
  const block = Math.max(1, Math.min(64, Math.round(size)));
  for (let y = 0; y < raster.height; y += block) {
    for (let x = 0; x < raster.width; x += block) {
      const sampleX = Math.min(raster.width - 1, x + Math.floor(block / 2));
      const sampleY = Math.min(raster.height - 1, y + Math.floor(block / 2));
      const sampleIndex = (sampleY * raster.width + sampleX) * 4;
      for (let yy = y; yy < Math.min(raster.height, y + block); yy += 1) {
        for (let xx = x; xx < Math.min(raster.width, x + block); xx += 1) {
          const index = (yy * raster.width + xx) * 4;
          output.data[index] = raster.data[sampleIndex];
          output.data[index + 1] = raster.data[sampleIndex + 1];
          output.data[index + 2] = raster.data[sampleIndex + 2];
        }
      }
    }
  }
  return output;
}

const bayer4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

const bayer8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

function orderedDither(
  raster: Raster,
  matrix: number[],
  side: number,
  threshold: number,
  monochrome: boolean,
): Raster {
  const output = copyRaster(raster);
  const bias = threshold - 128;
  const divisor = side * side;
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const index = (y * raster.width + x) * 4;
      const matrixValue = matrix[(y % side) * side + (x % side)];
      const localThreshold = clamp(
        ((matrixValue + 0.5) / divisor) * 255 + bias,
      );
      if (monochrome) {
        const value = luminance(
          raster.data[index],
          raster.data[index + 1],
          raster.data[index + 2],
        ) >= localThreshold ? 255 : 0;
        output.data[index] = value;
        output.data[index + 1] = value;
        output.data[index + 2] = value;
      } else {
        for (let c = 0; c < 3; c += 1) {
          output.data[index + c] =
            raster.data[index + c] >= localThreshold ? 255 : 0;
        }
      }
    }
  }
  return output;
}

function thresholdDither(
  raster: Raster,
  threshold: number,
  monochrome: boolean,
): Raster {
  const output = copyRaster(raster);
  for (let i = 0; i < output.data.length; i += 4) {
    if (monochrome) {
      const value =
        luminance(output.data[i], output.data[i + 1], output.data[i + 2]) >=
        threshold
          ? 255
          : 0;
      output.data[i] = value;
      output.data[i + 1] = value;
      output.data[i + 2] = value;
    } else {
      for (let c = 0; c < 3; c += 1) {
        output.data[i + c] = output.data[i + c] >= threshold ? 255 : 0;
      }
    }
  }
  return output;
}

function diffuseMono(
  raster: Raster,
  threshold: number,
  algorithm: 'floyd-steinberg' | 'atkinson',
): Raster {
  const work = new Float32Array(raster.width * raster.height);
  const output = copyRaster(raster);
  for (let i = 0, p = 0; i < raster.data.length; i += 4, p += 1) {
    work[p] = luminance(
      raster.data[i],
      raster.data[i + 1],
      raster.data[i + 2],
    );
  }

  const add = (x: number, y: number, error: number, weight: number) => {
    if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return;
    work[y * raster.width + x] += error * weight;
  };

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const p = y * raster.width + x;
      const oldValue = work[p];
      const newValue = oldValue >= threshold ? 255 : 0;
      const error = oldValue - newValue;
      const index = p * 4;
      output.data[index] = newValue;
      output.data[index + 1] = newValue;
      output.data[index + 2] = newValue;

      if (algorithm === 'floyd-steinberg') {
        add(x + 1, y, error, 7 / 16);
        add(x - 1, y + 1, error, 3 / 16);
        add(x, y + 1, error, 5 / 16);
        add(x + 1, y + 1, error, 1 / 16);
      } else {
        const weight = 1 / 8;
        add(x + 1, y, error, weight);
        add(x + 2, y, error, weight);
        add(x - 1, y + 1, error, weight);
        add(x, y + 1, error, weight);
        add(x + 1, y + 1, error, weight);
        add(x, y + 2, error, weight);
      }
    }
  }
  return output;
}

function diffuseRgb(
  raster: Raster,
  threshold: number,
  algorithm: 'floyd-steinberg' | 'atkinson',
): Raster {
  const work = new Float32Array(raster.width * raster.height * 3);
  const output = copyRaster(raster);
  for (let p = 0; p < raster.width * raster.height; p += 1) {
    const index = p * 4;
    work[p * 3] = raster.data[index];
    work[p * 3 + 1] = raster.data[index + 1];
    work[p * 3 + 2] = raster.data[index + 2];
  }

  const add = (
    x: number,
    y: number,
    channel: number,
    error: number,
    weight: number,
  ) => {
    if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return;
    work[(y * raster.width + x) * 3 + channel] += error * weight;
  };

  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const pixel = y * raster.width + x;
      const index = pixel * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const workIndex = pixel * 3 + channel;
        const oldValue = work[workIndex];
        const newValue = oldValue >= threshold ? 255 : 0;
        const error = oldValue - newValue;
        output.data[index + channel] = newValue;

        if (algorithm === 'floyd-steinberg') {
          add(x + 1, y, channel, error, 7 / 16);
          add(x - 1, y + 1, channel, error, 3 / 16);
          add(x, y + 1, channel, error, 5 / 16);
          add(x + 1, y + 1, channel, error, 1 / 16);
        } else {
          const weight = 1 / 8;
          add(x + 1, y, channel, error, weight);
          add(x + 2, y, channel, error, weight);
          add(x - 1, y + 1, channel, error, weight);
          add(x, y + 1, channel, error, weight);
          add(x + 1, y + 1, channel, error, weight);
          add(x, y + 2, channel, error, weight);
        }
      }
    }
  }
  return output;
}

export function ditherRaster(
  raster: Raster,
  algorithm: StudioNodeData['algorithm'] = 'floyd-steinberg',
  threshold = 128,
  monochrome = true,
): Raster {
  if (algorithm === 'bayer-4') {
    return orderedDither(raster, bayer4, 4, threshold, monochrome);
  }
  if (algorithm === 'bayer-8') {
    return orderedDither(raster, bayer8, 8, threshold, monochrome);
  }
  if (algorithm === 'threshold') {
    return thresholdDither(raster, threshold, monochrome);
  }
  if (monochrome) {
    return diffuseMono(raster, threshold, algorithm ?? 'floyd-steinberg');
  }
  return diffuseRgb(raster, threshold, algorithm ?? 'floyd-steinberg');
}

function applyEffect(raster: Raster, node: StudioNodeData): Raster {
  switch (node.kind) {
    case 'adjust':
      return adjustRaster(raster, node);
    case 'pixelate':
      return pixelateRaster(raster, Number(node.pixelSize ?? 8));
    case 'posterize':
      return posterizeRaster(raster, Number(node.levels ?? 5));
    case 'dither':
      return ditherRaster(
        raster,
        node.algorithm,
        Number(node.threshold ?? 128),
        Boolean(node.monochrome ?? true),
      );
    default:
      return copyRaster(raster);
  }
}

export function processGraph(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
  source: Raster,
): Raster {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outputNode = nodes.find((node) => node.data.kind === 'output');
  if (!outputNode) return source;

  const memo = new Map<string, Raster>();
  const visiting = new Set<string>();

  const evaluate = (nodeId: string): Raster | null => {
    if (memo.has(nodeId)) return memo.get(nodeId) ?? null;
    if (visiting.has(nodeId)) return null;
    const node = byId.get(nodeId);
    if (!node) return null;
    visiting.add(nodeId);

    let result: Raster | null = null;
    if (node.data.kind === 'source') {
      result = source;
    } else {
      const incoming = edges.find((edge) => edge.target === nodeId);
      const input = incoming ? evaluate(incoming.source) : null;
      if (input) {
        result =
          node.data.kind === 'output'
            ? copyRaster(input)
            : applyEffect(input, node.data);
      }
    }

    visiting.delete(nodeId);
    if (result) memo.set(nodeId, result);
    return result;
  };

  return evaluate(outputNode.id) ?? source;
}
