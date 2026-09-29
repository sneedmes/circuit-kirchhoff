import type { CircuitElement } from '../../types/circuit';
import type { Wire } from '../../types/wiring';
import {
  detectCircuitNodes,
  type CircuitElementClusterLink,
} from '../../utils/circuitGeometry';
import type {
  CircuitGraph,
  TopoNode,
  TopoBranch,
  BranchElement,
} from '../types';

const comparePoints = (
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  return ax - bx || ay - by;
};

const compareClusterIds = (
  a: string,
  b: string
): number => {
  const [ax, ay] = a.split(',').map(Number);
  const [bx, by] = b.split(',').map(Number);

  return (
    comparePoints(ax, ay, bx, by) ||
    a.localeCompare(b)
  );
};

/**
 * Приводит произвольный угол к одному из
 * четырёх допустимых направлений:
 *
 *   0°   →
 *   90°  ↓
 *   180° ←
 *   270° ↑
 */
const normalizeCardinalAngle = (
  angle: number
): number => {
  let normalized = angle % 360;

  if (normalized < 0) {
    normalized += 360;
  }

  /*
   * Ближайшее из:
   *
   * 0, 90, 180, 270
   */
  const directions = [
    0,
    90,
    180,
    270,
  ];

  let closest =
    directions[0];

  let minDistance =
    Infinity;

  directions.forEach(
    (direction) => {
      const directDistance =
        Math.abs(
          normalized - direction
        );

      const circularDistance =
        Math.min(
          directDistance,
          360 - directDistance
        );

      if (
        circularDistance <
        minDistance
      ) {
        minDistance =
          circularDistance;

        closest =
          direction;
      }
    }
  );

  return closest;
};

/**
 * Возвращает направление конкретного элемента
 * относительно канонического направления branch.
 *
 * Важно:
 *
 * branch direction:
 *
 *   fromNode → toNode
 *
 * isSameDirection:
 *
 *   true  = элемент направлен так же,
 *           как branch
 *
 *   false = элемент направлен обратно
 *
 * rotation задаёт геометрическую ось самого элемента.
 */
const getElementArrowAngle = (
  element: CircuitElement,
  isSameDirection: boolean
): number => {
  /*
   * rotation элемента уже задаёт одну из
   * горизонтальной/вертикальной осей.
   *
   * Нормализуем его к:
   *
   *   0
   *   90
   *   180
   *   270
   */
  const elementAngle =
    normalizeCardinalAngle(
      element.rotation ?? 0
    );

  if (isSameDirection) {
    return elementAngle;
  }

  /*
   * Если направление элемента противоположно
   * направлению branch, разворачиваем стрелку
   * на 180°.
   */
  return normalizeCardinalAngle(
    elementAngle + 180
  );
};

