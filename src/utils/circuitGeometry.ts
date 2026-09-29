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

export const detectVisualNodes = (elements: CircuitElement[], wires: Wire[]): VisualNode[] => {
  const coordKey = (x: number, y: number) => {
    const qx = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const qy = Math.round(y / GRID_SIZE) * GRID_SIZE;
    return `${qx},${qy}`;
  };

  // 1. Объединяем точки, соединенные чистыми проводами
  const dsu = new DSU();
  wires.forEach((w) => {
    dsu.union(coordKey(w.from.x, w.from.y), coordKey(w.to.x, w.to.y));
  });

  // 2. Подсчитываем, сколько пинов элементов подключено к каждому кластеру проводов
  const clusterPins = new Map<string, Point[]>();
  elements.forEach((el) => {
    const [p1, p2] = getElementPins(el);
    const k1 = dsu.find(coordKey(p1.position.x, p1.position.y));
    const k2 = dsu.find(coordKey(p2.position.x, p2.position.y));

    if (!clusterPins.has(k1)) clusterPins.set(k1, []);
    if (!clusterPins.has(k2)) clusterPins.set(k2, []);
    clusterPins.get(k1)!.push(p1.position);
    clusterPins.get(k2)!.push(p2.position);
  });

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nodes: VisualNode[] = [];
  let letterIdx = 0;

  // ИСТИННЫЙ УЗЕЛ — ЭТО КЛАСТЕР, К КОТОРОМУ ПОДКЛЮЧЕНО СТРОГО >= 3 ЭЛЕМЕНТОВ
  const significant = Array.from(clusterPins.entries())
    .filter(([_, pts]) => pts.length >= 3)
    .sort((a, b) => a[1][0].x - b[1][0].x);

  significant.forEach(([clusterKey, pts]) => {
    const avgX = Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length);
    const avgY = Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length);

    nodes.push({
      id: clusterKey,
      label: letters[letterIdx % letters.length],
      position: { x: avgX, y: avgY },
      connectionsCount: pts.length,
    });
    letterIdx++;
  });

  return nodes;
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
      const dist = Math.hypot(p.position.x - point.x, p.position.y - point.y);
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
  if (lineLen === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= tolerance;

  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (lineLen * lineLen);
  if (t < 0.05 || t > 0.95) return false; // Исключаем сами концы отрезка (там пины/стыки)

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
        splitPoint: { x: Math.round(point.x / 20) * 20, y: Math.round(point.y / 20) * 20 },
      };
    }
  }
  return null;
};