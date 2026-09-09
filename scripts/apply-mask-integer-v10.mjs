import fs from 'node:fs';

function replace(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`Missing integer patch anchor in ${path}: ${oldText.slice(0, 80)}`);
  fs.writeFileSync(path, source.replace(oldText, newText));
}

fs.copyFileSync('scripts/v10-mask-final.ts.txt', 'src/engine/mask.ts');
fs.copyFileSync('scripts/v10-mask-webgpu-final.ts.txt', 'src/engine/mask-webgpu.ts');

replace('src/engine/maskGpuEngine.ts',
`    const lut = buildMaskLut(node);
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
    device.queue.writeBuffer(parameterBuffer, 0, params);`,
`    const lut = buildMaskLut(node);
    const params = new Uint32Array(65 * 4);
    params[0] = maskChannelIds[channel] ?? 0;
    for (let index = 0; index < 256; index += 1) {
      params[4 + index] = lut[index];
    }
    device.queue.writeBuffer(parameterBuffer, 0, params);`);

replace('src/engine/mask.test.ts',
`import { buildMaskLut, maskChannelValue, maskRaster, shapeMaskValue } from './mask';`,
`import {
  buildMaskLut,
  maskChannelByte,
  maskChannelValue,
  maskRaster,
  shapeMaskValue,
} from './mask';`);

replace('src/engine/mask.test.ts',
`  it('shapes mask levels with black point, white point, and gamma', () => {`,
`  it('uses an integer Rec.709 luminance byte for cross-backend determinism', () => {
    const pixel = new Uint8ClampedArray([64, 128, 192, 255]);
    expect(maskChannelByte(pixel, 0, 'luminance')).toBe(119);
    expect(maskChannelValue(pixel, 0, 'luminance')).toBeCloseTo(119 / 255);
  });

  it('shapes mask levels with black point, white point, and gamma', () => {`);

replace('README.md',
`Masking uses its own cached two-input WebGPU kernel with channel, black/white point, gamma, inversion, and strength uniforms; when WebGPU is unavailable or not worth the round trip, the worker uses the same deterministic normalized-geometry semantics on the CPU.`,
`Masking compiles black/white point, gamma, inversion, and strength into a 256-entry byte LUT shared by CPU and WebGPU. The GPU mask path uses integer channel extraction, fixed-point Rec.709 luminance, integer geometry mapping, and integer alpha composition so the two backends follow the same byte semantics. When WebGPU is unavailable or not worth the round trip, the worker uses the same deterministic path on the CPU.`);

console.log('Applied exact integer mask backend with shared byte LUT.');
