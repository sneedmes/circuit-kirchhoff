import React from 'react';
import styles from './Sidebar.module.css';
import { ElementView } from '../Elements/ElementView';
import { type ElementType } from '../../types/circuit';

interface ToolItem {
    type: ElementType;
    title: string;
    defaultLabel: string;
}

const TOOLS: ToolItem[] = [
    { type: 'RESISTOR', title: 'Сопротивление', defaultLabel: 'R' },
    { type: 'CURRENT_SOURCE', title: 'Источник тока', defaultLabel: 'J' },
    { type: 'VOLTAGE_SOURCE', title: 'ЭДС', defaultLabel: 'E' },
];

export const Sidebar: React.FC = () => {
    const handleDragStart = (e: React.DragEvent, type: ElementType) => {
        e.dataTransfer.setData('circuit/element-type', type);
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <aside className={styles.sidebar}>
            <h2 className={styles.title}>Выбор элементов</h2>
            <p className={styles.subtitle}>
                Перетащите элементы на доску для создания цепи
            </p>

            <div className={styles.elementList}>
                {TOOLS.map((tool) => (
                    <div
                        key={tool.type}
                        className={styles.toolCard}
                        draggable
                        onDragStart={(e) => handleDragStart(e, tool.type)}
                    >
                        <span className={styles.toolLabel}>{tool.title}</span>
                        <svg width="100" height="80" viewBox="-50 -30 100 60">
                            <ElementView
                                type={tool.type}
                                label={tool.defaultLabel}
                                showPins={false}
                            />
                        </svg>
                    </div>
                ))}
            </div>
        </aside>
    );
};