import { Download, X } from 'lucide-react';
import type { ExportFormat } from '../engine/types';

interface ExportPanelProps {
  format: ExportFormat;
  quality: number;
  matte: string;
  fileName: string;
  sourceWidth: number;
  sourceHeight: number;
  exporting: boolean;
  onFormatChange: (format: ExportFormat) => void;
  onQualityChange: (quality: number) => void;
  onMatteChange: (matte: string) => void;
  onFileNameChange: (fileName: string) => void;
  onClose: () => void;
  onExport: () => void;
}

const formats: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: 'png', label: 'PNG', hint: 'Lossless + alpha' },
  { value: 'jpeg', label: 'JPEG', hint: 'Small photographic files' },
  { value: 'webp', label: 'WebP', hint: 'Compact + alpha' },
];

export function ExportPanel({
  format,
  quality,
  matte,
  fileName,
  sourceWidth,
  sourceHeight,
  exporting,
  onFormatChange,
  onQualityChange,
  onMatteChange,
  onFileNameChange,
  onClose,
  onExport,
}: ExportPanelProps) {
  return (
    <aside className="export-panel" aria-label="Export settings">
      <header className="export-panel__header">
        <div>
          <strong>Export</strong>
          <span>Render from the original source</span>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close export panel">
          <X size={14} />
        </button>
      </header>
      <div className="export-panel__body">
        <label className="export-field">
          <span>File name</span>
          <input
            type="text"
            value={fileName}
            spellCheck={false}
            onChange={(event) => onFileNameChange(event.target.value)}
          />
        </label>

        <div className="export-field">
          <span>Format</span>
          <div className="export-format-grid">
            {formats.map((option) => (
              <button
                key={option.value}
                type="button"
                className={format === option.value ? 'is-active' : ''}
                onClick={() => onFormatChange(option.value)}
              >
                <strong>{option.label}</strong>
                <span>{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {format !== 'png' && (
          <label className="export-field export-quality">
            <span>
              Quality
              <strong>{Math.round(quality * 100)}%</strong>
            </span>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(quality * 100)}
              onChange={(event) => onQualityChange(Number(event.target.value) / 100)}
            />
          </label>
        )}

        {format === 'jpeg' && (
          <label className="export-field">
            <span>Transparency matte</span>
            <div className="export-matte">
              <input type="color" value={matte} onChange={(event) => onMatteChange(event.target.value)} />
              <code>{matte.toUpperCase()}</code>
            </div>
          </label>
        )}

        <div className="export-summary">
          <span>Source</span>
          <strong>{sourceWidth} × {sourceHeight}</strong>
          <small>Geometry nodes can change final output dimensions.</small>
        </div>
      </div>

      <footer className="export-panel__footer">
        <button type="button" className="export-confirm" onClick={onExport} disabled={exporting}>
          <Download size={14} />
          {exporting ? 'Encoding…' : `Export ${format.toUpperCase()}`}
        </button>
      </footer>
    </aside>
  );
}
