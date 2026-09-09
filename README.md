# Graphic Studio

A node-based browser graphics editor focused on dithering, pixel-art processing, and fast experimental image workflows.

Graphic Studio is built as a static web application, so the editor runs entirely in the browser and can be hosted on GitHub Pages. Node.js is used for the development and build toolchain; image processing happens locally in the browser.

## Current editor

- Infinite node canvas powered by React Flow
- Drag-and-drop style image source node
- Live color / tone adjustments
- Floyd–Steinberg dithering
- Atkinson dithering
- Bayer 4×4 and Bayer 8×8 ordered dithering
- Threshold dithering
- Mono and RGB dither modes
- Pixelate and posterize nodes
- Live output preview
- PNG export
- Node insertion and reconnectable pipelines
- Undo / redo for editor operations
- Local workflow persistence
- GitHub Pages deployment workflow

## Stack

- React + TypeScript
- Vite
- `@xyflow/react`
- Canvas 2D image processing
- Vitest
- GitHub Actions + GitHub Pages

## Local development

```bash
npm install
npm run dev
```

Then open the Vite URL shown in the terminal.

## Verification

```bash
npm test
npm run build
```

## Architecture

The editor deliberately separates three layers:

1. **Graph model** — nodes and connections are UI state.
2. **Raster engine** — pure transformations operate on an RGBA raster buffer.
3. **Browser shell** — upload, preview, persistence, and export.

The output node recursively evaluates the connected upstream graph, so the same UI can grow into branching, masks, compositing, palette nodes, WebGL/WebGPU kernels, and reusable subgraphs without replacing the editor model.

## Roadmap

The next useful additions are palette extraction / locking, image masks, blend/composite nodes, edge detection, halftone screens, blue-noise dithering, reusable presets, graph import/export, history snapshots, WebGPU acceleration, and an optional WASM image-processing backend.

## License

MIT.
