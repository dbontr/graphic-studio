import type { GeneratorType, StudioNodeData } from '../model';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const TYPE_IDS: Record<GeneratorType, number> = {
  solid: 0,
  checkerboard: 1,
  grid: 2,
  noise: 3,
  'fractal-noise': 4,
  scanlines: 5,
  stripes: 6,
  'dot-matrix': 7,
  tile: 8,
  voronoi: 9,
  crt: 10,
};

function parseColor(value: unknown, fallback: readonly number[]): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? ''));
  if (!match) return [fallback[0], fallback[1], fallback[2]];
  return [
    parseInt(match[1].slice(0, 2), 16),
    parseInt(match[1].slice(2, 4), 16),
    parseInt(match[1].slice(4, 6), 16),
  ];
}
export interface GeneratorGpuConfig {
  width: number;
  height: number;
  meta: Uint32Array;
  params: Float32Array;
}

export function generatorGpuConfig(node: StudioNodeData): GeneratorGpuConfig {
  const width = clamp(Math.round(Number(node.canvasWidth ?? 1024)), 1, 8192);
  const height = clamp(Math.round(Number(node.canvasHeight ?? 1024)), 1, 8192);
  const kind = (node.generatorType ?? 'checkerboard') as GeneratorType;
  const colorA = parseColor(node.generatorColorA, [17, 17, 17]);
  const colorB = parseColor(node.generatorColorB, [244, 241, 234]);
  const scale = clamp(Number(node.generatorScale ?? 32), 1, 512);
  const seed = Math.max(0, Math.round(Number(node.generatorSeed ?? 1))) >>> 0;
  const octaves = clamp(Math.round(Number(node.generatorOctaves ?? 4)), 1, 8);
  const intensity = clamp(Number(node.generatorIntensity ?? 100) / 100, 0, 2);
  const cellCount = clamp(Math.round((width * height) / (scale * scale * 5)), 4, 196);
  return {
    width,
    height,
    meta: new Uint32Array([width, height, TYPE_IDS[kind], seed]),
    params: new Float32Array([
      colorA[0], colorA[1], colorA[2], scale,
      colorB[0], colorB[1], colorB[2], intensity,
      octaves, cellCount, 0, 0,
    ]),
  };
}
export const GENERATOR_WGSL = `
struct GeneratorMeta {
  width: u32,
  height: u32,
  kind: u32,
  seed: u32,
};

@group(0) @binding(0) var<storage, read_write> outputPixels: array<u32>;
@group(0) @binding(1) var<uniform> genMeta: GeneratorMeta;
@group(0) @binding(2) var<uniform> params: array<vec4<f32>, 3>;

fn hash2d(x: u32, y: u32, seed: u32) -> f32 {
  var value = ((x + 1u) * 374761393u)
    ^ ((y + 1u) * 668265263u)
    ^ ((seed + 1u) * 2246822507u);
  value = (value ^ (value >> 13u)) * 1274126177u;
  value = value ^ (value >> 16u);
  return f32(value) / 4294967296.0;
}

fn smoothValue(value: f32) -> f32 {
  return value * value * (3.0 - 2.0 * value);
}
`;
export const GENERATOR_WGSL_BODY = `
fn valueNoise(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let tx = smoothValue(x - f32(x0));
  let ty = smoothValue(y - f32(y0));
  let a = hash2d(u32(max(x0, 0)), u32(max(y0, 0)), seed);
  let b = hash2d(u32(max(x0 + 1, 0)), u32(max(y0, 0)), seed);
  let c = hash2d(u32(max(x0, 0)), u32(max(y0 + 1, 0)), seed);
  let d = hash2d(u32(max(x0 + 1, 0)), u32(max(y0 + 1, 0)), seed);
  let top = mix(a, b, tx);
  let bottom = mix(c, d, tx);
  return mix(top, bottom, ty);
}

fn packRgb(rgb: vec3<f32>) -> u32 {
  let value = vec3<u32>(clamp(round(rgb), vec3<f32>(0.0), vec3<f32>(255.0)));
  return value.r | (value.g << 8u) | (value.b << 16u) | (255u << 24u);
}

fn localCoord(value: f32, scale: f32) -> f32 {
  return value - floor(value / scale) * scale;
}
`;

