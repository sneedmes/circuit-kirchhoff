import type { CircuitElement } from '../../types/circuit';
import type { Wire } from '../../types/wiring';
import { getElementPins } from '../../utils/circuitGeometry';
import { DSU } from './dsu';
import type { CircuitGraph, TopoNode, TopoBranch, BranchElement } from '../types';
import { type Point, GRID_SIZE } from '../../utils/grid';

export const buildCircuitGraph = (
  elements: CircuitElement[],
  wires: Wire[]
): CircuitGraph => {
  if (elements.length === 0) {
    return { nodes: [], branches: [] };
  }

  const pointKey = (x: number, y: number) => {
    const qx = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const qy = Math.round(y / GRID_SIZE) * GRID_SIZE;
    return `${qx},${qy}`;
  };

  // 1. Провода объединяют пины в эквипотенциальные кластеры
  const dsu = new DSU();
  wires.forEach((wire) => {
    dsu.union(pointKey(wire.from.x, wire.from.y), pointKey(wire.to.x, wire.to.y));
  });

  // 2. Определяем подключение каждого элемента к кластерам
  interface ElementLink {
    element: CircuitElement;
    c1: string;
    c2: string;
    p1: Point;
    p2: Point;
  }

  const links: ElementLink[] = elements.map((el) => {
    const [pin1, pin2] = getElementPins(el);
    const c1 = dsu.find(pointKey(pin1.position.x, pin1.position.y));
    const c2 = dsu.find(pointKey(pin2.position.x, pin2.position.y));
    return { element: el, c1, c2, p1: pin1.position, p2: pin2.position };
  });

  // 3. Подсчитываем степень каждого кластера (сколько ветвей к нему подходит)
  const clusterDegree = new Map<string, number>();
  const clusterPoints = new Map<string, Point[]>();

  links.forEach(({ c1, c2, p1, p2 }) => {
    clusterDegree.set(c1, (clusterDegree.get(c1) || 0) + 1);
    clusterDegree.set(c2, (clusterDegree.get(c2) || 0) + 1);

    if (!clusterPoints.has(c1)) clusterPoints.set(c1, []);
    if (!clusterPoints.has(c2)) clusterPoints.set(c2, []);
    clusterPoints.get(c1)!.push(p1);
    clusterPoints.get(c2)!.push(p2);
  });

  // 4. СУЩЕСТВЕННЫЕ УЗЛЫ: степень строго >= 3 (разветвления)
  let essentialClusters = Array.from(clusterDegree.entries())
    .filter(([_, degree]) => degree >= 3)
    .map(([cluster]) => cluster);

  // Краевой случай: одиночный контур без разветвлений (например, 1 кольцо)
  if (essentialClusters.length === 0 && links.length > 0) {
    essentialClusters = [links[0].c1];
  }

  // Создаем узлы A, B, C... строго для существенных узлов
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const topoNodes: TopoNode[] = essentialClusters
    .map((clusterId) => {
      const pts = clusterPoints.get(clusterId) || [{ x: 0, y: 0 }];
      const avgX = Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length);
      const avgY = Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length);
      return {
        id: clusterId,
        label: '',
        position: { x: avgX, y: avgY },
      };
    })
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((node, idx) => ({
      ...node,
      label: letters[idx % letters.length],
    }));

  const essentialSet = new Set(essentialClusters);

  // 5. Построение макро-ветвей (сворачивание последовательных элементов в одну ветвь)
  interface AdjEdge {
    link: ElementLink;
    targetCluster: string;
    isForward: boolean;
  }

  const adj = new Map<string, AdjEdge[]>();
  links.forEach((l) => {
    if (!adj.has(l.c1)) adj.set(l.c1, []);
    if (!adj.has(l.c2)) adj.set(l.c2, []);
    adj.get(l.c1)!.push({ link: l, targetCluster: l.c2, isForward: true });
    adj.get(l.c2)!.push({ link: l, targetCluster: l.c1, isForward: false });
  });

  const visitedElements = new Set<string>();
  const branches: TopoBranch[] = [];
  let branchIndex = 1;

  for (const startCluster of essentialClusters) {
    const edges = adj.get(startCluster) || [];

    for (const startEdge of edges) {
      if (visitedElements.has(startEdge.link.element.id)) continue;

      const branchElements: BranchElement[] = [];
      let currentCluster = startCluster;
      let currEdge: AdjEdge | undefined = startEdge;
      let representativeElement = startEdge.link.element;

      // Идем по цепочке элементов, пока не встретим следующий существенный узел
      while (currEdge && !visitedElements.has(currEdge.link.element.id)) {
        visitedElements.add(currEdge.link.element.id);
        const el = currEdge.link.element;

        if (el.type === 'RESISTOR') {
          representativeElement = el; // Приоритет резистору для стрелки тока
        }

        branchElements.push({
          id: el.id,
          type: el.type,
          label: el.label,
          isSameDirection: currEdge.isForward,
        });

        currentCluster = currEdge.targetCluster;

        // Если дошли до другого существенного узла — ветвь завершена
        if (essentialSet.has(currentCluster)) {
          break;
        }

        // Иначе продолжаем путь через точку степени 2
        const nextEdges = adj.get(currentCluster) || [];
        currEdge = nextEdges.find((e) => !visitedElements.has(e.link.element.id));
      }

      const currentSource = branchElements.find((el) => el.type === 'CURRENT_SOURCE');

      // Направление тока ветви ориентируем слева направо (или сверху вниз)
      const angle = representativeElement.rotation % 180 === 0 ? 0 : 90;

      branches.push({
        id: `branch_${branchIndex}`,
        index: branchIndex,
        fromNodeId: startCluster,
        toNodeId: currentCluster,
        elements: branchElements,
        currentSource,
        hasResistor: branchElements.some((el) => el.type === 'RESISTOR'),
        marker: {
          index: branchIndex,
          elementId: representativeElement.id,
          baseCenter: { x: representativeElement.x, y: representativeElement.y },
          angleDeg: angle,
        },
      });

      branchIndex++;
    }
  }

  return { nodes: topoNodes, branches };
};