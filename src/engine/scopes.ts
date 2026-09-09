import type { FrameScopes, Raster } from './types';

const WAVEFORM_WIDTH = 128;
const WAVEFORM_HEIGHT = 64;
const VECTORSCOPE_SIZE = 96;
const MAX_SCOPE_SAMPLES = 250_000;

export function computeScopes(raster: Raster): FrameScopes {
  const red = new Array<number>(256).fill(0);
  const green = new Array<number>(256).fill(0);
  const blue = new Array<number>(256).fill(0);
  const luminance = new Array<number>(256).fill(0);
  const waveformBins = new Array<number>(WAVEFORM_WIDTH * WAVEFORM_HEIGHT).fill(0);
  const vectorscopeBins = new Array<number>(VECTORSCOPE_SIZE * VECTORSCOPE_SIZE).fill(0);
  const pixels = raster.width * raster.height;
  const step = Math.max(1, Math.ceil(pixels / MAX_SCOPE_SAMPLES));
  let samples = 0;

  for (let pixel = 0; pixel < pixels; pixel += step) {
    const index = pixel * 4;
    const r = raster.data[index];
    const g = raster.data[index + 1];
    const b = raster.data[index + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const yByte = Math.max(0, Math.min(255, Math.round(y)));

    red[r] += 1;
    green[g] += 1;
    blue[b] += 1;
    luminance[yByte] += 1;

    const sourceX = pixel % raster.width;
    const waveX = Math.min(
      WAVEFORM_WIDTH - 1,
      Math.floor((sourceX / Math.max(1, raster.width)) * WAVEFORM_WIDTH),
    );
    const waveY = WAVEFORM_HEIGHT - 1 - Math.min(
      WAVEFORM_HEIGHT - 1,
      Math.floor((yByte / 256) * WAVEFORM_HEIGHT),
    );
    waveformBins[waveY * WAVEFORM_WIDTH + waveX] += 1;

    const blueDelta = b - y;
    const redDelta = r - y;
    const cb = Math.abs(blueDelta) < 1e-9
      ? 0.5
      : 0.5 + blueDelta / (2 * 255 * (1 - 0.0722));
    const cr = Math.abs(redDelta) < 1e-9
      ? 0.5
      : 0.5 + redDelta / (2 * 255 * (1 - 0.2126));
    const vectorX = Math.min(
      VECTORSCOPE_SIZE - 1,
      Math.max(0, Math.floor(cb * VECTORSCOPE_SIZE)),
    );
    const vectorY = Math.min(
      VECTORSCOPE_SIZE - 1,
      Math.max(0, Math.floor((1 - cr) * VECTORSCOPE_SIZE)),
    );
    vectorscopeBins[vectorY * VECTORSCOPE_SIZE + vectorX] += 1;
    samples += 1;
  }

  return {
    histogram: { red, green, blue, luminance, samples },
    waveform: {
      width: WAVEFORM_WIDTH,
      height: WAVEFORM_HEIGHT,
      bins: waveformBins,
      samples,
    },
    vectorscope: {
      width: VECTORSCOPE_SIZE,
      height: VECTORSCOPE_SIZE,
      bins: vectorscopeBins,
      samples,
    },
  };
}