export const GENERATOR_MAIN_WGSL = `
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= genMeta.width || gid.y >= genMeta.height) { return; }
  let colorA = params[0].xyz;
  let scale = max(1.0, params[0].w);
  let colorB = params[1].xyz;
  let intensity = clamp(params[1].w, 0.0, 2.0);
  let octaves = u32(clamp(round(params[2].x), 1.0, 8.0));
  let cellCount = u32(clamp(round(params[2].y), 4.0, 196.0));
  let x = f32(gid.x);
  let y = f32(gid.y);
  let scaleU = max(1u, u32(round(scale)));
  var t = 0.0;

  switch genMeta.kind {
    case 0u: { t = 0.0; }
    case 1u: {
      t = select(0.0, 1.0, (((gid.x / scaleU) + (gid.y / scaleU)) & 1u) != 0u);
    }
    case 2u: {
      let line = max(1u, u32(round(scale * 0.08)));
      t = select(0.0, 1.0, gid.x % scaleU < line || gid.y % scaleU < line);
    }
    case 3u: { t = hash2d(gid.x, gid.y, genMeta.seed); }
    default: {}
  }
  if (genMeta.kind == 4u) {
    var amplitude = 1.0;
    var frequency = 1.0 / scale;
    var total = 0.0;
    var weight = 0.0;
    for (var octave = 0u; octave < 8u; octave = octave + 1u) {
      if (octave >= octaves) { break; }
      total = total + valueNoise(x * frequency, y * frequency, genMeta.seed + octave * 101u) * amplitude;
      weight = weight + amplitude;
      amplitude = amplitude * 0.5;
      frequency = frequency * 2.0;
    }
    t = total / max(0.000001, weight);
  } else if (genMeta.kind == 5u) {
    t = select(0.0, 1.0, f32(gid.y % scaleU) < max(1.0, scale * 0.22));
  } else if (genMeta.kind == 6u) {
    t = select(0.0, 1.0, f32(gid.x % scaleU) < scale * 0.5);
  } else if (genMeta.kind == 7u) {
    let cx = f32(gid.x % scaleU) - scale * 0.5;
    let cy = f32(gid.y % scaleU) - scale * 0.5;
    t = select(0.0, 1.0, length(vec2<f32>(cx, cy)) < scale * 0.26);
  } else if (genMeta.kind == 8u) {
    let edge = max(1.0, round(scale * 0.08));
    let lx = f32(gid.x % scaleU);
    let ly = f32(gid.y % scaleU);
    t = select(0.0, 1.0, lx < edge || ly < edge || lx >= scale - edge || ly >= scale - edge);
  }
  if (genMeta.kind == 9u) {
    var bestDistance = 1e30;
    var bestValue = 0.0;
    for (var cellIndex = 0u; cellIndex < 196u; cellIndex = cellIndex + 1u) {
      if (cellIndex >= cellCount) { break; }
      let cellX = hash2d(cellIndex, 0u, genMeta.seed) * f32(genMeta.width);
      let cellY = hash2d(cellIndex, 1u, genMeta.seed) * f32(genMeta.height);
      let dx = x - cellX;
      let dy = y - cellY;
      let distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestValue = hash2d(cellIndex, 2u, genMeta.seed);
      }
    }
    t = bestValue;
  } else if (genMeta.kind == 10u) {
    let period = max(2u, u32(round(scale * 0.22)));
    let scan = select(1.0, 0.35, gid.y % period == 0u);
    var phosphor = 1.0;
    if (gid.x % 3u == 1u) { phosphor = 0.84; }
    if (gid.x % 3u == 2u) { phosphor = 0.70; }
    t = clamp(scan * phosphor * (0.65 + hash2d(gid.x, gid.y, genMeta.seed) * 0.35), 0.0, 1.0);
  }

  t = clamp(0.5 + (t - 0.5) * intensity, 0.0, 1.0);
  let rgb = mix(colorA, colorB, t);
  outputPixels[gid.y * genMeta.width + gid.x] = packRgb(rgb);
}
`;

export const PROCEDURAL_GENERATOR_WGSL = GENERATOR_WGSL + GENERATOR_WGSL_BODY + GENERATOR_MAIN_WGSL;
