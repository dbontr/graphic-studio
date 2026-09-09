import fs from 'node:fs';

function replace(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`Missing patch anchor in ${path}: ${oldText.slice(0, 80)}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replace('src/model.ts',
`  maskChannel?: MaskChannel;
  maskInvert?: boolean;
  maskStrength?: number;
  rotation?: TransformRotation;`,
`  maskChannel?: MaskChannel;
  maskInvert?: boolean;
  maskStrength?: number;
  maskBlackPoint?: number;
  maskWhitePoint?: number;
  maskGamma?: number;
  rotation?: TransformRotation;`);

replace('src/model.ts',
`    maskChannel: 'luminance',
    maskInvert: false,
    maskStrength: 100,
  },`,
`    maskChannel: 'luminance',
    maskInvert: false,
    maskStrength: 100,
    maskBlackPoint: 0,
    maskWhitePoint: 100,
    maskGamma: 1,
  },`);

replace('src/engine/mask.ts',
`export function maskRaster(
  base: Raster,`,
`export function shapeMaskValue(value: number, node: StudioNodeData): number {
  const black = Math.min(254 / 255, clamp01(Number(node.maskBlackPoint ?? 0) / 100));
  const white = Math.max(black + 1 / 255, clamp01(Number(node.maskWhitePoint ?? 100) / 100));
  const gamma = Math.max(0.1, Math.min(10, Number(node.maskGamma ?? 1)));
  const normalized = clamp01((value - black) / (white - black));
  return Math.pow(normalized, 1 / gamma);
}

export function maskRaster(
  base: Raster,`);

replace('src/engine/mask.ts',
`      let amount = maskChannelValue(mask.data, maskIndex, channel);
      if (invert) amount = 1 - amount;
      amount = (1 - strength) + strength * amount;`,
`      let amount = maskChannelValue(mask.data, maskIndex, channel);
      amount = shapeMaskValue(amount, node);
      if (invert) amount = 1 - amount;
      amount = (1 - strength) + strength * amount;`);

replace('src/engine/mask-webgpu.ts',
`@group(0) @binding(4) var<uniform> params: vec4<f32>;`,
`@group(0) @binding(4) var<uniform> params: array<vec4<f32>, 2>;`);

replace('src/engine/mask-webgpu.ts',
`  var amount = channelValue(maskColor, u32(round(params.x)));
  if (params.y > 0.5) { amount = 1.0 - amount; }
  let strength = clamp(params.z, 0.0, 1.0);
  amount = (1.0 - strength) + strength * amount;`,
`  var amount = channelValue(maskColor, u32(round(params[0].x)));
  let black = min(254.0 / 255.0, clamp(params[1].x, 0.0, 1.0));
  let white = max(black + 1.0 / 255.0, clamp(params[1].y, 0.0, 1.0));
  let gamma = clamp(params[1].z, 0.1, 10.0);
  amount = pow(clamp((amount - black) / (white - black), 0.0, 1.0), 1.0 / gamma);
  if (params[0].y > 0.5) { amount = 1.0 - amount; }
  let strength = clamp(params[0].z, 0.0, 1.0);
  amount = (1.0 - strength) + strength * amount;`);

replace('src/engine/maskGpuEngine.ts',
`    const parameterBuffer = device.createBuffer({
      size: 16,`,
`    const parameterBuffer = device.createBuffer({
      size: 32,`);

replace('src/engine/maskGpuEngine.ts',
`      new Float32Array([
        maskChannelIds[channel] ?? 0,
        node.maskInvert ? 1 : 0,
        Math.max(0, Math.min(1, Number(node.maskStrength ?? 100) / 100)),
        0,
      ]),`,
`      new Float32Array([
        maskChannelIds[channel] ?? 0,
        node.maskInvert ? 1 : 0,
        Math.max(0, Math.min(1, Number(node.maskStrength ?? 100) / 100)),
        0,
        Math.max(0, Math.min(1, Number(node.maskBlackPoint ?? 0) / 100)),
        Math.max(0, Math.min(1, Number(node.maskWhitePoint ?? 100) / 100)),
        Math.max(0.1, Math.min(10, Number(node.maskGamma ?? 1))),
        0,
      ]),`);

for (const path of ['src/engine/graphCompiler.ts', 'src/engine/render-worker.ts']) {
  replace(path,
`    d.maskChannel,
    d.maskInvert,
    d.maskStrength,
  ]);`,
`    d.maskChannel,
    d.maskInvert,
    d.maskStrength,
    d.maskBlackPoint,
    d.maskWhitePoint,
    d.maskGamma,
  ]);`);
}

replace('src/components/StudioNode.tsx',
`          <RangeControl
            label="Strength"
            value={Number(data.maskStrength ?? 100)}
            min={0}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskStrength) => update({ maskStrength })}
          />
          <div className="segmented nodrag">`,
`          <RangeControl
            label="Strength"
            value={Number(data.maskStrength ?? 100)}
            min={0}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskStrength) => update({ maskStrength })}
          />
          <RangeControl
            label="Black point"
            value={Number(data.maskBlackPoint ?? 0)}
            min={0}
            max={99}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskBlackPoint) => update({
              maskBlackPoint: Math.min(maskBlackPoint, Number(data.maskWhitePoint ?? 100) - 1),
            })}
          />
          <RangeControl
            label="White point"
            value={Number(data.maskWhitePoint ?? 100)}
            min={1}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskWhitePoint) => update({
              maskWhitePoint: Math.max(maskWhitePoint, Number(data.maskBlackPoint ?? 0) + 1),
            })}
          />
          <RangeControl
            label="Mask gamma"
            value={Number(data.maskGamma ?? 1)}
            min={0.2}
            max={4}
            step={0.05}
            onBegin={studio.checkpoint}
            onChange={(maskGamma) => update({ maskGamma })}
          />
          <div className="segmented nodrag">`);

replace('src/engine/mask.test.ts',
`import { maskChannelValue, maskRaster } from './mask';`,
`import { maskChannelValue, maskRaster, shapeMaskValue } from './mask';`);

replace('src/engine/mask.test.ts',
`  it('uses the selected alpha channel independently of mask RGB', () => {`,
`  it('shapes mask levels with black point, white point, and gamma', () => {
    expect(shapeMaskValue(0.25, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBe(0);
    expect(shapeMaskValue(0.5, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBeCloseTo(0.5);
    expect(shapeMaskValue(0.75, { ...defaults, maskBlackPoint: 25, maskWhitePoint: 75 })).toBe(1);
    expect(shapeMaskValue(0.25, { ...defaults, maskGamma: 2 })).toBeCloseTo(0.5);
  });

  it('applies mask shaping before inversion and strength', () => {
    const base = raster(1, 1, [50, 60, 70, 200]);
    const mask = raster(1, 1, [128, 128, 128, 255]);
    const output = maskRaster(base, mask, {
      ...defaults,
      maskBlackPoint: 50,
      maskWhitePoint: 100,
      maskInvert: true,
      maskStrength: 50,
    });
    expect(output.data[3]).toBeGreaterThanOrEqual(198);
  });

  it('uses the selected alpha channel independently of mask RGB', () => {`);

replace('scripts/smoke-mask-ui.mjs',
`        kind: 'mask', label: 'Mask', maskChannel: 'red',
        maskInvert: true, maskStrength: 73,`,
`        kind: 'mask', label: 'Mask', maskChannel: 'red',
        maskInvert: true, maskStrength: 73,
        maskBlackPoint: 18, maskWhitePoint: 82, maskGamma: 1.6,`);

replace('scripts/smoke-mask-ui.mjs',
`  if (ui.nodes !== 1 || ui.handles !== 2 || ui.channels !== 5 || ui.strengthControls !== 1) {`,
`  if (ui.nodes !== 1 || ui.handles !== 2 || ui.channels !== 5 || ui.strengthControls !== 4) {`);

replace('README.md',
`- Mask: true two-input alpha masking from luminance, alpha, red, green, or blue; invert and 0–100% strength; normalized branch geometry`,
`- Mask: true two-input alpha masking from luminance, alpha, red, green, or blue; black/white point and gamma shaping; invert and 0–100% strength; normalized branch geometry`);

replace('README.md',
`Masking uses its own cached two-input WebGPU kernel with channel, inversion, and strength uniforms; when WebGPU is unavailable or not worth the round trip, the worker uses the same deterministic normalized-geometry semantics on the CPU.`,
`Masking uses its own cached two-input WebGPU kernel with channel, black/white point, gamma, inversion, and strength uniforms; when WebGPU is unavailable or not worth the round trip, the worker uses the same deterministic normalized-geometry semantics on the CPU.`);

replace('README.md',
`richer mask construction and feathering`,
`spatial mask feathering and blur`);

console.log('Applied Graphic Studio v0.10 mask-shaping patch.');
