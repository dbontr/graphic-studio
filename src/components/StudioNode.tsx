import {
  CircleDot,
  Crop,
  Download,
  Eye,
  EyeOff,
  Grid3X3,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Palette as PaletteIcon,
  Plus,
  RotateCcw,
  ScanLine,
  X,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ERROR_DIFFUSION_ALGORITHMS,
  effectDefaults,
  type ErrorDiffusionAlgorithm,
  type GradientStop,
  type StudioFlowNode,
} from '../model';
import { useStudio } from '../studio-context';

const kindIcon = {
  source: ImagePlus,
  adjust: SlidersHorizontal,
  curves: TrendingUp,
  blend: Layers,
  mask: CircleDot,
  overlay: Layers,
  text: ImageIcon,
  shape: CircleDot,
  gradient: PaletteIcon,
  generator: Sparkles,
  subgraph: Layers,
  transform: Crop,
  pixelate: Grid3X3,
  posterize: CircleDot,
  palette: PaletteIcon,
  convolution: ScanLine,
  dither: Sparkles,
  output: ImageIcon,
};

function BitmapPreview({
  bitmap,
  ariaLabel = 'Processed output',
  className = '',
  style,
}: {
  bitmap: ImageBitmap;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      className={['preview-canvas', className].filter(Boolean).join(' ')}
      style={style}
    />
  );
}

