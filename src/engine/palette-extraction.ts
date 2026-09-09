import type { Raster } from './types';

interface ColorBin {
  count: number;
  r: number;
  g: number;
  b: number;
}

function colorDistance(a: ColorBin, b: ColorBin): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr * 0.2126 + dg * dg * 0.7152 + db * db * 0.0722;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

export function extractPalette(raster: Raster, requestedCount: number): string[] {
  const targetCount = Math.max(2, Math.min(16, Math.round(requestedCount)));
  const binCount = 32 * 32 * 32;
  const counts = new Uint32Array(binCount);
  const rSums = new Uint32Array(binCount);
  const gSums = new Uint32Array(binCount);
  const bSums = new Uint32Array(binCount);
  const pixels = raster.width * raster.height;
  const sampleStep = Math.max(1, Math.floor(pixels / 300_000));
  const data = raster.data;

  for (let pixel = 0; pixel < pixels; pixel += sampleStep) {
    const index = pixel * 4;
    if (data[index + 3] < 16) continue;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const bin = (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
    counts[bin] += 1;
    rSums[bin] += r;
    gSums[bin] += g;
    bSums[bin] += b;
  }

  const bins: ColorBin[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const count = counts[bin];
    if (!count) continue;
    bins.push({
      count,
      r: rSums[bin] / count,
      g: gSums[bin] / count,
      b: bSums[bin] / count,
    });
  }

  if (!bins.length) return ['#000000', '#ffffff'];

  bins.sort((a, b) => b.count - a.count);
  const centroids: ColorBin[] = [{ ...bins[0] }];

  while (centroids.length < targetCount && centroids.length < bins.length) {
    let best = bins[0];
    let bestScore = -1;
    for (const candidate of bins) {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) {
        minDistance = Math.min(minDistance, colorDistance(candidate, centroid));
      }
      const score = minDistance * Math.sqrt(candidate.count);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    centroids.push({ ...best });
  }

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const accumulators = centroids.map(() => ({
      count: 0,
      r: 0,
      g: 0,
      b: 0,
    }));

    for (const candidate of bins) {
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < centroids.length; index += 1) {
        const distance = colorDistance(candidate, centroids[index]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      const accumulator = accumulators[bestIndex];
      accumulator.count += candidate.count;
      accumulator.r += candidate.r * candidate.count;
      accumulator.g += candidate.g * candidate.count;
      accumulator.b += candidate.b * candidate.count;
    }

    accumulators.forEach((accumulator, index) => {
      if (!accumulator.count) return;
      centroids[index] = {
        count: accumulator.count,
        r: accumulator.r / accumulator.count,
        g: accumulator.g / accumulator.count,
        b: accumulator.b / accumulator.count,
      };
    });
  }

  centroids.sort(
    (a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b),
  );

  return centroids.map(({ r, g, b }) => `#${toHex(r)}${toHex(g)}${toHex(b)}`);
}
