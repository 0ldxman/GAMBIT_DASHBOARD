import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity, Relation } from "../types";

interface Node {
  id: number;
  label: string;
  x: number;
  y: number;
}

const WIDTH = 900;
const HEIGHT = 560;

/** Цвет типа связи: стабильный, выводится из самой строки. */
export function typeColor(type: string): string {
  let hash = 0;
  for (const ch of type) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 65% 62%)`;
}

/**
 * Раскладка графа силовым алгоритмом.
 *
 * Считается один раз на набор данных, без анимации: узлы отталкиваются друг от
 * друга, связи стягивают их обратно, слабая гравитация держит всё в кадре.
 * Итераций фиксированное число — картинка получается одинаковой при каждом
 * открытии, а это важнее плавности: мастер запоминает расположение стран.
 */
function layout(entities: Entity[], relations: Relation[]): Node[] {
  const nodes: Node[] = entities.map((entity, i) => {
    // Стартовое кольцо: детерминированно, поэтому граф не «прыгает» при перезаходе.
    const angle = (i / Math.max(entities.length, 1)) * Math.PI * 2;
    return {
      id: entity.id,
      label: entity.label,
      x: WIDTH / 2 + Math.cos(angle) * 220,
      y: HEIGHT / 2 + Math.sin(angle) * 220,
    };
  });
  if (nodes.length === 0) return nodes;

  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = relations
    .map((r) => [index.get(r.parent_id), index.get(r.child_id)] as const)
    .filter(([a, b]) => a !== undefined && b !== undefined) as [number, number][];

  const k = Math.sqrt((WIDTH * HEIGHT) / nodes.length) * 0.6;
  let temperature = WIDTH / 8;

  for (let step = 0; step < 300; step++) {
    const dx = new Array(nodes.length).fill(0);
    const dy = new Array(nodes.length).fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let vx = nodes[i].x - nodes[j].x;
        let vy = nodes[i].y - nodes[j].y;
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) {
          // Совпавшие узлы разводим детерминированным сдвигом.
          vx = (i % 2 ? 1 : -1) * 0.5;
          vy = 0.5;
          dist = 0.7;
        }
        const force = (k * k) / dist;
        dx[i] += (vx / dist) * force;
        dy[i] += (vy / dist) * force;
        dx[j] -= (vx / dist) * force;
        dy[j] -= (vy / dist) * force;
      }
    }

    for (const [a, b] of edges) {
      const vx = nodes[a].x - nodes[b].x;
      const vy = nodes[a].y - nodes[b].y;
      const dist = Math.max(Math.hypot(vx, vy), 0.01);
      const force = (dist * dist) / k;
      dx[a] -= (vx / dist) * force;
      dy[a] -= (vy / dist) * force;
      dx[b] += (vx / dist) * force;
      dy[b] += (vy / dist) * force;
    }

    for (let i = 0; i < nodes.length; i++) {
      // Гравитация к центру: иначе несвязанные узлы уезжают за край.
      dx[i] += (WIDTH / 2 - nodes[i].x) * 0.02;
      dy[i] += (HEIGHT / 2 - nodes[i].y) * 0.02;

      const dist = Math.max(Math.hypot(dx[i], dy[i]), 0.01);
      const move = Math.min(dist, temperature);
      nodes[i].x = Math.max(40, Math.min(WIDTH - 40, nodes[i].x + (dx[i] / dist) * move));
      nodes[i].y = Math.max(30, Math.min(HEIGHT - 30, nodes[i].y + (dy[i] / dist) * move));
    }
    temperature *= 0.97;
  }
  return nodes;
}

/** Граф связей проекта: только просмотр, правится всё списком рядом. */
export function RelationGraph({
  entities,
  relations,
  highlight,
  onPick,
}: {
  entities: Entity[];
  relations: Relation[];
  /** Подсвеченная сущность — её связи выделены. */
  highlight?: number | null;
  onPick?: (entityId: number) => void;
}) {
  const initial = useMemo(() => layout(entities, relations), [entities, relations]);
  const [nodes, setNodes] = useState<Node[]>(initial);
  // Раскладка пересчиталась (изменились данные) — принимаем её.
  useEffect(() => setNodes(initial), [initial]);

  const dragging = useRef<{ id: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** Координаты указателя в системе координат SVG. */
  function toLocal(e: React.PointerEvent): { x: number; y: number } {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - box.left) / box.width) * WIDTH,
      y: ((e.clientY - box.top) / box.height) * HEIGHT,
    };
  }

  if (entities.length === 0) {
    return <p className="muted">Сущностей нет — граф пуст.</p>;
  }

  return (
    <svg
      ref={svgRef}
      className="graph"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      onPointerMove={(e) => {
        const drag = dragging.current;
        if (!drag) return;
        const { x, y } = toLocal(e);
        drag.moved = true;
        setNodes((list) => list.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
      }}
      onPointerUp={() => {
        dragging.current = null;
      }}
      onPointerLeave={() => {
        dragging.current = null;
      }}
    >
      {relations.map((relation) => {
        const from = byId.get(relation.parent_id);
        const to = byId.get(relation.child_id);
        if (!from || !to) return null;
        const active =
          highlight != null &&
          (relation.parent_id === highlight || relation.child_id === highlight);
        return (
          <line
            key={relation.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={typeColor(relation.relation_type)}
            strokeWidth={active ? 2.5 : 1.2}
            opacity={highlight == null || active ? 0.85 : 0.15}
          >
            <title>
              {from.label} → {to.label}: {relation.relation_type}
            </title>
          </line>
        );
      })}

      {nodes.map((node) => {
        const dim = highlight != null && node.id !== highlight &&
          !relations.some(
            (r) =>
              (r.parent_id === highlight && r.child_id === node.id) ||
              (r.child_id === highlight && r.parent_id === node.id),
          );
        return (
          <g
            key={node.id}
            className="graph-node"
            opacity={dim ? 0.25 : 1}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = { id: node.id, moved: false };
            }}
            onPointerUp={() => {
              // Клик без перетаскивания — открыть сущность.
              if (dragging.current && !dragging.current.moved) onPick?.(node.id);
            }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={node.id === highlight ? 11 : 8}
              fill={node.id === highlight ? "var(--accent)" : "var(--bg-elev2)"}
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
            <text x={node.x} y={node.y - 14} textAnchor="middle">
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
