import type { Point } from '../utils/grid';

export interface TopoNode {
  id: string;
  label: string;
  position?: Point;
}

export interface BranchElement {
  id: string;
  type: 'RESISTOR' | 'VOLTAGE_SOURCE' | 'CURRENT_SOURCE';
  label: string;
  isSameDirection: boolean;
}

export interface BranchVisualMarker {
  index: number;
  elementId: string;
  baseCenter: Point;
  angleDeg: number;
}

export interface TopoBranch {
  id: string;
  index: number;
  fromNodeId: string;
  toNodeId: string;
  elements: BranchElement[];
  currentSource?: BranchElement;
  hasResistor: boolean;
  marker?: BranchVisualMarker;
}

export interface LoopBranchEntry {
  branch: TopoBranch;
  isForward: boolean;
}

export interface IndependentLoop {
  id: string;
  index: number;
  entries: LoopBranchEntry[];
  center?: Point;
  elementIds: string[];
  isClockwise: boolean; // true — по часовой стрелке, false — против часовой
}

export interface KirchhoffEquation {
  id: string;
  type: 'KCL' | 'KVL';
  targetLabel: string;
  latex: string;
}

export interface CircuitGraph {
  nodes: TopoNode[];
  branches: TopoBranch[];
}