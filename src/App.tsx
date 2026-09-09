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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Aperture,
  ChevronDown,
  Download,
  Grid3X3,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StudioNode } from './components/StudioNode';
import {
  downloadRaster,
  imageElementToRaster,
  makeDemoRaster,
  processGraph,
  rasterToDataUrl,
  type Raster,
} from './engine/imageEngine';
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
const STORAGE_KEY = 'graphic-studio-workflow-v1';

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

function loadWorkflow(): Snapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: initialNodes, edges: initialEdges };
    const parsed = JSON.parse(raw) as Snapshot;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return { nodes: initialNodes, edges: initialEdges };
    }
    return parsed;
  } catch {
    return { nodes: initialNodes, edges: initialEdges };
  }
}

const palette = [
  { kind: 'adjust' as const, label: 'Color + tone', icon: SlidersHorizontal },
  { kind: 'dither' as const, label: 'Dither', icon: Sparkles },
  { kind: 'pixelate' as const, label: 'Pixelate', icon: Grid3X3 },
  { kind: 'posterize' as const, label: 'Posterize', icon: Aperture },
];

export default function App() {
  const initial = useMemo(loadWorkflow, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioFlowNode>(
    initial.nodes,
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioEdge>(
    initial.edges,
  );
  const [sourceRaster, setSourceRaster] = useState<Raster>(() =>
    makeDemoRaster(),
  );
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renderPulse, setRenderPulse] = useState(false);
  const dragStart = useRef<Snapshot | null>(null);

  const checkpoint = useCallback(() => {
    setHistory((items) => [...items.slice(-39), cloneSnapshot(nodes, edges)]);
    setFuture([]);
  }, [nodes, edges]);

  const result = useMemo(
    () => processGraph(nodes, edges, sourceRaster),
    [nodes, edges, sourceRaster],
  );
  const outputUrl = useMemo(() => rasterToDataUrl(result), [result]);
  const outputMeta = `${result.width} × ${result.height} · PNG`;

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nodes, edges } satisfies Snapshot),
    );
  }, [nodes, edges]);

  const updateNodeData = useCallback(
    (id: string, patch: Partial<StudioNodeData>) => {
      checkpoint();
      setNodes((items) =>
        items.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        ),
      );
    },
    [checkpoint, setNodes],
  );

  const uploadSource = useCallback(
    (file: File) => {
      checkpoint();
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          setSourceRaster(imageElementToRaster(image));
          setNodes((items) =>
            items.map((node) =>
              node.data.kind === 'source'
                ? { ...node, data: { ...node.data, fileName: file.name } }
                : node,
            ),
          );
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.src = url;
    },
    [checkpoint, setNodes],
  );

  const exportOutput = useCallback(() => {
    downloadRaster(result, 'graphic-studio-output.png');
  }, [result]);

  const onConnect = useCallback(
    (connection: Connection) => {
      checkpoint();
      setEdges((items) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.target}-${Date.now()}`,
          },
          items.filter((edge) => edge.target !== connection.target),
        ),
      );
    },
    [checkpoint, setEdges],
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
            x: 430 + (count % 3) * 300,
            y: 560 + Math.floor(count / 3) * 190,
          },
          data: { kind, ...effectDefaults[kind] },
        },
      ]);
      setPaletteOpen(false);
    },
    [checkpoint, nodes, setNodes],
  );

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [cloneSnapshot(nodes, edges), ...items.slice(0, 39)]);
    setHistory((items) => items.slice(0, -1));
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [history, nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((items) => [...items.slice(-39), cloneSnapshot(nodes, edges)]);
    setFuture((items) => items.slice(1));
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [future, nodes, edges, setNodes, setEdges]);

  const reset = useCallback(() => {
    checkpoint();
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSourceRaster(makeDemoRaster());
  }, [checkpoint, setNodes, setEdges]);

  const pulseRender = useCallback(() => {
    setRenderPulse(true);
    window.setTimeout(() => setRenderPulse(false), 700);
  }, []);

  const contextValue = useMemo(
    () => ({
      updateNodeData,
      uploadSource,
      outputUrl,
      outputMeta,
      exportOutput,
    }),
    [updateNodeData, uploadSource, outputUrl, outputMeta, exportOutput],
  );

  return (
    <StudioContext.Provider value={contextValue}>
      <main className="app-shell">
        <header className="topbar">
          <div className="topbar-left">
            <div className="brand-mark" title="Graphic Studio">
              <Aperture size={19} />
            </div>
            <nav className="tab-group" aria-label="Editor sections">
              <button className="active" type="button">Workflow</button>
              <button type="button">Edit</button>
              <button type="button">Help</button>
            </nav>
          </div>

          <div className="project-switcher">
            <button type="button" className="project-arrow">‹</button>
            <button type="button" className="project-name">
              Dither study <span>×</span>
            </button>
            <button type="button" className="project-arrow">›</button>
          </div>

          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              onClick={undo}
              disabled={!history.length}
              title="Undo"
            >
              <Undo2 size={15} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={redo}
              disabled={!future.length}
              title="Redo"
            >
              <Redo2 size={15} />
            </button>
            <button
              className={renderPulse ? 'run-button is-running' : 'run-button'}
              type="button"
              onClick={pulseRender}
            >
              <Play size={13} fill="currentColor" />
              {renderPulse ? 'Rendered' : 'Render'}
              <ChevronDown size={13} />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={reset}
              title="Reset workflow"
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="export-button"
              type="button"
              onClick={exportOutput}
            >
              <Download size={14} />
              Export
            </button>
          </div>
        </header>

        <div className="flow-shell">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            minZoom={0.25}
            maxZoom={1.8}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            onNodeDragStart={() => {
              dragStart.current = cloneSnapshot(nodes, edges);
            }}
            onNodeDragStop={() => {
              if (dragStart.current) {
                setHistory((items) => [...items.slice(-39), dragStart.current!]);
                setFuture([]);
                dragStart.current = null;
              }
            }}
            proOptions={{ hideAttribution: true }}
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
                  {palette.map(({ kind, label, icon: Icon }) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => addEffect(kind)}
                    >
                      <span><Icon size={14} /></span>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </Panel>

            <Panel position="bottom-center" className="status-dock">
              <span className="status-live" />
              <strong>Live pipeline</strong>
              <span>{nodes.length} nodes</span>
              <i />
              <span>Drop image → connect → export</span>
            </Panel>

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
