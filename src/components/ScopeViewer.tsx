import { useEffect, useRef, useState } from 'react';
import type { DensityScopeData, FrameScopes } from '../engine/types';
import { HistogramScope } from './HistogramScope';

type ScopeMode = 'histogram' | 'waveform' | 'vectorscope';

function DensityCanvas({
  data,
  mode,
}: {
  data: DensityScopeData | null;
  mode: 'waveform' | 'vectorscope';
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data) return;
    canvas.width = data.width;
    canvas.height = data.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(data.width, data.height);
    const maxLog = Math.max(1, ...data.bins.map((value) => Math.log1p(value)));
    for (let index = 0; index < data.bins.length; index += 1) {
      const intensity = Math.log1p(data.bins[index]) / maxLog;
      const offset = index * 4;
      if (mode === 'waveform') {
        image.data[offset] = 228;
        image.data[offset + 1] = 236;
        image.data[offset + 2] = 226;
      } else {
        image.data[offset] = 154;
        image.data[offset + 1] = 235;
        image.data[offset + 2] = 177;
      }
      image.data[offset + 3] = Math.round(intensity * 235);
    }
    context.clearRect(0, 0, data.width, data.height);
    context.putImageData(image, 0, 0);
  }, [data, mode]);

  return (
    <canvas
      ref={ref}
      className={`density-scope density-scope--${mode}`}
      aria-label={mode === 'waveform' ? 'Luminance waveform' : 'Color vectorscope'}
    />
  );
}

export function ScopeViewer({ scopes }: { scopes: FrameScopes | null }) {
  const [mode, setMode] = useState<ScopeMode>('histogram');
  const samples = scopes?.histogram.samples ?? 0;

  return (
    <section className="scope-viewer">
      <div className="scope-viewer__header">
        <strong>Scopes</strong>
        <span>{samples ? `${samples.toLocaleString()} samples` : 'Waiting for frame'}</span>
      </div>
      <div className="scope-tabs">
        {(['histogram', 'waveform', 'vectorscope'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={mode === value ? 'active' : ''}
            onClick={() => setMode(value)}
          >
            {value === 'vectorscope' ? 'Vector' : value === 'waveform' ? 'Waveform' : 'Histogram'}
          </button>
        ))}
      </div>
      <div className={`scope-viewer__plot scope-viewer__plot--${mode}`}>
        {mode === 'histogram' && (
          <HistogramScope histogram={scopes?.histogram ?? null} compact />
        )}
        {mode === 'waveform' && (
          <DensityCanvas data={scopes?.waveform ?? null} mode="waveform" />
        )}
        {mode === 'vectorscope' && (
          <>
            <DensityCanvas data={scopes?.vectorscope ?? null} mode="vectorscope" />
            <span className="vectorscope-center" aria-hidden="true" />
            <span className="vectorscope-axis vectorscope-axis--h" aria-hidden="true" />
            <span className="vectorscope-axis vectorscope-axis--v" aria-hidden="true" />
          </>
        )}
      </div>
      {mode === 'waveform' && (
        <div className="scope-labels scope-labels--waveform"><span>100</span><span>50</span><span>0</span></div>
      )}
      {mode === 'vectorscope' && (
        <div className="scope-labels scope-labels--vector"><span>Cb</span><span>Cr</span></div>
      )}
    </section>
  );
}
