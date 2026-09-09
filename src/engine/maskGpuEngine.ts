import type { MaskChannel, StudioNodeData } from '../model';
import {
  MASK_FEATHER_COMPOSITE_WGSL,
  MASK_FEATHER_HORIZONTAL_WGSL,
  MASK_WGSL,
  maskChannelIds,
} from './mask-webgpu';
import { buildMaskLut, maskFeatherRadius } from './mask';
import {
  MASK_FIELD_BOX_HORIZONTAL_WGSL,
  MASK_FIELD_BOX_VERTICAL_WGSL,
  MASK_FIELD_COMPOSITE_WGSL,
  MASK_FIELD_EXTREME_HORIZONTAL_WGSL,
  MASK_FIELD_EXTREME_VERTICAL_WGSL,
  MASK_FIELD_SOURCE_WGSL,
  MASK_FIELD_THRESHOLD_WGSL,
} from './mask-advanced-webgpu';import type { Raster } from './types';

function nextCapacity(bytes: number): number {
  const chunk = 4 * 1024 * 1024;
  return Math.max(chunk, Math.ceil(bytes / chunk) * chunk);
}

function needsAdvancedGpu(node: StudioNodeData): boolean {
  if (Number(node.maskKeyTolerance ?? 0) > 0) return false;
  if ((node.maskPreview ?? 'result') !== 'result') return false;
  return Number(node.maskBlurRadius ?? 0) > 0
    || (node.maskMorphology ?? 'none') !== 'none'
    || Number(node.maskExpand ?? 0) !== 0
    || Number(node.maskThreshold ?? 0) > 0;
}
export interface MaskGpuResult {
  raster: Raster;
  passes: number;
}

