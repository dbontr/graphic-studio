import type { MaskChannel, StudioNodeData } from '../model';
import { MASK_WGSL, maskChannelIds } from './mask-webgpu';
import type { Raster } from './types';

function nextCapacity(bytes: number): number {
  const chunk = 4 * 1024 * 1024;
  return Math.max(chunk, Math.ceil(bytes / chunk) * chunk);
}

export class MaskGpuEngine {
  private device: GPUDevice | null = null;
  private initialization: Promise<GPUDevice | null> | null = null;
  private pipeline: Promise<GPUComputePipeline> | null = null;
  private baseCapacity = 0;
  private maskCapacity = 0;
  private baseBuffer: GPUBuffer | null = null;
  private maskBuffer: GPUBuffer | null = null;
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
        this.pipeline = null;
        this.destroyBuffers();
      });
      return device;
    })().catch(() => null);
    return this.initialization;
  }

  private destroyBuffers(): void {
    this.baseBuffer?.destroy();
    this.maskBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.readback?.destroy();
    this.baseBuffer = null;
    this.maskBuffer = null;
    this.outputBuffer = null;
    this.readback = null;
    this.baseCapacity = 0;
    this.maskCapacity = 0;
  }

  private ensureBuffers(device: GPUDevice, baseBytes: number, maskBytes: number): void {
    if (this.baseCapacity < baseBytes || !this.baseBuffer || !this.outputBuffer || !this.readback) {
      this.baseBuffer?.destroy();
      this.outputBuffer?.destroy();
      this.readback?.destroy();
      this.baseCapacity = nextCapacity(baseBytes);
      this.baseBuffer = device.createBuffer({
        size: this.baseCapacity,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
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

  private async getPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    if (this.pipeline) return this.pipeline;
    this.pipeline = (async () => {
      const module = device.createShaderModule({ code: MASK_WGSL });
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
    return this.pipeline;
  }

  async run(base: Raster, mask: Raster, node: StudioNodeData): Promise<Raster> {
    if (!base.width || !base.height || !mask.width || !mask.height) {
      return { ...base, data: new Uint8ClampedArray(base.data) };
    }
    const device = await this.getDevice();
    if (!device) throw new Error('WebGPU is unavailable.');

    const baseBytes = base.data.byteLength;
    const maskBytes = mask.data.byteLength;
    this.ensureBuffers(device, baseBytes, maskBytes);
    const baseBuffer = this.baseBuffer!;
    const maskBuffer = this.maskBuffer!;
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
    const channel = (node.maskChannel ?? 'luminance') as MaskChannel;
    const parameterBuffer = device.createBuffer({
      size: 16,
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
      ]),
    );

    const pipeline = await this.getPipeline(device);
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

    const encoder = device.createCommandEncoder({ label: 'Graphic Studio mask' });
    const compute = encoder.beginComputePass();
    compute.setPipeline(pipeline);
    compute.setBindGroup(0, bindGroup);
    compute.dispatchWorkgroups(Math.ceil(base.width / 8), Math.ceil(base.height / 8));
    compute.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, baseBytes);
    device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ, 0, baseBytes);
    const mapped = new Uint8Array(readback.getMappedRange(0, baseBytes));
    const data = new Uint8ClampedArray(baseBytes);
    data.set(mapped);
    readback.unmap();
    metaBuffer.destroy();
    parameterBuffer.destroy();
    return { width: base.width, height: base.height, data };
  }
}
