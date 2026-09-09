import fs from 'node:fs';

function replace(path, oldText, newText) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(oldText)) {
    throw new Error(`Missing smoke patch anchor in ${path}: ${oldText.slice(0, 80)}`);
  }
  fs.writeFileSync(path, source.replace(oldText, newText));
}

replace(
  'scripts/smoke-mask-ui.mjs',
  `    const { maskRaster } = await import('/graphic-studio/src/engine/mask.ts');`,
  `    const { maskRaster } = await import('/graphic-studio/src/engine/mask.ts');
    const { MaskGpuEngine } = await import('/graphic-studio/src/engine/maskGpuEngine.ts');`,
);

replace(
  'scripts/smoke-mask-ui.mjs',
  `      const expected = maskRaster(baseRaster, maskRasterSource, mask.data);
      let maxDifference = 0;`,
  `      const expected = maskRaster(baseRaster, maskRasterSource, mask.data);

      // Isolate the mask compositor itself from upstream Adjust-node GPU/CPU drift.
      // This direct test must be byte-exact across the entire raster.
      const directMaskGpu = new MaskGpuEngine();
      const directMask = await directMaskGpu.run(baseRaster, maskRasterSource, mask.data);
      let directMaskMaxDifference = 0;
      let directMaskCompared = 0;
      for (let offset = 0; offset < expected.data.length; offset += 1) {
        directMaskMaxDifference = Math.max(
          directMaskMaxDifference,
          Math.abs(expected.data[offset] - directMask.data[offset]),
        );
        directMaskCompared += 1;
      }

      let maxDifference = 0;`,
);

replace(
  'scripts/smoke-mask-ui.mjs',
  `        maxDifference,
        compared,
        graphNodes: plan.graph?.nodes.length ?? 0,`,
  `        maxDifference,
        compared,
        directMaskMaxDifference,
        directMaskCompared,
        graphNodes: plan.graph?.nodes.length ?? 0,`,
);

replace(
  'scripts/smoke-mask-ui.mjs',
  `  if (engine.graphNodes !== 4) throw new Error(\`Expected four graph nodes, got \${engine.graphNodes}\`);
  if (engine.maxDifference > 1) throw new Error(\`Mask render parity failed: \${engine.maxDifference}\`);`,
  `  if (engine.graphNodes !== 4) throw new Error(\`Expected four graph nodes, got \${engine.graphNodes}\`);
  if (engine.directMaskMaxDifference !== 0) {
    throw new Error(\`Direct mask CPU/GPU parity failed: \${engine.directMaskMaxDifference}\`);
  }
  // The full graph includes an upstream floating-point Adjust node whose CPU/WebGPU
  // implementations are independently allowed a small byte-level rounding delta.
  if (engine.maxDifference > 2) throw new Error(\`Mask graph parity failed: \${engine.maxDifference}\`);`,
);

console.log('Added isolated byte-exact mask compositor browser verification.');