function ComparisonPreview({
  original,
  result,
  split,
  onSplit,
}: {
  original: ImageBitmap;
  result: ImageBitmap;
  split: number;
  onSplit: (value: number) => void;
}) {
  return (
    <div className="comparison-preview nodrag nowheel">
      <BitmapPreview
        bitmap={original}
        ariaLabel="Original source"
        className="comparison-canvas comparison-canvas--original"
      />
      <BitmapPreview
        bitmap={result}
        ariaLabel="Processed result"
        className="comparison-canvas comparison-canvas--result"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      />
      <span className="comparison-divider" style={{ left: `${split}%` }} aria-hidden="true" />
      <span className="comparison-label comparison-label--original">Original</span>
      <span className="comparison-label comparison-label--result">Result</span>
      <input
        className="comparison-scrubber nodrag nowheel"
        type="range"
        min={0}
        max={100}
        value={split}
        aria-label="Before and after split"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onSplit(Number(event.target.value))}
      />
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onBegin,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onBegin: () => void;
  onChange: (value: number) => void;
}) {
  return (
    <label className="node-control nodrag">
      <span>
        {label}
        <strong>{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onBegin}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorControl({ label, value, onBegin, onChange }: { label: string; value: string; onBegin: () => void; onChange: (value: string) => void }) {
  return (
    <label className="node-color nodrag">
      <span>{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onPointerDown={onBegin} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextControl({ label, value, multiline = false, onBegin, onChange }: { label: string; value: string; multiline?: boolean; onBegin: () => void; onChange: (value: string) => void }) {
  return (
    <label className="node-text-control nodrag">
      <span>{label}</span>
      {multiline ? (
        <textarea value={value} onFocus={onBegin} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input type="text" value={value} onFocus={onBegin} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function GradientStopsEditor({ stops, onBegin, onChange }: { stops: GradientStop[] | undefined; onBegin: () => void; onChange: (stops: GradientStop[]) => void }) {
  const values = (stops?.length ? stops : [{ offset: 0, color: '#111111' }, { offset: 1, color: '#f4f1ea' }]).slice(0, 8);
  return (
    <div className="gradient-stops nodrag">
      <span className="node-section-label">Color stops</span>
      {values.map((stop, index) => (
        <div className="gradient-stop-row" key={`${index}-${stop.offset}`}>
          <input type="color" value={stop.color} onPointerDown={onBegin} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))} />
          <input type="range" min={0} max={100} value={Math.round(stop.offset * 100)} onPointerDown={onBegin} onChange={(event) => onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, offset: Number(event.target.value) / 100 } : item).sort((a, b) => a.offset - b.offset))} />
          <button type="button" disabled={values.length <= 2} onClick={() => { onBegin(); onChange(values.filter((_, itemIndex) => itemIndex !== index)); }}>×</button>
        </div>
      ))}
      <button type="button" className="node-mini-button" disabled={values.length >= 8} onClick={() => { onBegin(); onChange([...values, { offset: 0.5, color: '#888888' }].sort((a, b) => a.offset - b.offset)); }}>+ stop</button>
    </div>
  );
}

const defaultCurve = [0, 64, 128, 192, 255];

function safeCurve(points: number[] | undefined): number[] {
  return defaultCurve.map((fallback, index) => {
    const value = Number(points?.[index] ?? fallback);
    return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : fallback;
  });
}

function CurveEditor({
  points,
  onBegin,
  onChange,
}: {
  points: number[] | undefined;
  onBegin: () => void;
  onChange: (points: number[]) => void;
}) {
  const draggingIndex = useRef<number | null>(null);
  const values = safeCurve(points);
  const polyline = values
    .map((value, index) => `${(defaultCurve[index] / 255) * 100},${100 - (value / 255) * 100}`)
    .join(' ');
  const updatePoint = (index: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.height) return;
    const normalized = 1 - (clientY - rect.top) / rect.height;
    const next = [...values];
    next[index] = Math.round(Math.max(0, Math.min(1, normalized)) * 255);
    onChange(next);
  };

  return (
    <div className="curve-editor nodrag">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label="Tone curve editor"
        onPointerMove={(event) => {
          if (draggingIndex.current === null) return;
          updatePoint(draggingIndex.current, event.clientY, event.currentTarget);
        }}
        onPointerUp={(event) => {
          draggingIndex.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => { draggingIndex.current = null; }}
      >
        {[25, 50, 75].map((value) => (
          <g key={value}>
            <line x1={value} y1="0" x2={value} y2="100" className="curve-grid" />
            <line x1="0" y1={value} x2="100" y2={value} className="curve-grid" />
          </g>
        ))}
        <line x1="0" y1="100" x2="100" y2="0" className="curve-diagonal" />
        <polyline points={polyline} className="curve-line" />
        {values.map((value, index) => (
          <circle
            key={index}
            cx={(defaultCurve[index] / 255) * 100}
            cy={100 - (value / 255) * 100}
            r="3.5"
            className="curve-point"
            onPointerDown={(event) => {
              event.stopPropagation();
              const svg = event.currentTarget.ownerSVGElement;
              if (!svg) return;
              draggingIndex.current = index;
              svg.setPointerCapture(event.pointerId);
              onBegin();
              updatePoint(index, event.clientY, svg);
            }}
          />
        ))}
      </svg>
      <div className="curve-values">
        {values.map((value, index) => <code key={index}>{value}</code>)}
      </div>
    </div>
  );
}

function MultiInputHandles({ kind }: { kind: 'blend' | 'mask' | 'overlay' }) {
  const secondaryId = kind === 'blend' ? 'blend' : kind === 'mask' ? 'mask' : 'overlay';
  return (
    <>
      <Handle
        id="base"
        type="target"
        position={Position.Left}
        className="studio-handle blend-handle blend-handle--base"
      />
      <Handle
        id={secondaryId}
        type="target"
        position={Position.Left}
        className="studio-handle blend-handle blend-handle--layer"
      />
      <span className="blend-port-label blend-port-label--base">A</span>
      <span className="blend-port-label blend-port-label--layer">
        {kind === 'blend' ? 'B' : kind === 'mask' ? 'M' : 'O'}
      </span>
    </>
  );
}

export function StudioNode({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const studio = useStudio();
  const [previewMode, setPreviewMode] = useState<'result' | 'original' | 'split'>('result');
  const [comparisonSplit, setComparisonSplit] = useState(50);
  const Icon = kindIcon[data.kind];
  const update = (patch: Partial<typeof data>) => studio.updateNodeData(id, patch);
  const resetToDefaults = () => {
    if (data.kind === 'source' || data.kind === 'output' || data.kind === 'subgraph') return;
    studio.checkpoint();
    studio.updateNodeData(id, structuredClone(effectDefaults[data.kind]));
  };
  const commit = (patch: Partial<typeof data>) => {
    studio.checkpoint();
    update(patch);
  };
  const customPalette = data.customPalette?.length
    ? data.customPalette.slice(0, 16)
    : ['#111111', '#f4f1ea'];
  const selectedAlgorithm = data.algorithm ?? 'floyd-steinberg';
  const isDiffusion = ERROR_DIFFUSION_ALGORITHMS.has(
    selectedAlgorithm as ErrorDiffusionAlgorithm,
  );
  const isProceduralPattern = selectedAlgorithm === 'halftone-dot'
    || selectedAlgorithm === 'halftone-line'
    || selectedAlgorithm === 'crosshatch';
  const usesPatternScale = isProceduralPattern || selectedAlgorithm === 'cmyk-halftone';
  const curveChannel = data.curveChannel ?? 'master';
  const curveKey = curveChannel === 'red'
    ? 'curveRed'
    : curveChannel === 'green'
      ? 'curveGreen'
      : curveChannel === 'blue'
        ? 'curveBlue'
        : 'curveMaster';
  const activeCurve = data[curveKey] as number[] | undefined;
  const updateCurve = (points: number[]) => update({ [curveKey]: points } as Partial<typeof data>);

  return (
    <section
      className={[
        'studio-node',
        `studio-node--${data.kind}`,
        selected ? 'is-selected' : '',
        data.enabled === false ? 'is-bypassed' : '',
      ].join(' ')}
    >
      {data.kind === 'blend' || data.kind === 'mask' || data.kind === 'overlay' ? (
        <MultiInputHandles kind={data.kind} />
      ) : data.kind !== 'source' && data.kind !== 'text' && data.kind !== 'shape' && data.kind !== 'gradient' && data.kind !== 'generator' ? (
        <Handle type="target" position={Position.Left} className="studio-handle" />
      ) : null}

      <header className="node-header">
        <span className="node-icon"><Icon size={14} /></span>
        <div className="node-heading-copy">
          <p>{data.label}</p>
          <span>{data.kind}</span>
        </div>
        {data.kind !== 'source' && data.kind !== 'output' && data.kind !== 'subgraph' && (
          <button
            className="node-reset nodrag"
            type="button"
            title="Reset node to defaults"
            aria-label="Reset node to defaults"
            onClick={resetToDefaults}
          >
            <RotateCcw size={12} />
          </button>
        )}
        {data.kind !== 'source' && data.kind !== 'output' && data.kind !== 'text' && data.kind !== 'shape' && data.kind !== 'gradient' && data.kind !== 'generator' && (
          <button
            className="node-bypass nodrag"
            type="button"
            title={data.enabled === false ? 'Enable node' : 'Bypass node'}
            aria-label={data.enabled === false ? 'Enable node' : 'Bypass node'}
            onClick={() => commit({ enabled: data.enabled === false })}
          >
            {data.enabled === false ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </header>

      {data.kind === 'source' && (
        <div className="node-body">
          <label className="upload-drop nodrag">
            <ImagePlus size={18} />
            <span>Choose image</span>
            <small>{data.fileName || 'Demo image active'}</small>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) studio.uploadSource(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      )}

      {data.kind === 'adjust' && (
        <div className="node-body">
          <RangeControl
            label="Exposure"
            value={Number(data.exposure ?? 0)}
            min={-3}
            max={3}
            step={0.1}
            unit=" EV"
            onBegin={studio.checkpoint}
            onChange={(exposure) => update({ exposure })}
          />
          <RangeControl
            label="Brightness"
            value={Number(data.brightness ?? 0)}
            min={-100}
            max={100}
            onBegin={studio.checkpoint}
            onChange={(brightness) => update({ brightness })}
          />
          <RangeControl
            label="Contrast"
            value={Number(data.contrast ?? 0)}
            min={-100}
            max={100}
            onBegin={studio.checkpoint}
            onChange={(contrast) => update({ contrast })}
          />
          <RangeControl
            label="Saturation"
            value={Number(data.saturation ?? 100)}
            min={0}
            max={250}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(saturation) => update({ saturation })}
          />
          <RangeControl
            label="Gamma"
            value={Number(data.gamma ?? 1)}
            min={0.2}
            max={3}
            step={0.05}
            onBegin={studio.checkpoint}
            onChange={(gamma) => update({ gamma })}
          />
          <RangeControl
            label="Temperature"
            value={Number(data.temperature ?? 0)}
            min={-100}
            max={100}
            onBegin={studio.checkpoint}
            onChange={(temperature) => update({ temperature })}
          />
          <RangeControl
            label="Tint"
            value={Number(data.tint ?? 0)}
            min={-100}
            max={100}
            onBegin={studio.checkpoint}
            onChange={(tint) => update({ tint })}
          />
        </div>
      )}

      {data.kind === 'curves' && (
        <div className="node-body curves-body">
          <div className="segmented curve-channel-tabs nodrag">
            {(['master', 'red', 'green', 'blue'] as const).map((channel) => (
              <button
                key={channel}
                type="button"
                className={curveChannel === channel ? 'active' : ''}
                onClick={() => update({ curveChannel: channel })}
              >
                {channel === 'master' ? 'Master' : channel[0].toUpperCase()}
              </button>
            ))}
          </div>
          <CurveEditor
            points={activeCurve}
            onBegin={studio.checkpoint}
            onChange={updateCurve}
          />
          <div className="curve-actions nodrag">
            <span>Black · shadows · mid · highlights · white</span>
            <button
              type="button"
              onClick={() => commit({ [curveKey]: [...defaultCurve] } as Partial<typeof data>)}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {data.kind === 'blend' && (
        <div className="node-body blend-body">
          <div className="blend-input-key nodrag">
            <span><i>A</i> Base</span>
            <span><i>B</i> Blend layer</span>
          </div>
          <label className="node-select nodrag">
            <span>Blend mode</span>
            <select
              value={data.blendMode ?? 'normal'}
              onChange={(event) => commit({ blendMode: event.target.value as typeof data.blendMode })}
            >
              <option value="normal">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
              <option value="soft-light">Soft light</option>
              <option value="hard-light">Hard light</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
              <option value="difference">Difference</option>
              <option value="exclusion">Exclusion</option>
              <option value="add">Add</option>
              <option value="subtract">Subtract</option>
            </select>
          </label>
          <RangeControl
            label="Opacity"
            value={Number(data.opacity ?? 100)}
            min={0}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(opacity) => update({ opacity })}
          />
          <p className="blend-note">B is normalized to A's canvas when branch geometry differs.</p>
        </div>
      )}

      {data.kind === 'overlay' && (
        <div className="node-body blend-body">
          <div className="blend-input-key nodrag"><span><i>A</i> Base</span><span><i>O</i> Overlay</span></div>
          <label className="node-select nodrag"><span>Blend mode</span><select value={data.overlayBlendMode ?? 'normal'} onChange={(event) => commit({ overlayBlendMode: event.target.value as typeof data.overlayBlendMode })}>
            <option value="normal">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option><option value="hard-light">Hard light</option><option value="darken">Darken</option><option value="lighten">Lighten</option><option value="difference">Difference</option><option value="exclusion">Exclusion</option><option value="add">Add</option><option value="subtract">Subtract</option>
          </select></label>
          <RangeControl label="X" value={Number(data.overlayX ?? 0)} min={-2048} max={2048} unit=" px" onBegin={studio.checkpoint} onChange={(overlayX) => update({ overlayX })} />
          <RangeControl label="Y" value={Number(data.overlayY ?? 0)} min={-2048} max={2048} unit=" px" onBegin={studio.checkpoint} onChange={(overlayY) => update({ overlayY })} />
          <RangeControl label="Scale" value={Number(data.overlayScale ?? 100)} min={1} max={500} unit="%" onBegin={studio.checkpoint} onChange={(overlayScale) => update({ overlayScale })} />
          <RangeControl label="Rotation" value={Number(data.overlayRotation ?? 0)} min={-180} max={180} unit="°" onBegin={studio.checkpoint} onChange={(overlayRotation) => update({ overlayRotation })} />
          <RangeControl label="Anchor X" value={Number(data.overlayAnchorX ?? 50)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(overlayAnchorX) => update({ overlayAnchorX })} />
          <RangeControl label="Anchor Y" value={Number(data.overlayAnchorY ?? 50)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(overlayAnchorY) => update({ overlayAnchorY })} />
          <RangeControl label="Opacity" value={Number(data.overlayOpacity ?? 100)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(overlayOpacity) => update({ overlayOpacity })} />
        </div>
      )}

      {data.kind === 'mask' && (
        <div className="node-body blend-body mask-body">
          <div className="blend-input-key nodrag">
            <span><i>A</i> Base</span>
            <span><i>M</i> Mask source</span>
          </div>
          <label className="node-select nodrag">
            <span>Mask channel</span>
            <select
              value={data.maskChannel ?? 'luminance'}
              onChange={(event) => commit({ maskChannel: event.target.value as typeof data.maskChannel })}
            >
              <option value="luminance">Luminance</option>
              <option value="alpha">Alpha</option>
              <option value="red">Red</option>
              <option value="green">Green</option>
              <option value="blue">Blue</option>
            </select>
          </label>
          <RangeControl
            label="Strength"
            value={Number(data.maskStrength ?? 100)}
            min={0}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskStrength) => update({ maskStrength })}
          />
          <RangeControl
            label="Feather"
            value={Number(data.maskFeather ?? 0)}
            min={0}
            max={64}
            unit=" px"
            onBegin={studio.checkpoint}
            onChange={(maskFeather) => update({ maskFeather })}
          />
          <RangeControl
            label="Black point"
            value={Number(data.maskBlackPoint ?? 0)}
            min={0}
            max={99}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskBlackPoint) => update({
              maskBlackPoint: Math.min(maskBlackPoint, Number(data.maskWhitePoint ?? 100) - 1),
            })}
          />
          <RangeControl
            label="White point"
            value={Number(data.maskWhitePoint ?? 100)}
            min={1}
            max={100}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(maskWhitePoint) => update({
              maskWhitePoint: Math.max(maskWhitePoint, Number(data.maskBlackPoint ?? 0) + 1),
            })}
          />
          <RangeControl
            label="Mask gamma"
            value={Number(data.maskGamma ?? 1)}
            min={0.2}
            max={4}
            step={0.05}
            onBegin={studio.checkpoint}
            onChange={(maskGamma) => update({ maskGamma })}
          />
          <RangeControl label="Gaussian blur" value={Number(data.maskBlurRadius ?? 0)} min={0} max={64} unit=" px" onBegin={studio.checkpoint} onChange={(maskBlurRadius) => update({ maskBlurRadius })} />
          <label className="node-select nodrag"><span>Morphology</span><select value={data.maskMorphology ?? 'none'} onChange={(event) => commit({ maskMorphology: event.target.value as typeof data.maskMorphology })}>
            <option value="none">None</option><option value="dilate">Dilate / expand</option><option value="erode">Erode / contract</option><option value="open">Open</option><option value="close">Close</option>
          </select></label>
          {(data.maskMorphology ?? 'none') !== 'none' && <RangeControl label="Morph radius" value={Number(data.maskMorphRadius ?? 0)} min={0} max={64} unit=" px" onBegin={studio.checkpoint} onChange={(maskMorphRadius) => update({ maskMorphRadius })} />}
          <RangeControl label="Expand / contract" value={Number(data.maskExpand ?? 0)} min={-64} max={64} unit=" px" onBegin={studio.checkpoint} onChange={(maskExpand) => update({ maskExpand })} />
          <p className="node-section-label">Mask curve</p>
          <CurveEditor points={data.maskCurve} onBegin={studio.checkpoint} onChange={(maskCurve) => update({ maskCurve })} />
          <div className="curve-actions nodrag">
            <span>Black · shadows · mid · highlights · white</span>
            <button type="button" onClick={() => commit({ maskCurve: [...defaultCurve] })}>Reset</button>
          </div>
          <RangeControl label="Threshold" value={Number(data.maskThreshold ?? 0)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(maskThreshold) => update({ maskThreshold })} />
          <ColorControl label="Key color" value={String(data.maskKeyColor ?? '#ffffff')} onBegin={studio.checkpoint} onChange={(maskKeyColor) => update({ maskKeyColor })} />
          <RangeControl label="Key tolerance" value={Number(data.maskKeyTolerance ?? 0)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(maskKeyTolerance) => update({ maskKeyTolerance })} />
          <div className="segmented nodrag mask-preview-tabs">
            {(['result', 'mask', 'overlay'] as const).map((mode) => <button key={mode} type="button" className={(data.maskPreview ?? 'result') === mode ? 'active' : ''} onClick={() => commit({ maskPreview: mode })}>{mode}</button>)}
          </div>
          <div className="segmented nodrag">
            <button
              className={data.maskInvert ? 'active' : ''}
              type="button"
              onClick={() => commit({ maskInvert: !data.maskInvert })}
            >
              Invert mask
            </button>
          </div>
          <p className="blend-note">M is normalized to A's canvas and modulates A's alpha.</p>
        </div>
      )}

      {data.kind === 'text' && (
        <div className="node-body generator-body">
          <TextControl label="Text" value={String(data.textContent ?? 'Graphic Studio')} multiline onBegin={studio.checkpoint} onChange={(textContent) => update({ textContent })} />
          <TextControl label="Font family" value={String(data.fontFamily ?? 'Inter, Arial, sans-serif')} onBegin={studio.checkpoint} onChange={(fontFamily) => update({ fontFamily })} />
          <RangeControl label="Width" value={Number(data.canvasWidth ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasWidth) => update({ canvasWidth })} />
          <RangeControl label="Height" value={Number(data.canvasHeight ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasHeight) => update({ canvasHeight })} />
          <RangeControl label="Font size" value={Number(data.fontSize ?? 96)} min={4} max={512} unit=" px" onBegin={studio.checkpoint} onChange={(fontSize) => update({ fontSize })} />
          <RangeControl label="Weight" value={Number(data.fontWeight ?? 700)} min={100} max={900} step={100} onBegin={studio.checkpoint} onChange={(fontWeight) => update({ fontWeight })} />
          <RangeControl label="Tracking" value={Number(data.letterSpacing ?? 0)} min={-20} max={100} unit=" px" onBegin={studio.checkpoint} onChange={(letterSpacing) => update({ letterSpacing })} />
          <RangeControl label="Line height" value={Number(data.lineHeight ?? 1.2)} min={0.5} max={3} step={0.05} onBegin={studio.checkpoint} onChange={(lineHeight) => update({ lineHeight })} />
          <div className="segmented nodrag">{(['left', 'center', 'right'] as const).map((align) => <button key={align} type="button" className={(data.textAlign ?? 'center') === align ? 'active' : ''} onClick={() => commit({ textAlign: align })}>{align}</button>)}</div>
          <ColorControl label="Fill" value={String(data.fillColor ?? '#ffffff')} onBegin={studio.checkpoint} onChange={(fillColor) => update({ fillColor })} />
          <ColorControl label="Stroke" value={String(data.strokeColor ?? '#000000')} onBegin={studio.checkpoint} onChange={(strokeColor) => update({ strokeColor })} />
          <RangeControl label="Stroke width" value={Number(data.strokeWidth ?? 0)} min={0} max={64} unit=" px" onBegin={studio.checkpoint} onChange={(strokeWidth) => update({ strokeWidth })} />
          <RangeControl label="Opacity" value={Number(data.textOpacity ?? 100)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(textOpacity) => update({ textOpacity })} />
        </div>
      )}

      {data.kind === 'shape' && (
        <div className="node-body generator-body">
          <label className="node-select nodrag"><span>Shape</span><select value={data.shapeType ?? 'rectangle'} onChange={(event) => commit({ shapeType: event.target.value as typeof data.shapeType })}><option value="rectangle">Rectangle</option><option value="rounded-rectangle">Rounded rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option><option value="triangle">Triangle</option><option value="polygon">Polygon</option></select></label>
          <RangeControl label="Width" value={Number(data.canvasWidth ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasWidth) => update({ canvasWidth })} />
          <RangeControl label="Height" value={Number(data.canvasHeight ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasHeight) => update({ canvasHeight })} />
          {(data.shapeType ?? 'rectangle') === 'rounded-rectangle' && <RangeControl label="Corner radius" value={Number(data.cornerRadius ?? 64)} min={0} max={512} unit=" px" onBegin={studio.checkpoint} onChange={(cornerRadius) => update({ cornerRadius })} />}
          {(data.shapeType ?? 'rectangle') === 'polygon' && <RangeControl label="Sides" value={Number(data.polygonSides ?? 6)} min={3} max={16} onBegin={studio.checkpoint} onChange={(polygonSides) => update({ polygonSides })} />}
          <ColorControl label="Fill" value={String(data.fillColor ?? '#ffffff')} onBegin={studio.checkpoint} onChange={(fillColor) => update({ fillColor })} />
          <ColorControl label="Stroke" value={String(data.strokeColor ?? '#000000')} onBegin={studio.checkpoint} onChange={(strokeColor) => update({ strokeColor })} />
          <RangeControl label="Stroke width" value={Number(data.shapeLineWidth ?? 0)} min={0} max={128} unit=" px" onBegin={studio.checkpoint} onChange={(shapeLineWidth) => update({ shapeLineWidth })} />
          <RangeControl label="Opacity" value={Number(data.textOpacity ?? 100)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(textOpacity) => update({ textOpacity })} />
        </div>
      )}

      {data.kind === 'gradient' && (
        <div className="node-body generator-body">
          <label className="node-select nodrag"><span>Gradient</span><select value={data.gradientType ?? 'linear'} onChange={(event) => commit({ gradientType: event.target.value as typeof data.gradientType })}><option value="linear">Linear</option><option value="radial">Radial</option></select></label>
          <RangeControl label="Width" value={Number(data.canvasWidth ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasWidth) => update({ canvasWidth })} />
          <RangeControl label="Height" value={Number(data.canvasHeight ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasHeight) => update({ canvasHeight })} />
          {(data.gradientType ?? 'linear') === 'linear' ? <RangeControl label="Angle" value={Number(data.gradientAngle ?? 0)} min={-180} max={180} unit="°" onBegin={studio.checkpoint} onChange={(gradientAngle) => update({ gradientAngle })} /> : <>
            <RangeControl label="Center X" value={Number(data.gradientCenterX ?? 50)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(gradientCenterX) => update({ gradientCenterX })} />
            <RangeControl label="Center Y" value={Number(data.gradientCenterY ?? 50)} min={0} max={100} unit="%" onBegin={studio.checkpoint} onChange={(gradientCenterY) => update({ gradientCenterY })} />
            <RangeControl label="Radius" value={Number(data.gradientRadius ?? 70)} min={1} max={200} unit="%" onBegin={studio.checkpoint} onChange={(gradientRadius) => update({ gradientRadius })} />
          </>}
          <GradientStopsEditor stops={data.gradientStops} onBegin={studio.checkpoint} onChange={(gradientStops) => update({ gradientStops })} />
        </div>
      )}

      {data.kind === 'generator' && (
        <div className="node-body generator-body">
          <label className="node-select nodrag"><span>Generator</span><select value={data.generatorType ?? 'checkerboard'} onChange={(event) => commit({ generatorType: event.target.value as typeof data.generatorType })}><option value="solid">Solid</option><option value="checkerboard">Checkerboard</option><option value="grid">Grid</option><option value="noise">White noise</option><option value="fractal-noise">Fractal noise</option><option value="scanlines">Scanlines</option><option value="stripes">Stripes</option><option value="dot-matrix">Dot matrix</option><option value="tile">Tile</option><option value="voronoi">Voronoi</option><option value="crt">CRT</option></select></label>
          <RangeControl label="Width" value={Number(data.canvasWidth ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasWidth) => update({ canvasWidth })} />
          <RangeControl label="Height" value={Number(data.canvasHeight ?? 1024)} min={64} max={4096} unit=" px" onBegin={studio.checkpoint} onChange={(canvasHeight) => update({ canvasHeight })} />
          <ColorControl label="Color A" value={String(data.generatorColorA ?? '#111111')} onBegin={studio.checkpoint} onChange={(generatorColorA) => update({ generatorColorA })} />
          <ColorControl label="Color B" value={String(data.generatorColorB ?? '#f4f1ea')} onBegin={studio.checkpoint} onChange={(generatorColorB) => update({ generatorColorB })} />
          <RangeControl label="Scale" value={Number(data.generatorScale ?? 32)} min={1} max={512} unit=" px" onBegin={studio.checkpoint} onChange={(generatorScale) => update({ generatorScale })} />
          <RangeControl label="Seed" value={Number(data.generatorSeed ?? 1)} min={0} max={9999} onBegin={studio.checkpoint} onChange={(generatorSeed) => update({ generatorSeed })} />
          <RangeControl label="Octaves" value={Number(data.generatorOctaves ?? 4)} min={1} max={8} onBegin={studio.checkpoint} onChange={(generatorOctaves) => update({ generatorOctaves })} />
          <RangeControl label="Intensity" value={Number(data.generatorIntensity ?? 100)} min={0} max={200} unit="%" onBegin={studio.checkpoint} onChange={(generatorIntensity) => update({ generatorIntensity })} />
        </div>
      )}

      {data.kind === 'subgraph' && data.subgraph && (
        <div className="node-body subgraph-body">
          <p className="subgraph-summary">{data.subgraph.nodes.length} nodes · {data.subgraph.bindings.length} exposed parameters</p>
          <details className="subgraph-inspector nodrag nowheel">
            <summary>Inspect internal graph</summary>
            <div className="subgraph-inspector-list">
              {data.subgraph.nodes.map((node) => (
                <div key={node.id}>
                  <strong>{node.data.label}</strong>
                  <span>{node.data.kind}</span>
                </div>
              ))}
            </div>
            <small>{data.subgraph.edges.length} internal connections · input {data.subgraph.inputNodeId} · output {data.subgraph.outputNodeId}</small>
          </details>
          {data.subgraph.bindings.slice(0, 24).map((binding) => {
            const value = data.subgraphValues?.[binding.key];
            if (binding.valueType === 'number') return <RangeControl key={binding.key} label={binding.label} value={Number(value ?? 0)} min={binding.min ?? -255} max={binding.max ?? 255} step={binding.step ?? 1} onBegin={studio.checkpoint} onChange={(next) => update({ subgraphValues: { ...(data.subgraphValues ?? {}), [binding.key]: next } })} />;
            if (binding.valueType === 'color') return <ColorControl key={binding.key} label={binding.label} value={String(value ?? '#ffffff')} onBegin={studio.checkpoint} onChange={(next) => update({ subgraphValues: { ...(data.subgraphValues ?? {}), [binding.key]: next } })} />;
            if (binding.valueType === 'boolean') return <button key={binding.key} type="button" className={`node-mini-button nodrag ${value ? 'active' : ''}`} onClick={() => commit({ subgraphValues: { ...(data.subgraphValues ?? {}), [binding.key]: !value } })}>{binding.label}</button>;
            return <TextControl key={binding.key} label={binding.label} value={String(value ?? '')} onBegin={studio.checkpoint} onChange={(next) => update({ subgraphValues: { ...(data.subgraphValues ?? {}), [binding.key]: next } })} />;
          })}
        </div>
      )}

      {data.kind === 'transform' && (
        <div className="node-body">
          <label className="node-select nodrag">
            <span>Rotation</span>
            <select
              value={Number(data.rotation ?? 0)}
              onChange={(event) => commit({
                rotation: Number(event.target.value) as typeof data.rotation,
              })}
            >
              <option value={0}>0°</option>
              <option value={90}>90° clockwise</option>
              <option value={180}>180°</option>
              <option value={270}>270° clockwise</option>
            </select>
          </label>
          <div className="segmented transform-flips nodrag">
            <button
              className={data.flipX ? 'active' : ''}
              type="button"
              onClick={() => commit({ flipX: !data.flipX })}
            >
              Flip X
            </button>
            <button
              className={data.flipY ? 'active' : ''}
              type="button"
              onClick={() => commit({ flipY: !data.flipY })}
            >
              Flip Y
            </button>
          </div>
          <RangeControl
            label="Scale"
            value={Number(data.scale ?? 100)}
            min={10}
            max={200}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(scale) => update({ scale })}
          />
          <label className="node-select nodrag">
            <span>Resampling</span>
            <select
              value={data.resample ?? 'bilinear'}
              onChange={(event) => commit({
                resample: event.target.value as typeof data.resample,
              })}
            >
              <option value="bilinear">Bilinear</option>
              <option value="nearest">Nearest · pixel art</option>
            </select>
          </label>
          <p className="node-section-label">Crop edges</p>
          <RangeControl
            label="Left"
            value={Number(data.cropLeft ?? 0)}
            min={0}
            max={45}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(cropLeft) => update({ cropLeft })}
          />
          <RangeControl
            label="Right"
            value={Number(data.cropRight ?? 0)}
            min={0}
            max={45}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(cropRight) => update({ cropRight })}
          />
          <RangeControl
            label="Top"
            value={Number(data.cropTop ?? 0)}
            min={0}
            max={45}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(cropTop) => update({ cropTop })}
          />
          <RangeControl
            label="Bottom"
            value={Number(data.cropBottom ?? 0)}
            min={0}
            max={45}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(cropBottom) => update({ cropBottom })}
          />
        </div>
      )}

      {data.kind === 'pixelate' && (
        <div className="node-body">
          <RangeControl
            label="Block size"
            value={Number(data.pixelSize ?? 8)}
            min={1}
            max={128}
            unit="px"
            onBegin={studio.checkpoint}
            onChange={(pixelSize) => update({ pixelSize })}
          />
        </div>
      )}

      {data.kind === 'posterize' && (
        <div className="node-body">
          <RangeControl
            label="Color levels"
            value={Number(data.levels ?? 5)}
            min={2}
            max={32}
            onBegin={studio.checkpoint}
            onChange={(levels) => update({ levels })}
          />
        </div>
      )}

      {data.kind === 'palette' && (
        <div className="node-body">
          <label className="node-select nodrag">
            <span>Palette</span>
            <select
              value={data.palette ?? 'gameboy'}
              onChange={(event) => commit({ palette: event.target.value as typeof data.palette })}
            >
              <option value="gameboy">Game Boy</option>
              <option value="pico8">PICO-8</option>
              <option value="cga">CGA</option>
              <option value="mono">Monochrome</option>
              <option value="grayscale-4">Grayscale · 4</option>
              <option value="grayscale-8">Grayscale · 8</option>
              <option value="custom">Custom palette</option>
            </select>
          </label>
          {data.palette === 'custom' && (
            <>
              <div className="custom-palette nodrag">
                {customPalette.map((color, index) => (
                  <div className="custom-color" key={index}>
                    <input
                      type="color"
                      value={color}
                      aria-label={'Palette color ' + (index + 1)}
                      onPointerDown={studio.checkpoint}
                      onChange={(event) => {
                        const colors = [...customPalette];
                        colors[index] = event.target.value;
                        update({ customPalette: colors });
                      }}
                    />
                    <code>{color.toUpperCase()}</code>
                    <button
                      type="button"
                      aria-label={'Remove palette color ' + (index + 1)}
                      disabled={customPalette.length <= 2}
                      onClick={() => commit({
                        customPalette: customPalette.filter((_, colorIndex) => colorIndex !== index),
                      })}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="palette-actions nodrag">
                <button
                  type="button"
                  onClick={() => {
                    void studio.extractPalette(8)
                      .then((colors) => {
                        studio.checkpoint();
                        update({ customPalette: colors });
                      })
                      .catch(() => undefined);
                  }}
                >
                  <Sparkles size={11} />
                  Extract 8
                </button>
                <button
                  type="button"
                  disabled={customPalette.length >= 16}
                  onClick={() => commit({ customPalette: [...customPalette, '#808080'] })}
                >
                  <Plus size={11} />
                  Add
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {data.kind === 'convolution' && (
        <div className="node-body">
          <label className="node-select nodrag">
            <span>Kernel</span>
            <select
              value={data.convolution ?? 'sharpen'}
              onChange={(event) => commit({ convolution: event.target.value as typeof data.convolution })}
            >
              <option value="blur">Blur 3×3</option>
              <option value="sharpen">Sharpen</option>
              <option value="edge">Edge detect</option>
              <option value="emboss">Emboss</option>
            </select>
          </label>
          <RangeControl
            label="Strength"
            value={Number(data.strength ?? 100)}
            min={0}
            max={200}
            unit="%"
            onBegin={studio.checkpoint}
            onChange={(strength) => update({ strength })}
          />
        </div>
      )}

      {data.kind === 'dither' && (
        <div className="node-body">
          <label className="node-select nodrag">
            <span>Algorithm</span>
            <select
              value={data.algorithm ?? 'floyd-steinberg'}
              onChange={(event) => commit({ algorithm: event.target.value as typeof data.algorithm })}
            >
              <optgroup label="Error diffusion · CPU worker">
                <option value="floyd-steinberg">Floyd–Steinberg</option>
                <option value="false-floyd-steinberg">False Floyd–Steinberg</option>
                <option value="atkinson">Atkinson</option>
                <option value="jarvis-judice-ninke">Jarvis–Judice–Ninke</option>
                <option value="stucki">Stucki</option>
                <option value="burkes">Burkes</option>
                <option value="sierra">Sierra 3</option>
                <option value="two-row-sierra">Two-row Sierra</option>
                <option value="sierra-lite">Sierra Lite</option>
                <option value="stevenson-arce">Stevenson–Arce</option>
                <option value="fan">Fan</option>
                <option value="shiau-fan">Shiau–Fan</option>
                <option value="shiau-fan-2">Shiau–Fan 2</option>
                <option value="simple-2d">Simple 2D</option>
              </optgroup>
              <optgroup label="Ordered + pattern · WebGPU">
                <option value="bayer-2">Bayer 2×2</option>
                <option value="bayer-4">Bayer 4×4</option>
                <option value="bayer-8">Bayer 8×8</option>
                <option value="blue-noise-32">Blue noise 32×32</option>
                <option value="clustered-4">Clustered dot 4×4</option>
                <option value="halftone-dot">Halftone dots</option>
                <option value="halftone-line">Halftone lines</option>
                <option value="crosshatch">Crosshatch</option>
                <option value="cmyk-halftone">CMYK halftone</option>
                <option value="noise">Noise</option>
                <option value="threshold">Threshold</option>
              </optgroup>
            </select>
          </label>
          <RangeControl
            label="Threshold"
            value={Number(data.threshold ?? 128)}
            min={1}
            max={254}
            onBegin={studio.checkpoint}
            onChange={(threshold) => update({ threshold })}
          />
          {isDiffusion && (
            <>
              <RangeControl
                label="Error strength"
                value={Number(data.diffusionStrength ?? 100)}
                min={0}
                max={160}
                unit="%"
                onBegin={studio.checkpoint}
                onChange={(diffusionStrength) => update({ diffusionStrength })}
              />
              <div className="segmented nodrag dither-scan-mode">
                <button
                  className={data.serpentine !== false ? 'active' : ''}
                  type="button"
                  onClick={() => commit({ serpentine: true })}
                >
                  Serpentine
                </button>
                <button
                  className={data.serpentine === false ? 'active' : ''}
                  type="button"
                  onClick={() => commit({ serpentine: false })}
                >
                  Raster
                </button>
              </div>
            </>
          )}
          {usesPatternScale && (
            <RangeControl
              label="Pattern size"
              value={Number(data.patternScale ?? 8)}
              min={2}
              max={48}
              unit="px"
              onBegin={studio.checkpoint}
              onChange={(patternScale) => update({ patternScale })}
            />
          )}
          {isProceduralPattern && (
            <RangeControl
              label="Angle"
              value={Number(data.angle ?? 45)}
              min={-90}
              max={90}
              unit="°"
              onBegin={studio.checkpoint}
              onChange={(angle) => update({ angle })}
            />
          )}
          {data.algorithm === 'noise' && (
            <RangeControl
              label="Seed"
              value={Number(data.seed ?? 1)}
              min={0}
              max={999}
              onBegin={studio.checkpoint}
              onChange={(seed) => update({ seed })}
            />
          )}
          <div className="segmented nodrag">
            <button
              className={data.monochrome !== false ? 'active' : ''}
              onClick={() => commit({ monochrome: true })}
              type="button"
            >
              Mono
            </button>
            <button
              className={data.monochrome === false ? 'active' : ''}
              onClick={() => commit({ monochrome: false })}
              type="button"
            >
              RGB
            </button>
          </div>
        </div>
      )}

      {data.kind === 'output' && (
        <div className="node-body preview-body">
          <div className={studio.rendering ? 'preview-frame is-rendering' : 'preview-frame'}>
            {studio.outputBitmap ? (
              previewMode === 'original' && studio.sourceBitmap ? (
                <BitmapPreview bitmap={studio.sourceBitmap} ariaLabel="Original source" />
              ) : previewMode === 'split' && studio.sourceBitmap ? (
                <ComparisonPreview
                  original={studio.sourceBitmap}
                  result={studio.outputBitmap}
                  split={comparisonSplit}
                  onSplit={setComparisonSplit}
                />
              ) : (
                <BitmapPreview bitmap={studio.outputBitmap} />
              )
            ) : (
              <div className="preview-empty">Preparing render engine…</div>
            )}
            {studio.rendering && <span className="preview-rendering">Rendering</span>}
          </div>
          <footer className="preview-footer">
            <div className="preview-meta">
              <strong>{previewMode === 'original' ? 'Original' : previewMode === 'split' ? 'Compare' : 'Result'}</strong>
              <span>{studio.outputMeta}</span>
            </div>
            <div className="preview-footer-actions nodrag">
              <div className="preview-mode-switch" role="group" aria-label="Preview comparison mode">
                {(['result', 'original', 'split'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={previewMode === mode ? 'active' : ''}
                    disabled={mode !== 'result' && !studio.sourceBitmap}
                    onClick={() => setPreviewMode(mode)}
                  >
                    {mode === 'result' ? 'Result' : mode === 'original' ? 'Original' : 'Split'}
                  </button>
                ))}
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Export full-resolution PNG"
                title="Export full-resolution PNG"
                onClick={studio.exportOutput}
              >
                <Download size={15} />
              </button>
            </div>
          </footer>
        </div>
      )}

      {data.kind !== 'output' && (
        <Handle type="source" position={Position.Right} className="studio-handle" />
      )}
    </section>
  );
}
