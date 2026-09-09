import { Download, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import type { PresetManifest } from '../presets';

interface PresetPanelProps {
  builtins: PresetManifest[];
  userPresets: PresetManifest[];
  canSaveSelection: boolean;
  onClose: () => void;
  onInsert: (preset: PresetManifest) => void;
  onSaveSelection: (name: string) => void;
  onImport: (file: File) => void;
  onExport: (preset: PresetManifest) => void;
  onDelete: (id: string) => void;
}

export function PresetPanel(props: PresetPanelProps) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('My preset');
  const normalized = query.trim().toLowerCase();
  const filter = (preset: PresetManifest) => !normalized
    || `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase().includes(normalized);
  const builtins: PresetManifest[] = props.builtins.filter(filter);
  const personal: PresetManifest[] = props.userPresets.filter(filter);

  return (
    <aside className="preset-panel" aria-label="Presets">
      <header><strong>Presets</strong><button type="button" className="icon-button" onClick={props.onClose} aria-label="Close presets"><X size={14} /></button></header>
      <label className="preset-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search presets" /></label>
      <div className="preset-save-row">
        <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Preset name" />
        <button type="button" disabled={!props.canSaveSelection} onClick={() => props.onSaveSelection(name.trim() || 'My preset')}><Save size={12} /> Save selection</button>
        <label className="preset-import"><Upload size={12} /><span>Import</span><input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.currentTarget.value = ''; }} /></label>
      </div>
      <section className="preset-list">
        <h3>Built in</h3>
        {builtins.map((preset) => (
          <article key={preset.id} className="preset-card">
            <div><strong>{preset.name}</strong><span>{preset.description}</span></div>
            <button type="button" onClick={() => props.onInsert(preset)}><Plus size={12} /> Insert</button>
          </article>
        ))}
        <h3>Saved</h3>
        {!personal.length && <div className="preset-empty">No saved presets yet.</div>}
        {personal.map((preset) => (
          <article key={preset.id} className="preset-card">
            <div><strong>{preset.name}</strong><span>{preset.description}</span></div>
            <div className="preset-card-actions">
              <button type="button" onClick={() => props.onInsert(preset)}><Plus size={12} /> Insert</button>
              <button type="button" className="icon-button" onClick={() => props.onExport(preset)} title="Export preset"><Download size={12} /></button>
              <button type="button" className="icon-button" onClick={() => props.onDelete(preset.id)} title="Delete preset"><Trash2 size={12} /></button>
            </div>
          </article>
        ))}
      </section>
    </aside>
  );
}
