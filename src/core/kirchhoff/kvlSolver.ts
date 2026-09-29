import type { CircuitGraph, KirchhoffEquation, TopoBranch, IndependentLoop, LoopBranchEntry } from '../types';
import type { Point } from '../../utils/grid';

interface GraphEdge {
  branch: TopoBranch;
  targetNodeId: string;
  isForward: boolean;
}

export const findIndependentLoops = (graph: CircuitGraph): IndependentLoop[] => {
  const { nodes, branches } = graph;
  const passiveBranches = branches.filter((b) => !b.currentSource);

  if (passiveBranches.length === 0) return [];

  // Одноконтурная цепь
  if (nodes.length <= 1) {
  const b = passiveBranches[0];

  return [{
    id: 'loop_1',
    index: 1,
    entries: [{ branch: b, isForward: true }],
    elementIds: b.elements.map((el) => el.id),
    center: b.marker
      ? {
          x: b.marker.baseCenter.x,
          y: b.marker.baseCenter.y,
        }
      : undefined,
    isClockwise: true,
  }];
}
  

  // Список смежности
  const adj = new Map<string, GraphEdge[]>();
  nodes.forEach((n) => adj.set(n.id, []));

  passiveBranches.forEach((b) => {
    adj.get(b.fromNodeId)?.push({ branch: b, targetNodeId: b.toNodeId, isForward: true });
    adj.get(b.toNodeId)?.push({ branch: b, targetNodeId: b.fromNodeId, isForward: false });
  });

  const visitedNodes = new Set<string>();
  const treeBranchIds = new Set<string>();

  const treeAdj = new Map<string, GraphEdge[]>();
  nodes.forEach((n) => treeAdj.set(n.id, []));

  const dfs = (u: string) => {
    visitedNodes.add(u);
    const neighbors = adj.get(u) || [];

    for (const edge of neighbors) {
      if (!visitedNodes.has(edge.targetNodeId)) {
        treeBranchIds.add(edge.branch.id);
        treeAdj.get(u)!.push(edge);
        treeAdj.get(edge.targetNodeId)!.push({
          branch: edge.branch,
          targetNodeId: u,
          isForward: !edge.isForward,
        });
        dfs(edge.targetNodeId);
      }
    }
  };

  for (const n of nodes) {
    if (!visitedNodes.has(n.id)) dfs(n.id);
  }

  const findPathInTree = (
    src: string,
    dst: string,
    visited: Set<string>
  ): LoopBranchEntry[] | null => {
    if (src === dst) return [];
    visited.add(src);

    const edges = treeAdj.get(src) || [];
    for (const edge of edges) {
      if (!visited.has(edge.targetNodeId)) {
        const subPath = findPathInTree(edge.targetNodeId, dst, visited);
        if (subPath !== null) {
          return [{ branch: edge.branch, isForward: edge.isForward }, ...subPath];
        }
      }
    }
    return null;
  };

  // Хорды замыкают независимые циклы
  const chordBranches = passiveBranches.filter((b) => !treeBranchIds.has(b.id));
  const independentLoops: IndependentLoop[] = [];
  let loopCounter = 1;

  for (const chord of chordBranches) {
    const treePath = findPathInTree(chord.toNodeId, chord.fromNodeId, new Set<string>());
    if (!treePath) continue;

    const loopEntries: LoopBranchEntry[] = [
      { branch: chord, isForward: true },
      ...treePath,
    ];

    // Координаты и ID элементов для центра
    const elementIds = new Set<string>();
    const pts: Point[] = [];

    loopEntries.forEach(({ branch }) => {
      branch.elements.forEach((el) => elementIds.add(el.id));
      if (branch.marker) {
        pts.push(branch.marker.baseCenter);
      }
    });

    // Добавляем узлы контура
    const nodeFrom = nodes.find((n) => n.id === chord.fromNodeId);
    const nodeTo = nodes.find((n) => n.id === chord.toNodeId);
    if (nodeFrom?.position) pts.push(nodeFrom.position);
    if (nodeTo?.position) pts.push(nodeTo.position);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });

    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);

    // Ориентация стрелки контура по верхней ветви
    let topEntry = loopEntries[0];
    let topY = Infinity;
    loopEntries.forEach((entry) => {
      const y = entry.branch.marker?.baseCenter.y ?? 0;
      if (y < topY) {
        topY = y;
        topEntry = entry;
      }
    });

    const isClockwise = topEntry.isForward;

    independentLoops.push({
      id: `loop_${loopCounter}`,
      index: loopCounter,
      entries: loopEntries,
      elementIds: Array.from(elementIds),
      center: pts.length > 0 ? { x: centerX, y: centerY } : undefined,
      isClockwise,
    });

    loopCounter++;
  }

  return independentLoops;
};

export const generateKVLEquations = (loops: IndependentLoop[]): KirchhoffEquation[] => {
  const equations: KirchhoffEquation[] = [];

  loops.forEach((loop) => {
    const voltageDrops: string[] = [];
    const emfs: string[] = [];

    loop.entries.forEach(({ branch, isForward }) => {
      const resistors = branch.elements.filter((el) => el.type === 'RESISTOR');
      if (resistors.length > 0) {
        const rLabels = resistors.map((r) => r.label).join(' + ');
        const sign = isForward ? '+' : '-';
        const rTerm = resistors.length > 1 ? `(${rLabels})` : rLabels;
        voltageDrops.push(`${sign} I_{${branch.index}} \\cdot ${rTerm}`);
      }

      const voltageSources = branch.elements.filter((el) => el.type === 'VOLTAGE_SOURCE');
      voltageSources.forEach((vs) => {
        const isEmfForward = vs.isSameDirection === isForward;
        const sign = isEmfForward ? '+' : '-';
        emfs.push(`${sign} ${vs.label}`);
      });
    });

    let leftSide = voltageDrops.length > 0 ? voltageDrops.join(' ') : '0';
    if (leftSide.startsWith('+ ')) leftSide = leftSide.substring(2);

    let rightSide = emfs.length > 0 ? emfs.join(' ') : '0';
    if (rightSide.startsWith('+ ')) rightSide = rightSide.substring(2);

    equations.push({
      id: loop.id,
      type: 'KVL',
      targetLabel: `Контур ${loop.index}`,
      latex: `${leftSide} = ${rightSide}`,
    });
  });

  return equations;
};