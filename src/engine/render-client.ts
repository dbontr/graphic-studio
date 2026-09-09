import type { RenderPlan, RenderedImage, SourceMeta } from './types';

type WorkerResponse =
  | { id: number; ok: true; type: 'capabilities'; webgpu: boolean }
  | { id: number; ok: true; type: 'source'; meta: SourceMeta }
  | { id: number; ok: true; type: 'palette'; colors: string[] }
  | { id: number; ok: true; type: 'render' | 'export'; image: RenderedImage }
  | { id: number; ok: false; error: string };

type Pending = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
};

type QueuedRender = {
  plan: RenderPlan;
  resolve: (image: RenderedImage) => void;
  reject: (error: Error) => void;
};

export class RenderEngineClient {
  private readonly worker = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module', name: 'graphic-studio-render-engine' },
  );

  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activeRenderId: number | null = null;
  private queuedRender: QueuedRender | null = null;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response);
      else pending.reject(new Error(response.error));
      if (response.id === this.activeRenderId) {
        this.activeRenderId = null;
        this.dispatchQueuedRender();
      }
    };

    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Graphic Studio render worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  private rpc(message: Record<string, unknown>): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  async capabilities(): Promise<{ webgpu: boolean }> {
    const response = await this.rpc({ type: 'capabilities' });
    if (!response.ok || response.type !== 'capabilities') {
      throw new Error('Unexpected capabilities response.');
    }
    return { webgpu: response.webgpu };
  }

  async loadFile(file: File): Promise<SourceMeta> {
    const response = await this.rpc({ type: 'load-file', file });
    if (!response.ok || response.type !== 'source') {
      throw new Error('Unexpected source response.');
    }
    return response.meta;
  }

  async extractPalette(count = 8): Promise<string[]> {
    const response = await this.rpc({ type: 'extract-palette', count });
    if (!response.ok || response.type !== 'palette') {
      throw new Error('Unexpected palette response.');
    }
    return response.colors;
  }

  render(plan: RenderPlan): Promise<RenderedImage> {
    return new Promise((resolve, reject) => {
      const request: QueuedRender = { plan, resolve, reject };
      if (this.activeRenderId !== null) {
        this.queuedRender?.reject(
          new DOMException('A newer render superseded this request.', 'AbortError'),
        );
        this.queuedRender = request;
        return;
      }
      this.dispatchRender(request);
    });
  }

  private dispatchRender(request: QueuedRender): void {
    const id = this.nextId++;
    this.activeRenderId = id;
    this.pending.set(id, {
      resolve: (response) => {
        if (!response.ok || response.type !== 'render') {
          request.reject(new Error('Unexpected render response.'));
          return;
        }
        request.resolve(response.image);
      },
      reject: request.reject,
    });
    this.worker.postMessage({ id, type: 'render', plan: request.plan });
  }

  private dispatchQueuedRender(): void {
    if (!this.queuedRender || this.activeRenderId !== null) return;
    const next = this.queuedRender;
    this.queuedRender = null;
    this.dispatchRender(next);
  }

  async export(plan: RenderPlan): Promise<RenderedImage> {
    const response = await this.rpc({ type: 'export', plan });
    if (!response.ok || response.type !== 'export') {
      throw new Error('Unexpected export response.');
    }
    return response.image;
  }

  dispose(): void {
    const error = new DOMException('Render engine disposed.', 'AbortError');
    this.queuedRender?.reject(error);
    this.queuedRender = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}
