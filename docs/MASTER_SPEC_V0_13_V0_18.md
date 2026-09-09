# Graphic Studio v0.13–v0.18 Master Specification

Status: implementation authority for the v0.13–v0.18 feature train.

## Product objective

Graphic Studio must become a professional, browser-native node graphics workbench: reusable like a procedural compositor, approachable like a modern image editor, local-first, and fast enough for interactive 4K-class work on capable hardware.

The shipped application remains static-hostable on GitHub Pages. Node.js is build/test tooling only. Image data stays local unless a user explicitly exports it.

## Non-negotiable engineering rules

1. Rendering never blocks the React UI thread.
2. Every new node has deterministic CPU semantics and an explicit GPU policy.
3. WebGPU is an acceleration backend, never a correctness dependency.
4. Graph signatures depend on semantic inputs only, never layout coordinates.
5. Reusable graph structures are versioned and portable as JSON.
6. Large operations use bounded memory and cancellable/coalesced scheduling.
7. Browser smoke tests cover critical cross-thread/WebGPU behavior.
8. Existing dirty worktrees are preserved; feature work is isolated.

## v0.13 — reusable subgraphs and presets

### User capabilities
- Select a connected group of nodes and create a reusable Subgraph node.
- Expose internal numeric/select/color controls as named outer parameters.
- Enter/inspect a subgraph without losing the parent workflow.
- Save any selected node set or subgraph as a local preset.
- Import/export presets as versioned JSON.
- Ship curated presets for mono diffusion, Atkinson, Bayer, retro palette, halftone, and sharpen/posterize workflows.

### Data contracts
`PresetManifest` contains schema version, id, name, description, nodes, edges, exposed parameters, created/updated timestamps, and optional tags.

`SubgraphDefinition` contains stable internal node/edge ids plus `SubgraphBinding[]` mapping an exposed key to an internal node id/property.

Preset/subgraph JSON must reject malformed schemas and unknown structural fields that would compromise graph execution.

### Acceptance
- Round-trip export/import produces an equivalent semantic graph.
- Nested reusable definitions compile deterministically.
- Changing one exposed parameter changes only the relevant semantic signature.
- Built-in presets can be inserted in one action.

## v0.14 — text, shapes, gradients, overlays

### Nodes
- Text: content, font family, size, weight, tracking, line height, alignment, fill, stroke, stroke width, opacity.
- Shape: rectangle, rounded rectangle, ellipse, line, triangle, polygon; fill/stroke/opacity.
- Gradient: linear/radial, angle/center/radius, 2–8 ordered color stops.
- Overlay: two-input compositor with translation, scale, rotation, anchor, opacity, and blend mode.

### Raster-source contract
Generator-like nodes may emit a raster without an incoming image. Their requested canvas size is explicit and clamped to engine limits. Overlay and ordinary unary nodes continue to consume normal graph rasters.

Text and shape rasterization uses OffscreenCanvas in the worker. Typography is deterministic within the active browser/font environment; workflow JSON stores font-family fallbacks, not font binaries.

### Acceptance
- Generator nodes compile as valid graph roots.
- Text/shape/gradient outputs preserve alpha.
- Overlay geometry is deterministic for mismatched branch sizes.
- New outputs compose with Blend, Mask, Transform, Dither, and export.

## v0.15 — advanced masking

### Capabilities
- Gaussian-style blur with configurable radius.
- Dilate, erode, open, and close morphology.
- Expand/contract controls for practical edge growth.
- Threshold, levels, gamma, and curve shaping dedicated to masks.
- Mask-only preview and overlay preview.
- Generate masks from luminance, alpha, RGB channel, or keyed color distance.

### Backend requirements
The CPU path uses separable kernels and bounded scratch buffers. WebGPU receives dedicated blur/morphology kernels when the image size justifies dispatch; integer/byte semantics remain aligned wherever exact parity is feasible.

Mask processing is represented as a reusable scalar-field pipeline rather than special-casing each consumer.

### Acceptance
- Morphology is correct on synthetic binary fixtures.
- Blur is stable and normalized at edges.
- Mask-only visualization never mutates the underlying graph raster.
- CPU/WebGPU paths remain within defined byte tolerances and never silently diverge.

## v0.16 — batch and production workflows

### Capabilities
- Queue multiple source files against one compiled workflow.
- Per-item status: queued, running, complete, failed, cancelled.
- Global progress plus cancel/retry controls.
- Output filename templates using source stem, index, dimensions, and date-safe tokens.
- PNG/JPEG/WebP output presets and resolution constraints.
- ZIP packaging for browser download without server involvement.

