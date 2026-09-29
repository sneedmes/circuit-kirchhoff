import type {
  CircuitGraph,
  KirchhoffEquation,
  TopoBranch,
  IndependentLoop,
  LoopBranchEntry,
} from '../types';
import type { Point } from '../../utils/grid';

interface HalfEdge {
  id: string;
  branch: TopoBranch;
  fromNodeId: string;
  toNodeId: string;
  isForward: boolean;
  angle: number;
}

interface Face {
  halfEdges: HalfEdge[];
  area: number;
  componentId: string;
}

const EPSILON = 1e-6;

/**
 * Определяет геометрическое направление ветви
 * в конкретной точке узла.
 *
 * Если у ветви есть marker, используем его как промежуточную
 * геометрическую точку. Это позволяет различать параллельные
 * визуально разведённые ветви.
 */
const getEdgeAngle = (
  branch: TopoBranch,
  fromNode: Point,
  toNode: Point
): number => {
  const marker = branch.marker?.baseCenter;

  if (marker) {
    const dx = marker.x - fromNode.x;
    const dy = marker.y - fromNode.y;

    if (Math.hypot(dx, dy) > EPSILON) {
      return Math.atan2(dy, dx);
    }
  }

  return Math.atan2(
    toNode.y - fromNode.y,
    toNode.x - fromNode.x
  );
};

/**
 * Signed area полигона в координатах SVG.
 *
 * В SVG Y направлен вниз, поэтому:
 *
 *   area > 0 → обход по часовой стрелке
 *   area < 0 → обход против часовой стрелки
 */
const getLoopArea = (points: Point[]): number => {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];

    area += a.x * b.y - b.x * a.y;
  }

  return area / 2;
};

/**
 * Разбивает passive graph на связные компоненты.
 *
 * Это нужно для удаления внешней грани каждого компонента
 * отдельно.
 */
const getComponentIds = (
  graph: CircuitGraph,
  branches: TopoBranch[]
): Map<string, string> => {
  const parent = new Map<string, string>();

  graph.nodes.forEach((node) => {
    parent.set(node.id, node.id);
  });

  const find = (id: string): string => {
    let root = id;

    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }

    let current = id;

    while (parent.get(current) !== current) {
      const next = parent.get(current)!;

      parent.set(current, root);
      current = next;
    }

    return root;
  };

  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) {
      return;
    }

    const rootA = find(a);
    const rootB = find(b);

    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  branches.forEach((branch) => {
    union(branch.fromNodeId, branch.toNodeId);
  });

  const result = new Map<string, string>();

  graph.nodes.forEach((node) => {
    result.set(node.id, find(node.id));
  });

  return result;
};

/**
 * Центр строгого bounding box всей геометрии грани.
 *
 * Учитываются:
 *
 *   - позиции узлов;
 *   - marker каждой ветви.
 *
 * Поэтому центр не зависит от того, какая ветвь
 * случайно оказалась первой в DFS.
 */
const getFaceCenter = (
  face: Face,
  nodeById: Map<string, Point>
): Point | undefined => {
  const points: Point[] = [];

  face.halfEdges.forEach((edge) => {
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);

    if (from) {
      points.push(from);
    }

    if (to) {
      points.push(to);
    }

    if (edge.branch.marker) {
      points.push(edge.branch.marker.baseCenter);
    }
  });

  if (points.length === 0) {
    return undefined;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });

  return {
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2),
  };
};

/**
 * Поиск независимых контуров как визуальных граней
 * планарного графа.
 *
 * В старой реализации использовались fundamental cycles,
 * получаемые через DFS. Такой подход математически корректен
 * как cycle basis, но не обязан соответствовать визуальным
 * ячейкам схемы.
 *
 * Здесь используется half-edge traversal:
 *
 *   1. Каждая ветвь превращается в два направленных half-edge.
 *   2. Исходящие half-edge каждого узла сортируются по углу.
 *   3. Для каждого half-edge выбирается следующее ребро
 *      на границе той же грани.
 *   4. Полученные циклы являются границами граней.
 *   5. Внешняя грань каждого компонента удаляется.
 *
 * CURRENT_SOURCE намеренно не участвует в KVL-графе.
 */
