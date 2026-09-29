import type { CircuitElement } from '../types/circuit';
import type { Point } from './grid';
import type { VisualNode } from '../types/wiring';

interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

export interface PlacedMarker {
  arrowPoint: Point;
  textPoint: Point;
  angleDeg: number;
}

export const calculateSafeMarkerPosition = (
  baseCenter: Point,
  angleDeg: number,
  elements: CircuitElement[],
  nodes: VisualNode[],
  currentElementId: string
): PlacedMarker => {
  const obstacles: Obstacle[] = [];

  elements.forEach((el) => {
    if (el.id !== currentElementId) {
      obstacles.push({ x: el.x, y: el.y, radius: 40 });
    }
  });

  nodes.forEach((n) => {
    obstacles.push({ x: n.position.x, y: n.position.y, radius: 24 });
  });

  const rad = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);

  const candidatesDistances = [28, -28, 44, -44];

  let bestDist = candidatesDistances[0];
  let minCollisions = Infinity;

  for (const dist of candidatesDistances) {
    const testX = baseCenter.x + nx * dist;
    const testY = baseCenter.y + ny * dist;

    let collisionScore = 0;
    for (const obs of obstacles) {
      const d = Math.hypot(testX - obs.x, testY - obs.y);
      if (d < obs.radius) {
        collisionScore += (obs.radius - d);
      }
    }

    if (collisionScore < minCollisions) {
      minCollisions = collisionScore;
      bestDist = dist;
    }

    if (collisionScore === 0) break;
  }

  const arrowX = baseCenter.x + nx * bestDist;
  const arrowY = baseCenter.y + ny * bestDist;

  const textDistExtra = bestDist > 0 ? 14 : -14;
  const isVertical = Math.abs(angleDeg % 180) === 90;

  const textX = arrowX + (isVertical ? textDistExtra : 0);
  const textY = arrowY + (isVertical ? 0 : textDistExtra);

  return {
    arrowPoint: { x: arrowX, y: arrowY },
    textPoint: { x: textX, y: textY },
    angleDeg,
  };
};