const getBranchVisualCenter = (
  branchElements: CircuitElement[],
  fallback: {
    x: number;
    y: number;
  }
) => {
  if (
    branchElements.length === 0
  ) {
    return fallback;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  branchElements.forEach(
    (element) => {
      minX = Math.min(
        minX,
        element.x
      );

      maxX = Math.max(
        maxX,
        element.x
      );

      minY = Math.min(
        minY,
        element.y
      );

      maxY = Math.max(
        maxY,
        element.y
      );
    }
  );

  return {
    x: Math.round(
      (minX + maxX) / 2
    ),

    y: Math.round(
      (minY + maxY) / 2
    ),
  };
};

export const buildCircuitGraph = (
  elements: CircuitElement[],
  wires: Wire[]
): CircuitGraph => {
  if (
    elements.length === 0
  ) {
    return {
      nodes: [],
      branches: [],
    };
  }

  /*
   * Единый источник истины
   * для определения topology.
   */
  const {
    clusters,
    elementLinks,
  } = detectCircuitNodes(
    elements,
    wires
  );

  const links: CircuitElementClusterLink[] =
    elementLinks;

  const clusterById =
    new Map(
      clusters.map(
        (cluster) => [
          cluster.id,
          cluster,
        ]
      )
    );

  /*
   * Канонический порядок узлов.
   *
   * Сначала X, затем Y.
   */
  const sortedClusters =
    [...clusters].sort(
      (a, b) =>
        comparePoints(
          a.position.x,
          a.position.y,
          b.position.x,
          b.position.y
        ) ||
        a.id.localeCompare(
          b.id
        )
    );

  let essentialClusters =
    sortedClusters.map(
      (cluster) =>
        cluster.id
    );

  /*
   * Одноконтурная цепь без
   * визуальных узлов.
   */
  if (
    essentialClusters.length === 0 &&
    links.length > 0
  ) {
    essentialClusters = [
      links[0].c1,
    ];
  }

  const letters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const topoNodes: TopoNode[] =
    essentialClusters.map(
      (
        clusterId,
        index
      ) => {
        const cluster =
          clusterById.get(
            clusterId
          );

        return {
          id: clusterId,

          label:
            letters[
              index %
                letters.length
            ],

          position:
            cluster?.position ??
            links[0]?.p1 ?? {
              x: 0,
              y: 0,
            },
        };
      }
    );

  const essentialSet =
    new Set(
      essentialClusters
    );

  /*
   * Adjacency graph.
   *
   * isForward здесь пока означает
   * направление конкретного шага DFS.
   *
   * После построения branch направление
   * нормализуется независимо от DFS.
   */
  interface AdjEdge {
    link: CircuitElementClusterLink;
    targetCluster: string;
    isForward: boolean;
  }

  const adj =
    new Map<
      string,
      AdjEdge[]
    >();

  links.forEach(
    (link) => {
      if (
        !adj.has(link.c1)
      ) {
        adj.set(
          link.c1,
          []
        );
      }

      if (
        !adj.has(link.c2)
      ) {
        adj.set(
          link.c2,
          []
        );
      }

      adj
        .get(link.c1)!
        .push({
          link,
          targetCluster:
            link.c2,
          isForward:
            true,
        });

      adj
        .get(link.c2)!
        .push({
          link,
          targetCluster:
            link.c1,
          isForward:
            false,
        });
    }
  );

  const visitedElements =
    new Set<string>();

  const branches: TopoBranch[] =
    [];

  let branchIndex = 1;

  for (
    const startCluster of
      essentialClusters
  ) {
    const edges =
      adj.get(
        startCluster
      ) ?? [];

    for (
      const startEdge of
        edges
    ) {
      if (
        visitedElements.has(
          startEdge.link
            .element.id
        )
      ) {
        continue;
      }

      const branchElements: BranchElement[] =
        [];

      const branchCircuitElements: CircuitElement[] =
        [];

      let currentCluster =
        startCluster;

      let currEdge:
        | AdjEdge
        | undefined =
        startEdge;

      while (
        currEdge &&
        !visitedElements.has(
          currEdge.link
            .element.id
        )
      ) {
        const element =
          currEdge.link
            .element;

        visitedElements.add(
          element.id
        );

        branchCircuitElements.push(
          element
        );

        branchElements.push({
          id: element.id,
          type: element.type,
          label: element.label,

          isSameDirection:
            currEdge.isForward,
        });

        currentCluster =
          currEdge.targetCluster;

        /*
         * Дошли до существенного
         * узла — branch закончена.
         */
        if (
          essentialSet.has(
            currentCluster
          )
        ) {
          break;
        }

        const nextEdges =
          adj.get(
            currentCluster
          ) ?? [];

        currEdge =
          nextEdges.find(
            (edge) =>
              !visitedElements.has(
                edge.link
                  .element.id
              )
          );
      }

      if (
        branchElements.length === 0
      ) {
        continue;
      }

      /*
       * ----------------------------------------
       * КАНОНИЧЕСКОЕ НАПРАВЛЕНИЕ BRANCH
       * ----------------------------------------
       *
       * Меньший node ID → больший node ID.
       *
       * Поэтому направление не зависит
       * от порядка DFS.
       */
      const shouldReverse =
        compareClusterIds(
          startCluster,
          currentCluster
        ) > 0;

      const normalizedElements =
        shouldReverse
          ? [...branchElements]
              .reverse()
              .map(
                (element) => ({
                  ...element,

                  isSameDirection:
                    !element.isSameDirection,
                })
              )
          : branchElements;

      const normalizedCircuitElements =
        shouldReverse
          ? [
              ...branchCircuitElements,
            ].reverse()
          : branchCircuitElements;

      const normalizedFromNodeId =
        shouldReverse
          ? currentCluster
          : startCluster;

      const normalizedToNodeId =
        shouldReverse
          ? startCluster
          : currentCluster;

      const fromPosition =
        clusterById.get(
          normalizedFromNodeId
        )?.position;

      const toPosition =
        clusterById.get(
          normalizedToNodeId
        )?.position;

      /*
       * ----------------------------------------
       * ВЫБОР ЭЛЕМЕНТА ДЛЯ МАРКЕРА
       * ----------------------------------------
       *
       * Берём центральный элемент branch.
       *
       * Именно возле него будет размещаться
       * стрелка тока.
       */
      const markerElementIndex =
        Math.floor(
          normalizedCircuitElements.length /
            2
        );

      const markerCircuitElement =
        normalizedCircuitElements[
          markerElementIndex
        ];

      const markerBranchElement =
        normalizedElements[
          markerElementIndex
        ];

      /*
       * ----------------------------------------
       * НАПРАВЛЕНИЕ СТРЕЛКИ
       * ----------------------------------------
       *
       * Ключевой момент:
       *
       * НЕ используем:
       *
       *   fromNode → toNode
       *
       * потому что branch может быть ломаной.
       *
       * Вместо этого используем rotation
       * конкретного элемента, возле которого
       * расположен marker.
       */
      const angleDeg =
        markerCircuitElement &&
        markerBranchElement
          ? getElementArrowAngle(
              markerCircuitElement,
              markerBranchElement
                .isSameDirection
            )
          : 0;

      /*
       * ----------------------------------------
       * ЦЕНТР МАРКЕРА
       * ----------------------------------------
       *
       * Пока сохраняем существующую идею
       * центра bounding box элементов branch.
       *
       * Это отдельный вопрос размещения UI
       * и не влияет на математическое
       * направление стрелки.
       */
      const fallbackCenter =
        fromPosition &&
        toPosition
          ? {
              x:
                (fromPosition.x +
                  toPosition.x) /
                2,

              y:
                (fromPosition.y +
                  toPosition.y) /
                2,
            }
          : {
              x: 0,
              y: 0,
            };

      const baseCenter =
        getBranchVisualCenter(
          normalizedCircuitElements,
          fallbackCenter
        );

      const currentSource =
        normalizedElements.find(
          (element) =>
            element.type ===
            'CURRENT_SOURCE'
        );

      branches.push({
        id:
          `branch_${branchIndex}`,

        index:
          branchIndex,

        fromNodeId:
          normalizedFromNodeId,

        toNodeId:
          normalizedToNodeId,

        elements:
          normalizedElements,

        currentSource,

        hasResistor:
          normalizedElements.some(
            (element) =>
              element.type ===
              'RESISTOR'
          ),

        marker: {
          index:
            branchIndex,

          /*
           * UI использует elementId,
           * чтобы привязать marker
           * к конкретному элементу.
           */
          elementId:
            markerCircuitElement?.id ??
            normalizedCircuitElements[0]
              ?.id ??
            '',

          baseCenter,

          /*
           * Теперь значение ВСЕГДА одно
           * из:
           *
           * 0 / 90 / 180 / 270
           */
          angleDeg,
        },
      });

      branchIndex++;
    }
  }

  return {
    nodes: topoNodes,
    branches,
  };
};