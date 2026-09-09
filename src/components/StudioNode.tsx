import {
  CircleDot,
  Crop,
  Download,
  Eye,
  EyeOff,
  Grid3X3,
  Image as ImageIcon,
  ImagePlus,
  Palette as PaletteIcon,
  Plus,
  ScanLine,
  X,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import {
  ERROR_DIFFUSION_ALGORITHMS,
  type ErrorDiffusionAlgorithm,
  type StudioFlowNode,
} from '../model';
import { useStudio } from '../studio-context';

const kindIcon = {
  source: ImagePlus,
  adjust: SlidersHorizontal,
  transform: Crop,
  pixelate: Grid3X3,
  posterize: CircleDot,
  palette: PaletteIcon,
  convolution: ScanLine,
  dither: Sparkles,
  output: ImageIcon,
};

function BitmapPreview({ bitmap }: { bitmap: ImageBitmap }) {
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
      aria-label="Processed output"
      className="preview-canvas"
    />
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
export function StudioNode({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const studio = useStudio();
  const Icon = kindIcon[data.kind];
  const update = (patch: Partial<typeof data>) => studio.updateNodeData(id, patch);
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

  return (
    <section
      className={[
        'studio-node',
        `studio-node--${data.kind}`,
        selected ? 'is-selected' : '',
        data.enabled === false ? 'is-bypassed' : '',
      ].join(' ')}
    >
      {data.kind !== 'source' && (
        <Handle type="target" position={Position.Left} className="studio-handle" />
      )}

      <header className="node-header">
        <span className="node-icon"><Icon size={14} /></span>
        <div className="node-heading-copy">
          <p>{data.label}</p>
          <span>{data.kind}</span>
        </div>
        {data.kind !== 'source' && data.kind !== 'output' && (
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
              <BitmapPreview bitmap={studio.outputBitmap} />
            ) : (
              <div className="preview-empty">Preparing render engine…</div>
            )}
            {studio.rendering && <span className="preview-rendering">Rendering</span>}
          </div>
          <footer className="preview-footer">
            <div>
              <strong>Live result</strong>
              <span>{studio.outputMeta}</span>
            </div>
            <button
              className="icon-button nodrag"
              type="button"
              aria-label="Export full-resolution PNG"
              title="Export full-resolution PNG"
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
