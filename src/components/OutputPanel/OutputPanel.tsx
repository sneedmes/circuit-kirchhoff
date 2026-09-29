import React, { useState, useEffect } from 'react';
import katex from 'katex';
import styles from './OutputPanel.module.css';
import type { KirchhoffEquation, TopoNode } from '../../core/types';

interface OutputPanelProps {
    onCalculate: () => void;
    equations: KirchhoffEquation[];
    nodes: TopoNode[];
    selectedKclNodeId: string;
    onSelectKclNode: (nodeId: string) => void;
    hoveredLoopId: string | null;
    onHoverLoop: (loopId: string | null) => void;
}

export const OutputPanel: React.FC<OutputPanelProps> = ({
    onCalculate,
    equations,
    nodes,
    selectedKclNodeId,
    onSelectKclNode,
    hoveredLoopId,
    onHoverLoop,
}) => {
    const [height, setHeight] = useState<number>(220);
    const [isResizing, setIsResizing] = useState<boolean>(false);

    const kclEquations = equations.filter((eq) => eq.type === 'KCL');
    const kvlEquations = equations.filter((eq) => eq.type === 'KVL');

    const renderFormula = (latex: string) => {
        try {
            return {
                __html: katex.renderToString(latex, { throwOnError: false }),
            };
        } catch {
            return { __html: latex };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const newHeight = window.innerHeight - e.clientY;
            if (newHeight >= 90 && newHeight <= 600) {
                setHeight(newHeight);
            }
        };

        const handleMouseUp = () => setIsResizing(false);

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    return (
        <section className={styles.panel} style={{ height: `${height}px` }}>
            <div
                className={`${styles.resizer} ${isResizing ? styles.resizerActive : ''}`}
                onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                }}
            >
                <div className={styles.resizerHandle} />
            </div>

            <div className={styles.contentWrapper}>
                <button className={styles.actionButton} onClick={onCalculate}>
                    Составить уравнение по схеме
                </button>

                <div className={styles.equationsContainer}>
                    {equations.length === 0 && (
                        <p className={styles.emptyHint}>
                            Соберите замкнутую цепь и нажмите кнопку для расчета
                        </p>
                    )}

                    {equations.length > 0 && (
                        <div className={styles.group}>
                            <h3 className={styles.groupTitle}>По I закону Кирхгофа (для узлов):</h3>

                            {nodes.length > 1 && (
                                <div className={styles.nodeFilterRow}>
                                    <span className={styles.nodeFilterLabel}>Выбор узла:</span>
                                    <button
                                        className={`${styles.nodeChip} ${selectedKclNodeId === 'ALL' ? styles.nodeChipActive : ''}`}
                                        onClick={() => onSelectKclNode('ALL')}
                                    >
                                        Все независимые (N - 1)
                                    </button>
                                    {nodes.map((n) => (
                                        <button
                                            key={n.id}
                                            className={`${styles.nodeChip} ${selectedKclNodeId === n.id ? styles.nodeChipActive : ''}`}
                                            onClick={() => onSelectKclNode(n.id)}
                                        >
                                            Узел {n.label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className={styles.list}>
                                {kclEquations.map((eq) => (
                                    <div key={eq.id} className={styles.equationRow}>
                                        <span className={styles.label}>{eq.targetLabel}:</span>
                                        <span dangerouslySetInnerHTML={renderFormula(eq.latex)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {kvlEquations.length > 0 && (
                        <div className={styles.group}>
                            <h3 className={styles.groupTitle}>По II закону Кирхгофа (для контуров):</h3>
                            <div className={styles.list}>
                                {kvlEquations.map((eq) => (
                                    <div
                                        key={eq.id}
                                        className={`${styles.equationRow} ${hoveredLoopId === eq.id ? styles.equationRowHighlight : ''}`}
                                        onMouseEnter={() => onHoverLoop(eq.id)}
                                        onMouseLeave={() => onHoverLoop(null)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <span className={styles.label}>{eq.targetLabel}:</span>
                                        <span dangerouslySetInnerHTML={renderFormula(eq.latex)} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};