import { Archive, Play, RotateCcw, Square, X } from 'lucide-react';
import { zipSync } from 'fflate';
import { useMemo, useRef, useState } from 'react';
import type { ExportFormat, RenderedImage } from '../engine/types';

type BatchStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
interface BatchItem {
  id: string;
  file: File;
  status: BatchStatus;
  result?: RenderedImage;
  error?: string;
}

interface BatchPanelProps {
  format: ExportFormat;
  onClose: () => void;
  onRender: (file: File, maxDimension: number, format: ExportFormat) => Promise<RenderedImage>;
}

const extensionFor = (format: ExportFormat) => format === 'jpeg' ? 'jpg' : format;
const stemFor = (name: string) => name.replace(/\.[^.]+$/, '') || 'image';

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function outputName(template: string, item: BatchItem, index: number, format: ExportFormat): string {
  const ext = extensionFor(format);
  const width = item.result?.telemetry.width ?? 0;
  const height = item.result?.telemetry.height ?? 0;
  const date = new Date().toISOString().slice(0, 10);
  const value = template
    .replaceAll('{name}', stemFor(item.file.name))
    .replaceAll('{index}', String(index + 1).padStart(3, '0'))
    .replaceAll('{width}', String(width))
    .replaceAll('{height}', String(height))
    .replaceAll('{date}', date)
    .replaceAll('{ext}', ext)
    .replace(/[\\/:*?"<>|]+/g, '-');
  return value.toLowerCase().endsWith(`.${ext}`) ? value : `${value}.${ext}`;
}

export function BatchPanel({ format, onClose, onRender }: BatchPanelProps) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [template, setTemplate] = useState('{name}-processed-{index}.{ext}');
  const [batchFormat, setBatchFormat] = useState<ExportFormat>(format);
  const [maxDimension, setMaxDimension] = useState(8192);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const complete = items.filter((item) => item.status === 'complete').length;
  const terminal = items.filter((item) => ['complete', 'failed', 'cancelled'].includes(item.status)).length;
  const progress = items.length ? Math.round((terminal / items.length) * 100) : 0;
  const canRun = items.some((item) => item.status === 'queued' || item.status === 'failed' || item.status === 'cancelled');

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => ({ id: crypto.randomUUID(), file, status: 'queued' as const }));
    setItems((current) => [...current, ...incoming].slice(0, 500));
  };

  const run = async () => {
    if (running || !canRun) return;
    cancelRef.current = false;
    setRunning(true);
    const queue = items.map((item) =>
      item.status === 'complete' ? item : { ...item, status: 'queued' as BatchStatus, error: undefined },
    );
    setItems(queue);
    for (const item of queue) {
      if (item.status === 'complete') continue;
      if (cancelRef.current) {
        setItems((current) => current.map((entry) =>
          entry.id === item.id && entry.status === 'queued' ? { ...entry, status: 'cancelled' } : entry,
        ));
        continue;
      }
      setItems((current) => current.map((entry) =>
        entry.id === item.id ? { ...entry, status: 'running', error: undefined } : entry,
      ));
      try {
        const result = await onRender(item.file, maxDimension, batchFormat);
        setItems((current) => current.map((entry) =>
          entry.id === item.id
            ? cancelRef.current
              ? { ...entry, status: 'cancelled', result: undefined }
              : { ...entry, status: 'complete', result }
            : entry,
        ));
      } catch (reason) {
        const error = reason instanceof Error ? reason.message : String(reason);
        setItems((current) => current.map((entry) =>
          entry.id === item.id ? { ...entry, status: 'failed', error } : entry,
        ));
      }
    }
    setRunning(false);
  };

  const cancel = () => {
    cancelRef.current = true;
    setItems((current) => current.map((item) =>
      item.status === 'queued' ? { ...item, status: 'cancelled' } : item,
    ));
  };

  const retryFailed = () => setItems((current) => current.map((item) =>
    item.status === 'failed' || item.status === 'cancelled'
      ? { ...item, status: 'queued', error: undefined }
      : item,
  ));

  const downloadZip = async () => {
    const finished = items.filter((item) => item.status === 'complete' && item.result);
    if (!finished.length) return;
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (let index = 0; index < finished.length; index += 1) {
      const item = finished[index];
      const raw = outputName(template, item, index, batchFormat);
      let name = raw;
      let duplicate = 2;
      while (used.has(name)) {
        const dot = raw.lastIndexOf('.');
        name = dot >= 0 ? `${raw.slice(0, dot)}-${duplicate}${raw.slice(dot)}` : `${raw}-${duplicate}`;
        duplicate += 1;
      }
      used.add(name);
      files[name] = new Uint8Array(await item.result!.blob.arrayBuffer());
    }
    const zipped = zipSync(files, { level: 6 });
    downloadBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), 'graphic-studio-batch.zip');
  };

  const summary = useMemo(() => {
    const failed = items.filter((item) => item.status === 'failed').length;
    return `${complete}/${items.length} complete${failed ? ` · ${failed} failed` : ''}`;
  }, [complete, items]);

  return (
    <aside className="batch-panel" aria-label="Batch processing">
      <header>
        <div>
          <Archive size={15} />
          <strong>Batch</strong>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close batch panel"><X size={14} /></button>
      </header>
      <label className="batch-drop">
        <span>Add images</span>
        <small>PNG · JPEG · WebP · AVIF · GIF · up to 500 files</small>
        <input type="file" accept="image/*" multiple onChange={(event) => addFiles(event.target.files)} />
      </label>
      <label className="batch-template">
        <span>Filename template</span>
        <input value={template} onChange={(event) => setTemplate(event.target.value)} spellCheck={false} />
        <small>{'{name} {index} {width} {height} {date} {ext}'}</small>
      </label>
      <div className="batch-options">
        <label>
          <span>Format</span>
          <select value={batchFormat} onChange={(event) => setBatchFormat(event.target.value as ExportFormat)} disabled={running}>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label>
          <span>Max dimension</span>
          <select value={maxDimension} onChange={(event) => setMaxDimension(Number(event.target.value))} disabled={running}>
            <option value={8192}>Full / 8K cap</option>
            <option value={4096}>4K</option>
            <option value={2560}>2.5K</option>
            <option value={2048}>2K</option>
            <option value={1920}>HD</option>
            <option value={1024}>1K</option>
          </select>
        </label>
      </div>      <div className="batch-progress">
        <div><strong>{summary}</strong><span>{progress}%</span></div>
        <progress max={100} value={progress} />
      </div>
      <div className="batch-list">
        {items.map((item) => (
          <div key={item.id} className={`batch-item is-${item.status}`}>
            <div><strong>{item.file.name}</strong><small>{item.error ?? item.status}</small></div>
            <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}>×</button>
          </div>
        ))}
        {!items.length && <div className="batch-empty">Drop a production set here.</div>}
      </div>
      <footer>
        {running ? (
          <button type="button" className="batch-stop" onClick={cancel}><Square size={12} /> Cancel queue</button>
        ) : (
          <button type="button" className="run-button" disabled={!canRun} onClick={() => void run()}><Play size={12} /> Run queue</button>
        )}
        <button type="button" className="icon-button" onClick={retryFailed} title="Retry failed/cancelled"><RotateCcw size={13} /></button>
        <button type="button" className="export-button" disabled={!complete || running} onClick={() => void downloadZip()}><Archive size={13} /> Download ZIP</button>
      </footer>
    </aside>
  );
}
