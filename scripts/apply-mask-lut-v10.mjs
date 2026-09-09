import fs from 'node:fs';

function replace(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`Missing LUT patch anchor in ${path}: ${oldText.slice(0, 80)}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replace('src/engine/mask.ts',
`export function maskRaster(
  base: Raster,`,
`export function buildMaskLut(node: StudioNodeData): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    lut[value] = clampByte(shapeMaskValue(value / 255, node) * 255);
  }
  return lut;
}

export function maskRaster(
  base: Raster,`);

replace('src/engine/mask.ts',
`  const invert = Boolean(node.maskInvert);
  const strength = clamp01(Number(node.maskStrength ?? 100) / 100);

  for (let y = 0; y < base.height; y += 1) {`,
`  const invert = Boolean(node.maskInvert);
  const strength = clamp01(Number(node.maskStrength ?? 100) / 100);
  const maskLut = buildMaskLut(node);

  for (let y = 0; y < base.height; y += 1) {`);

replace('src/engine/mask.ts',
`      let amount = maskChannelValue(mask.data, maskIndex, channel);
      amount = shapeMaskValue(amount, node);
      if (invert) amount = 1 - amount;`,
`      let amount = maskChannelValue(mask.data, maskIndex, channel);
      amount = maskLut[clampByte(amount * 255)] / 255;
      if (invert) amount = 1 - amount;`);

replace('src/engine/mask-webgpu.ts',
`@group(0) @binding(4) var<uniform> params: array<vec4<f32>, 2>;`,
`@group(0) @binding(4) var<uniform> params: array<vec4<f32>, 65>;`);

replace('src/engine/mask-webgpu.ts',
`fn channelValue(color: vec4<f32>, channel: u32) -> f32 {
  switch channel {
    case 1u: { return color.a; }
    case 2u: { return color.r; }
    case 3u: { return color.g; }
    case 4u: { return color.b; }
    default: { return dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)); }
  }
}
`,
`fn channelValue(color: vec4<f32>, channel: u32) -> f32 {
  switch channel {
    case 1u: { return color.a; }
    case 2u: { return color.r; }
    case 3u: { return color.g; }
    case 4u: { return color.b; }
    default: { return dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)); }
  }
}

fn maskLut(byteValue: u32) -> f32 {
  let packed = params[1u + byteValue / 4u];
  switch byteValue % 4u {
    case 0u: { return packed.x; }
    case 1u: { return packed.y; }
    case 2u: { return packed.z; }
    default: { return packed.w; }
  }
}
`);

replace('src/engine/mask-webgpu.ts',
`  var amount = channelValue(maskColor, u32(round(params[0].x)));
  let black = min(254.0 / 255.0, clamp(params[1].x, 0.0, 1.0));
  let white = max(black + 1.0 / 255.0, clamp(params[1].y, 0.0, 1.0));
  let gamma = clamp(params[1].z, 0.1, 10.0);
  amount = pow(clamp((amount - black) / (white - black), 0.0, 1.0), 1.0 / gamma);
  if (params[0].y > 0.5) { amount = 1.0 - amount; }`,
`  var amount = channelValue(maskColor, u32(round(params[0].x)));
  let sourceByte = u32(clamp(round(amount * 255.0), 0.0, 255.0));
  amount = maskLut(sourceByte);
  if (params[0].y > 0.5) { amount = 1.0 - amount; }`);

replace('src/engine/maskGpuEngine.ts',
`import { MASK_WGSL, maskChannelIds } from './mask-webgpu';
import type { Raster } from './types';`,
`import { MASK_WGSL, maskChannelIds } from './mask-webgpu';
import { buildMaskLut } from './mask';
import type { Raster } from './types';`);

replace('src/engine/maskGpuEngine.ts',
`    const parameterBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      parameterBuffer,
      0,
      new Float32Array([
        maskChannelIds[channel] ?? 0,
        node.maskInvert ? 1 : 0,
        Math.max(0, Math.min(1, Number(node.maskStrength ?? 100) / 100)),
        0,
        Math.max(0, Math.min(1, Number(node.maskBlackPoint ?? 0) / 100)),
        Math.max(0, Math.min(1, Number(node.maskWhitePoint ?? 100) / 100)),
        Math.max(0.1, Math.min(10, Number(node.maskGamma ?? 1))),
        0,
      ]),
    );`,
`    const parameterBuffer = device.createBuffer({
      size: 65 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const lut = buildMaskLut(node);
    const params = new Float32Array(65 * 4);
    params.set([
      maskChannelIds[channel] ?? 0,
      node.maskInvert ? 1 : 0,
      Math.max(0, Math.min(1, Number(node.maskStrength ?? 100) / 100)),
      0,
    ]);
    for (let index = 0; index < 256; index += 1) {
      params[4 + index] = lut[index] / 255;
    }
    device.queue.writeBuffer(parameterBuffer, 0, params);`);

replace('src/engine/mask.test.ts',
`import { maskChannelValue, maskRaster, shapeMaskValue } from './mask';`,
`import { buildMaskLut, maskChannelValue, maskRaster, shapeMaskValue } from './mask';`);

replace('src/engine/mask.test.ts',
`  it('applies mask shaping before inversion and strength', () => {`,
`  it('compiles shaping to a deterministic 256-entry byte LUT', () => {
    const lut = buildMaskLut({ ...defaults, maskBlackPoint: 25, maskWhitePoint: 75, maskGamma: 2 });
    expect(lut).toHaveLength(256);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[128]).toBeGreaterThan(175);
  });

  it('applies mask shaping before inversion and strength', () => {`);

console.log('Applied byte-LUT mask shaping for deterministic CPU/GPU parity.');
