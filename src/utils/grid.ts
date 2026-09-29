export const GRID_SIZE = 20; // шг сетки в пикселях

export interface Point {
  x: number;
  y: number;
}

// округление координат
export const snapToGrid = (x: number, y: number, gridSize: number = GRID_SIZE): Point => {
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
};