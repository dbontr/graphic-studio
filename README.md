# Graphic Studio

Graphic Studio is a high-performance, node-based image processing studio that runs entirely in the browser and deploys as a static GitHub Pages application.

It started as a Dither Boy-style experiment and is evolving into a broader local-first graphics workbench for dithering, pixel-art workflows, palette processing, color grading, convolution effects, and reusable image pipelines.

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
- Drag-and-drop image loading anywhere on the workspace
- Clipboard image paste support
- PNG, JPEG, WebP, GIF, and AVIF input
- Live preview and full-resolution PNG export
- Node bypass / enable controls
- Undo / redo with drag and slider coalescing
- Keyboard shortcuts for undo, redo, save, and render
- Workflow JSON import / export
- Local workflow persistence
- Last source image persistence in IndexedDB
- Runtime performance panel with backend, compute time, throughput, cache hits, and GPU pass counts

### Processing nodes

- Color + tone: exposure, brightness, contrast, saturation, gamma, temperature, tint
- Transform: crop edges, 90° rotation, horizontal/vertical flip, 10–200% resize, nearest or bilinear resampling
- Pixelate
- Posterize
- Palette mapping: Game Boy, PICO-8, CGA, monochrome, grayscale, editable custom palettes, source palette extraction
- Convolution: blur, sharpen, edge detection, emboss, adjustable strength
- Dither: Floyd–Steinberg, Atkinson, Burkes, Sierra Lite, Bayer 2×2 / 4×4 / 8×8, threshold, deterministic noise

## Render engine

### WebGPU path

Graphic Studio contains a real WebGPU compute backend rather than a GPU-styled UI flag. Compatible graph stages are partitioned into GPU passes, and adjacent point operations are fused into a single compute shader.

The backend currently accelerates:

- Color / tone adjustment
- Posterization
- Palette mapping
- Pixelation
- 3×3 convolution
- Bayer dithering
- Threshold dithering
- Noise dithering

GPU buffers are reused between renders, compute pipelines are cached, compatible stages are fused, and a ping-pong storage-buffer design avoids intermediate CPU readbacks.

### CPU-worker path

Algorithms with strong serial dependencies are intentionally kept on the worker CPU instead of being forced onto an unsuitable GPU implementation. Error diffusion uses rotating `Float32Array` error rows, avoiding a full-frame floating-point working image and dramatically reducing temporary memory.

The engine uses an adaptive hybrid policy: a GPU round trip is avoided for tiny or cheap GPU prefixes when a sequential CPU stage immediately follows, while all-GPU pipelines and expensive spatial kernels can stay on WebGPU.

### Incremental rendering

A source-revision + stage-signature cache stores reusable intermediate rasters with a bounded memory budget. Moving nodes does not rerender the image because layout coordinates are not part of the semantic render plan. During rapid slider edits, the main thread debounces changes while the render client keeps at most one active render and one newest queued render.

Preview decoding is capped for interactivity, while export re-decodes the original source at a much higher resolution budget. This keeps editing responsive without permanently throwing away source resolution.

## Stack

- React 19 + TypeScript
- Vite
- React Flow / XYFlow
- Dedicated Web Worker
- WebGPU compute + WGSL
- OffscreenCanvas + ImageBitmap
- IndexedDB for local source persistence
- Vitest
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

That command runs linting, the engine test suite, TypeScript, and the production Vite build.

## Direction

The render foundation is intentionally larger than a dithering clone. Planned higher-level capabilities include masks, compositing and blend nodes, curves, halftones and blue-noise screens, reusable subgraphs, presets, batch export, comparison views, histogram/scopes, vector/text overlays, and additional GPU kernels.

The goal is to keep those features on the same local-first architecture rather than growing a server dependency.

## Browser behavior

WebGPU is used when the browser exposes it and the graph benefits from it. The CPU-worker path remains the correctness fallback, so Graphic Studio remains functional when WebGPU is unavailable.

## License

MIT.