export const findIndependentLoops = (
  graph: CircuitGraph
): IndependentLoop[] => {
  const { nodes } = graph;

  const passiveBranches = graph.branches.filter(
    (branch) => !branch.currentSource
  );

  if (passiveBranches.length === 0) {
    return [];
  }

  const nodeById = new Map<string, Point>();

  nodes.forEach((node) => {
    if (node.position) {
      nodeById.set(node.id, node.position);
    }
  });

  /*
   * Одноконтурная цепь без явных визуальных узлов.
   *
   * graphBuilder создаёт для неё один технический узел.
   * Поэтому обычный half-edge обход здесь неприменим:
   * branch имеет вид A -> A.
   */
  if (nodes.length <= 1) {
    const branch = passiveBranches[0];

    if (!branch) {
      return [];
    }

    const points: Point[] = [];

    const node = nodeById.get(branch.fromNodeId);

    if (node) {
      points.push(node);
    }

    if (branch.marker) {
      points.push(branch.marker.baseCenter);
    }

    let center: Point | undefined;

    if (points.length > 0) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);

      center = {
        x: Math.round(
          (Math.min(...xs) + Math.max(...xs)) / 2
        ),
        y: Math.round(
          (Math.min(...ys) + Math.max(...ys)) / 2
        ),
      };
    }

    return [
      {
        id: 'loop_1',
        index: 1,

        entries: [
          {
            branch,
            isForward: true,
          },
        ],

        elementIds: branch.elements.map(
          (element) => element.id
        ),

        center,

        isClockwise: true,
      },
    ];
  }

  /*
   * Исходящие half-edge каждого узла.
   */
  const outgoing = new Map<string, HalfEdge[]>();

  nodes.forEach((node) => {
    outgoing.set(node.id, []);
  });

  passiveBranches.forEach((branch) => {
    const from = nodeById.get(branch.fromNodeId);
    const to = nodeById.get(branch.toNodeId);

    if (!from || !to) {
      return;
    }

    /*
     * Self-loop для обычного graph не рассматриваем.
     * Одноконтурный случай обработан выше.
     */
    if (branch.fromNodeId === branch.toNodeId) {
      return;
    }

    const forward: HalfEdge = {
      id: `${branch.id}:forward`,
      branch,
      fromNodeId: branch.fromNodeId,
      toNodeId: branch.toNodeId,
      isForward: true,
      angle: getEdgeAngle(
        branch,
        from,
        to
      ),
    };

    const backward: HalfEdge = {
      id: `${branch.id}:backward`,
      branch,
      fromNodeId: branch.toNodeId,
      toNodeId: branch.fromNodeId,
      isForward: false,
      angle: getEdgeAngle(
        branch,
        to,
        from
      ),
    };

    outgoing
      .get(forward.fromNodeId)
      ?.push(forward);

    outgoing
      .get(backward.fromNodeId)
      ?.push(backward);
  });

  /*
   * В экранных координатах atan2 увеличивается
   * по часовой стрелке.
   *
   * Поэтому сортировка по углу по возрастанию
   * даёт clockwise-порядок лучей.
   */
  outgoing.forEach((edges) => {
    edges.sort((a, b) => {
      const angleDiff = a.angle - b.angle;

      if (Math.abs(angleDiff) > EPSILON) {
        return angleDiff;
      }

      /*
       * Детерминированный tie-breaker.
       *
       * Для параллельных ветвей их marker обычно уже
       * даёт разные углы. Если углы всё же совпали,
       * используем ID.
       */
      return a.branch.id.localeCompare(
        b.branch.id
      );
    });
  });

  const halfEdgeById = new Map<string, HalfEdge>();

  outgoing.forEach((edges) => {
    edges.forEach((edge) => {
      halfEdgeById.set(edge.id, edge);
    });
  });

  const visited = new Set<string>();

  const faces: Face[] = [];

  const componentIds = getComponentIds(
    graph,
    passiveBranches
  );

  /**
   * Находит следующее half-edge вдоль той же грани.
   *
   * Мы пришли в current.toNodeId.
   *
   * Сначала находим обратное ребро.
   * Затем берём ребро непосредственно перед ним
   * в clockwise-сортировке.
   *
   * Это продолжает обход одной грани.
   */
  const getNextHalfEdge = (
    current: HalfEdge
  ): HalfEdge | undefined => {
    const edges = outgoing.get(
      current.toNodeId
    );

    if (!edges || edges.length === 0) {
      return undefined;
    }

    const reverseId = `${current.branch.id}:${
      current.isForward
        ? 'backward'
        : 'forward'
    }`;

    const reverseIndex = edges.findIndex(
      (edge) => edge.id === reverseId
    );

    if (reverseIndex < 0) {
      return undefined;
    }

    const nextIndex =
      (reverseIndex - 1 + edges.length) %
      edges.length;

    return edges[nextIndex];
  };

  /*
   * Обходим все half-edge.
   */
  halfEdgeById.forEach((start) => {
    if (visited.has(start.id)) {
      return;
    }

    const cycle: HalfEdge[] = [];

    let current: HalfEdge | undefined = start;

    /*
     * Защита от повреждённого topology.
     */
    let guard = 0;

    while (
      current &&
      !visited.has(current.id) &&
      guard < halfEdgeById.size + 1
    ) {
      visited.add(current.id);

      cycle.push(current);

      current = getNextHalfEdge(current);

      guard++;

      if (current?.id === start.id) {
        break;
      }
    }

    /*
     * Если traversal не замкнулся,
     * это не полноценная грань.
     */
    if (
      current?.id !== start.id ||
      cycle.length < 2
    ) {
      return;
    }

    const points = cycle
      .map((edge) =>
        nodeById.get(edge.fromNodeId)
      )
      .filter(
        (point): point is Point =>
          Boolean(point)
      );

    const area = getLoopArea(points);

    /*
     * Нулевые циклы возникают у мостов / вырожденных
     * геометрических случаев. Это не визуальные ячейки.
     */
    if (Math.abs(area) <= EPSILON) {
      return;
    }

    const componentId =
      componentIds.get(
        cycle[0].fromNodeId
      ) ?? cycle[0].fromNodeId;

    faces.push({
      halfEdges: cycle,
      area,
      componentId,
    });
  });

  /*
   * Собираем грани по компонентам.
   */
  const facesByComponent =
    new Map<string, Face[]>();

  faces.forEach((face) => {
    const list =
      facesByComponent.get(
        face.componentId
      ) ?? [];

    list.push(face);

    facesByComponent.set(
      face.componentId,
      list
    );
  });

  const boundedFaces: Face[] = [];

  /*
   * У каждой связной компоненты есть одна внешняя грань.
   *
   * Она имеет максимальную площадь по модулю.
   *
   * Остальные грани являются внутренними
   * визуальными ячейками.
   */
  facesByComponent.forEach(
    (componentFaces) => {
      if (componentFaces.length <= 1) {
        return;
      }

      let outerFace =
        componentFaces[0];

      componentFaces.forEach((face) => {
        if (
          Math.abs(face.area) >
          Math.abs(outerFace.area)
        ) {
          outerFace = face;
        }
      });

      componentFaces.forEach((face) => {
        if (face !== outerFace) {
          boundedFaces.push(face);
        }
      });
    }
  );

  /*
   * Детерминированный порядок контуров:
   * сначала X центра, затем Y.
   */
  boundedFaces.sort((a, b) => {
    const aCenter = getFaceCenter(
      a,
      nodeById
    );

    const bCenter = getFaceCenter(
      b,
      nodeById
    );

    return (
      (aCenter?.x ?? 0) -
        (bCenter?.x ?? 0) ||
      (aCenter?.y ?? 0) -
        (bCenter?.y ?? 0)
    );
  });

  return boundedFaces.map(
    (face, index) => {
      /*
       * Направление каждого branch внутри
       * конкретного контура берётся непосредственно
       * из half-edge traversal.
       *
       * Поэтому знак KVL теперь соответствует
       * реальному направлению обхода границы ячейки.
       */
      const entries: LoopBranchEntry[] =
        face.halfEdges.map(
          (edge) => ({
            branch: edge.branch,
            isForward:
              edge.isForward,
          })
        );

      /*
       * Все элементы контура.
       */
      const elementIds = Array.from(
        new Set(
          entries.flatMap(
            ({ branch }) =>
              branch.elements.map(
                (element) =>
                  element.id
              )
          )
        )
      );

      return {
        id: `loop_${index + 1}`,

        index: index + 1,

        entries,

        elementIds,

        /*
         * Центр строгого bounding box
         * всей геометрии ячейки.
         */
        center: getFaceCenter(
          face,
          nodeById
        ),

        /*
         * Signed area в SVG-координатах:
         *
         *   > 0 → clockwise
         *   < 0 → counter-clockwise
         *
         * Canvas использует это значение
         * непосредственно для направления стрелки.
         */
        isClockwise:
          face.area > 0,
      };
    }
  );
};

