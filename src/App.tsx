import React, { useState } from 'react';
import styles from './App.module.css';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Canvas } from './components/Canvas/Canvas';
import { OutputPanel } from './components/OutputPanel/OutputPanel';
import type { CircuitElement } from './types/circuit';
import type { Wire } from './types/wiring';
import { buildCircuitGraph } from './core/graph/circuitGraphBuilder';
import { generateKCLEquations } from './core/kirchhoff/kclSolver';
import { findIndependentLoops, generateKVLEquations } from './core/kirchhoff/kvlSolver';
import type { KirchhoffEquation, CircuitGraph, IndependentLoop } from './core/types';
import { findPinPosition } from './utils/circuitGeometry';

export const App: React.FC = () => {
  const [elements, setElements] = useState<CircuitElement[]>([]);
  const [wires, setWires] = useState<Wire[]>([]);
  const [equations, setEquations] = useState<KirchhoffEquation[]>([]);
  const [graph, setGraph] = useState<CircuitGraph | null>(null);
  const [loops, setLoops] = useState<IndependentLoop[]>([]);
  const [hoveredLoopId, setHoveredLoopId] = useState<string | null>(null);
  const [selectedKclNodeId, setSelectedKclNodeId] = useState<string>('ALL');

  const handleCircuitModified = () => {
    if (graph !== null || equations.length > 0) {
      setGraph(null);
      setLoops([]);
      setEquations([]);
      setHoveredLoopId(null);
      setSelectedKclNodeId('ALL');
    }
  };

  const calculateWithGraph = (targetGraph: CircuitGraph, foundLoops: IndependentLoop[], nodeId: string) => {
    const kcl = generateKCLEquations(targetGraph, nodeId);
    const kvl = generateKVLEquations(foundLoops);

    setGraph(targetGraph);
    setLoops(foundLoops);
    setEquations([...kcl, ...kvl]);
  };

  const handleCalculate = () => {
    const resolvedWires = wires.map((wire) => ({
      ...wire,
      from: findPinPosition(wire.fromPinId, elements) || wire.from,
      to: findPinPosition(wire.toPinId, elements) || wire.to,
    }));

    const builtGraph = buildCircuitGraph(elements, resolvedWires);
    const foundLoops = findIndependentLoops(builtGraph);
    calculateWithGraph(builtGraph, foundLoops, selectedKclNodeId);
  };

  const handleSelectKclNode = (nodeId: string) => {
    setSelectedKclNodeId(nodeId);
    if (graph) {
      calculateWithGraph(graph, loops, nodeId);
    }
  };

  return (
    <div className={styles.appWindow}>
      <header className={styles.header}>
        <h1 className={styles.title}>Расчет токов с помощью законов Кирхгофа</h1>
      </header>

      <main className={styles.workspace}>
        <Sidebar />
        <Canvas
          elements={elements}
          wires={wires}
          graph={graph}
          loops={loops}
          hoveredLoopId={hoveredLoopId}
          onHoverLoop={setHoveredLoopId}
          onElementsChange={setElements}
          onWiresChange={setWires}
          onCircuitModified={handleCircuitModified}
        />
      </main>

      <OutputPanel
        onCalculate={handleCalculate}
        equations={equations}
        nodes={graph ? graph.nodes : []}
        selectedKclNodeId={selectedKclNodeId}
        onSelectKclNode={handleSelectKclNode}
        hoveredLoopId={hoveredLoopId}
        onHoverLoop={setHoveredLoopId}
      />
    </div>
  );
};

export default App;