### Scheduler
Batch execution reuses graph compilation and keeps concurrency bounded by memory/CPU policy. It never launches an unbounded worker per file. Cancellation is cooperative between jobs and must release ImageBitmap/Blob resources promptly.

### Acceptance
- 100 synthetic jobs complete without unbounded memory growth.
- One failing item does not abort unrelated queue entries.
- Cancelling queued/running work reaches a terminal state.
- ZIP entries and filename templates are deterministic and collision-safe.

## v0.17 — procedural generators

### Nodes
- Solid color.
- Linear/radial gradient.
- Checkerboard and configurable grid.
- Seeded white noise and fractal value noise.
- Scanlines, stripes, dot matrix, and tile/pixel pattern.
- Voronoi/cellular field.
- CRT starter generator/effect controls.

All generators expose width/height and seed where applicable. Identical parameters must produce identical pixels.

### Acceptance
- Seeded generators are deterministic across repeated renders.
- Generator dimensions obey engine limits.
- Generator roots can feed every existing unary or multi-input node.
- Expensive procedural fields use WebGPU where profitable and deterministic CPU fallback otherwise.

## v0.18 — performance architecture

### Execution planner
- Preserve fast linear plans for simple pipelines.
- Keep DAG memoization for branch/recombine graphs.
- Detect and fuse adjacent point operations.
- Track GPU-resident intermediates across compatible branch segments.
- Insert CPU/GPU synchronization only at true backend boundaries.
- Use semantic stage signatures for incremental invalidation.

### GPU memory and pipeline policy
- Reuse storage buffers through capacity-based pools.
- Cache compute pipelines and prewarm common kernels after idle.
- Avoid readback when a downstream GPU stage can consume the same raster.
- Use adaptive preview resolution during interactive edits; issue a quality render after idle.

### Performance budgets
Targets on a modern discrete GPU are design goals, not correctness gates: <16 ms UI-thread work per interaction; <50 ms typical 1080p preview for point-heavy graphs; <150 ms typical 4K preview after warmup; bounded preview memory below 512 MiB; no leaked GPU buffers/ImageBitmaps after source replacement.

## Cross-cutting UX

- Node search supports keyboard-first insertion.
- Multi-select supports duplicate, delete, align, distribute, group/subgraph, copy, and paste.
- Controls expose reset-to-default without adding permanent explanatory banners.
- Preset/generator/batch surfaces are compact panels that do not obstruct the canvas when closed.
- All modal/panel actions are keyboard reachable and have visible focus treatment.

## Validation matrix

Every release train commit must pass `npm run check` and `git diff --check`. Critical engine changes require focused unit fixtures. Browser smoke must cover WebGPU availability/fallback, graph rendering, new node insertion, and the most important UI interaction for that train.

Release readiness requires:
- zero lint warnings/errors;
- complete TypeScript build;
- all Vitest suites green;
- production Vite build;
- no browser console/page errors in smoke;
- no regression to v0.11 exact mask parity or v0.12 comparison behavior;
- workflow JSON from older storage versions still loads.

## Delivery structure

Implementation uses logically separated commits for v0.13 through v0.18 on one isolated feature train. The final PR may merge the train only after the complete gate is green. Version advances to 0.18.0 when all listed capabilities are present; intermediate commits remain independently bisectable.

## Implementation completion record

Implementation target: `0.18.0`.

- v0.13: subgraphs, exposed controls, nested expansion, built-in/user presets, import/export, and preset validation implemented.
- v0.14: text, six shape families, editable gradients, positioned overlays, anchors, and source abstractions implemented.
- v0.15: advanced mask curves, blur, morphology, signed expansion/contraction, threshold/key selection, previews, and pooled WebGPU field kernels implemented.
- v0.16: bounded batch queue, format/resolution controls, retry/cancel, filename templates, progress, and collision-safe ZIP output implemented.
- v0.17: eleven deterministic procedural generator families implemented with CPU fallback and WebGPU acceleration.
- v0.18: shader prewarm, adaptive two-stage preview, semantic caching, pooled buffers, fused point shaders, GPU-resident generated chains, benchmark tooling, and browser parity coverage implemented.

Release gates require zero lint warnings/errors, the full unit suite, TypeScript and production build success, zero npm audit vulnerabilities, both browser smoke suites, recorded 1080p/4K/8K WebGPU benchmarks, successful GitHub Pages deployment, and a production smoke before the roadmap is considered shipped.
