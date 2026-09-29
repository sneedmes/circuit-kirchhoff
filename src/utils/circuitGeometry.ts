import { DSU } from '../core/graph/dsu';
import type { CircuitElement } from '../types/circuit';
import type { Pin, Wire, VisualNode } from '../types/wiring';
import { GRID_SIZE, type Point } from './grid';

export const getElementPins = (element: CircuitElement): [Pin, Pin] => {
  const rad = (element.rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));

  const p1x = element.x + (-40 * cos - 0 * sin);
  const p1y = element.y + (-40 * sin + 0 * cos);

  const p2x = element.x + (40 * cos - 0 * sin);
  const p2y = element.y + (40 * sin + 0 * cos);

  return [
    {
      id: `${element.id}_pin1`,
      elementId: element.id,
      pinIndex: 1,
      position: { x: p1x, y: p1y },
    },
    {
      id: `${element.id}_pin2`,
      elementId: element.id,
      pinIndex: 2,
      position: { x: p2x, y: p2y },
    },
  ];
};

export interface CircuitNodeCluster {
  id: string;
  position: Point;
  connectionsCount: number;
  points: Point[];
}

export interface CircuitElementClusterLink {
  element: CircuitElement;
  c1: string;
  c2: string;
  p1: Point;
  p2: Point;
}

export interface CircuitNodeDetection {
  clusters: CircuitNodeCluster[];
  elementLinks: CircuitElementClusterLink[];
}

/**
 * Единая точка истины для определения электрических кластеров схемы.
 *
 * Провода объединяют точки в электрические кластеры.
 * Существенным узлом считается кластер, к которому подключено
 * не менее трех выводов элементов.
 *
 * Порядок существенных узлов стабилен:
 * сначала X, затем Y.
 */
export const detectCircuitNodes = (
  elements: CircuitElement[],
  wires: Wire[]
): CircuitNodeDetection => {
  const coordKey = (x: number, y: number): string => {
    const qx = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const qy = Math.round(y / GRID_SIZE) * GRID_SIZE;

    return `${qx},${qy}`;
  };

  const dsu = new DSU();

  // 1. Объединяем точки, соединённые проводами.
  wires.forEach((wire) => {
    dsu.union(
      coordKey(wire.from.x, wire.from.y),
      coordKey(wire.to.x, wire.to.y)
    );
  });

  // 2. Определяем, к каким электрическим кластерам подключены
  // оба вывода каждого элемента.
  const rawLinks = elements.map((element) => {
    const [pin1, pin2] = getElementPins(element);

    const p1 = pin1.position;
    const p2 = pin2.position;

    const k1 = coordKey(p1.x, p1.y);
    const k2 = coordKey(p2.x, p2.y);

    return {
      element,
      c1: dsu.find(k1),
      c2: dsu.find(k2),
      p1,
      p2,
      k1,
      k2,
    };
  });

  /*
   * DSU root не используем как внешний ID.
   *
   * Например, один и тот же электрический кластер при другом порядке
   * union() потенциально может получить другой root.
   *
   * Поэтому строим стабильный ID из минимальной координаты,
   * принадлежащей кластеру.
   */
  const clusterKeys = new Map<string, Set<string>>();

  const addClusterKey = (root: string, key: string): void => {
    if (!clusterKeys.has(root)) {
      clusterKeys.set(root, new Set());
    }

    clusterKeys.get(root)!.add(key);
  };

  wires.forEach((wire) => {
    const fromKey = coordKey(wire.from.x, wire.from.y);
    const toKey = coordKey(wire.to.x, wire.to.y);

    const root = dsu.find(fromKey);

    addClusterKey(root, fromKey);
    addClusterKey(root, toKey);
  });

  rawLinks.forEach(({ k1, k2 }) => {
    addClusterKey(dsu.find(k1), k1);
    addClusterKey(dsu.find(k2), k2);
  });

  const canonicalIdByRoot = new Map<string, string>();

  for (const [root, keys] of clusterKeys) {
    const canonicalKey = Array.from(keys)
      .map((key) => {
        const [x, y] = key.split(',').map(Number);

        return {
          key,
          x,
          y,
        };
      })
      .sort((a, b) => a.x - b.x || a.y - b.y)[0]?.key;

    if (canonicalKey !== undefined) {
      canonicalIdByRoot.set(root, canonicalKey);
    }
  }

  /*
   * 3. Собираем точки подключения элементов каждого кластера.
   *
   * Отдельно считаем степень каждой геометрической точки по проводам.
   * Это позволяет отличить реальную точку junction от произвольного
   * набора точек одного электрического кластера.
   */
  const pointsByCluster = new Map<string, Point[]>();
  const pinCountByClusterKey = new Map<string, number>();
  const wireDegreeByClusterKey = new Map<string, number>();

  const addPoint = (root: string, point: Point): void => {
    const clusterId = canonicalIdByRoot.get(root) ?? root;

    if (!pointsByCluster.has(clusterId)) {
      pointsByCluster.set(clusterId, []);
    }

    pointsByCluster.get(clusterId)!.push(point);

    const key = coordKey(point.x, point.y);
    pinCountByClusterKey.set(
      `${clusterId}|${key}`,
      (pinCountByClusterKey.get(`${clusterId}|${key}`) ?? 0) + 1
    );
  };

  wires.forEach((wire) => {
    const fromKey = coordKey(wire.from.x, wire.from.y);
    const toKey = coordKey(wire.to.x, wire.to.y);
    const clusterId =
      canonicalIdByRoot.get(dsu.find(fromKey)) ?? dsu.find(fromKey);

    for (const key of [fromKey, toKey]) {
      const mapKey = `${clusterId}|${key}`;
      wireDegreeByClusterKey.set(
        mapKey,
        (wireDegreeByClusterKey.get(mapKey) ?? 0) + 1
      );
    }
  });

  /*
   * 4. Нормализуем связи элементов к каноническим ID кластеров.
   */
  const elementLinks: CircuitElementClusterLink[] = rawLinks.map(
    ({ element, c1, c2, p1, p2 }) => {
      const canonicalC1 = canonicalIdByRoot.get(c1) ?? c1;
      const canonicalC2 = canonicalIdByRoot.get(c2) ?? c2;

      addPoint(c1, p1);
      addPoint(c2, p2);

      return {
        element,
        c1: canonicalC1,
        c2: canonicalC2,
        p1,
        p2,
      };
    }
  );

  /*
   * 5. Формируем существенные узлы.
   *
   * Позиция узла НЕ является средним арифметическим pin-координат.
   *
   * Приоритет выбора геометрической точки:
   *   1. точка с несколькими проводными сегментами (junction);
   *   2. точка, в которой совпадают несколько pin'ов;
   *   3. точка с pin + несколькими проводными сегментами;
   *   4. детерминированный fallback — существующая pin-точка,
   *      ближайшая к геометрическому центру кластера.
   *
   * Поэтому буква узла всегда привязана к реально существующей точке
   * схемы, а не «плавает» между элементами.
   */
  const getNodePosition = (
    id: string,
    points: Point[]
  ): Point => {
    const uniqueKeys = Array.from(
      new Set(points.map((point) => coordKey(point.x, point.y)))
    );

    const candidates = uniqueKeys.map((key) => {
      const [x, y] = key.split(',').map(Number);
      const pinCount = pinCountByClusterKey.get(`${id}|${key}`) ?? 0;
      const wireDegree = wireDegreeByClusterKey.get(`${id}|${key}`) ?? 0;

      return {
        key,
        point: { x, y },
        pinCount,
        wireDegree,
      };
    });

    const junctionCandidates = candidates.filter(
      (candidate) =>
        candidate.wireDegree >= 3 ||
        candidate.pinCount >= 2 ||
        (candidate.pinCount >= 1 && candidate.wireDegree >= 2)
    );

    if (junctionCandidates.length > 0) {
      return junctionCandidates.sort(
        (a, b) =>
          b.wireDegree - a.wireDegree ||
          b.pinCount - a.pinCount ||
          a.point.x - b.point.x ||
          a.point.y - b.point.y
      )[0].point;
    }

    const center = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };

    return candidates.sort(
      (a, b) =>
        Math.hypot(a.point.x - center.x, a.point.y - center.y) -
          Math.hypot(b.point.x - center.x, b.point.y - center.y) ||
        a.point.x - b.point.x ||
        a.point.y - b.point.y
    )[0].point;
  };

  /*
   * ВАЖНО:
   * сортировка является частью topology contract:
   *
   *     X ↑
   *     при равном X → Y ↑
   */
  const clusters: CircuitNodeCluster[] = Array.from(
    pointsByCluster.entries()
  )
    .map(([id, points]) => ({
      id,
      points,
      connectionsCount: points.length,
      position: getNodePosition(id, points),
    }))
    .filter((cluster) => cluster.connectionsCount >= 3)
    .sort(
      (a, b) =>
        a.position.x - b.position.x ||
        a.position.y - b.position.y
    );

  return {
    clusters,
    elementLinks,
  };
};

