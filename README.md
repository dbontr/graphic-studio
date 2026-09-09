# Graphic Studio

Graphic Studio is a high-performance, node-based image processing studio that runs entirely in the browser and deploys as a static GitHub Pages application.

It started as a Dither Boy-style experiment and is now a broader local-first graphics workbench for reusable node workflows, raster authoring, procedural graphics, dithering, palette processing, color grading, compositing, masking, batch production, and high-resolution export.

**Live:** https://dbontr.github.io/graphic-studio/

## Why this architecture

GitHub Pages cannot run a persistent Node.js backend, so Node.js is deliberately used only for development, testing, and the production build. The shipped application does all image work locally in the browser.

The render architecture is designed around three rules:

1. **Never block the editor UI with image processing.** Rendering runs in a dedicated Web Worker.
2. **Use the GPU when it actually helps.** Parallel effects use WebGPU compute, while sequential algorithms such as error diffusion remain on an optimized CPU-worker path.
3. **Do not recompute unchanged work.** The engine compiles the connected graph, caches intermediate rasters, fuses compatible GPU stages, and coalesces stale render requests.

No uploaded image needs to leave the device.

## Current feature set

### Editor

- Infinite node canvas with reconnectable pipelines
- True branch/recombine graphs with explicit multi-input ports
- Drag-and-drop image loading anywhere on the workspace
- Clipboard image paste support
- PNG, JPEG, WebP, GIF, and AVIF input
- Live result/original preview plus draggable split before/after comparison and full-resolution PNG, JPEG, and WebP export
- Export panel with filename, quality, alpha-aware WebP, and configurable JPEG transparency matte
- Node bypass / enable controls
- Undo / redo with drag and slider coalescing
- Keyboard shortcuts for undo, redo, save, and render
- Workflow JSON import / export with bounded schema validation and backward-compatible local persistence
- Searchable node palette plus multi-select duplicate, copy/paste, align, distribute, and per-node reset controls
- Reusable subgraphs with exposed parameters, nested deterministic expansion, and an inline internal-graph inspector
- Built-in and user preset library with selection capture, local persistence, search, import/export, and portable JSON manifests
- Batch queue for up to 500 images with PNG/JPEG/WebP output, resolution caps, filename templates, retry/cancel, collision-safe names, progress, and ZIP download
- Last source image persistence in IndexedDB
- Runtime performance panel with backend, compute time, throughput, cache hits, GPU pass counts, and live histogram / waveform / vectorscope analysis

### Processing nodes

- Color + tone: exposure, brightness, contrast, saturation, gamma, temperature, tint
- Curves: interactive five-anchor Master, Red, Green, and Blue tone curves with exact CPU/WebGPU parity
- Blend: true two-input branch compositing with 12 blend modes, opacity, alpha compositing, and normalized branch geometry
- Mask: true two-input alpha masking with luminance/R/G/B/alpha channels, levels, gamma, five-point mask curves, Gaussian-style blur, dilate/erode/open/close morphology, signed expand/contract, thresholding, color-key selection, feather, inversion, strength, and mask/overlay diagnostic previews
- Overlay: positioned two-input compositing with translation, scale, rotation, configurable anchor, opacity, and all 12 blend modes
- Text: multiline transparent typography sources with font family, size, weight, tracking, line height, alignment, fill, stroke, and opacity
- Shape: rectangle, rounded rectangle, ellipse, line, triangle, and polygon sources with fill/stroke controls
- Gradient: editable multi-stop linear/radial sources with angle, center, and radius controls
- Generator: solid, checkerboard, grid, deterministic noise, fractal noise, scanlines, stripes, dot matrix, tile, Voronoi, and CRT-style procedural sources
- Transform: crop edges, 90-degree rotation, horizontal/vertical flip, 10-200% resize, nearest or bilinear resampling
- Pixelate
- Posterize
- Palette mapping: Game Boy, PICO-8, CGA, monochrome, grayscale, editable custom palettes, source palette extraction
- Convolution: blur, sharpen, edge detection, emboss, adjustable strength
- Dither: 25 modes spanning 14 error-diffusion kernels, Bayer matrices, a progressive 32x32 blue-noise threshold map, clustered-dot screens, procedural dot/line/crosshatch screens, CMYK halftone, threshold, and deterministic noise
- Error-diffusion controls: serpentine or raster scan plus 0-160% error strength
- Pattern controls: screen size and angle with GPU acceleration where applicable

## Render engine

### WebGPU path

Graphic Studio contains a real WebGPU compute backend rather than a GPU-styled UI flag. Compatible graph stages are partitioned into GPU passes, and adjacent point operations are fused into a single compute shader.

The backend currently accelerates:

- Color / tone adjustment
- Master/RGB tone curves
- Two-input blend compositing across 12 blend modes
- Two-input masking, including exact feathering plus GPU blur/morphology/expand/threshold field passes
- Posterization
- Palette mapping
- Pixelation
- 3x3 convolution
- Bayer, progressive blue-noise, and clustered-dot ordered dithering
- Procedural halftone dots, line screens, and crosshatch
- Four-screen CMYK halftone at standard C/M/Y/K angles
- Threshold dithering
- Noise dithering
- Procedural generator roots, including deterministic pattern/noise/Voronoi/CRT families

GPU buffers are pooled and reused between renders, compute pipelines are cached and prewarmed, compatible point stages are shader-fused, and ping-pong storage buffers avoid unnecessary intermediate readbacks. Procedural generator roots can remain GPU-resident through a compatible unary chain and read back only the final raster.

### Branching graph execution

