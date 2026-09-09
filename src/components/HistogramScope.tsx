import type { HistogramData } from '../engine/types';

function pointsFor(values: number[], maxLog: number): string {
  if (!values.length || maxLog <= 0) return '';
  return values
    .map((value, index) => {
      const y = 92 - (Math.log1p(value) / maxLog) * 84;
      return `${index},${y.toFixed(2)}`;
    })
    .join(' ');
}

function areaFor(values: number[], maxLog: number): string {
  const points = pointsFor(values, maxLog);
  return points ? `0,96 ${points} 255,96` : '';
}

export function HistogramScope({ histogram }: { histogram: HistogramData | null }) {
  const values = histogram
    ? [...histogram.red, ...histogram.green, ...histogram.blue, ...histogram.luminance]
    : [];
  const maxLog = values.length ? Math.max(...values.map((value) => Math.log1p(value))) : 1;

  return (
    <div className="histogram-scope">
      <div className="histogram-scope__title">
        <strong>Histogram</strong>
        <span>{histogram ? `${histogram.samples.toLocaleString()} samples` : 'Waiting for frame'}</span>
      </div>
      <svg viewBox="0 0 256 96" preserveAspectRatio="none" aria-label="RGB and luminance histogram">
        {[64, 128, 192].map((x) => (
          <line key={`x-${x}`} x1={x} y1="0" x2={x} y2="96" className="histogram-grid" />
        ))}
        {[24, 48, 72].map((y) => (
          <line key={`y-${y}`} x1="0" y1={y} x2="256" y2={y} className="histogram-grid" />
        ))}
        {histogram && (
          <>
            <polygon
              points={areaFor(histogram.luminance, maxLog)}
              className="histogram-area histogram-luma"
            />
            <polyline points={pointsFor(histogram.red, maxLog)} className="histogram-line histogram-red" />
            <polyline points={pointsFor(histogram.green, maxLog)} className="histogram-line histogram-green" />
            <polyline points={pointsFor(histogram.blue, maxLog)} className="histogram-line histogram-blue" />
          </>
        )}
      </svg>
      <div className="histogram-axis">
        <span>Shadows</span>
        <span>Midtones</span>
        <span>Highlights</span>
      </div>
    </div>
  );
}
