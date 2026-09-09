import type { StudioNodeData } from '../model';
import { resolvePalette } from './imageEngine';
import { BLUE_NOISE_32 } from './blue-noise';
import type { PipelineStage, Raster } from './types';

type GpuPass =
  | { kind: 'point'; stages: PipelineStage[] }
  | { kind: 'pixelate'; stage: PipelineStage }
  | { kind: 'convolution'; stage: PipelineStage };

interface CompiledPass {
  key: string;
  shader: string;
  params: Float32Array;
}

const COMMON_WGSL = `
struct Meta {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<storage, read> sourcePixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> targetPixels: array<u32>;
@group(0) @binding(2) var<uniform> renderMeta: Meta;

fn unpackRgba(value: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(value & 255u),
    f32((value >> 8u) & 255u),
    f32((value >> 16u) & 255u),
    f32((value >> 24u) & 255u)
  );
}

fn packRgba(value: vec4<f32>) -> u32 {
  let v = vec4<u32>(clamp(round(value), vec4<f32>(0.0), vec4<f32>(255.0)));
  return v.r | (v.g << 8u) | (v.b << 16u) | (v.a << 24u);
}

fn curveSample(value: f32, first: vec4<f32>, last: vec4<f32>) -> f32 {
  let input = clamp(value, 0.0, 255.0);
  let segment = select(select(select(3u, 2u, input <= 192.0), 1u, input <= 128.0), 0u, input <= 64.0);
  let anchors = array<f32, 5>(0.0, 64.0, 128.0, 192.0, 255.0);
  let points = array<f32, 5>(first.x, first.y, first.z, first.w, last.x);
  let start = anchors[segment];
  let end = anchors[segment + 1u];
  let t = (input - start) / (end - start);
  return mix(points[segment], points[segment + 1u], t);
}
`;
const BAYER_WGSL = `
const BAYER2 = array<f32, 4>(0.0, 2.0, 3.0, 1.0);
const BAYER4 = array<f32, 16>(
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);
const CLUSTER4 = array<f32, 16>(
  12.0, 5.0, 6.0, 13.0,
  4.0, 0.0, 1.0, 7.0,
  11.0, 3.0, 2.0, 8.0,
  15.0, 10.0, 9.0, 14.0
);
const BAYER8 = array<f32, 64>(
  0.0,32.0,8.0,40.0,2.0,34.0,10.0,42.0,
  48.0,16.0,56.0,24.0,50.0,18.0,58.0,26.0,
  12.0,44.0,4.0,36.0,14.0,46.0,6.0,38.0,
  60.0,28.0,52.0,20.0,62.0,30.0,54.0,22.0,
  3.0,35.0,11.0,43.0,1.0,33.0,9.0,41.0,
  51.0,19.0,59.0,27.0,49.0,17.0,57.0,25.0,
  15.0,47.0,7.0,39.0,13.0,45.0,5.0,37.0,
  63.0,31.0,55.0,23.0,61.0,29.0,53.0,21.0
);

fn noise01(x: u32, y: u32, seed: u32) -> f32 {
  var value = ((x + 1u) * 374761393u) ^ ((y + 1u) * 668265263u) ^ ((seed + 1u) * 2246822519u);
  value = (value ^ (value >> 13u)) * 1274126177u;
  return f32(value ^ (value >> 16u)) / 4294967296.0;
}

fn dotScreen(x: f32, y: f32, angle: f32, scale: f32) -> f32 {
  let c = cos(angle);
  let s = sin(angle);
  let rx = (x * c + y * s) / scale;
  let ry = (-x * s + y * c) / scale;
  let ux = abs(fract(rx) - 0.5) * 2.0;
  let uy = abs(fract(ry) - 0.5) * 2.0;
  return min(1.0, length(vec2<f32>(ux, uy)) / 1.41421356237);
}
`;

const BLUE_NOISE_WGSL = `
const BLUE_NOISE32 = array<f32, 1024>(
  ${BLUE_NOISE_32.map((value) => `${value}.0`).join(', ')}
);
`;

const pointKinds = new Set(['adjust', 'curves', 'posterize', 'palette', 'dither']);

