import { chromium } from 'playwright';

const url = process.env.GRAPHIC_STUDIO_SMOKE_URL
  ?? 'http://127.0.0.1:5173/graphic-studio/';

const browserChannel = process.env.GRAPHIC_STUDIO_BROWSER_CHANNEL ?? 'chrome';
const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
  args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const problems = [];
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error' || /fallback|validation/i.test(text)) {
    problems.push(`${message.type()}:${text}`);
  }
});
page.on('pageerror', (error) => problems.push(`page:${error.message}`));

try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`Smoke URL returned HTTP ${response?.status()}`);
  await page.waitForSelector('canvas.preview-canvas', { timeout: 15_000 });

  const engine = await page.evaluate(async () => {
    const { RenderEngineClient } = await import('/graphic-studio/src/engine/render-client.ts');
    const { compileRenderGraph } = await import('/graphic-studio/src/engine/graphCompiler.ts');
    const { applyEffectCpu, makeDemoRaster } = await import('/graphic-studio/src/engine/imageEngine.ts');
    const { maskRaster } = await import('/graphic-studio/src/engine/mask.ts');
    const { MaskGpuEngine } = await import('/graphic-studio/src/engine/maskGpuEngine.ts');

    const source = { id: 'source', type: 'studio', position: { x: 0, y: 0 }, data: { kind: 'source', label: 'Source' } };
    const maskSource = {
      id: 'mask-source',
      type: 'studio',
      position: { x: 0, y: 0 },
      data: {
        kind: 'adjust', label: 'Mask grade', brightness: -12,
        contrast: 24, saturation: 70, gamma: 0.85,
      },
    };
    const mask = {
      id: 'mask',
      type: 'studio',
      position: { x: 0, y: 0 },
      data: {
        kind: 'mask', label: 'Mask', maskChannel: 'red',
        maskInvert: true, maskStrength: 73, maskFeather: 9,
        maskBlackPoint: 18, maskWhitePoint: 82, maskGamma: 1.6,
      },
    };
    const output = { id: 'output', type: 'studio', position: { x: 0, y: 0 }, data: { kind: 'output', label: 'Output' } };
    const edges = [
      { id: 's-mask-source', source: 'source', target: 'mask-source' },
      { id: 's-mask-base', source: 'source', target: 'mask', targetHandle: 'base' },
      { id: 'mask-source-mask', source: 'mask-source', target: 'mask', targetHandle: 'mask' },
      { id: 'mask-output', source: 'mask', target: 'output' },
    ];
    const plan = compileRenderGraph([source, maskSource, mask, output], edges);
    const client = new RenderEngineClient();
    try {
      const capabilities = await client.capabilities();
      const frame = await client.render(plan);
      const canvas = new OffscreenCanvas(frame.bitmap.width, frame.bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable in browser smoke.');
      context.drawImage(frame.bitmap, 0, 0);
      const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
      frame.bitmap.close();

      const baseRaster = makeDemoRaster();
      const maskRasterSource = applyEffectCpu(baseRaster, maskSource.data);
      const expected = maskRaster(baseRaster, maskRasterSource, mask.data);

      // Isolate the mask compositor itself from upstream Adjust-node GPU/CPU drift.
      // This direct test must be byte-exact across the entire raster.
      const directMaskGpu = new MaskGpuEngine();
      const directMaskResult = await directMaskGpu.run(baseRaster, maskRasterSource, mask.data);
      const directMask = directMaskResult.raster;
      let directMaskMaxDifference = 0;
      let directMaskCompared = 0;
      for (let offset = 0; offset < expected.data.length; offset += 1) {
        directMaskMaxDifference = Math.max(
          directMaskMaxDifference,
          Math.abs(expected.data[offset] - directMask.data[offset]),
        );
        directMaskCompared += 1;
      }

      let maxDifference = 0;
      let compared = 0;
      for (let pixel = 0; pixel < expected.width * expected.height; pixel += 997) {
        const offset = pixel * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          maxDifference = Math.max(
            maxDifference,
            Math.abs(expected.data[offset + channel] - actual[offset + channel]),
          );
          compared += 1;
        }
      }
      return {
        webgpu: capabilities.webgpu,
        backend: frame.telemetry.backend,
        gpuPasses: frame.telemetry.gpuPasses,
        maxDifference,
        compared,
        directMaskMaxDifference,
        directMaskCompared,
        directMaskPasses: directMaskResult.passes,
        graphNodes: plan.graph?.nodes.length ?? 0,
      };
    } finally {
      client.dispose();
    }
  });

  await page.getByRole('button', { name: 'Add node' }).click();
  await page.getByRole('button', { name: /Mask/ }).click();
  const maskNode = page.locator('.studio-node--mask').last();
  const ui = {
    nodes: await maskNode.count(),
    handles: await maskNode.locator('.blend-handle').count(),
    channels: await maskNode.locator('select option').count(),
    strengthControls: await maskNode.locator('input[type="range"]').count(),
    inputLabels: (await maskNode.locator('.blend-input-key').innerText()).replace(/\s+/g, ' ').trim(),
  };

  console.log('MASK_ENGINE', JSON.stringify(engine));
  console.log('MASK_UI', JSON.stringify(ui));
  console.log('PROBLEMS', JSON.stringify(problems));

  if (engine.graphNodes !== 4) throw new Error(`Expected four graph nodes, got ${engine.graphNodes}`);
  if (engine.directMaskMaxDifference !== 0) {
    throw new Error(`Direct mask CPU/GPU parity failed: ${engine.directMaskMaxDifference}`);
  }
  if (engine.directMaskPasses !== 2 || engine.gpuPasses < 2) {
    throw new Error(`Expected two-pass GPU feathering: ${JSON.stringify(engine)}`);
  }
  // The full graph includes an upstream floating-point Adjust node whose CPU/WebGPU
  // implementations are independently allowed a small byte-level rounding delta.
  if (engine.maxDifference > 2) throw new Error(`Mask graph parity failed: ${engine.maxDifference}`);
  if (ui.nodes !== 1 || ui.handles !== 2 || ui.channels !== 5 || ui.strengthControls !== 5) {
    throw new Error(`Mask UI smoke failed: ${JSON.stringify(ui)}`);
  }
  if (problems.length) throw new Error(`Browser problems: ${JSON.stringify(problems)}`);
} finally {
  await browser.close();
}
