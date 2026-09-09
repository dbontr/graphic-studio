import type { StudioEdge, StudioFlowNode } from '../model';
import { stableStageSignature } from './imageEngine';
import type { GraphPlanNode, PipelineStage, RenderPlan } from './types';

function stageSignature(stage: PipelineStage): string {
  if (stage.data.kind !== 'mask') return stableStageSignature(stage);
  const d = stage.data;
  return JSON.stringify([
    stage.id,
    d.kind,
    d.enabled,
    d.maskChannel,
    d.maskInvert,
    d.maskStrength,
    d.maskBlackPoint,
    d.maskWhitePoint,
    d.maskGamma,
  ]);
}

export function compileRenderGraph(
  nodes: StudioFlowNode[],
  edges: StudioEdge[],
): RenderPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, StudioEdge[]>();
  for (const edge of edges) {
    const values = incoming.get(edge.target) ?? [];
    values.push(edge);
    incoming.set(edge.target, values);
  }

  const output = nodes.find((node) => node.data.kind === 'output');
  if (!output) return { stages: [], signature: 'no-output' };

  const graphNodes: GraphPlanNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  let failure = '';

  const visit = (id: string): void => {
    if (failure || visited.has(id)) return;
    if (visiting.has(id)) {
      failure = 'cycle';
      return;
    }
    const node = byId.get(id);
    if (!node) {
      failure = 'missing-node';
      return;
    }

    const allInputs = incoming.get(id) ?? [];
    let selected: StudioEdge[] = [];
    if (node.data.kind === 'source') {
      selected = [];
    } else if (node.data.kind === 'blend' || node.data.kind === 'mask') {
      const secondaryPort = node.data.kind === 'blend' ? 'blend' : 'mask';
      const base = allInputs.filter((edge) => edge.targetHandle === 'base');
      const secondary = allInputs.filter((edge) => edge.targetHandle === secondaryPort);
      if (base.length !== 1 || (node.data.enabled !== false && secondary.length !== 1)) {
        failure = 'disconnected';
        return;
      }
      selected = node.data.enabled === false ? [base[0]] : [base[0], secondary[0]];
    } else {
      if (allInputs.length !== 1) {
        failure = allInputs.length ? 'ambiguous-input' : 'disconnected';
        return;
      }
      selected = [allInputs[0]];
    }

    visiting.add(id);
    for (const edge of selected) visit(edge.source);
    visiting.delete(id);
    if (failure) return;

    graphNodes.push({
      id,
      data: { ...node.data },
      inputs: selected.map((edge) => ({
        source: edge.source,
        port: edge.targetHandle ?? null,
      })),
    });
    visited.add(id);
  };

  visit(output.id);
  if (failure) return { stages: [], signature: failure };

  const activeMultiInput = graphNodes.some(
    (node) =>
      (node.data.kind === 'blend' || node.data.kind === 'mask')
      && node.data.enabled !== false,
  );
  const stages = graphNodes
    .filter((node) =>
      node.data.kind !== 'source'
      && node.data.kind !== 'output'
      && node.data.enabled !== false,
    )
    .map((node) => ({ id: node.id, data: { ...node.data } }));

  if (!activeMultiInput) {
    return {
      stages,
      signature: stages.map(stageSignature).join('|'),
    };
  }

  const signature = graphNodes.map((node) => {
    const inputSignature = node.inputs
      .map((input) => `${input.port ?? 'in'}:${input.source}`)
      .join(',');
    const nodeSignature = node.data.kind === 'source' || node.data.kind === 'output'
      ? `${node.id}:${node.data.kind}`
      : stageSignature({ id: node.id, data: node.data });
    return `${nodeSignature}<-${inputSignature}`;
  }).join('|');

  return {
    stages,
    signature,
    graph: { outputId: output.id, nodes: graphNodes },
  };
}
