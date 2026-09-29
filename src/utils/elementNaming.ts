import type { CircuitElement, ElementType } from '../types/circuit';

export const getNextElementLabel = (type: ElementType, elements: CircuitElement[]): string => {
  let prefix = 'R';
  if (type === 'VOLTAGE_SOURCE') prefix = 'E';
  if (type === 'CURRENT_SOURCE') prefix = 'J';

  const usedIndices = new Set<number>();

  elements.forEach((el) => {
    if (el.type === type && el.label.startsWith(prefix)) {
      const numPart = parseInt(el.label.replace(prefix, ''), 10);
      if (!isNaN(numPart)) {
        usedIndices.add(numPart);
      }
    }
  });

  let nextIndex = 1;
  while (usedIndices.has(nextIndex)) {
    nextIndex++;
  }

  return `${prefix}${nextIndex}`;
};