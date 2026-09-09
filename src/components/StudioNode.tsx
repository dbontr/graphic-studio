import {
  Download,
  ImagePlus,
  SlidersHorizontal,
  Sparkles,
  Grid3X3,
  CircleDot,
  Image as ImageIcon,
} from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StudioFlowNode } from '../model';
import { useStudio } from '../studio-context';

const kindIcon = {
  source: ImagePlus,
  adjust: SlidersHorizontal,
  pixelate: Grid3X3,
  posterize: CircleDot,
  dither: Sparkles,
  output: ImageIcon,
};

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="node-control nodrag">
      <span>
        {label}
        <strong>{value}{unit}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function StudioNode({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const studio = useStudio();
  const Icon = kindIcon[data.kind];
  const update = (patch: Partial<typeof data>) => studio.updateNodeData(id, patch);

  return (
    <section
      className={[
        'studio-node',
        `studio-node--${data.kind}`,
        selected ? 'is-selected' : '',
      ].join(' ')}
    >
      {data.kind !== 'source' && (
        <Handle type="target" position={Position.Left} className="studio-handle" />
      )}

      <header className="node-header">
        <span className="node-icon"><Icon size={14} /></span>
        <div>
          <p>{data.label}</p>
          <span>{data.kind}</span>
        </div>
      </header>

      {data.kind === 'source' && (
        <div className="node-body">
          <label className="upload-drop nodrag">
            <ImagePlus size={18} />
            <span>Choose image</span>
            <small>{data.fileName || 'Demo gradient active'}</small>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
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
            label="Brightness"
            value={Number(data.brightness ?? 0)}
            min={-100}
            max={100}
            onChange={(brightness) => update({ brightness })}
          />
          <RangeControl
            label="Contrast"
            value={Number(data.contrast ?? 0)}
            min={-100}
            max={100}
            onChange={(contrast) => update({ contrast })}
          />
          <RangeControl
            label="Saturation"
            value={Number(data.saturation ?? 100)}
            min={0}
            max={200}
            unit="%"
            onChange={(saturation) => update({ saturation })}
          />
        </div>
      )}

      {data.kind === 'pixelate' && (
        <div className="node-body">
          <RangeControl
            label="Block size"
            value={Number(data.pixelSize ?? 8)}
            min={1}
            max={48}
            unit="px"
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
            max={16}
            onChange={(levels) => update({ levels })}
          />
        </div>
      )}

      {data.kind === 'dither' && (
        <div className="node-body">
          <label className="node-select nodrag">
            <span>Algorithm</span>
            <select
              value={data.algorithm ?? 'floyd-steinberg'}
              onChange={(event) =>
                update({ algorithm: event.target.value as typeof data.algorithm })
              }
            >
              <option value="floyd-steinberg">Floyd–Steinberg</option>
              <option value="atkinson">Atkinson</option>
              <option value="bayer-4">Bayer 4×4</option>
              <option value="bayer-8">Bayer 8×8</option>
              <option value="threshold">Threshold</option>
            </select>
          </label>
          <RangeControl
            label="Threshold"
            value={Number(data.threshold ?? 128)}
            min={1}
            max={254}
            onChange={(threshold) => update({ threshold })}
          />
          <div className="segmented nodrag">
            <button
              className={data.monochrome !== false ? 'active' : ''}
              onClick={() => update({ monochrome: true })}
              type="button"
            >
              Mono
            </button>
            <button
              className={data.monochrome === false ? 'active' : ''}
              onClick={() => update({ monochrome: false })}
              type="button"
            >
              RGB
            </button>
          </div>
        </div>
      )}

      {data.kind === 'output' && (
        <div className="node-body preview-body">
          <div className="preview-frame">
            {studio.outputUrl ? (
              <img src={studio.outputUrl} alt="Processed output" draggable={false} />
            ) : (
              <div className="preview-empty">Connect an image pipeline</div>
            )}
          </div>
          <footer className="preview-footer">
            <div>
              <strong>Live result</strong>
              <span>{studio.outputMeta}</span>
            </div>
            <button
              className="icon-button nodrag"
              type="button"
              aria-label="Export PNG"
              title="Export PNG"
              onClick={studio.exportOutput}
            >
              <Download size={15} />
            </button>
          </footer>
        </div>
      )}

      {data.kind !== 'output' && (
        <Handle type="source" position={Position.Right} className="studio-handle" />
      )}
    </section>
  );
}