export const detectVisualNodes = (
  elements: CircuitElement[],
  wires: Wire[]
): VisualNode[] => {
  const { clusters } = detectCircuitNodes(elements, wires);

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  return clusters.map((cluster, index) => ({
    id: cluster.id,
    label: letters[index % letters.length],
    position: cluster.position,
    connectionsCount: cluster.connectionsCount,
  }));
};

export const findPinPosition = (
  pinId: string | undefined,
  elements: CircuitElement[]
): Point | null => {
  if (!pinId) return null;

  for (const el of elements) {
    const [p1, p2] = getElementPins(el);

    if (p1.id === pinId) return p1.position;
    if (p2.id === pinId) return p2.position;
  }

  return null;
};

export const findNearbyPin = (
  point: Point,
  elements: CircuitElement[],
  threshold: number = 10
): Pin | null => {
  for (const el of elements) {
    const pins = getElementPins(el);

    for (const p of pins) {
      const dist = Math.hypot(
        p.position.x - point.x,
        p.position.y - point.y
      );

      if (dist <= threshold) {
        return p;
      }
    }
  }

  return null;
};

export const isPointOnSegment = (
  p: Point,
  a: Point,
  b: Point,
  tolerance: number = 6
): boolean => {
  const lineLen = Math.hypot(b.x - a.x, b.y - a.y);

  if (lineLen === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y) <= tolerance;
  }

  const t =
    ((p.x - a.x) * (b.x - a.x) +
      (p.y - a.y) * (b.y - a.y)) /
    (lineLen * lineLen);

  if (t < 0.05 || t > 0.95) {
    return false;
  }

  const projX = a.x + t * (b.x - a.x);
  const projY = a.y + t * (b.y - a.y);

  return Math.hypot(p.x - projX, p.y - projY) <= tolerance;
};

export const findNearbyWire = (
  point: Point,
  wires: Wire[],
  tolerance: number = 8
): { wire: Wire; splitPoint: Point } | null => {
  for (const w of wires) {
    if (isPointOnSegment(point, w.from, w.to, tolerance)) {
      return {
        wire: w,
        splitPoint: {
          x: Math.round(point.x / 20) * 20,
          y: Math.round(point.y / 20) * 20,
        },
      };
    }
  }

  return null;
};