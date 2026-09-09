import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Aperture,
  ChevronDown,
  Download,
  FolderOpen,
  Gauge,
  Crop,
  Grid3X3,
  Layers,
  Palette as PaletteIcon,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Undo2,
  Zap,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ExportPanel } from './components/ExportPanel';
import { ScopeViewer } from './components/ScopeViewer';
import { StudioNode } from './components/StudioNode';
import { compilePipeline } from './engine/imageEngine';
import { RenderEngineClient } from './engine/render-client';
import { persistSource, restoreSource } from './engine/source-storage';
import type {
  EngineTelemetry,
  ExportFormat,
  ExportOptions,
  FrameScopes,
  SourceMeta,
} from './engine/types';
import {
  effectDefaults,
  initialEdges,
  initialNodes,
  type NodeKind,
  type StudioEdge,
  type StudioFlowNode,
  type StudioNodeData,
} from './model';
import { StudioContext } from './studio-context';
import './styles.css';

const nodeTypes = { studio: StudioNode };
const STORAGE_KEY = 'graphic-studio-workflow-v2';
const LEGACY_STORAGE_KEY = 'graphic-studio-workflow-v1';

type Snapshot = { nodes: StudioFlowNode[]; edges: StudioEdge[] };

const cloneSnapshot = (
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
): Snapshot => ({
  nodes: nodes.map((node) => ({
    ...node,
    data: { ...node.data },
    position: { ...node.position },
  })),
  edges: edges.map((edge) => ({ ...edge })),
});

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<Snapshot>;
  return Array.isArray(snapshot.nodes)
    && Array.isArray(snapshot.edges)
    && snapshot.nodes.every((node) =>
      Boolean(node && typeof node.id === 'string' && node.data && typeof node.data.kind === 'string'),
    );
}

function loadWorkflow(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
      ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return cloneSnapshot(initialNodes, initialEdges);
    const parsed = JSON.parse(raw) as unknown;
    return validSnapshot(parsed)
      ? parsed
      : cloneSnapshot(initialNodes, initialEdges);
  } catch {
    return cloneSnapshot(initialNodes, initialEdges);
  }
}

function backendLabel(backend: EngineTelemetry['backend'] | undefined): string {
  if (backend === 'webgpu') return 'WebGPU';
  if (backend === 'hybrid') return 'Hybrid GPU + CPU';
  return 'CPU worker';
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportExtension(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

function safeExportName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.+$/g, '');
  return cleaned || 'graphic-studio-output';
}

function exportNameForSource(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem && stem !== 'Demo image' ? `${stem}-processed` : 'graphic-studio-output';
}

const palette = [
  { kind: 'adjust' as const, label: 'Color + tone', icon: SlidersHorizontal, hint: 'Exposure, gamma, temperature' },
  { kind: 'curves' as const, label: 'Curves', icon: TrendingUp, hint: 'Master + RGB tone curves' },
  { kind: 'blend' as const, label: 'Blend', icon: Layers, hint: 'Two-input compositing' },
  { kind: 'transform' as const, label: 'Transform', icon: Crop, hint: 'Crop, rotate, flip, resize' },
  { kind: 'dither' as const, label: 'Dither', icon: Sparkles, hint: '25 algorithms + screens' },
  { kind: 'palette' as const, label: 'Palette map', icon: PaletteIcon, hint: 'Retro + grayscale palettes' },
  { kind: 'convolution' as const, label: 'Convolution', icon: ScanLine, hint: 'Blur, sharpen, edge, emboss' },
  { kind: 'pixelate' as const, label: 'Pixelate', icon: Grid3X3, hint: 'Nearest block sampling' },
  { kind: 'posterize' as const, label: 'Posterize', icon: Aperture, hint: '2–32 color levels' },
];

