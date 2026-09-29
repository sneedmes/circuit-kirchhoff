import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import styles from './Canvas.module.css';
import { GRID_SIZE, snapToGrid, type Point } from '../../utils/grid';
import type { CircuitElement, ElementType } from '../../types/circuit';
import type { Wire } from '../../types/wiring';
import {
    getElementPins,
    detectVisualNodes,
    findPinPosition,
    findNearbyPin,
    findNearbyWire,
} from '../../utils/circuitGeometry';
import { ElementView } from '../Elements/ElementView';
import type { CircuitGraph, IndependentLoop } from '../../core/types';
import { getNextElementLabel } from '../../utils/elementNaming';
import { calculateSafeMarkerPosition } from '../../utils/markerPlacement';

interface CanvasProps {
    elements: CircuitElement[];
    wires: Wire[];
    graph: CircuitGraph | null;
    loops: IndependentLoop[];
    hoveredLoopId: string | null;
    onHoverLoop: (loopId: string | null) => void;
    onElementsChange: React.Dispatch<React.SetStateAction<CircuitElement[]>>;
    onWiresChange: React.Dispatch<React.SetStateAction<Wire[]>>;
    onCircuitModified: () => void;
}

export const Canvas: React.FC<CanvasProps> = ({
    elements,
    wires,
    graph,
    loops,
    hoveredLoopId,
    onHoverLoop,
    onElementsChange,
    onWiresChange,
    onCircuitModified,
}) => {
    const [zoom, setZoom] = useState<number>(1);
    const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState<boolean>(false);
    const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });

    const [drawingWireStart, setDrawingWireStart] = useState<{ point: Point; pinId?: string } | null>(null);
    const [currentMousePos, setCurrentMousePos] = useState<Point | null>(null);

    const svgRef = useRef<SVGSVGElement | null>(null);

    const toWorldCoords = useCallback(
        (screenX: number, screenY: number): Point => {
            if (!svgRef.current) return { x: 0, y: 0 };
            const rect = svgRef.current.getBoundingClientRect();
            const clickX = screenX - rect.left;
            const clickY = screenY - rect.top;

            const worldX = (clickX - pan.x) / zoom;
            const worldY = (clickY - pan.y) / zoom;
            return snapToGrid(worldX, worldY);
        },
        [pan, zoom]
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!selectedId) return;

            if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
                onCircuitModified();
                onElementsChange((prev) =>
                    prev.map((el) =>
                        el.id === selectedId
                            ? { ...el, rotation: (el.rotation + 90) % 360 }
                            : el
                    )
                );
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                onCircuitModified();
                onElementsChange((prev) => prev.filter((el) => el.id !== selectedId));
                const p1Id = `${selectedId}_pin1`;
                const p2Id = `${selectedId}_pin2`;
                onWiresChange((prev) =>
                    prev.filter(
                        (w) =>
                            w.fromPinId !== p1Id &&
                            w.fromPinId !== p2Id &&
                            w.toPinId !== p1Id &&
                            w.toPinId !== p2Id
                    )
                );
                setSelectedId(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedId, onElementsChange, onWiresChange, onCircuitModified]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const zoomFactor = 1.1;
        const newZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
        if (newZoom >= 0.4 && newZoom <= 2.5) {
            setZoom(newZoom);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('circuit/element-type') as ElementType;
        if (!type) return;

        onCircuitModified();
        const snapped = toWorldCoords(e.clientX, e.clientY);
        const label = getNextElementLabel(type, elements);

        const newElement: CircuitElement = {
            id: crypto.randomUUID(),
            type,
            label,
            x: snapped.x,
            y: snapped.y,
            rotation: 0,
        };

        onElementsChange((prev) => [...prev, newElement]);
        setSelectedId(newElement.id);
    };

    const handleSvgMouseDown = (e: React.MouseEvent) => {
        if (e.button === 1 || e.altKey) {
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            return;
        }

        const world = toWorldCoords(e.clientX, e.clientY);
        const wireHit = findNearbyWire(world, wires);
        if (wireHit) {
            setDrawingWireStart({ point: wireHit.splitPoint });
            setCurrentMousePos(wireHit.splitPoint);
            return;
        }

        if (e.target === svgRef.current || (e.target as HTMLElement).tagName === 'rect') {
            setSelectedId(null);
        }
    };

    const handlePinMouseDown = (element: CircuitElement, pinIndex: 1 | 2) => {
        const pins = getElementPins(element);
        const selectedPin = pins[pinIndex - 1];

        setDrawingWireStart({
            point: selectedPin.position,
            pinId: selectedPin.id,
        });
        setCurrentMousePos(selectedPin.position);
    };

    const handleElementMouseDown = (e: React.MouseEvent, el: CircuitElement) => {
        e.stopPropagation();
        setSelectedId(el.id);
        onCircuitModified();

        const world = toWorldCoords(e.clientX, e.clientY);
        setDraggingId(el.id);
        setDragOffset({
            x: world.x - el.x,
            y: world.y - el.y,
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y,
            });
            return;
        }

        const world = toWorldCoords(e.clientX, e.clientY);

        if (drawingWireStart) {
            setCurrentMousePos(world);
            return;
        }

        if (draggingId) {
            const newX = snapToGrid(world.x - dragOffset.x, 0).x;
            const newY = snapToGrid(0, world.y - dragOffset.y).y;

            onElementsChange((prev) =>
                prev.map((el) => (el.id === draggingId ? { ...el, x: newX, y: newY } : el))
            );
        }
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (isPanning) {
            setIsPanning(false);
            return;
        }

        if (drawingWireStart && currentMousePos) {
            const endWorld = toWorldCoords(e.clientX, e.clientY);
            const targetPin = findNearbyPin(endWorld, elements);
            const wireHit = findNearbyWire(endWorld, wires);

            if (targetPin) {
                const finalToPos = targetPin.position;
                if (drawingWireStart.point.x !== finalToPos.x || drawingWireStart.point.y !== finalToPos.y) {
                    onCircuitModified();
                    const newWire: Wire = {
                        id: crypto.randomUUID(),
                        from: drawingWireStart.point,
                        to: finalToPos,
                        fromPinId: drawingWireStart.pinId,
                        toPinId: targetPin.id,
                    };
                    onWiresChange((prev) => [...prev, newWire]);
                }
            } else if (wireHit) {
                const splitPoint = wireHit.splitPoint;

                if (drawingWireStart.point.x !== splitPoint.x || drawingWireStart.point.y !== splitPoint.y) {
                    onCircuitModified();
                    const originalWire = wireHit.wire;
                    const wirePart1: Wire = {
                        id: crypto.randomUUID(),
                        from: originalWire.from,
                        to: splitPoint,
                        fromPinId: originalWire.fromPinId,
                    };
                    const wirePart2: Wire = {
                        id: crypto.randomUUID(),
                        from: splitPoint,
                        to: originalWire.to,
                        toPinId: originalWire.toPinId,
                    };
                    const branchWire: Wire = {
                        id: crypto.randomUUID(),
                        from: drawingWireStart.point,
                        to: splitPoint,
                        fromPinId: drawingWireStart.pinId,
                    };

                    onWiresChange((prev) => [
                        ...prev.filter((w) => w.id !== originalWire.id),
                        wirePart1,
                        wirePart2,
                        branchWire,
                    ]);
                }
            }

            setDrawingWireStart(null);
            setCurrentMousePos(null);
        }

        setDraggingId(null);
    };

    const resolvedWires = useMemo(() => {
        return wires.map((wire) => ({
            ...wire,
            from: findPinPosition(wire.fromPinId, elements) || wire.from,
            to: findPinPosition(wire.toPinId, elements) || wire.to,
        }));
    }, [wires, elements]);

    const visualNodes = useMemo(() => {
        return detectVisualNodes(elements, resolvedWires);
    }, [elements, resolvedWires]);

    // ID элементов активного подсвеченного контура
    const highlightedElementIds = useMemo(() => {
        if (!hoveredLoopId) return new Set<string>();
        const loop = loops.find((l) => l.id === hoveredLoopId);
        return loop ? new Set(loop.elementIds) : new Set<string>();
    }, [hoveredLoopId, loops]);

    return (
        <div className={styles.canvasContainer}>
            <div style={{
                position: 'absolute',
                top: 10,
                right: 12,
                fontSize: '11px',
                color: '#64748b',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                pointerEvents: 'none',
                lineHeight: 1.5,
                zIndex: 10,
            }}>
                <div><b>R:</b> повернуть элемент</div>
                <div><b>Del:</b> удалить элемент</div>
                <div><b>Колесико:</b> масштаб / сдвиг</div>
            </div>

            <svg
                ref={svgRef}
                className={styles.svgRoot}
                id="circuit-canvas"
                onWheel={handleWheel}
                onMouseDown={handleSvgMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onDrop={handleDrop}
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                }}
            >
                <defs>
                    <pattern
                        id="grid-pattern"
                        width={GRID_SIZE}
                        height={GRID_SIZE}
                        patternUnits="userSpaceOnUse"
                    >
                        <path
                            d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
                            fill="none"
                            className={styles.gridPatternLine}
                        />
                    </pattern>

                    {/* Стрелка для токов ветвей (красная) */}
                    <marker
                        id="current-arrow"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                    >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626" />
                    </marker>

                    {/* Круговая стрелка направления контура (фиолетовая) */}
                    <marker
                        id="loop-arrow"
                        viewBox="0 0 10 10"
                        refX="6"
                        refY="5"
                        markerWidth="5"
                        markerHeight="5"
                        orient="auto"
                    >
                        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8b5cf6" />
                    </marker>
                </defs>

                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                    <rect
                        x={-5000}
                        y={-5000}
                        width={10000}
                        height={10000}
                        fill="url(#grid-pattern)"
                    />

                    {/* Слой проводов */}
                    <g id="wires-layer">
                        {resolvedWires.map((wire) => (
                            <line
                                key={wire.id}
                                x1={wire.from.x}
                                y1={wire.from.y}
                                x2={wire.to.x}
                                y2={wire.to.y}
                                stroke="#0f172a"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                            />
                        ))}

                        {drawingWireStart && currentMousePos && (
                            <line
                                x1={drawingWireStart.point.x}
                                y1={drawingWireStart.point.y}
                                x2={currentMousePos.x}
                                y2={currentMousePos.y}
                                stroke="#2563eb"
                                strokeWidth="2.5"
                                strokeDasharray="4 4"
                            />
                        )}
                    </g>

                    {/* Слой компонентов */}
                    <g id="elements-layer">
                        {elements.map((el) => (
                            <g
                                key={el.id}
                                onMouseDown={(e) => handleElementMouseDown(e, el)}
                            >
                                <ElementView
                                    type={el.type}
                                    label={el.label}
                                    x={el.x}
                                    y={el.y}
                                    rotation={el.rotation}
                                    showPins={true}
                                    isSelected={el.id === selectedId}
                                    isHighlighted={highlightedElementIds.has(el.id)}
                                    onPinMouseDown={(_, pinIndex) => handlePinMouseDown(el, pinIndex)}
                                />
                            </g>
                        ))}
                    </g>

                    {/* Слой узлов цепи (A, B...) */}
                    <g id="nodes-layer">
                        {visualNodes.map((node) => (
                            <g key={node.id} transform={`translate(${node.position.x}, ${node.position.y})`}>
                                <circle r="9" fill="#2563eb" stroke="#ffffff" strokeWidth="1.5" />
                                <text
                                    textAnchor="middle"
                                    dominantBaseline="central"
                                    fill="#ffffff"
                                    fontSize="10"
                                    fontWeight="bold"
                                >
                                    {node.label}
                                </text>
                            </g>
                        ))}
                    </g>

                    {/* Слой токов ветвей (I1, I2...) */}
                    {graph && (
                        <g id="branch-currents-layer">
                            {graph.branches.map((b) => {
                                if (!b.marker) return null;
                                const { baseCenter, angleDeg, index, elementId } = b.marker;

                                const placement = calculateSafeMarkerPosition(
                                    baseCenter,
                                    angleDeg,
                                    elements,
                                    visualNodes,
                                    elementId
                                );

                                return (
                                    <g key={b.id}>
                                        <g
                                            transform={`translate(${placement.arrowPoint.x}, ${placement.arrowPoint.y}) rotate(${placement.angleDeg})`}
                                        >
                                            <line
                                                x1="-16"
                                                y1="0"
                                                x2="16"
                                                y2="0"
                                                stroke="#dc2626"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                markerEnd="url(#current-arrow)"
                                            />
                                        </g>

                                        <rect
                                            x={placement.textPoint.x - 12}
                                            y={placement.textPoint.y - 8}
                                            width="24"
                                            height="16"
                                            fill="#ffffff"
                                            opacity="0.85"
                                            rx="3"
                                        />

                                        <text
                                            x={placement.textPoint.x}
                                            y={placement.textPoint.y}
                                            fill="#dc2626"
                                            fontSize="13"
                                            fontWeight="bold"
                                            fontStyle="italic"
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                        >
                                            {b.currentSource ? b.currentSource.label : `I${index}`}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    )}

                    {/* Слой круговых стрелок независимых контуров 2ЗК */}
                    {loops.length > 0 && (
                        <g id="loops-layer">
                            {loops.map((loop) => {
                                if (!loop.center) return null;
                                const isHovered = hoveredLoopId === loop.id;

                                const pathData = loop.isClockwise
                                    ? 'M 0 -13 A 13 13 0 1 1 -13 0' // По часовой (CW)
                                    : 'M 0 -13 A 13 13 0 1 0 13 0'; // Против часовой (CCW)

                                return (
                                    <g
                                        key={loop.id}
                                        transform={`translate(${loop.center.x}, ${loop.center.y})`}
                                        style={{ cursor: 'pointer' }}
                                        onMouseEnter={() => onHoverLoop(loop.id)}
                                        onMouseLeave={() => onHoverLoop(null)}
                                    >
                                        {/* Полупрозрачная подложка */}
                                        <circle
                                            r="18"
                                            fill={isHovered ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.92)'}
                                            stroke={isHovered ? '#8b5cf6' : '#cbd5e1'}
                                            strokeWidth={isHovered ? '2' : '1.5'}
                                        />

                                        {/* Дуга со стрелкой направления */}
                                        <path
                                            d={pathData}
                                            fill="none"
                                            stroke="#8b5cf6"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            markerEnd="url(#loop-arrow)"
                                        />

                                        {/* Номер контура */}
                                        <text
                                            x="0"
                                            y="0"
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                            fill="#8b5cf6"
                                            fontSize="11"
                                            fontWeight="bold"
                                        >
                                            {loop.index}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    )}
                </g>
            </svg>
        </div>
    );
};