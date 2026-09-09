import { chromium } from 'playwright';

const url = process.env.GRAPHIC_STUDIO_SMOKE_URL
  ?? 'http://127.0.0.1:5173/graphic-studio/';

const browserChannel = process.env.GRAPHIC_STUDIO_BROWSER_CHANNEL;
const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
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
    const { generateRaster } = await import('/graphic-studio/src/engine/generators.ts');
    const { WebGpuEngine } = await import('/graphic-studio/src/engine/webgpu.ts');

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

      const advancedMaskData = {
        ...mask.data,
        maskInvert: false,
        maskStrength: 88,
        maskFeather: 3,
        maskBlurRadius: 7,
        maskMorphology: 'close',
        maskMorphRadius: 2,
        maskExpand: -1,
        maskThreshold: 38,
        maskCurve: [0, 42, 116, 214, 255],
      };
      const advancedExpected = maskRaster(baseRaster, maskRasterSource, advancedMaskData);
      const advancedGpu = new MaskGpuEngine();
      const advancedResult = await advancedGpu.run(baseRaster, maskRasterSource, advancedMaskData);
      let advancedMaxDifference = 0;
      for (let offset = 0; offset < advancedExpected.data.length; offset += 1) {
        advancedMaxDifference = Math.max(
          advancedMaxDifference,
          Math.abs(advancedExpected.data[offset] - advancedResult.raster.data[offset]),
        );
      }

      const generatorData = {
        kind: 'generator', label: 'GPU checker', canvasWidth: 640, canvasHeight: 480,
        generatorType: 'checkerboard', generatorColorA: '#112233', generatorColorB: '#eeddcc',
        generatorScale: 23, generatorSeed: 17, generatorIntensity: 100,
      };
      const generatorExpected = generateRaster(generatorData);
      const generatorGpu = new WebGpuEngine();
      const generatorResult = await generatorGpu.runGenerator(generatorData);
      let generatorMaxDifference = 0;
      for (let offset = 0; offset < generatorExpected.data.length; offset += 1) {
        generatorMaxDifference = Math.max(
          generatorMaxDifference,
          Math.abs(generatorExpected.data[offset] - generatorResult.raster.data[offset]),
        );
      }
      const generatorStages = [
        { id: 'grade', data: { kind: 'adjust', label: 'Grade', exposure: 0.2, contrast: 12, saturation: 108, gamma: 0.94 } },
        { id: 'posterize', data: { kind: 'posterize', label: 'Posterize', levels: 9 } },
        { id: 'ordered', data: { kind: 'dither', label: 'Ordered', algorithm: 'bayer-8', threshold: 128, monochrome: false } },
      ];
      let generatorChainExpected = generatorExpected;
      for (const stage of generatorStages) generatorChainExpected = applyEffectCpu(generatorChainExpected, stage.data);
      const generatorChainResult = await generatorGpu.runGeneratorChain(generatorData, generatorStages);
      let generatorChainMaxDifference = 0;
      for (let offset = 0; offset < generatorChainExpected.data.length; offset += 1) {
        generatorChainMaxDifference = Math.max(
          generatorChainMaxDifference,
          Math.abs(generatorChainExpected.data[offset] - generatorChainResult.raster.data[offset]),
        );
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
        advancedMaskMaxDifference: advancedMaxDifference,
        advancedMaskPasses: advancedResult.passes,
        generatorMaxDifference,
        generatorPasses: generatorResult.passes,
        generatorChainMaxDifference,
        generatorChainPasses: generatorChainResult.passes,
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
    advancedControls: /Gaussian blur/.test(await maskNode.innerText())
      && /Expand \/ contract/.test(await maskNode.innerText())
      && /Mask curve/i.test(await maskNode.innerText()),
  };

  const outputNode = page.locator('.studio-node--output').first();
  const comparisonButtons = outputNode.locator('.preview-mode-switch button');
  const splitButton = outputNode.getByRole('button', { name: 'Split' });
  await splitButton.click();
  const comparisonPreview = outputNode.locator('.comparison-preview');
  await comparisonPreview.waitFor();
  const scrubber = comparisonPreview.locator('input[type="range"]');
  await scrubber.evaluate((input) => {
    input.value = '63';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const comparison = {
    modes: await comparisonButtons.count(),
    canvases: await comparisonPreview.locator('canvas').count(),
    scrubbers: await scrubber.count(),
    split: await scrubber.inputValue(),
    sourceReady: await splitButton.isEnabled(),
  };

  console.log('MASK_ENGINE', JSON.stringify(engine));
  console.log('MASK_UI', JSON.stringify(ui));
  console.log('COMPARISON_UI', JSON.stringify(comparison));
  console.log('PROBLEMS', JSON.stringify(problems));

  if (engine.graphNodes !== 4) throw new Error(`Expected four graph nodes, got ${engine.graphNodes}`);
  if (engine.directMaskMaxDifference !== 0) {
    throw new Error(`Direct mask CPU/GPU parity failed: ${engine.directMaskMaxDifference}`);
  }
  if (engine.advancedMaskMaxDifference !== 0 || engine.advancedMaskPasses < 4) {
    throw new Error(`Advanced mask GPU parity failed: ${JSON.stringify(engine)}`);
  }
  if (engine.generatorChainMaxDifference > 2 || engine.generatorChainPasses !== 2) {
    throw new Error(`Resident generator-chain parity failed: ${JSON.stringify(engine)}`);
  }  if (engine.generatorMaxDifference !== 0 || engine.generatorPasses !== 1) {
    throw new Error(`Generator GPU parity failed: ${JSON.stringify(engine)}`);
  }
  if (engine.directMaskPasses !== 2 || engine.gpuPasses < 2) {
    throw new Error(`Expected two-pass GPU feathering: ${JSON.stringify(engine)}`);
  }
  // The full graph includes an upstream floating-point Adjust node whose CPU/WebGPU
  // implementations are independently allowed a small byte-level rounding delta.
  if (engine.maxDifference > 2) throw new Error(`Mask graph parity failed: ${engine.maxDifference}`);
  if (ui.nodes !== 1 || ui.handles !== 2 || ui.channels < 5 || ui.strengthControls < 9 || !ui.advancedControls) {
    throw new Error(`Mask UI smoke failed: ${JSON.stringify(ui)}`);
  }
  if (!comparison.sourceReady || comparison.modes !== 3 || comparison.canvases !== 2
    || comparison.scrubbers !== 1 || comparison.split !== '63') {
    throw new Error(`Comparison UI smoke failed: ${JSON.stringify(comparison)}`);
  }
  if (problems.length) throw new Error(`Browser problems: ${JSON.stringify(problems)}`);
} finally {
  await browser.close();
}