/**
 * Генерирует уравнения KVL для найденных
 * визуальных ячеек.
 */
export const generateKVLEquations = (
  loops: IndependentLoop[]
): KirchhoffEquation[] => {
  const equations: KirchhoffEquation[] = [];

  loops.forEach((loop) => {
    const voltageDrops: string[] = [];
    const emfs: string[] = [];

    loop.entries.forEach(
      ({ branch, isForward }) => {
        /*
         * Резисторы.
         */
        const resistors =
          branch.elements.filter(
            (element) =>
              element.type ===
              'RESISTOR'
          );

        if (resistors.length > 0) {
          const rLabels =
            resistors
              .map(
                (resistor) =>
                  resistor.label
              )
              .join(' + ');

          const sign =
            isForward
              ? '+'
              : '-';

          const rTerm =
            resistors.length > 1
              ? `(${rLabels})`
              : rLabels;

          voltageDrops.push(
            `${sign} I_{${branch.index}} \\cdot ${rTerm}`
          );
        }

        /*
         * Источники напряжения.
         */
        const voltageSources =
          branch.elements.filter(
            (element) =>
              element.type ===
              'VOLTAGE_SOURCE'
          );

        voltageSources.forEach(
          (vs) => {
            /*
             * isSameDirection описывает физическое
             * направление источника относительно
             * канонического направления branch.
             *
             * isForward описывает направление
             * текущего обхода контура.
             */
            const isEmfForward =
              vs.isSameDirection ===
              isForward;

            const sign =
              isEmfForward
                ? '+'
                : '-';

            emfs.push(
              `${sign} ${vs.label}`
            );
          }
        );
      }
    );

    let leftSide =
      voltageDrops.length > 0
        ? voltageDrops.join(' ')
        : '0';

    if (
      leftSide.startsWith('+ ')
    ) {
      leftSide =
        leftSide.substring(2);
    }

    let rightSide =
      emfs.length > 0
        ? emfs.join(' ')
        : '0';

    if (
      rightSide.startsWith('+ ')
    ) {
      rightSide =
        rightSide.substring(2);
    }

    equations.push({
      id: loop.id,
      type: 'KVL',
      targetLabel:
        `Контур ${loop.index}`,
      latex:
        `${leftSide} = ${rightSide}`,
    });
  });

  return equations;
};