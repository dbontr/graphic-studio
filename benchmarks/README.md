# Graphic Studio browser benchmarks

The v0.18 benchmark is a real browser workload executed through the production render worker and WebGPU backend. It exercises a procedural fractal-noise root followed by color adjustment, posterization, and Bayer-8 dithering at 1080p, 4K, and 8K.

Run it with:

```bash
npm run benchmark:browser
```

The runner starts a local Vite server, launches a system Chromium browser with WebGPU enabled, rejects console/WebGPU fallback or validation errors, and writes a JSON report.

## Jupiter v0.18 reference

| Resolution | Interactive wall | Quality wall | Quality GPU compute | Export wall |
| --- | ---: | ---: | ---: | ---: |
| 1080p | 14.1 ms | 22.6 ms | 14.0 ms | 272.9 ms |
| 4K | 11.3 ms | 92.5 ms | 63.8 ms | 1.08 s |
| 8K | 11.4 ms | 293.3 ms | 197.7 ms | 4.37 s |

Interactive 4K and 8K use the adaptive 1333x750 immediate plan, followed by the full-resolution quality pass. The machine-readable reference is `jupiter-v0.18.json`.
