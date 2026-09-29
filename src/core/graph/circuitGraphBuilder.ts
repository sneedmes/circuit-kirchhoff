import type { CircuitElement } from '../../types/circuit';
import type { Wire } from '../../types/wiring';
import {
  detectCircuitNodes,
  type CircuitElementClusterLink,
} from '../../utils/circuitGeometry';
import type {
  CircuitGraph,
  TopoNode,
  TopoBranch,
  BranchElement,
} from '../types';

const normalizeCardinalAngle = (angle: number): number => {
  const normalized = ((angle % 360) + 360) % 360;

  const candidates = [0, 90, 180, 270];

  return candidates.reduce((closest, candidate) => {
    const currentDistance = Math.min(
      Math.abs(normalized - candidate),
      360 - Math.abs(normalized - candidate)
    );

    const closestDistance = Math.min(
      Math.abs(normalized - closest),
      360 - Math.abs(normalized - closest)
    );

    return currentDistance < closestDistance
      ? candidate
      : closest;
  }, 0);
};

/**
 * Направление стрелки вдоль конкретного элемента ветви.
 *
 * rotation элемента задаёт направление от pin1 к pin2:
 *
 *   0°   →  вправо
 *   90°  →  вниз
 *   180° →  влево
 *   270° →  вверх
 *
 * Если branch traversal идёт против pin1 → pin2,
 * направление разворачивается на 180°.
 */
const getElementArrowAngle = (
  element: CircuitElement,
  isSameDirection: boolean
): number => {
  const elementAngle = normalizeCardinalAngle(
    element.rotation
  );

  if (isSameDirection) {
    return elementAngle;
  }

  return (elementAngle + 180) % 360;
};

export const buildCircuitGraph = (
  elements: CircuitElement[],
  wires: Wire[]
): CircuitGraph => {
  if (elements.length === 0) {
    return { nodes: [], branches: [] };
  }

  /*
   * Единый источник истины для topology:
   *
   * Canvas → detectVisualNodes()
   * Graph Builder → detectCircuitNodes()
   *
   * Оба используют один и тот же detector.
   */
  const { clusters, elementLinks } = detectCircuitNodes(
    elements,
    wires
  );

  const links: CircuitElementClusterLink[] = elementLinks;

  /*
   * Существенные узлы уже отфильтрованы и отсортированы
   * внутри detectCircuitNodes():
   *
   *     X ↑
   *     Y ↑ при одинаковом X
   */
  let essentialClusters = clusters.map(
    (cluster) => cluster.id
  );

  /*
   * Краевой случай:
   * одноконтурная цепь без разветвлений.
   *
   * Этот искусственный узел НЕ является визуальным узлом.
   * Он нужен только для внутреннего представления branch graph.
   */
  if (essentialClusters.length === 0 && links.length > 0) {
    essentialClusters = [links[0].c1];
  }

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const clusterById = new Map(
    clusters.map((cluster) => [cluster.id, cluster])
  );

  const elementById = new Map(
    elements.map((element) => [element.id, element])
  );

  const topoNodes: TopoNode[] = essentialClusters.map(
    (clusterId, index) => {
      const cluster = clusterById.get(clusterId);

      const position =
        cluster?.position ??
        links[0]?.p1 ?? {
          x: 0,
          y: 0,
        };

      return {
        id: clusterId,
        label: letters[index % letters.length],
        position,
      };
    }
  );

  const essentialSet = new Set(essentialClusters);

  /*
   * Построение adjacency для существующего алгоритма ветвей.
   */
  interface AdjEdge {
    link: CircuitElementClusterLink;
    targetCluster: string;
    isForward: boolean;
  }

  const adj = new Map<string, AdjEdge[]>();

  links.forEach((link) => {
    if (!adj.has(link.c1)) {
      adj.set(link.c1, []);
    }

    if (!adj.has(link.c2)) {
      adj.set(link.c2, []);
    }

    adj.get(link.c1)!.push({
      link,
      targetCluster: link.c2,
      isForward: true,
    });

    adj.get(link.c2)!.push({
      link,
      targetCluster: link.c1,
      isForward: false,
    });
  });

  const visitedElements = new Set<string>();
  const branches: TopoBranch[] = [];

  let branchIndex = 1;

  for (const startCluster of essentialClusters) {
    const edges = adj.get(startCluster) || [];

    for (const startEdge of edges) {
      if (
        visitedElements.has(
          startEdge.link.element.id
        )
      ) {
        continue;
      }

      const branchElements: BranchElement[] = [];

      let currentCluster = startCluster;
      let currEdge: AdjEdge | undefined = startEdge;

      while (
        currEdge &&
        !visitedElements.has(
          currEdge.link.element.id
        )
      ) {
        visitedElements.add(
          currEdge.link.element.id
        );

        const el = currEdge.link.element;

        branchElements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          isSameDirection:
            currEdge.isForward,
        });

        currentCluster =
          currEdge.targetCluster;

        if (essentialSet.has(currentCluster)) {
          break;
        }

        const nextEdges =
          adj.get(currentCluster) || [];

        currEdge = nextEdges.find(
          (edge) =>
            !visitedElements.has(
              edge.link.element.id
            )
        );
      }

      const currentSource =
        branchElements.find(
          (element) =>
            element.type === 'CURRENT_SOURCE'
        );

      /*
       * Выбираем центральный элемент ветви
       * для визуального маркера тока.
       *
       * Это особенно важно для одноконтурной цепи:
       *
       *   E1 ─ R1 ─ R2
       *
       * вся цепь может быть одной branch,
       * поэтому нельзя брать просто последний
       * элемент как representativeElement.
       */
      const markerElementIndex =
        Math.floor(branchElements.length / 2);

      const markerBranchElement =
        branchElements[markerElementIndex];

      const markerCircuitElement =
        markerBranchElement
          ? elementById.get(markerBranchElement.id)
          : undefined;

      /*
       * Теоретически markerBranchElement всегда существует,
       * но оставляем безопасный fallback.
       */
      const fallbackElement =
        elements.find(
          (element) =>
            element.id ===
            branchElements[0]?.id
        ) ?? elements[0];

      const visualElement =
        markerCircuitElement ?? fallbackElement;

      const angle =
        markerBranchElement && visualElement
          ? getElementArrowAngle(
              visualElement,
              markerBranchElement.isSameDirection
            )
          : 0;

      branches.push({
        id: `branch_${branchIndex}`,
        index: branchIndex,
        fromNodeId: startCluster,
        toNodeId: currentCluster,
        elements: branchElements,
        currentSource,
        hasResistor: branchElements.some(
          (element) =>
            element.type === 'RESISTOR'
        ),
        marker: {
          index: branchIndex,
          elementId: visualElement.id,
          baseCenter: {
            x: visualElement.x,
            y: visualElement.y,
          },
          angleDeg: angle,
        },
      });

      branchIndex++;
    }
  }

  return {
    nodes: topoNodes,
    branches,
  };
};