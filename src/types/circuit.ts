export type ElementType = 'RESISTOR' | 'VOLTAGE_SOURCE' | 'CURRENT_SOURCE';

export interface CircuitElement {
  id: string;
  type: ElementType;
  label: string;     
  x: number;         
  y: number;
  rotation: number;  
}