function hasPath(edges: StudioEdge[], start: string, target: string): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const values = adjacency.get(edge.source) ?? [];
    values.push(edge.target);
    adjacency.set(edge.source, values);
  }
  const stack = [start];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export default function App() {
  const initial = useMemo(() => loadWorkflow(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioEdge>(initial.edges);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [performanceOpen, setPerformanceOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [webgpuAvailable, setWebgpuAvailable] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportQuality, setExportQuality] = useState(0.92);
  const [exportMatte, setExportMatte] = useState('#ffffff');
  const [exportFileName, setExportFileName] = useState('graphic-studio-output');
  const [outputBitmap, setOutputBitmap] = useState<ImageBitmap | null>(null);
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null);
  const [scopes, setScopes] = useState<FrameScopes | null>(null);
  const [sourceMeta, setSourceMeta] = useState<SourceMeta>({
    width: 960,
    height: 720,
    previewWidth: 960,
    previewHeight: 720,
    fileName: 'Demo image',
  });
  const [sourceVersion, setSourceVersion] = useState(0);
  const [renderNonce, setRenderNonce] = useState(0);
  const [error, setError] = useState('');
  const dragStart = useRef<Snapshot | null>(null);
  const dragDepth = useRef(0);
  const engineRef = useRef<RenderEngineClient | null>(null);
  const outputBitmapRef = useRef<ImageBitmap | null>(null);
  const renderGeneration = useRef(0);
  const workflowInputRef = useRef<HTMLInputElement | null>(null);

  const plan = useMemo(() => compilePipeline(nodes, edges), [nodes, edges]);
  const exportOptions = useMemo<ExportOptions>(() => ({
    format: exportFormat,
    quality: exportQuality,
    matte: exportMatte,
  }), [exportFormat, exportQuality, exportMatte]);
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    const engine = new RenderEngineClient();
    engineRef.current = engine;
    let active = true;
    void (async () => {
      try {
        const [{ webgpu }, restored] = await Promise.all([
          engine.capabilities(),
          restoreSource().catch(() => null),
        ]);
        if (!active) return;
        setWebgpuAvailable(webgpu);
        if (restored) {
          const meta = await engine.loadFile(restored);
          if (!active) return;
          setSourceMeta(meta);
          setExportFileName(exportNameForSource(meta.fileName));
          setSourceVersion((value) => value + 1);
          setNodes((items) => items.map((node) =>
            node.data.kind === 'source'
              ? { ...node, data: { ...node.data, fileName: restored.name } }
              : node,
          ));
        } else {
          setNodes((items) => items.map((node) =>
            node.data.kind === 'source'
              ? { ...node, data: { ...node.data, fileName: undefined } }
              : node,
          ));
        }
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (active) setEngineReady(true);
      }
    })();
    return () => {
      active = false;
      engine.dispose();
      engineRef.current = null;
      outputBitmapRef.current?.close();
      outputBitmapRef.current = null;
    };
  }, [setNodes]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nodes, edges } satisfies Snapshot),
    );
  }, [nodes, edges]);

  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    const generation = ++renderGeneration.current;
    const timeout = window.setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setRendering(true);
      setError('');
      void engine.render(planRef.current)
        .then((frame) => {
          if (generation !== renderGeneration.current) {
            frame.bitmap.close();
            return;
          }
          const previous = outputBitmapRef.current;
          outputBitmapRef.current = frame.bitmap;
          setOutputBitmap(frame.bitmap);
          setTelemetry(frame.telemetry);
          setScopes(frame.scopes);
          previous?.close();
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return;
          if (generation !== renderGeneration.current) return;
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (generation === renderGeneration.current) setRendering(false);
        });
    }, 28);
    return () => window.clearTimeout(timeout);
  }, [engineReady, plan.signature, renderNonce, sourceVersion]);

  const checkpoint = useCallback(() => {
    setHistory((items) => [...items.slice(-59), cloneSnapshot(nodes, edges)]);
    setFuture([]);
  }, [nodes, edges]);

  const updateNodeData = useCallback(
    (id: string, patch: Partial<StudioNodeData>) => {
      setNodes((items) =>
        items.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const uploadSource = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('Graphic Studio only accepts image files as sources.');
        return;
      }
      const engine = engineRef.current;
      if (!engine) return;
      setRendering(true);
      setError('');
      void engine.loadFile(file)
        .then((meta) => {
          void persistSource(file).catch(() => undefined);
          setSourceMeta(meta);
          setExportFileName(exportNameForSource(meta.fileName));
          setSourceVersion((value) => value + 1);
          setNodes((items) =>
            items.map((node) =>
              node.data.kind === 'source'
                ? { ...node, data: { ...node.data, fileName: file.name } }
                : node,
            ),
          );
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => setRendering(false));
    },
    [setNodes],
  );

  const extractPalette = useCallback(async (count = 8) => {
    const engine = engineRef.current;
    if (!engine) throw new Error('Render engine is not ready yet.');
    return engine.extractPalette(count);
  }, []);

  const exportOutput = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || exporting) return;
    setExporting(true);
    setError('');
    void engine.export(plan, exportOptions)
      .then((image) => {
        const extension = exportExtension(exportOptions.format);
        downloadBlob(image.blob, `${safeExportName(exportFileName)}.${extension}`);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => setExporting(false));
  }, [exportFileName, exportOptions, exporting, plan]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [cloneSnapshot(nodes, edges), ...items.slice(0, 59)]);
    setHistory((items) => items.slice(0, -1));
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [history, nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items.slice(-59), cloneSnapshot(nodes, edges)]);
    setFuture((items) => items.slice(1));
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [future, nodes, edges, setNodes, setEdges]);

  const resetWorkflow = useCallback(() => {
    checkpoint();
    setNodes(cloneSnapshot(initialNodes, initialEdges).nodes);
    setEdges(cloneSnapshot(initialNodes, initialEdges).edges);
  }, [checkpoint, setNodes, setEdges]);

  const isValidConnection = useCallback(
    (connection: Connection | StudioEdge) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const source = nodes.find((node) => node.id === connection.source);
      const target = nodes.find((node) => node.id === connection.target);
      if (!source || !target) return false;
      if (source.data.kind === 'output' || target.data.kind === 'source') return false;

      const blendTarget = target.data.kind === 'blend';
      const targetHandle = connection.targetHandle ?? null;
      if (blendTarget && targetHandle !== 'base' && targetHandle !== 'blend') return false;
      const withoutSlot = edges.filter((edge) => {
        if (edge.target !== connection.target) return true;
        if (!blendTarget) return false;
        return (edge.targetHandle ?? null) !== targetHandle;
      });
      return !hasPath(withoutSlot, connection.target, connection.source);
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      checkpoint();
      setEdges((items) => {
        const target = nodes.find((node) => node.id === connection.target);
        const blendTarget = target?.data.kind === 'blend';
        const targetHandle = connection.targetHandle ?? null;
        const remaining = items.filter((edge) => {
          if (edge.target !== connection.target) return true;
          if (!blendTarget) return false;
          return (edge.targetHandle ?? null) !== targetHandle;
        });
        return addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}-${targetHandle ?? 'in'}-${crypto.randomUUID().slice(0, 8)}`,
          },
          remaining,
        );
      });
    },
    [checkpoint, isValidConnection, nodes, setEdges],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<StudioFlowNode>[]) => {
      if (changes.some((change) => change.type === 'remove')) checkpoint();
      onNodesChange(changes);
    },
    [checkpoint, onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<StudioEdge>[]) => {
      if (changes.some((change) => change.type === 'remove')) checkpoint();
      onEdgesChange(changes);
    },
    [checkpoint, onEdgesChange],
  );

  const addEffect = useCallback(
    (kind: Exclude<NodeKind, 'source' | 'output'>) => {
      checkpoint();
      const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
      const count = nodes.filter((node) => node.data.kind !== 'source').length;
      setNodes((items) => [
        ...items,
        {
          id,
          type: 'studio',
          position: {
            x: 380 + (count % 3) * 310,
            y: 560 + Math.floor(count / 3) * 210,
          },
          data: { kind, ...effectDefaults[kind] } as StudioNodeData,
        },
      ]);
      setPaletteOpen(false);
    },
    [checkpoint, nodes, setNodes],
  );

  const saveWorkflow = useCallback(() => {
    const portableNodes = nodes.map((node) =>
      node.data.kind === 'source'
        ? { ...node, data: { ...node.data, fileName: undefined } }
        : node,
    );
    const payload = JSON.stringify(
      { version: 3, nodes: portableNodes, edges, app: 'Graphic Studio' },
      null,
      2,
    );
    downloadBlob(new Blob([payload], { type: 'application/json' }), 'graphic-studio-workflow.json');
  }, [nodes, edges]);

  const importWorkflow = useCallback(
    (file: File) => {
      void file.text()
        .then((text) => {
          const parsed = JSON.parse(text) as unknown;
          const candidate = parsed && typeof parsed === 'object' && 'nodes' in parsed
            ? parsed
            : null;
          if (!validSnapshot(candidate)) throw new Error('This is not a valid Graphic Studio workflow.');
          checkpoint();
          const currentFileName = sourceMeta.fileName === 'Demo image'
            ? undefined
            : sourceMeta.fileName;
          setNodes(candidate.nodes.map((node) =>
            node.data.kind === 'source'
              ? { ...node, data: { ...node.data, fileName: currentFileName } }
              : node,
          ));
          setEdges(candidate.edges);
          setError('');
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    },
    [checkpoint, setNodes, setEdges, sourceMeta.fileName],
  );

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExportOpen(false);
        setPaletteOpen(false);
        setPerformanceOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveWorkflow();
      } else if (modifier && event.key === 'Enter') {
        event.preventDefault();
        setRenderNonce((value) => value + 1);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [undo, redo, saveWorkflow]);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        uploadSource(file);
      }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [uploadSource]);

  const outputMeta = telemetry
    ? `${telemetry.width} × ${telemetry.height} · ${backendLabel(telemetry.backend)} · ${telemetry.durationMs.toFixed(1)} ms`
    : `${sourceMeta.previewWidth} × ${sourceMeta.previewHeight} · preparing`;

  const contextValue = useMemo(
    () => ({
      checkpoint,
      updateNodeData,
      uploadSource,
      extractPalette,
      outputBitmap,
      outputMeta,
      telemetry,
      rendering,
      exportOutput,
    }),
    [
      checkpoint,
      updateNodeData,
      uploadSource,
      extractPalette,
      outputBitmap,
      outputMeta,
      telemetry,
      rendering,
      exportOutput,
    ],
  );

  const statusBackend = telemetry
    ? backendLabel(telemetry.backend)
    : webgpuAvailable ? 'WebGPU ready' : 'CPU worker';

  return (
    <StudioContext.Provider value={contextValue}>
      <main className="app-shell">
        <input
          ref={workflowInputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importWorkflow(file);
            event.currentTarget.value = '';
          }}
        />

        <header className="topbar">
          <div className="topbar-left">
            <div className="brand-mark" title="Graphic Studio">
              <Aperture size={19} />
            </div>
            <nav className="tab-group" aria-label="Editor sections">
              <button className="active" type="button">Workflow</button>
              <button type="button" onClick={() => setPaletteOpen(true)}>Effects</button>
              <button
                type="button"
                className={performanceOpen ? 'active' : ''}
                onClick={() => setPerformanceOpen((open) => !open)}
              >
                Performance
              </button>
            </nav>
          </div>

          <div className="project-switcher">
            <span className="project-kicker">Graphic Studio</span>
            <strong>Dither study</strong>
          </div>

          <div className="topbar-actions">
            <span
              className={telemetry?.backend === 'webgpu' || telemetry?.backend === 'hybrid' ? 'engine-chip is-gpu' : 'engine-chip'}
              title="Active preview compute backend"
            >
              <Zap size={12} />
              {statusBackend}
            </span>
            <button
              className="icon-button"
              type="button"
              onClick={undo}
              disabled={!history.length}
              title="Undo · Ctrl/Cmd+Z"
            >
              <Undo2 size={15} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={redo}
              disabled={!future.length}
              title="Redo · Ctrl/Cmd+Shift+Z"
            >
              <Redo2 size={15} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={() => workflowInputRef.current?.click()}
              title="Open workflow"
            >
              <FolderOpen size={15} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={saveWorkflow}
              title="Save workflow · Ctrl/Cmd+S"
            >
              <Save size={15} />
            </button>
            <button
              className={rendering ? 'run-button is-running' : 'run-button'}
              type="button"
              onClick={() => setRenderNonce((value) => value + 1)}
              title="Render now · Ctrl/Cmd+Enter"
            >
              <Play size={13} fill="currentColor" />
              {rendering ? 'Rendering' : 'Render'}
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={resetWorkflow}
              title="Reset workflow"
            >
              <RotateCcw size={14} />
            </button>
            <button
              className={exportOpen ? 'export-button is-open' : 'export-button'}
              type="button"
              onClick={() => {
                setExportOpen((open) => !open);
                setPaletteOpen(false);
                setPerformanceOpen(false);
              }}
            >
              <Download size={14} />
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </header>

        {exportOpen && (
          <ExportPanel
            format={exportFormat}
            quality={exportQuality}
            matte={exportMatte}
            fileName={exportFileName}
            sourceWidth={sourceMeta.width}
            sourceHeight={sourceMeta.height}
            exporting={exporting}
            onFormatChange={setExportFormat}
            onQualityChange={setExportQuality}
            onMatteChange={setExportMatte}
            onFileNameChange={setExportFileName}
            onClose={() => setExportOpen(false)}
            onExport={exportOutput}
          />
        )}

        <div
          className={dragActive ? 'flow-shell is-dragging' : 'flow-shell'}
          onDragEnter={(event) => {
            event.preventDefault();
            dragDepth.current += 1;
            if (event.dataTransfer.types.includes('Files')) setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragActive(false);
            const file = Array.from(event.dataTransfer.files).find((item) =>
              item.type.startsWith('image/'),
            );
            if (file) uploadSource(file);
          }}
        >
          {dragActive && (
            <div className="drop-overlay">
              <ImageDropMark />
              <strong>Drop image anywhere</strong>
              <span>PNG · JPEG · WebP · AVIF · GIF</span>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2.2}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            deleteKeyCode={['Backspace', 'Delete']}
            onNodeDragStart={() => {
              dragStart.current = cloneSnapshot(nodes, edges);
            }}
            onNodeDragStop={() => {
              if (dragStart.current) {
                setHistory((items) => [...items.slice(-59), dragStart.current!]);
                setFuture([]);
                dragStart.current = null;
              }
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.05}
              color="rgba(255,255,255,.12)"
            />

            <Panel position="top-left" className="add-panel">
              <button
                className="add-node-button"
                type="button"
                onClick={() => setPaletteOpen((open) => !open)}
              >
                <Plus size={15} />
                Add node
                <ChevronDown size={13} />
              </button>
              {paletteOpen && (
                <div className="node-palette">
                  {palette.map(({ kind, label, icon: Icon, hint }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => addEffect(kind)}
                    >
                      <span><Icon size={14} /></span>
                      <div>
                        <strong>{label}</strong>
                        <small>{hint}</small>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            {performanceOpen && (
              <Panel position="top-right" className="performance-panel">
                <header>
                  <Gauge size={14} />
                  <strong>Render engine</strong>
                </header>
                <ScopeViewer scopes={scopes} />
                <dl>
                  <div>
                    <dt>Active backend</dt>
                    <dd>{telemetry ? backendLabel(telemetry.backend) : 'Starting…'}</dd>
                  </div>
                  <div>
                    <dt>WebGPU</dt>
                    <dd>{webgpuAvailable ? 'Available' : 'Fallback only'}</dd>
                  </div>
                  <div>
                    <dt>Preview</dt>
                    <dd>{telemetry ? `${telemetry.width} × ${telemetry.height}` : 'Starting…'}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{sourceMeta.width} × {sourceMeta.height}</dd>
                  </div>
                  <div>
                    <dt>Compute</dt>
                    <dd>{telemetry ? `${telemetry.durationMs.toFixed(2)} ms` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Throughput</dt>
                    <dd>{telemetry ? `${telemetry.megapixelsPerSecond.toFixed(1)} MP/s` : '—'}</dd>
                  </div>
                  <div>
                    <dt>GPU passes</dt>
                    <dd>{telemetry?.gpuPasses ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Cache hits</dt>
                    <dd>{telemetry?.cacheHits ?? 0}</dd>
                  </div>
                </dl>
              </Panel>
            )}
            <Panel position="bottom-center" className="status-dock">
              <span className={rendering ? 'status-live is-busy' : 'status-live'} />
              <strong>{rendering ? 'Rendering' : 'Live'}</strong>
              <span>{statusBackend}</span>
              <i />
              <span>{telemetry ? `${telemetry.durationMs.toFixed(1)} ms` : 'warming engine'}</span>
              <i />
              <span>{telemetry ? `${telemetry.megapixelsPerSecond.toFixed(0)} MP/s` : `${plan.stages.length} stages`}</span>
              {telemetry && telemetry.cacheHits > 0 && (
                <>
                  <i />
                  <span>{telemetry.cacheHits} cached</span>
                </>
              )}
            </Panel>

            {error && (
              <Panel position="bottom-left" className="error-panel">
                <span>Render issue</span>
                <strong>{error}</strong>
                <button type="button" onClick={() => setError('')}>×</button>
              </Panel>
            )}

            <Controls
              position="bottom-right"
              showInteractive={false}
              className="studio-controls"
            />
          </ReactFlow>
        </div>
      </main>
    </StudioContext.Provider>
  );
}

function ImageDropMark() {
  return (
    <span className="drop-mark" aria-hidden="true">
      <Aperture size={23} />
    </span>
  );
}
