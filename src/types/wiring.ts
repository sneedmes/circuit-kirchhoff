import { type Point } from '../utils/grid';

export interface Pin {
  id: string;          
  elementId: string;
  pinIndex: 1 | 2;     // 1: отрицательный/вход, 2: положительный/выход
  position: Point;     // абсолютные координаты на холсте (с учетом rotation)
}

export interface Wire {
  id: string;
  from: Point;         // Начальная точка провода (координаты сетки)
  to: Point;           // Конечная точка провода
  fromPinId?: string;  // Если провод начался прямо на пине элемента
  toPinId?: string;    // Если провод закончился на пине элемента
}

export interface VisualNode {
  id: string;
  label: string;       // "A", "B", "C"...
  position: Point;
  connectionsCount: number;
}