function partitionPasses(stages: PipelineStage[]): GpuPass[] {
  const passes: GpuPass[] = [];
  let pointStages: PipelineStage[] = [];
  const flush = () => {
    if (pointStages.length) passes.push({ kind: 'point', stages: pointStages });
    pointStages = [];
  };
  for (const stage of stages) {
    if (pointKinds.has(stage.data.kind)) pointStages.push(stage);
    else if (stage.data.kind === 'pixelate') {
      flush();
      passes.push({ kind: 'pixelate', stage });
    } else if (stage.data.kind === 'convolution') {
      flush();
      passes.push({ kind: 'convolution', stage });
    }
  }
  flush();
  return passes;
}
const curveIdentity = [0, 64, 128, 192, 255] as const;

function curveValues(values: number[] | undefined): number[] {
  return curveIdentity.map((fallback, index) => {
    const value = Number(values?.[index] ?? fallback);
    return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : fallback;
  });
}

function paletteFunction(index: number, node: StudioNodeData): string {
  const colors = resolvePalette(node);
  const values = colors
    .map(([r, g, b]) => `vec3<f32>(${r}.0, ${g}.0, ${b}.0)`)
    .join(', ');
  return `
fn mapPalette${index}(rgb: vec3<f32>) -> vec3<f32> {
  let palette = array<vec3<f32>, ${colors.length}>(${values});
  var best = palette[0];
  var bestDistance = 1e30;
  for (var i = 0u; i < ${colors.length}u; i = i + 1u) {
    let delta = rgb - palette[i];
    let distance = delta.r * delta.r * 0.2126 + delta.g * delta.g * 0.7152 + delta.b * delta.b * 0.0722;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = palette[i];
    }
  }
  return best;
}
`;
}

