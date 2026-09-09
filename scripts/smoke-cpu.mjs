import { chromium } from 'playwright';

const url = process.env.GRAPHIC_STUDIO_SMOKE_URL
  ?? 'http://127.0.0.1:5173/graphic-studio/';
const channel = process.env.GRAPHIC_STUDIO_BROWSER_CHANNEL;
const launchOptions = {
  headless: true,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  ...(channel ? { channel } : {}),
};
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console:${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`page:${error.message}`));

try {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!response?.ok()) throw new Error(`CPU smoke URL returned HTTP ${response?.status()}`);
  const result = await page.evaluate(async () => {
    const { RenderEngineClient } = await import('/graphic-studio/src/engine/render-client.ts');
    const { compileRenderGraph } = await import('/graphic-studio/src/engine/graphCompiler.ts');
    const { effectDefaults } = await import('/graphic-studio/src/model.ts');
    const node = (id, data) => ({ id, type: 'studio', position: { x: 0, y: 0 }, data });
    const nodes = [
      node('source', { kind: 'source', label: 'Source' }),
      node('adjust', { kind: 'adjust', ...effectDefaults.adjust, brightness: 7, contrast: 18 }),
      node('generator', {
        kind: 'generator', ...effectDefaults.generator,
        canvasWidth: 640, canvasHeight: 480, generatorType: 'fractal-noise',
        generatorScale: 48, generatorSeed: 23,
      }),
      node('overlay', {
        kind: 'overlay', ...effectDefaults.overlay,
        overlayScale: 78, overlayRotation: 13, overlayOpacity: 61,
        overlayBlendMode: 'screen',
      }),
      node('mask', {
        kind: 'mask', ...effectDefaults.mask,
        maskChannel: 'luminance', maskBlurRadius: 3,
        maskMorphology: 'dilate', maskMorphRadius: 1,
        maskCurve: [0, 40, 126, 218, 255], maskStrength: 86,
      }),
      node('dither', {
        kind: 'dither', ...effectDefaults.dither,
        algorithm: 'floyd-steinberg', threshold: 123,
      }),
      node('output', { kind: 'output', label: 'Output' }),
    ];
    const edges = [
      { id: 's-a', source: 'source', target: 'adjust' },
      { id: 'a-o', source: 'adjust', target: 'overlay', targetHandle: 'base' },
      { id: 'g-o', source: 'generator', target: 'overlay', targetHandle: 'overlay' },
      { id: 'o-m', source: 'overlay', target: 'mask', targetHandle: 'base' },
      { id: 's-m', source: 'source', target: 'mask', targetHandle: 'mask' },
      { id: 'm-d', source: 'mask', target: 'dither' },
      { id: 'd-out', source: 'dither', target: 'output' },
    ];
    const plan = compileRenderGraph(nodes, edges);
    const client = new RenderEngineClient();
    try {
      const capabilities = await client.capabilities();
      const frame = await client.render(plan, 'quality');
      const frameInfo = {
        width: frame.bitmap.width,
        height: frame.bitmap.height,
        backend: frame.telemetry.backend,
        gpuPasses: frame.telemetry.gpuPasses,
      };
      frame.bitmap.close();

      const sourceCanvas = new OffscreenCanvas(320, 240);
      const context = sourceCanvas.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable.');
      const gradient = context.createLinearGradient(0, 0, 320, 240);
      gradient.addColorStop(0, '#183153');
      gradient.addColorStop(1, '#f2a65a');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 320, 240);
      const sourceBlob = await sourceCanvas.convertToBlob({ type: 'image/png' });
      const sourceFile = new File([sourceBlob], 'cpu-smoke.png', { type: 'image/png' });
      const batch = await client.exportFile(
        sourceFile,
        plan,
        { format: 'webp', quality: 0.9, matte: '#ffffff' },
        1024,
      );
      return {
        webgpu: capabilities.webgpu,
        frame: frameInfo,
        batch: {
          backend: batch.telemetry.backend,
          gpuPasses: batch.telemetry.gpuPasses,
          bytes: batch.blob.size,
          type: batch.blob.type,
        },
      };
    } finally {
      client.dispose();
    }
  });

  console.log('CPU_FALLBACK', JSON.stringify(result));
  console.log('PROBLEMS', JSON.stringify(problems));
  if (result.webgpu !== false) throw new Error('WebGPU was not disabled for CPU fallback smoke.');
  if (result.frame.backend !== 'cpu-worker' || result.frame.gpuPasses !== 0) throw new Error('Preview did not stay on CPU worker.');
  if (result.batch.backend !== 'cpu-worker' || result.batch.gpuPasses !== 0) throw new Error('Batch export did not stay on CPU worker.');
  if (result.frame.width < 1 || result.frame.height < 1 || result.batch.bytes < 100) throw new Error('CPU fallback output was empty.');
  if (!result.batch.type.includes('webp')) throw new Error(`Unexpected batch type: ${result.batch.type}`);
  if (problems.length) throw new Error(`CPU fallback browser errors: ${JSON.stringify(problems)}`);
} finally {
  await browser.close();
}