export class MaskGpuEngine {
  private device: GPUDevice | null = null;
  private initialization: Promise<GPUDevice | null> | null = null;
  private singlePipeline: Promise<GPUComputePipeline> | null = null;
  private featherHorizontalPipeline: Promise<GPUComputePipeline> | null = null;
  private featherCompositePipeline: Promise<GPUComputePipeline> | null = null;
  private advancedPipelines = new Map<string, Promise<GPUComputePipeline>>();
  private baseCapacity = 0;
  private maskCapacity = 0;
  private baseBuffer: GPUBuffer | null = null;  private maskBuffer: GPUBuffer | null = null;
  private tempMaskBuffer: GPUBuffer | null = null;
  private fieldBufferB: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
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
        this.singlePipeline = null;
        this.featherHorizontalPipeline = null;
        this.featherCompositePipeline = null;
        this.advancedPipelines.clear();
        this.destroyBuffers();
      });
      return device;
    })().catch(() => null);
    return this.initialization;
  }
  private destroyBuffers(): void {
    this.baseBuffer?.destroy();
    this.maskBuffer?.destroy();
    this.tempMaskBuffer?.destroy();
    this.fieldBufferB?.destroy();
    this.outputBuffer?.destroy();
    this.readback?.destroy();
    this.baseBuffer = null;
    this.maskBuffer = null;
    this.tempMaskBuffer = null;
    this.fieldBufferB = null;
    this.outputBuffer = null;
    this.readback = null;
    this.baseCapacity = 0;
    this.maskCapacity = 0;
  }

  private ensureBuffers(device: GPUDevice, baseBytes: number, maskBytes: number): void {
    if (
      this.baseCapacity < baseBytes
      || !this.baseBuffer
      || !this.tempMaskBuffer
      || !this.fieldBufferB
      || !this.outputBuffer
      || !this.readback
    ) {
      this.baseBuffer?.destroy();
      this.tempMaskBuffer?.destroy();
      this.fieldBufferB?.destroy();
      this.outputBuffer?.destroy();
      this.readback?.destroy();
      this.baseCapacity = nextCapacity(baseBytes);
      this.baseBuffer = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });      this.tempMaskBuffer = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE,
      });      this.fieldBufferB = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE,
      });
      this.outputBuffer = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      this.readback = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    if (this.maskCapacity < maskBytes || !this.maskBuffer) {
      this.maskBuffer?.destroy();
      this.maskCapacity = nextCapacity(maskBytes);
      this.maskBuffer = device.createBuffer({
        size: this.maskCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
  }

  private async compilePipeline(
    device: GPUDevice,
    code: string,
    label: string,
  ): Promise<GPUComputePipeline> {
    const module = device.createShaderModule({ code, label });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length) {      throw new Error(
        errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join(' | '),
      );
    }
    return device.createComputePipelineAsync({
      label,
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  }

  private getSinglePipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    if (!this.singlePipeline) {
      this.singlePipeline = this.compilePipeline(device, MASK_WGSL, 'Graphic Studio mask');
    }
    return this.singlePipeline;
  }

  private getFeatherHorizontalPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    if (!this.featherHorizontalPipeline) {
      this.featherHorizontalPipeline = this.compilePipeline(
        device,
        MASK_FEATHER_HORIZONTAL_WGSL,
        'Graphic Studio mask feather horizontal',
      );
    }
    return this.featherHorizontalPipeline;
  }

  private getFeatherCompositePipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    if (!this.featherCompositePipeline) {
      this.featherCompositePipeline = this.compilePipeline(        device,
        MASK_FEATHER_COMPOSITE_WGSL,
        'Graphic Studio mask feather composite',
      );
    }
    return this.featherCompositePipeline;
  }

  private getAdvancedPipeline(
    device: GPUDevice,
    key: string,
    code: string,
  ): Promise<GPUComputePipeline> {
    let pipeline = this.advancedPipelines.get(key);
    if (!pipeline) {
      pipeline = this.compilePipeline(device, code, `Graphic Studio mask ${key}`);
      this.advancedPipelines.set(key, pipeline);
    }
    return pipeline;
  }

  private async runAdvanced(
    base: Raster,
    mask: Raster,
    node: StudioNodeData,
    device: GPUDevice,
  ): Promise<MaskGpuResult> {
    const baseBytes = base.data.byteLength;
    const maskBytes = mask.data.byteLength;
    this.ensureBuffers(device, baseBytes, maskBytes);
    const baseBuffer = this.baseBuffer!;
    const maskBuffer = this.maskBuffer!;
    const fieldA = this.tempMaskBuffer!;
    const fieldB = this.fieldBufferB!;
    const outputBuffer = this.outputBuffer!;
    const readback = this.readback!;

    device.queue.writeBuffer(
      baseBuffer,
      0,
      base.data.buffer,
      base.data.byteOffset,
      baseBytes,
    );
    device.queue.writeBuffer(
      maskBuffer,
      0,
      mask.data.buffer,
      mask.data.byteOffset,
      maskBytes,
    );

    const metaBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      metaBuffer,
      0,
      new Uint32Array([base.width, base.height, mask.width, mask.height]),
    );
    const cleanup: GPUBuffer[] = [metaBuffer];
    const encoder = device.createCommandEncoder({ label: 'Graphic Studio advanced mask' });
    let passes = 0;
    let current = fieldA;
    let spare = fieldB;

    const dispatchField = async (
      key: string,
      shader: string,
      source: GPUBuffer,
      target: GPUBuffer,
      values: readonly number[],
    ) => {
      const pipeline = await this.getAdvancedPipeline(device, key, shader);
      const paramsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      cleanup.push(paramsBuffer);
      const params = new Uint32Array(4);
      values.slice(0, 4).forEach((value, index) => { params[index] = Math.max(0, Math.round(value)); });
      device.queue.writeBuffer(paramsBuffer, 0, params);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: source } },
          { binding: 1, resource: { buffer: target } },
          { binding: 2, resource: { buffer: metaBuffer } },
          { binding: 3, resource: { buffer: paramsBuffer } },
        ],
      });
      const pass = encoder.beginComputePass({ label: key });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
      pass.end();
      passes += 1;
    };
    const swap = () => {
      const previous = current;
      current = spare;
      spare = previous;
    };
    const fieldPass = async (
      key: string,
      shader: string,
      values: readonly number[],
    ) => {
      await dispatchField(key, shader, current, spare, values);
      swap();
    };
    const box = async (radius: number) => {
      if (radius <= 0) return;
      await fieldPass('box-horizontal', MASK_FIELD_BOX_HORIZONTAL_WGSL, [radius]);
      await fieldPass('box-vertical', MASK_FIELD_BOX_VERTICAL_WGSL, [radius]);
    };
    const extreme = async (radius: number, takeMax: boolean) => {
      if (radius <= 0) return;
      await fieldPass('extreme-horizontal', MASK_FIELD_EXTREME_HORIZONTAL_WGSL, [radius, takeMax ? 1 : 0]);
      await fieldPass('extreme-vertical', MASK_FIELD_EXTREME_VERTICAL_WGSL, [radius, takeMax ? 1 : 0]);
    };

    const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
    await dispatchField(
      'field-source',
      MASK_FIELD_SOURCE_WGSL,
      maskBuffer,
      current,
      [maskChannelIds[channel] ?? 0],
    );
    passes += 0;

    const blurRadius = Math.max(0, Math.min(64, Math.round(Number(node.maskBlurRadius ?? 0))));
    if (blurRadius > 0) {
      const boxRadius = Math.max(1, Math.round(blurRadius / 1.8));
      await box(boxRadius);
      await box(boxRadius);
      await box(boxRadius);
    }

    const morphologyRadius = Math.max(0, Math.min(64, Math.round(Number(node.maskMorphRadius ?? 0))));
    const morphologyMode = node.maskMorphology ?? 'none';
    if (morphologyRadius > 0 && morphologyMode !== 'none') {
      if (morphologyMode === 'dilate') await extreme(morphologyRadius, true);
      else if (morphologyMode === 'erode') await extreme(morphologyRadius, false);
      else if (morphologyMode === 'open') {
        await extreme(morphologyRadius, false);
        await extreme(morphologyRadius, true);
      } else if (morphologyMode === 'close') {
        await extreme(morphologyRadius, true);
        await extreme(morphologyRadius, false);
      }
    }

    const expand = Math.max(-64, Math.min(64, Math.round(Number(node.maskExpand ?? 0))));
    if (expand !== 0) await extreme(Math.abs(expand), expand > 0);

    const threshold = Math.max(0, Math.min(100, Number(node.maskThreshold ?? 0)));
    if (threshold > 0) {
      await fieldPass(
        'threshold',
        MASK_FIELD_THRESHOLD_WGSL,
        [Math.round((threshold / 100) * 255)],
      );
    }

    const featherRadius = maskFeatherRadius(node);
    await box(featherRadius);

    const lutBuffer = device.createBuffer({
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    cleanup.push(lutBuffer);
    const lut = buildMaskLut(node);
    const lutValues = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) lutValues[index] = lut[index];
    device.queue.writeBuffer(lutBuffer, 0, lutValues);

    const compositePipeline = await this.getAdvancedPipeline(
      device,
      'field-composite',
      MASK_FIELD_COMPOSITE_WGSL,
    );
    const compositeGroup = device.createBindGroup({
      layout: compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: baseBuffer } },
        { binding: 1, resource: { buffer: current } },
        { binding: 2, resource: { buffer: outputBuffer } },
        { binding: 3, resource: { buffer: metaBuffer } },
        { binding: 4, resource: { buffer: lutBuffer } },
      ],
    });
    const composite = encoder.beginComputePass({ label: 'Mask field composite' });
    composite.setPipeline(compositePipeline);
    composite.setBindGroup(0, compositeGroup);
    composite.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
    composite.end();
    passes += 1;

    encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, baseBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ, 0, baseBytes);
    const mapped = new Uint8Array(readback.getMappedRange(0, baseBytes));
    const data = new Uint8ClampedArray(baseBytes);
    data.set(mapped);
    readback.unmap();
    cleanup.forEach((buffer) => buffer.destroy());
    return {
      raster: { width: base.width, height: base.height, data },
      passes,
    };
  }

  async run(base: Raster, mask: Raster, node: StudioNodeData): Promise<MaskGpuResult> {
    if (!base.width || !base.height || !mask.width || !mask.height) {
      return {
        raster: { ...base, data: new Uint8ClampedArray(base.data) },
        passes: 0,
      };
    }
    const device = await this.getDevice();
    if (!device) throw new Error('WebGPU is unavailable.');
    if (needsAdvancedGpu(node)) return this.runAdvanced(base, mask, node, device);

    const baseBytes = base.data.byteLength;
    const maskBytes = mask.data.byteLength;
    this.ensureBuffers(device, baseBytes, maskBytes);
    const baseBuffer = this.baseBuffer!;
    const maskBuffer = this.maskBuffer!;
    const tempMaskBuffer = this.tempMaskBuffer!;
    const outputBuffer = this.outputBuffer!;
    const readback = this.readback!;

    device.queue.writeBuffer(
      baseBuffer,
      0,
      base.data.buffer,
      base.data.byteOffset,
      baseBytes,
    );    device.queue.writeBuffer(
      maskBuffer,
      0,
      mask.data.buffer,
      mask.data.byteOffset,
      maskBytes,
    );

    const metaBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      metaBuffer,
      0,
      new Uint32Array([base.width, base.height, mask.width, mask.height]),
    );

    const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
    const radius = maskFeatherRadius(node);
    const parameterBuffer = device.createBuffer({
      size: 65 * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const lut = buildMaskLut(node);
    const params = new Uint32Array(65 * 4);
    params[0] = maskChannelIds[channel] ?? 0;
    params[1] = radius;
    for (let index = 0; index < 256; index += 1) {
      params[4 + index] = lut[index];
    }
    device.queue.writeBuffer(parameterBuffer, 0, params);

    const encoder = device.createCommandEncoder({ label: 'Graphic Studio mask' });
    let passes = 1;    if (radius > 0) {
      passes = 2;
      const [horizontalPipeline, compositePipeline] = await Promise.all([
        this.getFeatherHorizontalPipeline(device),
        this.getFeatherCompositePipeline(device),
      ]);
      const horizontalGroup = device.createBindGroup({
        layout: horizontalPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: maskBuffer } },
          { binding: 1, resource: { buffer: tempMaskBuffer } },
          { binding: 2, resource: { buffer: metaBuffer } },
          { binding: 3, resource: { buffer: parameterBuffer } },
        ],
      });
      const compositeGroup = device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: baseBuffer } },
          { binding: 1, resource: { buffer: tempMaskBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
          { binding: 3, resource: { buffer: metaBuffer } },
          { binding: 4, resource: { buffer: parameterBuffer } },
        ],
      });

      const horizontal = encoder.beginComputePass({ label: 'Mask feather horizontal' });
      horizontal.setPipeline(horizontalPipeline);
      horizontal.setBindGroup(0, horizontalGroup);
      horizontal.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
      horizontal.end();
      const composite = encoder.beginComputePass({ label: 'Mask feather composite' });
      composite.setPipeline(compositePipeline);
      composite.setBindGroup(0, compositeGroup);
      composite.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
      composite.end();
    } else {
      const pipeline = await this.getSinglePipeline(device);
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: baseBuffer } },
          { binding: 1, resource: { buffer: maskBuffer } },
          { binding: 2, resource: { buffer: outputBuffer } },
          { binding: 3, resource: { buffer: metaBuffer } },
          { binding: 4, resource: { buffer: parameterBuffer } },
        ],
      });
      const compute = encoder.beginComputePass({ label: 'Mask composite' });
      compute.setPipeline(pipeline);
      compute.setBindGroup(0, bindGroup);
      compute.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
      compute.end();
    }

    encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, baseBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ, 0, baseBytes);
    const mapped = new Uint8Array(readback.getMappedRange(0, baseBytes));
    const data = new Uint8ClampedArray(baseBytes);
    data.set(mapped);    readback.unmap();
    metaBuffer.destroy();
    parameterBuffer.destroy();
    return {
      raster: { width: base.width, height: base.height, data },
      passes,
    };
  }
}
