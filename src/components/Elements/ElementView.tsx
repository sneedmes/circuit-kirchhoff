import React from 'react';
import type { ElementType } from '../../types/circuit';
import styles from './ElementView.module.css';

interface ElementViewProps {
    type: ElementType;
    label: string;
    x?: number;
    y?: number;
    rotation?: number;
    showPins?: boolean;
    isSelected?: boolean;
    isHighlighted?: boolean; // Пропс подсветки контура
    onPinMouseDown?: (e: React.MouseEvent, pinIndex: 1 | 2) => void;
}

export const ElementView: React.FC<ElementViewProps> = ({
    type,
    label,
    x = 0,
    y = 0,
    rotation = 0,
    showPins = true,
    isSelected = false,
    isHighlighted = false,
    onPinMouseDown,
}) => {
    const isVertical = rotation === 90 || rotation === 270;
    const labelOffsetX = isVertical ? 28 : 0;
    const labelOffsetY = isVertical ? 0 : (type === 'RESISTOR' ? -18 : -26);
    const textAnchor = isVertical ? 'start' : 'middle';

    return (
        <g
            transform={`translate(${x}, ${y})`}
            className={`${styles.elementGroup} ${isSelected ? styles.selected : ''} ${isHighlighted ? styles.highlighted : ''}`}
        >
            <g transform={`rotate(${rotation})`}>
                {isSelected && (
                    <rect
                        x="-46"
                        y="-30"
                        width="92"
                        height="60"
                        className={styles.selectionBox}
                    />
                )}

                <line x1="-40" y1="0" x2="-20" y2="0" className={styles.wirePath} />
                <line x1="20" y1="0" x2="40" y2="0" className={styles.wirePath} />

                {type === 'RESISTOR' && (
                    <rect
                        x="-20"
                        y="-10"
                        width="40"
                        height="20"
                        className={styles.symbolBody}
                    />
                )}

                {type === 'VOLTAGE_SOURCE' && (
                    <>
                        <circle cx="0" cy="0" r="20" className={styles.symbolBody} />
                        <line x1="-14" y1="0" x2="14" y2="0" className={styles.arrow} />
                        <polyline points="6,-5 14,0 6,5" className={styles.arrow} />
                    </>
                )}

                {type === 'CURRENT_SOURCE' && (
                    <>
                        <circle cx="0" cy="0" r="20" className={styles.symbolBody} />
                        <polyline points="-7,-5 -1,0 -7,5" className={styles.arrow} />
                        <polyline points="1,-5 7,0 1,5" className={styles.arrow} />
                    </>
                )}

                {showPins && (
                    <>
                        <circle
                            cx="-40"
                            cy="0"
                            r="4.5"
                            className={styles.pin}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                onPinMouseDown?.(e, 1);
                            }}
                        />
                        <circle
                            cx="40"
                            cy="0"
                            r="4.5"
                            className={styles.pin}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                onPinMouseDown?.(e, 2);
                            }}
                        />
                    </>
                )}
            </g>

            <text
                x={labelOffsetX}
                y={labelOffsetY}
                textAnchor={textAnchor}
                dominantBaseline="central"
                className={styles.label}
            >
                {label}
            </text>
        </g>
    );
};