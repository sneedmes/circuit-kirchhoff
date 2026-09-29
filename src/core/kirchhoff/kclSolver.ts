import type { CircuitGraph, KirchhoffEquation, TopoBranch, TopoNode } from '../types';

export const generateKCLForNode = (node: TopoNode, branches: TopoBranch[]): KirchhoffEquation | null => {
  const terms: string[] = [];

  branches.forEach((branch) => {
    let isEntering = false;
    let isConnected = false;

    if (branch.toNodeId === node.id) {
      isConnected = true;
      isEntering = true;
    }

    else if (branch.fromNodeId === node.id) {
      isConnected = true;
      isEntering = false;
    }

    if (!isConnected) return;

    if (branch.currentSource) {
      const jName = branch.currentSource.label;
      const isSame = branch.currentSource.isSameDirection;
      const signPositive = isEntering ? isSame : !isSame;
      terms.push(signPositive ? `+ ${jName}` : `- ${jName}`);
    } else {
      const currentName = `I_{${branch.index}}`;
      terms.push(isEntering ? `+ ${currentName}` : `- ${currentName}`);
    }
  });

  if (terms.length === 0) return null;

  let equationStr = terms.join(' ');
  if (equationStr.startsWith('+ ')) {
    equationStr = equationStr.substring(2);
  }

  return {
    id: `kcl_${node.id}`,
    type: 'KCL',
    targetLabel: `Узел ${node.label}`,
    latex: `${equationStr} = 0`,
  };
};

export const generateKCLEquations = (
  graph: CircuitGraph,
  selectedNodeId?: string | 'ALL'
): KirchhoffEquation[] => {
  const { nodes, branches } = graph;
  const equations: KirchhoffEquation[] = [];

  if (graph.nodes.length < 2) {
    return [];
  }

  if (nodes.length === 0) return equations;

  if (selectedNodeId && selectedNodeId !== 'ALL') {
    const targetNode = nodes.find((n) => n.id === selectedNodeId);
    if (targetNode) {
      const eq = generateKCLForNode(targetNode, branches);
      if (eq) equations.push(eq);
    }
    return equations;
  }

  const targetNodes = nodes.length > 1 ? nodes.slice(0, nodes.length - 1) : nodes;

  targetNodes.forEach((node) => {
    const eq = generateKCLForNode(node, branches);
    if (eq) equations.push(eq);
  });

  return equations;
};