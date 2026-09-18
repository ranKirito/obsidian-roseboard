import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { inkOf, type Board, type Stroke } from '../domain/model';
import { flatten, hitStroke, pairs, simplify, strokePath } from '../domain/ink';
export type Tool = 'select' | 'hand' | 'pen' | 'eraser';
export interface InkStyle {
  color: Stroke['color'];
  width: number;
}
export const inkWidths: { label: string; width: number }[] = [
  { label: 'Thin', width: 2 },
  { label: 'Medium', width: 3.5 },
  { label: 'Thick', width: 7 },
];
export const inkColor: Record<Stroke['color'], string> = {
  ink: 'var(--rb-ink)',
  rose: 'var(--rb-pink)',
  amber: 'var(--rb-amber)',
  mint: 'var(--rb-mint)',
  sky: 'var(--rb-sky)',
  violet: 'var(--rb-violet)',
  slate: 'var(--rb-slate)',
};
const StrokePath = memo(function StrokePath({ id, stroke, dim }: { id: string; stroke: Stroke; dim: boolean }) {
  const d = useMemo(() => strokePath(pairs(stroke.points)), [stroke.points]);
  return (
    <path
      className={`rb-stroke rb-stroke-${stroke.color}${dim ? ' rb-stroke-pending' : ''}`}
      data-stroke={id}
      d={d}
      stroke={inkColor[stroke.color]}
      strokeWidth={stroke.width}
    />
  );
});
/**
 * Ink lives inside React Flow's viewport, so it pans and zooms with the cards. The SVG is a
 * 1 × 1 anchor at the world origin with visible overflow; every path is in world coordinates.
 */
export const InkLayer = memo(function InkLayer({
  board,
  live,
  pending,
}: {
  board: Board;
  live?: { points: number[]; style: InkStyle };
  pending: ReadonlySet<string>;
}) {
  const ink = inkOf(board);
  const entries = Object.entries(ink);
  if (!entries.length && !live) return null;
  return (
    <ViewportPortal>
      <svg className="rb-ink" width="1" height="1" aria-hidden="true">
        {entries.map(([id, stroke]) => (
          <StrokePath key={id} id={id} stroke={stroke} dim={pending.has(id)} />
        ))}
        {live && live.points.length >= 2 && (
          <path
            className="rb-stroke rb-stroke-live"
            d={strokePath(pairs(live.points))}
            stroke={inkColor[live.style.color]}
            strokeWidth={live.style.width}
          />
        )}
      </svg>
    </ViewportPortal>
  );
});
/**
 * Captures pointer input while the pen or eraser is active. Pen strokes are collected in world
 * coordinates, simplified once on release, and committed as one undoable edit. The eraser marks
 * every stroke the pointer touches and removes them together on release. Wheel events are
 * forwarded to React Flow's pane so scrolling and pinching keep working mid-drawing.
 */
export function DrawOverlay({
  tool,
  style,
  board,
  onLive,
  onPending,
  onStroke,
  onErase,
}: {
  tool: 'pen' | 'eraser';
  style: InkStyle;
  board: Board;
  onLive: (live: { points: number[]; style: InkStyle } | undefined) => void;
  onPending: (ids: Set<string>) => void;
  onStroke: (stroke: Stroke) => void;
  onErase: (ids: string[]) => void;
}) {
  const flow = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<{ pointerId: number; points: number[]; erased: Set<string> } | undefined>(undefined);
  const frame = useRef(0);
  const [, force] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const forward = (e: WheelEvent) => {
      const pane = element.parentElement?.querySelector('.react-flow__pane');
      if (!pane) return;
      e.preventDefault();
      e.stopPropagation();
      pane.dispatchEvent(new WheelEvent('wheel', e));
    };
    element.addEventListener('wheel', forward, { passive: false });
    return () => element.removeEventListener('wheel', forward);
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      onLive(undefined);
      onPending(new Set());
    },
    [onLive, onPending],
  );
  const world = (e: ReactPointerEvent) => flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  const eraseAt = useCallback(
    (x: number, y: number) => {
      const state = active.current;
      if (!state) return;
      const tolerance = 6 / flow.getZoom();
      let changed = false;
      for (const [id, stroke] of Object.entries(inkOf(board)))
        if (!state.erased.has(id) && hitStroke(stroke.points, stroke.width, x, y, tolerance)) {
          state.erased.add(id);
          changed = true;
        }
      if (changed) onPending(new Set(state.erased));
    },
    [board, flow, onPending],
  );
  const down = (e: ReactPointerEvent) => {
    if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    ref.current?.setPointerCapture(e.pointerId);
    const p = world(e);
    active.current = { pointerId: e.pointerId, points: tool === 'pen' ? [p.x, p.y] : [], erased: new Set() };
    if (tool === 'pen') onLive({ points: [p.x, p.y], style });
    else eraseAt(p.x, p.y);
    force((n) => n + 1);
  };
  const move = (e: ReactPointerEvent) => {
    const state = active.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const p = world(e);
    if (tool === 'eraser') {
      eraseAt(p.x, p.y);
      return;
    }
    const n = state.points.length;
    const step = 0.75 / flow.getZoom();
    if (n >= 2 && Math.hypot(p.x - state.points[n - 2]!, p.y - state.points[n - 1]!) < step) return;
    state.points.push(p.x, p.y);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onLive({ points: state.points.slice(), style }));
  };
  const up = (e: ReactPointerEvent) => {
    const state = active.current;
    if (!state || state.pointerId !== e.pointerId) return;
    active.current = undefined;
    cancelAnimationFrame(frame.current);
    if (ref.current?.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId);
    if (tool === 'pen') {
      onLive(undefined);
      const points = simplify(pairs(state.points), 0.6 / flow.getZoom());
      if (points.length === 1) points.push([points[0]![0] + 0.5, points[0]![1]]);
      if (points.length >= 2) onStroke({ points: flatten(points), color: style.color, width: style.width });
    } else {
      onPending(new Set());
      if (state.erased.size) onErase([...state.erased]);
    }
    force((n) => n + 1);
  };
  return (
    <div
      ref={ref}
      className={`rb-draw-overlay rb-tool-${tool}${active.current ? ' is-drawing' : ''}`}
      role="application"
      aria-label={tool === 'pen' ? 'Drawing surface' : 'Eraser surface'}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
