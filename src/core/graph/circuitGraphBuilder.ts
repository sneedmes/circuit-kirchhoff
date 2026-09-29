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
   * Канонический порядок узлов.
   *
   * Направление branch больше не должно зависеть
   * от порядка обхода DFS.
   *
   * Сначала сравниваем X, затем Y.
   */
  const compareClusterIds = (a: string, b: string): number => {
    const [ax, ay] = a.split(',').map(Number);
    const [bx, by] = b.split(',').map(Number);

    return ax - bx || ay - by || a.localeCompare(b);
  };

  /*
   * Существенные узлы уже отфильтрованы и отсортированы
   * внутри detectCircuitNodes().
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

  const topoNodes: TopoNode[] = essentialClusters.map(
    (clusterId, index) => {
      const cluster = clusterById.get(clusterId);

      const position =
        cluster?.position ??
        links[0]?.p1 ??
        { x: 0, y: 0 };

      return {
        id: clusterId,
        label: letters[index % letters.length],
        position,
      };
    }
  );

  const essentialSet = new Set(essentialClusters);

  /*
   * Adjacency для построения branch.
   *
   * isForward здесь означает только направление
   * конкретного шага обхода:
   *
   *   c1 → c2 = true
   *   c2 → c1 = false
   *
   * После формирования branch направление
   * нормализуется независимо от DFS.
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

      let representativeElement =
        startEdge.link.element;

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

        if (el.type === 'RESISTOR') {
          representativeElement = el;
        }

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

      const angle =
        representativeElement.rotation % 180 === 0
          ? 0
          : 90;

      /*
       * Каноническое направление branch:
       *
       * меньший cluster ID → больший cluster ID.
       *
       * Поэтому результат не зависит от того,
       * с какой стороны DFS начал обход.
       */
      const shouldReverse =
        compareClusterIds(startCluster, currentCluster) > 0;

      /*
       * Если DFS построил branch в обратном направлении,
       * разворачиваем:
       *
       * 1. порядок элементов;
       * 2. направление каждого элемента.
       */
      const normalizedElements = shouldReverse
        ? [...branchElements]
            .reverse()
            .map((element) => ({
              ...element,
              isSameDirection:
                !element.isSameDirection,
            }))
        : branchElements;

      const normalizedFromNodeId = shouldReverse
        ? currentCluster
        : startCluster;

      const normalizedToNodeId = shouldReverse
        ? startCluster
        : currentCluster;

      const normalizedCurrentSource =
        normalizedElements.find(
          (element) =>
            element.type === 'CURRENT_SOURCE'
        );

      branches.push({
        id: `branch_${branchIndex}`,
        index: branchIndex,
        fromNodeId: normalizedFromNodeId,
        toNodeId: normalizedToNodeId,
        elements: normalizedElements,
        currentSource: normalizedCurrentSource,
        hasResistor: normalizedElements.some(
          (element) =>
            element.type === 'RESISTOR'
        ),
        marker: {
          index: branchIndex,
          elementId:
            representativeElement.id,
          baseCenter: {
            x: representativeElement.x,
            y: representativeElement.y,
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