function pointPass(pass: Extract<GpuPass, { kind: 'point' }>): CompiledPass {
  const params: number[] = [];
  const declarations: string[] = [];
  const body: string[] = [];
  const keyParts: string[] = [];
  let paramIndex = 0;

  const addParam = (a = 0, b = 0, c = 0, d = 0) => {
    params.push(a, b, c, d);
    return paramIndex++;
  };

  pass.stages.forEach((stage, index) => {
    const node = stage.data;
    keyParts.push(
      node.kind === 'palette'
        ? `palette:${node.palette ?? 'gameboy'}:${(node.customPalette ?? []).join('.')}`
        : node.kind === 'dither'
          ? `dither:${node.algorithm ?? 'threshold'}`
          : node.kind,
    );
    if (node.kind === 'adjust') {
      const p0 = addParam(
        Number(node.brightness ?? 0),
        Number(node.contrast ?? 0),
        Number(node.saturation ?? 100),
        Number(node.exposure ?? 0),
      );
      const p1 = addParam(
        Number(node.gamma ?? 1),
        Number(node.temperature ?? 0),
        Number(node.tint ?? 0),
      );
      body.push(`
  let a0 = params[${p0}];
  let a1 = params[${p1}];
  let brightness${index} = a0.x * 2.55;
  let contrast${index} = clamp(a0.y, -100.0, 100.0) * 2.2;
  let saturation${index} = clamp(a0.z, 0.0, 300.0) / 100.0;
  let exposure${index} = exp2(clamp(a0.w, -4.0, 4.0));
  let gamma${index} = clamp(a1.x, 0.15, 4.0);
  let temperature${index} = clamp(a1.y, -100.0, 100.0) * 0.7;
  let tint${index} = clamp(a1.z, -100.0, 100.0) * 0.45;
  let contrastFactor${index} = (259.0 * (contrast${index} + 255.0)) / (255.0 * (259.0 - contrast${index}));
  var rgb${index} = color.rgb * exposure${index} + vec3<f32>(
    brightness${index} + temperature${index} + tint${index} * 0.2,
    brightness${index} - tint${index},
    brightness${index} - temperature${index} + tint${index} * 0.2
  );
  rgb${index} = contrastFactor${index} * (rgb${index} - vec3<f32>(128.0)) + vec3<f32>(128.0);
  let gray${index} = dot(rgb${index}, vec3<f32>(0.2126, 0.7152, 0.0722));
  rgb${index} = vec3<f32>(gray${index}) + (rgb${index} - vec3<f32>(gray${index})) * saturation${index};
  rgb${index} = pow(clamp(rgb${index}, vec3<f32>(0.0), vec3<f32>(255.0)) / 255.0, vec3<f32>(1.0 / gamma${index})) * 255.0;
  color = vec4<f32>(rgb${index}, color.a);
`);
    } else if (node.kind === 'curves') {
      const master = curveValues(node.curveMaster);
      const red = curveValues(node.curveRed);
      const green = curveValues(node.curveGreen);
      const blue = curveValues(node.curveBlue);
      const m0 = addParam(master[0], master[1], master[2], master[3]);
      const m1 = addParam(master[4]);
      const r0 = addParam(red[0], red[1], red[2], red[3]);
      const r1 = addParam(red[4]);
      const g0 = addParam(green[0], green[1], green[2], green[3]);
      const g1 = addParam(green[4]);
      const b0 = addParam(blue[0], blue[1], blue[2], blue[3]);
      const b1 = addParam(blue[4]);
      body.push(`
  let master${index} = floor(vec3<f32>(
    curveSample(color.r, params[${m0}], params[${m1}]),
    curveSample(color.g, params[${m0}], params[${m1}]),
    curveSample(color.b, params[${m0}], params[${m1}])
  ) + vec3<f32>(0.5));
  color = vec4<f32>(floor(vec3<f32>(
    curveSample(master${index}.r, params[${r0}], params[${r1}]),
    curveSample(master${index}.g, params[${g0}], params[${g1}]),
    curveSample(master${index}.b, params[${b0}], params[${b1}])
  ) + vec3<f32>(0.5)), color.a);
`);
    } else if (node.kind === 'posterize') {
      const p = addParam(Number(node.levels ?? 5));
      body.push(`
  let levels${index} = clamp(round(params[${p}].x), 2.0, 32.0);
  let steps${index} = levels${index} - 1.0;
  color = vec4<f32>(round((color.rgb / 255.0) * steps${index}) * (255.0 / steps${index}), color.a);
`);
    }    else if (node.kind === 'palette') {
      declarations.push(paletteFunction(index, node));
      body.push(`  color = vec4<f32>(mapPalette${index}(color.rgb), color.a);\n`);
    } else if (node.kind === 'dither') {
      const p = addParam(
        Number(node.threshold ?? 128),
        node.monochrome === false ? 0 : 1,
        Number(node.seed ?? 1),
        Number(node.patternScale ?? 8),
      );
      const p2 = addParam(Number(node.angle ?? 45));
      const algorithm = node.algorithm ?? 'threshold';
      if (algorithm === 'cmyk-halftone') {
        body.push(`
  let rgbCmyk${index} = clamp(color.rgb / 255.0, vec3<f32>(0.0), vec3<f32>(1.0));
  let k${index} = 1.0 - max(rgbCmyk${index}.r, max(rgbCmyk${index}.g, rgbCmyk${index}.b));
  let denom${index} = max(0.000001, 1.0 - k${index});
  let bias${index} = (params[${p}].x - 128.0) / 255.0;
  let cmyk${index} = clamp(vec4<f32>(
    (1.0 - rgbCmyk${index}.r - k${index}) / denom${index} + bias${index},
    (1.0 - rgbCmyk${index}.g - k${index}) / denom${index} + bias${index},
    (1.0 - rgbCmyk${index}.b - k${index}) / denom${index} + bias${index},
    k${index} + bias${index}
  ), vec4<f32>(0.0), vec4<f32>(1.0));
  let screenScale${index} = clamp(params[${p}].w, 3.0, 64.0);
  let cInk${index} = select(0.0, 1.0, cmyk${index}.x >= dotScreen(f32(gid.x), f32(gid.y), 0.2617993878, screenScale${index}));
  let mInk${index} = select(0.0, 1.0, cmyk${index}.y >= dotScreen(f32(gid.x), f32(gid.y), 1.3089969390, screenScale${index}));
  let yInk${index} = select(0.0, 1.0, cmyk${index}.z >= dotScreen(f32(gid.x), f32(gid.y), 0.0, screenScale${index}));
  let kInk${index} = select(0.0, 1.0, cmyk${index}.w >= dotScreen(f32(gid.x), f32(gid.y), 0.7853981634, screenScale${index}));
  color = vec4<f32>(255.0 * vec3<f32>(
    (1.0 - cInk${index}) * (1.0 - kInk${index}),
    (1.0 - mInk${index}) * (1.0 - kInk${index}),
    (1.0 - yInk${index}) * (1.0 - kInk${index})
  ), color.a);
`);
        return;
      }
      let thresholdCode = `var localThreshold${index} = params[${p}].x;`;
      if (algorithm === 'bayer-2') {
        thresholdCode += `\n  localThreshold${index} = clamp(((BAYER2[(gid.y % 2u) * 2u + (gid.x % 2u)] + 0.5) / 4.0) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      } else if (algorithm === 'bayer-4') {
        thresholdCode += `\n  localThreshold${index} = clamp(((BAYER4[(gid.y % 4u) * 4u + (gid.x % 4u)] + 0.5) / 16.0) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      } else if (algorithm === 'bayer-8') {
        thresholdCode += `\n  localThreshold${index} = clamp(((BAYER8[(gid.y % 8u) * 8u + (gid.x % 8u)] + 0.5) / 64.0) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      } else if (algorithm === 'blue-noise-32') {
        thresholdCode += `\n  localThreshold${index} = clamp(((BLUE_NOISE32[(gid.y % 32u) * 32u + (gid.x % 32u)] + 0.5) / 1024.0) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      } else if (algorithm === 'clustered-4') {
        thresholdCode += `\n  localThreshold${index} = clamp(((CLUSTER4[(gid.y % 4u) * 4u + (gid.x % 4u)] + 0.5) / 16.0) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      } else if (algorithm === 'noise') {
        thresholdCode += `\n  localThreshold${index} = clamp(params[${p}].x + (noise01(gid.x, gid.y, u32(max(0.0, params[${p}].z))) - 0.5) * 192.0, 0.0, 255.0);`;
      } else if (algorithm === 'halftone-dot' || algorithm === 'halftone-line' || algorithm === 'crosshatch') {
        const patternExpression = algorithm === 'halftone-dot'
          ? `1.0 - min(1.0, length(vec2<f32>(ux${index}, uy${index})) / 1.41421356237)`
          : algorithm === 'crosshatch'
            ? `max(1.0 - ux${index}, 1.0 - uy${index})`
            : `1.0 - ux${index}`;
        thresholdCode += `\n  let scale${index} = clamp(params[${p}].w, 2.0, 64.0);\n  let angle${index} = params[${p2}].x * 0.017453292519943295;\n  let c${index} = cos(angle${index});\n  let s${index} = sin(angle${index});\n  let rx${index} = (f32(gid.x) * c${index} + f32(gid.y) * s${index}) / scale${index};\n  let ry${index} = (-f32(gid.x) * s${index} + f32(gid.y) * c${index}) / scale${index};\n  let ux${index} = abs(fract(rx${index}) - 0.5) * 2.0;\n  let uy${index} = abs(fract(ry${index}) - 0.5) * 2.0;\n  localThreshold${index} = clamp((${patternExpression}) * 255.0 + params[${p}].x - 128.0, 0.0, 255.0);`;
      }
      body.push(`
  ${thresholdCode}
  if (params[${p}].y > 0.5) {
    let mono${index} = select(0.0, 255.0, dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) >= localThreshold${index});
    color = vec4<f32>(vec3<f32>(mono${index}), color.a);
  } else {
    color = vec4<f32>(select(vec3<f32>(0.0), vec3<f32>(255.0), color.rgb >= vec3<f32>(localThreshold${index})), color.a);
  }
`);
    }
  });

  const paramCount = Math.max(1, paramIndex);
  while (params.length < paramCount * 4) params.push(0);
  const usesBlueNoise = pass.stages.some((stage) =>
    stage.data.kind === 'dither' && stage.data.algorithm === 'blue-noise-32',
  );
  const optionalNoise = usesBlueNoise ? BLUE_NOISE_WGSL : '';
  const shader = `${COMMON_WGSL}\n${BAYER_WGSL}\n${optionalNoise}\n${declarations.join('\n')}\n@group(0) @binding(3) var<uniform> params: array<vec4<f32>, ${paramCount}>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) gid: vec3<u32>) {\n  if (gid.x >= renderMeta.width || gid.y >= renderMeta.height) { return; }\n  let index = gid.y * renderMeta.width + gid.x;\n  var color = unpackRgba(sourcePixels[index]);\n${body.join('\n')}\n  targetPixels[index] = packRgba(color);\n}\n`;
  return { key: `point:${keyParts.join('>')}`, shader, params: new Float32Array(params) };
}
function pixelatePass(pass: Extract<GpuPass, { kind: 'pixelate' }>): CompiledPass {
  const block = Math.max(1, Math.min(256, Math.round(Number(pass.stage.data.pixelSize ?? 8))));
  const shader = `${COMMON_WGSL}
@group(0) @binding(3) var<uniform> params: array<vec4<f32>, 1>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= renderMeta.width || gid.y >= renderMeta.height) { return; }
  let block = max(1u, u32(round(params[0].x)));
  let sampleX = min(renderMeta.width - 1u, (gid.x / block) * block + block / 2u);
  let sampleY = min(renderMeta.height - 1u, (gid.y / block) * block + block / 2u);
  let sourceIndex = sampleY * renderMeta.width + sampleX;
  let targetIndex = gid.y * renderMeta.width + gid.x;
  targetPixels[targetIndex] = sourcePixels[sourceIndex];
}
`;
  return {
    key: 'pixelate',
    shader,
    params: new Float32Array([block, 0, 0, 0]),
  };
}

const kernels: Record<string, readonly number[]> = {
  blur: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  edge: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
};

function convolutionPass(pass: Extract<GpuPass, { kind: 'convolution' }>): CompiledPass {
  const mode = pass.stage.data.convolution ?? 'sharpen';
  const kernel = kernels[mode] ?? kernels.sharpen;
  const kernelValues = kernel.map((value) => value.toFixed(8)).join(', ');
  const strength = Math.max(0, Math.min(200, Number(pass.stage.data.strength ?? 100)));
  const embossBias = mode === 'emboss' ? '128.0' : '0.0';
  const shader = `${COMMON_WGSL}
@group(0) @binding(3) var<uniform> params: array<vec4<f32>, 1>;
const KERNEL = array<f32, 9>(${kernelValues});

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= renderMeta.width || gid.y >= renderMeta.height) { return; }
  let centerIndex = gid.y * renderMeta.width + gid.x;
  let original = unpackRgba(sourcePixels[centerIndex]);
  var filtered = vec3<f32>(0.0);
  var k = 0u;
  for (var dy = -1i; dy <= 1i; dy = dy + 1i) {
    let yy = u32(clamp(i32(gid.y) + dy, 0i, i32(renderMeta.height) - 1i));
    for (var dx = -1i; dx <= 1i; dx = dx + 1i) {
      let xx = u32(clamp(i32(gid.x) + dx, 0i, i32(renderMeta.width) - 1i));
      filtered = filtered + unpackRgba(sourcePixels[yy * renderMeta.width + xx]).rgb * KERNEL[k];
      k = k + 1u;
    }
  }
  filtered = filtered + vec3<f32>(${embossBias});
  let amount = clamp(params[0].x, 0.0, 200.0) / 100.0;
  let rgb = original.rgb + (filtered - original.rgb) * amount;
  targetPixels[centerIndex] = packRgba(vec4<f32>(rgb, original.a));
}
`;
  return {
    key: `convolution:${mode}`,
    shader,
    params: new Float32Array([strength, 0, 0, 0]),
  };
}

function compilePass(pass: GpuPass): CompiledPass {
  if (pass.kind === 'point') return pointPass(pass);
  if (pass.kind === 'pixelate') return pixelatePass(pass);
  return convolutionPass(pass);
}

function nextCapacity(bytes: number): number {
  const chunk = 4 * 1024 * 1024;
  return Math.ceil(bytes / chunk) * chunk;
}
export class WebGpuEngine {
  private device: GPUDevice | null = null;
  private initialization: Promise<GPUDevice | null> | null = null;
  private pipelineCache = new Map<string, Promise<GPUComputePipeline>>();
  private capacity = 0;
  private bufferA: GPUBuffer | null = null;
  private bufferB: GPUBuffer | null = null;
  private readback: GPUBuffer | null = null;

  async available(): Promise<boolean> {
    return Boolean(await this.getDevice());
  }

  private async getDevice(): Promise<GPUDevice | null> {
    if (this.device) return this.device;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      this.device = device;
      void device.lost.then(() => {
        this.device = null;
        this.initialization = null;
        this.pipelineCache.clear();
        this.destroyBuffers();
      });
      return device;
    })().catch(() => null);
    return this.initialization;
  }

  private destroyBuffers(): void {
    this.bufferA?.destroy();
    this.bufferB?.destroy();
    this.readback?.destroy();
    this.bufferA = null;
    this.bufferB = null;
    this.readback = null;
    this.capacity = 0;
  }
  private ensureBuffers(device: GPUDevice, byteLength: number): void {
    if (this.capacity >= byteLength && this.bufferA && this.bufferB && this.readback) return;
    this.destroyBuffers();
    this.capacity = nextCapacity(byteLength);
    const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.bufferA = device.createBuffer({ size: this.capacity, usage: storageUsage });
    this.bufferB = device.createBuffer({ size: this.capacity, usage: storageUsage });
    this.readback = device.createBuffer({
      size: this.capacity,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private getPipeline(
    device: GPUDevice,
    compiled: CompiledPass,
  ): Promise<GPUComputePipeline> {
    const cached = this.pipelineCache.get(compiled.key);
    if (cached) return cached;
    const pipeline = (async () => {
      const module = device.createShaderModule({ code: compiled.shader });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) {
        throw new Error(
          errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join(' | '),
        );
      }
      return device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
    })();
    this.pipelineCache.set(compiled.key, pipeline);
    return pipeline;
  }

  async run(
    raster: Raster,
    stages: PipelineStage[],
  ): Promise<{ raster: Raster; passes: number }> {
    if (!stages.length) {
      return {
        raster: { ...raster, data: new Uint8ClampedArray(raster.data) },
        passes: 0,
      };
    }
    const device = await this.getDevice();
    if (!device) throw new Error('WebGPU is unavailable.');

    const byteLength = raster.data.byteLength;
    this.ensureBuffers(device, byteLength);
    const bufferA = this.bufferA!;
    const bufferB = this.bufferB!;
    const readback = this.readback!;
    device.queue.writeBuffer(
      bufferA,
      0,
      raster.data.buffer,
      raster.data.byteOffset,
      raster.data.byteLength,
    );

    const passes = partitionPasses(stages).map(compilePass);
    const pipelines = await Promise.all(
      passes.map((pass) => this.getPipeline(device, pass)),
    );
    const metaBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      metaBuffer,
      0,
      new Uint32Array([raster.width, raster.height, 0, 0]),
    );

    const parameterBuffers: GPUBuffer[] = [];
    const encoder = device.createCommandEncoder({ label: 'Graphic Studio render' });
    let readBuffer = bufferA;
    let writeBuffer = bufferB;

    for (let index = 0; index < passes.length; index += 1) {
      const compiled = passes[index];
      const pipeline = pipelines[index];
      const parameterBuffer = device.createBuffer({
        size: Math.max(16, Math.ceil(compiled.params.byteLength / 16) * 16),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      parameterBuffers.push(parameterBuffer);
      device.queue.writeBuffer(parameterBuffer, 0, compiled.params);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: readBuffer } },
          { binding: 1, resource: { buffer: writeBuffer } },
          { binding: 2, resource: { buffer: metaBuffer } },
          { binding: 3, resource: { buffer: parameterBuffer } },
        ],
      });
      const compute = encoder.beginComputePass();
      compute.setPipeline(pipeline);
      compute.setBindGroup(0, bindGroup);
      compute.dispatchWorkgroups(
        Math.ceil(raster.width / 8),
        Math.ceil(raster.height / 8),
      );
      compute.end();
      const swap = readBuffer;
      readBuffer = writeBuffer;
      writeBuffer = swap;
    }

    encoder.copyBufferToBuffer(readBuffer, 0, readback, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ, 0, byteLength);
    const mapped = new Uint8Array(readback.getMappedRange(0, byteLength));
    const data = new Uint8ClampedArray(byteLength);
    data.set(mapped);
    readback.unmap();
    metaBuffer.destroy();
    parameterBuffers.forEach((buffer) => buffer.destroy());

    return {
      raster: { width: raster.width, height: raster.height, data },
      passes: passes.length,
    };
  }
}