The compiler preserves the fast linear plan for ordinary pipelines and emits a dependency DAG only when a live multi-input node requires it. Blend, Mask, and Overlay ports are explicit in workflow edges, branch results are memoized, shared ancestors are evaluated once, and compatible unary chains remain fused between branch boundaries. Reusable subgraphs expand deterministically into the same graph IR with bounded nesting and exposed-parameter overrides.

Blend execution uses a dedicated two-input WebGPU kernel on larger canvases with a deterministic CPU-worker fallback. Masking builds one normalized scalar mask field, then applies optional Gaussian-style blur, morphology, signed expansion/contraction, thresholding, feathering, levels/gamma/five-point-curve LUT shaping, inversion, and strength before alpha composition. The CPU uses O(N) sliding windows and deque morphology; the WebGPU path keeps the mask field on pooled storage buffers across horizontal/vertical passes and performs one final readback. Simple feathering retains the exact v0.11 byte path. Integer channel extraction, fixed-point Rec.709 luminance, geometry mapping, filter rounding, LUT lookup, and alpha composition use matching byte semantics; browser parity tests require zero byte difference for both simple and advanced GPU masks. Color-key selection and diagnostic mask/overlay previews intentionally remain on the CPU worker.

### CPU-worker path

Algorithms with strong serial dependencies are intentionally kept on the worker CPU instead of being forced onto an unsuitable GPU implementation. Fourteen error-diffusion kernels share one bounded-row engine with optional serpentine scanning and adjustable error strength. It allocates only the forward rows required by each kernel—up to four for Stevenson–Arce—instead of a full-frame floating-point working image.

The engine uses an adaptive hybrid policy: a GPU round trip is avoided for tiny or cheap GPU prefixes when a sequential CPU stage immediately follows, while all-GPU pipelines and expensive spatial kernels can stay on WebGPU.

### Incremental rendering

A source-revision + stage-signature cache stores reusable intermediate rasters with a bounded memory budget. Multi-input cache keys include branch identity and semantic controls, so changing mask channel, inversion, strength, blend mode, or opacity invalidates only the answer-relevant downstream work. Moving nodes does not rerender the image because layout coordinates are not part of the semantic render plan. During rapid slider edits, the main thread debounces changes while the render client keeps at most one active render and one newest queued render.

Interactive rendering is resolution-adaptive: graph complexity selects a pixel budget, image sources are downsampled for the immediate frame, and generated roots receive a proportionally scaled render plan so text, shapes, masks, patterns, overlays, and pixel effects retain their visual scale. An idle quality pass follows after editing settles. This keeps the 4K/8K editing path close to the same interaction cost while export preserves the requested source resolution.

Preview decoding is capped for interactivity, while export re-decodes the original source at a much higher resolution budget. The worker exposes a zero-copy source-preview snapshot alongside processed frames so the Output node can switch between Result, Original, and draggable Split comparison modes without rerunning the graph. Source and live frames are transferred as `ImageBitmap` objects and drawn directly to preview canvases, so interactive rendering pays no image-encoding or Blob-URL churn. A single bounded worker-side analysis pass builds the RGB/luminance histogram, 128×64 luminance waveform, and 96×96 Cb/Cr vectorscope with at most 250,000 samples, avoiding any main-thread pixel readback. PNG, JPEG, or WebP encoding only happens on explicit export; JPEG exports flatten alpha against the selected matte while PNG and WebP preserve transparency. This keeps editing responsive without permanently throwing away source resolution.

## Performance benchmark

`npm run benchmark:browser` executes a real Edge/Chrome WebGPU workload at 1080p, 4K, and 8K and writes a machine-readable report under `benchmarks/`. The v0.18 Jupiter reference run uses a procedural generator plus a fused adjustment/posterize/Bayer chain.

| Resolution | Interactive wall | Quality wall | WebGPU compute | Export wall |
| --- | ---: | ---: | ---: | ---: |
| 1080p | 14.1 ms | 22.6 ms | 14.0 ms | 272.9 ms |
| 4K | 11.3 ms | 92.5 ms | 63.8 ms | 1.08 s |
| 8K | 11.4 ms | 293.3 ms | 197.7 ms | 4.37 s |

Interactive 4K/8K stays near 11 ms because the immediate pass is resolution-adaptive (1333x750 in this workload), followed by the full-quality idle render. Full 8K rendering and WebP export complete without leaving the browser.
## Stack

- React 19 + TypeScript
- Vite
- React Flow / XYFlow
- Dedicated Web Worker
- WebGPU compute + WGSL
- OffscreenCanvas + ImageBitmap
- IndexedDB for local source persistence
- Vitest
- Playwright browser regression + WebGPU parity tests
- fflate for local ZIP batch export
- GitHub Actions + GitHub Pages

## Development

```bash
npm install
npm run dev
```

Run the complete quality gate with:

```bash
npm run check
```

Run browser/WebGPU regression suites and the benchmark harness with:

```bash
npm run smoke:browser
npm run smoke:v18
npm run benchmark:browser
```

`npm run check` runs linting, the full engine/unit suite, TypeScript, and the production Vite build. The browser suites exercise real WebGPU kernels, editor workflows, subgraphs/presets, batch ZIP production, authoring nodes, and comparison controls.

## Direction

v0.18 completes the v0.13-v0.18 roadmap: reusable workflow packaging, raster authoring primitives, advanced masking, batch production, procedural generators, and the deep performance pass all live on the same local-first runtime. Future work can concentrate on deeper vector editing, richer typography/font loading, additional GPU-resident multi-input chains, and further UX polish rather than filling foundational gaps.

## Browser behavior

WebGPU is used when the browser exposes it and the graph benefits from it. The CPU-worker path remains the correctness fallback, so Graphic Studio remains functional when WebGPU is unavailable.

## License

MIT.
