import type { MaskChannel, StudioNodeData } from '../model';
import {
  MASK_FEATHER_COMPOSITE_WGSL,
  MASK_FEATHER_HORIZONTAL_WGSL,
  MASK_WGSL,
  maskChannelIds,
} from './mask-webgpu';
import { buildMaskLut, maskFeatherRadius } from './mask';
import type { Raster } from './types';

function nextCapacity(bytes: number): number {
  const chunk = 4 * 1024 * 1024;
  return Math.max(chunk, Math.ceil(bytes / chunk) * chunk);
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
  private baseCapacity = 0;
  private maskCapacity = 0;
  private baseBuffer: GPUBuffer | null = null;  private maskBuffer: GPUBuffer | null = null;
  private tempMaskBuffer: GPUBuffer | null = null;
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
    this.outputBuffer?.destroy();
    this.readback?.destroy();
    this.baseBuffer = null;
    this.maskBuffer = null;
    this.tempMaskBuffer = null;
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
      || !this.outputBuffer
      || !this.readback
    ) {
      this.baseBuffer?.destroy();
      this.tempMaskBuffer?.destroy();
      this.outputBuffer?.destroy();
      this.readback?.destroy();
      this.baseCapacity = nextCapacity(baseBytes);
      this.baseBuffer = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });      this.tempMaskBuffer = device.createBuffer({
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

  async run(base: Raster, mask: Raster, node: StudioNodeData): Promise<MaskGpuResult> {
    if (!base.width || !base.height || !mask.width || !mask.height) {
      return {
        raster: { ...base, data: new Uint8ClampedArray(base.data) },
        passes: 0,
      };
    }
    const device = await this.getDevice();
    if (!device) throw new Error('WebGPU is unavailable.');

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
