import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  applyNodeChanges,
  MarkerType,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type OnConnectEnd,
  type OnNodeDrag,
} from '@xyflow/react';
import {
  blocked,
  colors,
  emptyFilters,
  filtersActive,
  inkColors,
  inkOf,
  localDate,
  matches,
  newId,
  newTask,
  overdue,
  priorities,
  statuses,
  type Board,
  type Color,
  type Filters,
  type Status,
} from '../domain/model';
import {
  addStroke,
  addTask,
  align,
  clearInk,
  duplicate,
  eraseStrokes,
  moveNodes,
  nudge,
  placeAll,
  removePlacements,
  setDependency,
  setStatus,
  type Edit,
} from '../domain/commands';
import type { Change, Overlap } from '../domain/merge';
import { nodeTypes, formatDue, type FlowNode, type CardData } from './Nodes';
import { Inspector } from './Inspector';
import { Kanban } from './Kanban';
import { Documents } from './Documents';
import { Planner } from './Planner';
import { DrawOverlay, InkLayer, inkColor, inkWidths, type InkStyle, type Tool } from './Ink';
import { Icon, priorityIcon, statusIcon, statusLabel } from './icons';
import type { BoardHost, InputDevice, MenuItemSpec } from './ports';
const snapGrid: [number, number] = [16, 16];
const multiKeys = ['Shift', 'Meta', 'Control'];
const CULL_THRESHOLD = 120;
const RECENT_MS = 4500;
type Mode = 'canvas' | 'list' | 'kanban' | 'day' | 'calendar' | 'documents';
const views: { mode: Mode; label: string; icon: string }[] = [
  { mode: 'canvas', label: 'Canvas', icon: 'layout-dashboard' },
  { mode: 'kanban', label: 'Kanban', icon: 'columns-3' },
  { mode: 'list', label: 'List', icon: 'list' },
  { mode: 'day', label: 'Day', icon: 'sun' },
  { mode: 'calendar', label: 'Calendar', icon: 'calendar-days' },
  { mode: 'documents', label: 'Documents', icon: 'book-open' },
];
export function BoardApp({ host, preview = false }: { host: BoardHost; preview?: boolean }) {
  return (
    <ReactFlowProvider>
      <BoardSurface host={host} preview={preview} />
    </ReactFlowProvider>
  );
}
/** Mouse wheels report notch-sized integer deltas; trackpads report small fractional ones. */
function looksLikeMouseWheel(e: WheelEvent): boolean {
  if (e.ctrlKey) return false; // Pinch gestures arrive as ctrl+wheel.
  if (e.deltaMode !== 0) return true;
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0) return true;
  return e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40;
}
const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function BoardSurface({ host, preview }: { host: BoardHost; preview: boolean }) {
  const state = useSyncExternalStore(host.session.subscribe, host.session.getSnapshot);
  const board = state.board;
  const flow = useReactFlow<FlowNode>();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('canvas');
  const [plannerDate, setPlannerDate] = useState('');
  const [documentPath, setDocumentPath] = useState<string>();
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const expandNote = useCallback((id: string, expanded: boolean) => {
    setExpandedNotes((current) => {
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const previewNote = useCallback(
    (path: string) => {
      const current = host.session.getSnapshot().board;
      const entry =
        Object.entries(current?.nodes ?? {}).find(
          ([, node]) => node.type === 'note' && node.notePath === path,
        ) ??
        Object.entries(current?.nodes ?? {}).find(
          ([, node]) => node.type === 'task' && current?.tasks[node.taskId]?.notePath === path,
        );
      if (entry) {
        setMode('canvas');
        expandNote(entry[0], true);
        setInspector(false);
        requestAnimationFrame(
          () =>
            void flow.setCenter(entry[1].x + 260, entry[1].y + 260, {
              zoom: Math.max(flow.getZoom(), 0.8),
              duration: reduceMotion() ? 0 : 180,
            }),
        );
        return;
      }
      setDocumentPath(path);
      setMode('documents');
      setInspector(false);
    },
    [host, flow, expandNote],
  );
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(host.platform.touch ? 'hand' : 'select');
  const hand = tool === 'hand';
  const drawing = tool === 'pen' || tool === 'eraser';
  const setHand = (value: boolean) => setTool(value ? 'hand' : 'select');
  const [inkStyle, setInkStyle] = useState<InkStyle>({ color: 'ink', width: inkWidths[1]!.width });
  const [live, setLive] = useState<{ points: number[]; style: InkStyle }>();
  const [pendingErase, setPendingErase] = useState<Set<string>>(new Set());
  const [inspector, setInspector] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [seenActivity, setSeenActivity] = useState(0);
  const [selectedTask, setSelectedTask] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [focusTask, setFocusTask] = useState<string>();
  const [prefs, setPrefs] = useState(host.preferences);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [zoom, setZoom] = useState(1);
  const [noteRevision, setNoteRevision] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [detected, setDetected] = useState<Exclude<InputDevice, 'auto'>>('trackpad');
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'created' | 'title' | 'due' | 'priority' | 'status'>('created');
  const gestureRevision = useRef(0);
  const [connectMode, setConnectMode] = useState('relationship');
  const [connectTarget, setConnectTarget] = useState('');
  const [connectLabel, setConnectLabel] = useState('relates to');
  const [connectOpen, setConnectOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const readOnly =
    preview ||
    state.sourceOpen ||
    state.status === 'Conflict' ||
    state.status === 'Error' ||
    !host.session.canEdit();
  const selectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selectedNodeId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const selectedNode = selectedNodeId ? board?.nodes[selectedNodeId] : undefined;
  const taskId = selectedNode?.type === 'task' ? selectedNode.taskId : selectedTask;
  const today = board ? localDate(board.timeZone, new Date(clock)) : '';
  const wheelZooms = (prefs.input === 'auto' ? detected : prefs.input) === 'mouse';
  const nodeCount = board ? Object.keys(board.nodes).length : 0;
  const culling = prefs.culling === 'on' || (prefs.culling === 'auto' && nodeCount > CULL_THRESHOLD);
  const animate = reduceMotion() ? 0 : 180;
  const inkCount = board ? Object.keys(inkOf(board)).length : 0;
  useEffect(() => host.subscribeNotes(() => setNoteRevision((v) => v + 1)), [host]);
  // Drawing tools need a writable board; fall back to Select when writes pause or the view changes.
  useEffect(() => {
    if (drawing && (readOnly || mode !== 'canvas')) setTool('select');
  }, [drawing, readOnly, mode]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  // Cards another device just changed glow for a few seconds.
  useEffect(() => {
    if (!state.recent.length) return;
    setRecent(new Set(state.recent));
    const timer = setTimeout(() => setRecent(new Set()), RECENT_MS);
    return () => clearTimeout(timer);
  }, [state.remoteRevision, state.recent]);
  // Wheel handling: detect the input device and give mouse users Shift+wheel horizontal panning.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let streak = 0;
    const handler = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.nowheel')) return;
      if (prefs.input === 'auto') {
        // Two consistent events in a row switch the interpretation; one stray event never does.
        const mouse = looksLikeMouseWheel(e);
        streak = mouse ? Math.max(streak, 0) + 1 : Math.min(streak, 0) - 1;
        if (streak >= 2) setDetected('mouse');
        else if (streak <= -2) setDetected('trackpad');
      }
      if (wheelZooms && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const viewport = flow.getViewport();
        void flow.setViewport({ ...viewport, x: viewport.x - (e.deltaY || e.deltaX) }, { duration: 0 });
      }
    };
    element.addEventListener('wheel', handler, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', handler, { capture: true });
  }, [flow, prefs.input, wheelZooms, mode]);
  const edit = useCallback(
    (label: string, action: Edit, key = '') => {
      try {
        host.session.edit(label, action, key);
      } catch (error) {
        host.notify(error instanceof Error ? error.message : String(error));
      }
    },
    [host],
  );
  const complete = useCallback(
    (id: string) => {
      const task = host.session.getSnapshot().board?.tasks[id];
      if (!task) return;
      const finish = () =>
        edit('Change task status', (b) => {
          const t = b.tasks[id];
          if (t) t.status = task.status === 'done' ? 'todo' : 'done';
        });
      if (task.status !== 'done' && blocked(task, host.session.getSnapshot().board!))
        void host
          .confirm(
            'Complete a blocked task?',
            'Some prerequisites are unfinished. You can still mark this task done.',
          )
          .then((ok) => {
            if (ok) finish();
          });
      else finish();
    },
    [edit, host],
  );
  const begin = useCallback(() => {
    gestureRevision.current = host.session.getSnapshot().revision;
  }, [host]);
  const restoreFromModel = useCallback(() => {
    const latest = host.session.getSnapshot().board;
    setNodes((ns) =>
      ns.map((n) => {
        const saved = latest?.nodes[n.id];
        return saved
          ? { ...n, position: { x: saved.x, y: saved.y }, width: saved.width, height: saved.height }
          : n;
      }),
    );
  }, [host]);
  const resize = useCallback(
    (id: string, params: { x: number; y: number; width: number; height: number }) => {
      if (gestureRevision.current !== host.session.getSnapshot().revision) {
        host.notify('Board changed during resizing; the gesture was cancelled.');
        restoreFromModel();
        return;
      }
      edit('Resize card', (b) => {
        moveNodes(b, { [id]: { x: params.x, y: params.y } });
        const n = b.nodes[id];
        if (n) {
          n.width = params.width;
          n.height = params.height;
        }
      });
    },
    [edit, host, restoreFromModel],
  );
  const setText = useCallback(
    (nodeId: string, text: string) => {
      edit('Rename', (b) => {
        const node = b.nodes[nodeId];
        if (!node) return;
        if (node.type === 'task') {
          const title = text.trim();
          if (title) b.tasks[node.taskId]!.title = title;
        } else if (node.type === 'frame') node.title = text.trim() || 'Frame';
        else if (node.type === 'sticky') node.content = text;
      });
    },
    [edit],
  );
  const matching = useMemo(
    () =>
      new Set(
        board
          ? Object.entries(board.tasks)
              .filter(([, t]) => matches(t, board, filters, today))
              .map(([id]) => id)
          : [],
      ),
    [board, filters, today],
  );
  const focused = useMemo(() => {
    if (!board || !focusTask || !board.tasks[focusTask]) return undefined;
    return new Set([
      focusTask,
      ...board.tasks[focusTask]!.dependsOn,
      ...Object.keys(board.tasks).filter((id) => board.tasks[id]!.dependsOn.includes(focusTask)),
    ]);
  }, [board, focusTask]);
  const cache = useRef(new Map<string, CardData>());
  useEffect(() => {
    if (!board) return;
    setNodes((current) => {
      const old = new Map(current.map((n) => [n.id, n]));
      const members = new Map<string, { total: number; done: number }>();
      for (const n of Object.values(board.nodes))
        if (n.frameId && n.type === 'task') {
          const m = members.get(n.frameId) ?? { total: 0, done: 0 };
          m.total++;
          if (board.tasks[n.taskId]?.status === 'done') m.done++;
          members.set(n.frameId, m);
        }
      const next = Object.entries(board.nodes)
        .sort((a, b) => Number(b[1].type === 'frame') - Number(a[1].type === 'frame'))
        .map(([id, node]): FlowNode => {
          const task = node.type === 'task' ? board.tasks[node.taskId] : undefined;
          const path = task?.notePath ?? (node.type === 'note' ? node.notePath : undefined);
          const count = members.get(id);
          const expanded = !!path && expandedNotes.has(id);
          const width = expanded ? Math.max(node.width, Math.min(node.width + 160, 560)) : node.width;
          const height = expanded ? Math.max(node.height, Math.min(node.height + 200, 560)) : node.height;
          const data: CardData = {
            node,
            task,
            host,
            readOnly,
            today,
            complete,
            previewNote,
            expanded,
            expandNote,
            resize,
            begin,
            setText,
            overdue: !!task && overdue(task, today),
            blocked: !!task && blocked(task, board),
            missing: !!path && !host.noteExists(path),
            recent: recent.has(id) || (!!task && node.type === 'task' && recent.has(node.taskId)),
            count: count ? `${count.done}/${count.total} done` : 'Frame',
          };
          const previous = cache.current.get(id);
          const same =
            previous && (Object.keys(data) as (keyof CardData)[]).every((key) => data[key] === previous[key]);
          if (!same) cache.current.set(id, data);
          const dim =
            node.type === 'task' && (!matching.has(node.taskId) || (focused && !focused.has(node.taskId)));
          const className = dim ? 'rb-dim' : '';
          const existing = old.get(id);
          // Reuse the previous node object when nothing changed so React Flow skips re-adoption.
          if (
            existing &&
            same &&
            existing.className === className &&
            existing.position.x === node.x &&
            existing.position.y === node.y &&
            existing.width === width &&
            existing.height === height
          )
            return existing;
          return {
            id,
            type: 'card',
            position: { x: node.x, y: node.y },
            width,
            height,
            style: {
              width,
              height,
              pointerEvents: node.type === 'frame' ? 'none' : 'all',
            },
            data: same ? previous : data,
            selected: existing?.selected ?? false,
            className,
            zIndex: expanded ? 5 : node.type === 'frame' ? -1 : 1,
            dragHandle: node.type === 'frame' ? '.rb-frame-label' : undefined,
          };
        });
      for (const id of cache.current.keys()) if (!board.nodes[id]) cache.current.delete(id);
      return next;
    });
  }, [
    board,
    host,
    readOnly,
    complete,
    previewNote,
    expandedNotes,
    expandNote,
    resize,
    begin,
    setText,
    matching,
    focused,
    today,
    noteRevision,
    recent,
  ]);
  const baseEdges = useMemo<Edge[]>(() => {
    if (!board) return [];
    const list: Edge[] = Object.entries(board.edges).map(([id, e]) => ({
      id,
      source: e.source,
      target: e.target,
      label: e.label,
      className: 'rb-relation',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#8F8F9F' },
      ariaLabel: `Relationship: ${e.label}`,
    }));
    const placed = new Map(
      Object.entries(board.nodes)
        .filter(([, n]) => n.type === 'task')
        .map(([id, n]) => [n.type === 'task' ? n.taskId : '', id]),
    );
    for (const [id, task] of Object.entries(board.tasks))
      for (const dep of task.dependsOn) {
        const source = placed.get(dep),
          target = placed.get(id);
        if (source && target)
          list.push({
            id: `dependency:${JSON.stringify([dep, id])}`,
            source,
            target,
            label: 'prerequisite',
            className: `rb-dependency${board.tasks[dep]?.status === 'done' ? ' rb-dependency-done' : ''}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#F472B6' },
            ariaLabel: `Prerequisite: ${board.tasks[dep]?.title} before ${task.title}`,
            data: { prerequisite: dep, dependent: id },
          });
      }
    return list;
  }, [board]);
  const edgeCache = useRef(new Map<string, Edge>());
  const edges = useMemo<Edge[]>(() => {
    const next = baseEdges.map((e) => {
      const selected = selectedEdge === e.id;
      const previous = edgeCache.current.get(e.id);
      if (
        previous &&
        previous.selected === selected &&
        previous.label === e.label &&
        previous.className === e.className
      )
        return previous;
      const edge = { ...e, selected };
      edgeCache.current.set(e.id, edge);
      return edge;
    });
    const ids = new Set(next.map((e) => e.id));
    for (const id of edgeCache.current.keys()) if (!ids.has(id)) edgeCache.current.delete(id);
    return next;
  }, [baseEdges, selectedEdge]);
  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => {
      const expanded = [...changes];
      for (const change of changes)
        if (change.type === 'position' && change.position && change.dragging) {
          const frame = current.find((n) => n.id === change.id);
          if (frame?.data.node.type !== 'frame') continue;
          const dx = change.position.x - frame.position.x,
            dy = change.position.y - frame.position.y;
          for (const child of current)
            if (
              child.data.node.frameId === frame.id &&
              !changes.some((c) => c.type === 'position' && c.id === child.id)
            )
              expanded.push({
                id: child.id,
                type: 'position',
                position: { x: child.position.x + dx, y: child.position.y + dy },
                dragging: true,
              });
        }
      return applyNodeChanges(expanded, current);
    });
  }, []);
  const stopDrag = useCallback<OnNodeDrag<FlowNode>>(
    (_event, _node, dragged) => {
      if (gestureRevision.current !== host.session.getSnapshot().revision) {
        host.notify('Board changed during the drag; gesture cancelled.');
        restoreFromModel();
        return;
      }
      const model = host.session.getSnapshot().board;
      const positions = Object.fromEntries(
        dragged
          .filter((n) => {
            const saved = model?.nodes[n.id];
            return saved && (saved.x !== n.position.x || saved.y !== n.position.y);
          })
          .map((n) => [n.id, n.position]),
      );
      if (Object.keys(positions).length) edit('Move cards', (b) => moveNodes(b, positions));
    },
    [edit, host, restoreFromModel],
  );
  const connectNodes = useCallback(
    (sourceId: string, targetId: string, kind = connectMode, label = connectLabel) =>
      edit('Connect cards', (b) => {
        const source = b.nodes[sourceId],
          target = b.nodes[targetId];
        if (kind === 'dependency') {
          if (source?.type !== 'task' || target?.type !== 'task')
            throw new Error('Dependencies connect task cards only.');
          setDependency(b, source.taskId, target.taskId);
        } else b.edges[newId('edge')] = { source: sourceId, target: targetId, label };
      }),
    [edit, connectMode, connectLabel],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target && connection.source !== connection.target)
        connectNodes(connection.source, connection.target);
    },
    [connectNodes],
  );
  const selectOnly = useCallback(
    (ids: string[]) =>
      setNodes((ns) =>
        ns.map((n) => (n.selected === ids.includes(n.id) ? n : { ...n, selected: ids.includes(n.id) })),
      ),
    [],
  );
  const createAt = useCallback(
    (
      type: 'task' | 'sticky' | 'frame' | 'note',
      position: { x: number; y: number },
      extra?: { title?: string; path?: string },
    ) => {
      let id = '';
      edit(`Create ${type}`, (b) => {
        if (type === 'task') id = addTask(b, position.x, position.y, extra?.title);
        else {
          id = newId('node');
          const base = {
            ...position,
            width: type === 'frame' ? 700 : type === 'note' ? 380 : 300,
            height: type === 'frame' ? 480 : type === 'note' ? 340 : 220,
          };
          b.nodes[id] =
            type === 'sticky'
              ? { ...base, type, content: 'A little space to think.\n\nDouble-click to edit.' }
              : type === 'frame'
                ? { ...base, type, title: 'New frame' }
                : { ...base, type: 'note', notePath: extra!.path! };
        }
      });
      setSelectedTask(undefined);
      setSelectedEdge(undefined);
      setInspector(true);
      requestAnimationFrame(() => selectOnly([id]));
      return id;
    },
    [edit, selectOnly],
  );
  // Dropping a new connection on empty canvas creates a task there and links it.
  const connectEnd = useCallback<OnConnectEnd>(
    (event, connection) => {
      if (readOnly || !connection.fromNode || connection.toNode) return;
      // Cards live inside the pane element, so only a drop on the pane itself counts as empty space.
      const target = event.target as HTMLElement | null;
      if (!target?.classList?.contains('react-flow__pane')) return;
      const point = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
      if (!point) return;
      const at = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const from = connection.fromNode.id;
      const kind = (connection.fromNode.data as CardData).node.type === 'task' ? connectMode : 'relationship';
      let id = '';
      edit('Create linked task', (b) => {
        id = addTask(b, at.x - 20, at.y - 20);
        if (kind === 'dependency')
          setDependency(
            b,
            (b.nodes[from] as { taskId: string }).taskId,
            (b.nodes[id] as { taskId: string }).taskId,
          );
        else b.edges[newId('edge')] = { source: from, target: id, label: connectLabel };
      });
      setInspector(true);
      requestAnimationFrame(() => selectOnly([id]));
    },
    [readOnly, flow, connectMode, connectLabel, edit, selectOnly],
  );
  const jump = useCallback(
    (id: string) => {
      const b = host.session.getSnapshot().board;
      const node = Object.entries(b?.nodes ?? {}).find(([, n]) => n.type === 'task' && n.taskId === id);
      setSelectedTask(id);
      setInspector(true);
      setSelectedEdge(undefined);
      if (node) {
        setMode('canvas');
        selectOnly([node[0]]);
        requestAnimationFrame(
          () =>
            void flow.setCenter(node[1].x + node[1].width / 2, node[1].y + node[1].height / 2, {
              zoom: Math.max(flow.getZoom(), 0.9),
              duration: animate,
            }),
        );
      }
    },
    [flow, host, selectOnly, animate],
  );
  const selectTask = (id: string) => {
    setSelectedTask(id);
    setSelectedEdge(undefined);
    selectOnly([]);
    setInspector(true);
  };
  const viewCenter = () => {
    const rect = canvas.current?.getBoundingClientRect();
    return rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - 150, y: rect.top + rect.height / 2 - 95 })
      : { x: 100, y: 100 };
  };
  const create = (type: 'task' | 'sticky' | 'frame' | 'note', position = viewCenter()) => {
    if (type === 'note')
      void host.pickNote().then((path) => {
        if (path) {
          setMode('canvas');
          createAt('note', position, { path });
        }
      });
    else if (type === 'task' && (mode === 'day' || mode === 'calendar')) {
      const id = newId('task');
      edit('Create daily task', (b) => {
        b.tasks[id] = { ...newTask('Untitled task'), dueDate: plannerDate || today };
      });
      selectTask(id);
    } else {
      if (mode === 'documents' || type !== 'task') setMode('canvas');
      createAt(type, position);
    }
  };
  const remove = () => {
    if (!selectedIds.length && !selectedEdge) return;
    edit('Remove selection', (b) => {
      removePlacements(b, selectedIds);
      const e = edges.find((e) => e.id === selectedEdge);
      if (e?.data?.prerequisite)
        setDependency(b, String(e.data.prerequisite), String(e.data.dependent), false);
      else if (selectedEdge) delete b.edges[selectedEdge];
    });
    setSelectedEdge(undefined);
    setSelectedTask(undefined);
  };
  const duplicateSelected = () => {
    if (!selectedIds.length) return;
    let ids: string[] = [];
    edit('Duplicate cards', (b) => {
      ids = duplicate(b, selectedIds);
    });
    requestAnimationFrame(() => selectOnly(ids));
  };
  const colorSelected = (color?: Color) =>
    edit('Change colour', (b) => {
      for (const id of selectedIds) {
        const node = b.nodes[id];
        if (!node) continue;
        if (color) node.color = color;
        else delete node.color;
      }
    });
  const fit = () => void flow.fitView({ padding: 0.15, minZoom: 0.15, maxZoom: 1, duration: animate });
  const fitSelection = () =>
    void flow.fitView({
      nodes: selectedIds.map((id) => ({ id })),
      padding: 0.25,
      maxZoom: 1.5,
      duration: animate,
    });
  const selectAll = () => selectOnly(nodes.map((n) => n.id));
  const keyDown = (e: KeyboardEvent) => {
    if (preview || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))
      return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && key === 'z') {
      handled();
      e.shiftKey ? host.session.redo() : host.session.undo();
    } else if (mod && key === 'd' && mode === 'canvas') {
      handled();
      duplicateSelected();
    } else if (mod && key === 'a' && mode === 'canvas') {
      handled();
      selectAll();
    } else if (mod && key === 'f') {
      handled();
      setSearchOpen(true);
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLInputElement>(
            mode === 'documents' ? '[aria-label="Search documents"]' : '.rb-search',
          )
          ?.focus(),
      );
    } else if (mod && key === 'enter' && taskId) {
      handled();
      complete(taskId);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'canvas') {
      handled();
      remove();
    } else if (e.key === 'Escape') {
      if (drawing) setTool('select');
      else if (selectedIds.length || selectedEdge || selectedTask) {
        selectOnly([]);
        setSelectedEdge(undefined);
        setSelectedTask(undefined);
      } else {
        setInspector(false);
        setFocusTask(undefined);
      }
    } else if (mod || e.altKey) return;
    else if (e.key.startsWith('Arrow') && selectedIds.length && !readOnly && mode === 'canvas') {
      handled();
      const step = e.shiftKey ? 32 : 8;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      edit('Nudge cards', (b) => nudge(b, selectedIds, dx, dy), `nudge:${selectedIds.join(',')}`);
    } else if (mode !== 'canvas') return;
    else if (key === 'v') setHand(false);
    else if (key === 'h') setHand(true);
    else if (key === 'p' && !readOnly) setTool('pen');
    else if (key === 'e' && !readOnly) setTool('eraser');
    // Creation deliberately has no bare-letter shortcut: a board with focus must never grow content
    // from stray typing. Use the toolbar, double-click, the context menu or the command palette.
    else if (e.code === 'Digit1' && e.shiftKey) fit();
    else if (e.code === 'Digit2' && e.shiftKey && selectedIds.length) fitSelection();
    else if (e.code === 'Digit1') void flow.zoomTo(1, { duration: animate });
    else if (e.key === 'Enter' && (selectedIds.length === 1 || taskId)) setInspector(true);
  };
  const shortcutActions = useRef<Record<string, () => void>>({});
  shortcutActions.current = {
    undo: host.session.undo,
    redo: host.session.redo,
    duplicate: () => {
      if (mode === 'canvas') duplicateSelected();
    },
    remove: () => {
      if (mode === 'canvas') remove();
    },
    selectAll: () => {
      if (mode === 'canvas') selectAll();
    },
  };
  useEffect(() => {
    const element = root.current;
    if (!element || preview) return;
    const handler = (event: Event) => shortcutActions.current[(event as CustomEvent<string>).detail]?.();
    element.addEventListener('roseboard-shortcut', handler);
    return () => element.removeEventListener('roseboard-shortcut', handler);
  }, [preview]);
  const unplaced = useMemo(
    () =>
      board
        ? Object.keys(board.tasks).filter(
            (id) => !Object.values(board.nodes).some((n) => n.type === 'task' && n.taskId === id),
          )
        : [],
    [board],
  );
  const updatePreference = <K extends keyof typeof prefs>(key: K, value: (typeof prefs)[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    host.savePreferences(next);
  };
  const filter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const asyncAction = (action: () => Promise<unknown>) => {
    void action().catch((error) => host.notify(String(error)));
  };
  const titleOf = (b: Board, kind: Change['kind'], id: string) => {
    if (kind === 'task') return b.tasks[id]?.title ?? 'a task';
    if (kind === 'edge') return 'a connector';
    if (kind === 'ink') return 'a stroke';
    if (kind === 'board') return 'the board';
    const n = b.nodes[id];
    return n?.type === 'task'
      ? (b.tasks[n.taskId]?.title ?? 'a card')
      : n?.type === 'frame'
        ? n.title
        : n?.type === 'note'
          ? n.notePath
          : 'a note';
  };
  const describe = (c: Change) => {
    const b = board!;
    const name = `“${titleOf(b, c.kind, c.id)}”`;
    if (c.kind === 'ink') return c.op === 'removed' ? 'erased a stroke' : 'drew a stroke';
    if (c.op === 'added') return `added ${name}`;
    if (c.op === 'removed')
      return `removed ${c.kind === 'node' ? 'a card' : c.kind === 'task' ? 'a task' : 'a connector'}`;
    const f = c.fields.map((x) =>
      x === 'position' ? 'moved' : x === 'size' ? 'resized' : `changed ${x} of`,
    );
    return `${f.join(', ')} ${name}`;
  };
  const describeOverlap = (o: Overlap) => {
    const name = board ? `“${titleOf(board, o.kind, o.id)}”` : o.id;
    if (o.field === 'removed')
      return `${name} was ${o.chosen === 'mine' ? 'removed elsewhere but edited here' : 'removed here but edited elsewhere'}`;
    if (o.field === 'duplicate placement')
      return `${name} was placed on both devices; the synced card was kept`;
    if (o.field === 'orphan') return `A card whose task no longer exists was removed`;
    return `${o.field} of ${name} changed on both sides; ${o.chosen === 'mine' ? 'your' : 'their'} value was kept`;
  };
  const cardMenu = (event: ReactMouseEvent | MouseEvent, ids: string[]) => {
    event.preventDefault();
    if (preview || !board) return;
    if (!ids.every((id) => selectedIds.includes(id))) selectOnly(ids);
    const single = ids.length === 1 ? board.nodes[ids[0]!] : undefined;
    const task = single?.type === 'task' ? board.tasks[single.taskId] : undefined;
    const items: MenuItemSpec[] = [];
    if (task && single?.type === 'task') {
      const tid = single.taskId;
      items.push(
        {
          title: task.status === 'done' ? 'Reopen task' : 'Complete task',
          icon: 'circle-check-big',
          disabled: readOnly,
          action: () => complete(tid),
        },
        {
          title: 'Edit details',
          icon: 'pencil',
          action: () => {
            setSelectedTask(undefined);
            setSelectedEdge(undefined);
            setInspector(true);
          },
        },
        {
          title: 'Focus task + dependencies',
          icon: 'focus',
          action: () => {
            setFocusTask(tid);
            jump(tid);
          },
        },
        { separator: true },
        { title: 'Status', label: true },
        ...statuses.map((s) => ({
          title: statusLabel[s]!,
          icon: statusIcon[s],
          checked: task.status === s,
          disabled: readOnly,
          action: () =>
            s === 'done' ? complete(tid) : edit('Change task status', (b) => setStatus(b, tid, s)),
        })),
        { separator: true },
        { title: 'Priority', label: true },
        ...priorities.map((p) => ({
          title: p,
          icon: priorityIcon[p] || 'minus',
          checked: task.priority === p,
          disabled: readOnly,
          action: () =>
            edit('Change priority', (b) => {
              b.tasks[tid]!.priority = p;
            }),
        })),
        { separator: true },
      );
      if (task.notePath)
        items.push({
          title: 'Open linked note',
          icon: 'file-text',
          action: () => host.openNote(task.notePath!),
        });
    }
    if (single?.type === 'note')
      items.push({ title: 'Open note', icon: 'file-text', action: () => host.openNote(single.notePath) });
    items.push(
      { title: 'Colour', label: true },
      {
        title: 'None',
        icon: 'slash',
        checked: ids.every((id) => !board.nodes[id]?.color),
        disabled: readOnly,
        action: () => colorSelected(undefined),
      },
      ...colors.map((c) => ({
        title: c,
        icon: 'circle',
        checked: ids.every((id) => board.nodes[id]?.color === c),
        disabled: readOnly,
        action: () => colorSelected(c),
      })),
      { separator: true },
      { title: 'Duplicate', icon: 'copy', disabled: readOnly, action: duplicateSelected },
      { title: 'Fit selection', icon: 'scan', action: fitSelection },
    );
    if (ids.length > 1)
      items.push(
        {
          title: 'Align left',
          icon: 'align-start-vertical',
          disabled: readOnly,
          action: () => edit('Align', (b) => align(b, ids, 'left')),
        },
        {
          title: 'Align top',
          icon: 'align-start-horizontal',
          disabled: readOnly,
          action: () => edit('Align', (b) => align(b, ids, 'top')),
        },
        {
          title: 'Distribute horizontally',
          icon: 'align-horizontal-space-around',
          disabled: readOnly,
          action: () => edit('Distribute', (b) => align(b, ids, 'space-x')),
        },
        {
          title: 'Distribute vertically',
          icon: 'align-vertical-space-around',
          disabled: readOnly,
          action: () => edit('Distribute', (b) => align(b, ids, 'space-y')),
        },
      );
    items.push(
      { separator: true },
      {
        title: ids.length > 1 ? 'Remove cards' : 'Remove card',
        icon: 'x',
        disabled: readOnly,
        action: () => {
          selectOnly(ids);
          edit('Remove selection', (b) => removePlacements(b, ids));
        },
      },
    );
    if (task && single?.type === 'task')
      items.push({
        title: 'Delete task…',
        icon: 'trash-2',
        warning: true,
        disabled: readOnly,
        action: () => {
          void host
            .confirm(
              'Delete task?',
              'This deletes the task record, its card, and references to it in prerequisites. You can undo this action.',
            )
            .then((ok) => {
              if (ok)
                edit('Delete task', (b) => {
                  removePlacements(b, ids);
                  delete b.tasks[single.taskId];
                  for (const t of Object.values(b.tasks))
                    t.dependsOn = t.dependsOn.filter((d) => d !== single.taskId);
                });
            });
        },
      });
    host.showMenu({ x: event.clientX, y: event.clientY }, items);
  };
  const paneMenu = (event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
    if (preview) return;
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    host.showMenu({ x: event.clientX, y: event.clientY }, [
      { title: 'New task here', icon: 'plus', disabled: readOnly, action: () => createAt('task', at) },
      {
        title: 'New note here',
        icon: 'sticky-note',
        disabled: readOnly,
        action: () => createAt('sticky', at),
      },
      { title: 'New frame here', icon: 'frame', disabled: readOnly, action: () => createAt('frame', at) },
      { title: 'Vault note here…', icon: 'link', disabled: readOnly, action: () => create('note', at) },
      { separator: true },
      { title: 'Select all', icon: 'box-select', action: selectAll },
      { title: 'Fit all', icon: 'maximize', action: fit },
      { title: 'Zoom to 100 %', icon: 'search', action: () => void flow.zoomTo(1, { duration: animate }) },
      { separator: true },
      {
        title: 'Snap to grid',
        icon: 'grid-2x2',
        checked: prefs.snap,
        action: () => updatePreference('snap', !prefs.snap),
      },
      {
        title: 'Minimap',
        icon: 'map',
        checked: prefs.minimap,
        action: () => updatePreference('minimap', !prefs.minimap),
      },
      { separator: true },
      { title: 'Draw here', icon: 'pen-line', disabled: readOnly, action: () => setTool('pen') },
      {
        title: `Clear all ink… (${inkCount})`,
        icon: 'eraser',
        disabled: readOnly || !inkCount,
        warning: true,
        action: () => {
          void host
            .confirm(
              'Clear all ink?',
              `This removes ${inkCount} stroke${inkCount === 1 ? '' : 's'} from the board. You can undo this action.`,
            )
            .then((ok) => {
              if (ok) edit('Clear ink', (b) => clearInk(b));
            });
        },
      },
    ]);
  };
  const edgeMenu = (event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    if (preview) return;
    const dependency = edge.id.startsWith('dependency:');
    host.showMenu({ x: event.clientX, y: event.clientY }, [
      {
        title: dependency
          ? 'Prerequisite → dependent'
          : edge.label
            ? `“${String(edge.label)}”`
            : 'Relationship',
        label: true,
      },
      ...(!dependency
        ? [
            {
              title: 'Edit label',
              icon: 'pencil',
              action: () => {
                setSelectedEdge(edge.id);
                setSelectedTask(undefined);
                selectOnly([]);
                setInspector(true);
              },
            },
          ]
        : []),
      {
        title: dependency ? 'Remove dependency' : 'Remove connector',
        icon: 'unlink',
        disabled: readOnly,
        action: () =>
          edit('Remove connector', (b) => {
            if (dependency)
              setDependency(b, String(edge.data!.prerequisite), String(edge.data!.dependent), false);
            else delete b.edges[edge.id];
          }),
      },
    ]);
  };
  const menu = (event: ReactMouseEvent, items: MenuItemSpec[]) => {
    const rect = event.currentTarget.getBoundingClientRect();
    host.showMenu({ x: rect.left, y: rect.bottom + 5 }, items);
  };
  const inputMenu = (event: ReactMouseEvent) => {
    const options: [InputDevice, string, string][] = [
      ['auto', 'Auto-detect', 'wand-sparkles'],
      ['trackpad', 'Trackpad · scroll pans, pinch zooms', 'touchpad'],
      ['mouse', 'Mouse · wheel zooms, drag pans', 'mouse'],
    ];
    menu(event, [
      {
        title: 'Snap to grid',
        icon: 'grid-2x2',
        checked: prefs.snap,
        action: () => updatePreference('snap', !prefs.snap),
      },
      {
        title: 'Minimap',
        icon: 'map',
        checked: prefs.minimap,
        action: () => updatePreference('minimap', !prefs.minimap),
      },
      { separator: true },
      { title: `Input · now ${wheelZooms ? 'mouse' : 'trackpad'}`, label: true },
      ...options.map(([value, title, icon]) => ({
        title,
        icon,
        checked: prefs.input === value,
        action: () => updatePreference('input', value),
      })),
      { separator: true },
      { title: 'Render only visible cards', label: true },
      ...(['auto', 'on', 'off'] as const).map((value) => ({
        title:
          value === 'auto' ? `Automatic (over ${CULL_THRESHOLD} cards)` : value === 'on' ? 'Always' : 'Never',
        checked: prefs.culling === value,
        action: () => updatePreference('culling', value),
      })),
    ]);
  };
  const listTasks = useMemo(() => {
    if (!board) return [];
    const rows = Object.entries(board.tasks).filter(([id]) => matching.has(id));
    const rank = { high: 0, medium: 1, low: 2, none: 3 };
    const order: Record<Status, number> = { doing: 0, todo: 1, backlog: 2, done: 3 };
    if (sort === 'title') rows.sort((a, b) => a[1].title.localeCompare(b[1].title));
    else if (sort === 'due')
      rows.sort((a, b) => (a[1].dueDate ?? '9999').localeCompare(b[1].dueDate ?? '9999'));
    else if (sort === 'priority') rows.sort((a, b) => rank[a[1].priority] - rank[b[1].priority]);
    else if (sort === 'status') rows.sort((a, b) => order[a[1].status] - order[b[1].status]);
    return rows;
  }, [board, matching, sort]);
  const unseen = Math.max(0, state.activity.length - seenActivity);
  const saveIcon = {
    'Saved locally': 'check',
    Saving: 'loader',
    Unsaved: 'circle-dot',
    Conflict: 'alert-triangle',
    Error: 'octagon-alert',
  }[state.status];
  return (
    <div
      className={`roseboard-root${preview ? ' rb-preview' : ''}${zoom < 0.5 ? ' rb-zoom-low' : ''}${hand ? ' rb-hand' : drawing ? ' rb-draw' : ' rb-select'}`}
      ref={root}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      <header className="rb-toolbar">
        <div className="rb-brand">
          <span className="rb-logo">
            <RoseMark />
          </span>
          <strong title={board?.title}>{board?.title ?? 'Roseboard'}</strong>
          <span className="rb-task-count" title="Tasks">
            {board ? Object.keys(board.tasks).length : 0}
          </span>
        </div>
        {!preview && (
          <>
            <span className="rb-divider" />
            <button
              className="rb-view-picker"
              aria-label="Board view"
              aria-haspopup="menu"
              title="Switch view"
              onClick={(event) =>
                menu(
                  event,
                  views.map((view) => ({
                    title: view.label,
                    icon: view.icon,
                    checked: mode === view.mode,
                    action: () => {
                      setMode(view.mode);
                      if (view.mode === 'documents') setInspector(false);
                    },
                  })),
                )
              }
            >
              <Icon name={views.find((view) => view.mode === mode)!.icon} />
              {views.find((view) => view.mode === mode)!.label}
              <Icon name="chevron-down" />
            </button>
          </>
        )}
        <span className="rb-spacer" />
        <span
          className={`rb-save rb-save-${state.status.toLowerCase().replace(' ', '-')}`}
          role="status"
          title={state.status}
          aria-label={state.status}
        >
          <Icon name={saveIcon} />
          <span>{state.status}</span>
        </span>
        {!preview && (
          <>
            {mode !== 'documents' && (
              <>
                <button
                  className={`rb-icon-button${searchOpen || filters.search ? ' is-active' : ''}`}
                  aria-label="Toggle task search"
                  title="Search tasks (⌘F / Ctrl+F)"
                  aria-expanded={searchOpen}
                  onClick={() => setSearchOpen(!searchOpen)}
                >
                  <Icon name="search" />
                </button>
                <button
                  aria-label="Toggle filters"
                  title="Filters"
                  aria-expanded={filterOpen}
                  className={`rb-icon-button${filterOpen || filtersActive({ ...filters, search: '' }) ? ' is-active' : ''}`}
                  onClick={() => setFilterOpen(!filterOpen)}
                >
                  <Icon name="sliders-horizontal" />
                  {filtersActive({ ...filters, search: '' }) && <span className="rb-active-dot" />}
                </button>
              </>
            )}
            <button
              aria-label="Toggle inspector"
              title="Properties"
              className={`rb-icon-button rb-properties-button${inspector ? ' is-active' : ''}`}
              onClick={() => setInspector(!inspector)}
            >
              <Icon name="panel-right" />
            </button>
            <button
              className="rb-icon-button"
              aria-label="Board actions"
              title="Board actions"
              aria-haspopup="menu"
              onClick={(event) =>
                menu(event, [
                  {
                    title: 'Undo',
                    icon: 'undo-2',
                    disabled: readOnly || !state.canUndo,
                    action: host.session.undo,
                  },
                  {
                    title: 'Redo',
                    icon: 'redo-2',
                    disabled: readOnly || !state.canRedo,
                    action: host.session.redo,
                  },
                  { separator: true },
                  {
                    title: `Unplaced tasks (${unplaced.length})`,
                    icon: 'inbox',
                    checked: trayOpen,
                    action: () => setTrayOpen(!trayOpen),
                  },
                  {
                    title: 'Inspector',
                    icon: 'panel-right',
                    checked: inspector,
                    action: () => setInspector(!inspector),
                  },
                  {
                    title: 'Activity',
                    icon: 'activity',
                    action: () => {
                      setActivityOpen(!activityOpen);
                      setSeenActivity(state.activity.length);
                    },
                  },
                  { separator: true },
                  { title: 'Open source', icon: 'code-2', action: () => asyncAction(host.openSource) },
                  { title: 'Export JSON', icon: 'download', action: () => asyncAction(host.exportJSON) },
                ])
              }
            >
              <Icon name="ellipsis" />
              {unseen > 0 && <span className="rb-active-dot" />}
            </button>
            <button
              className="rb-primary rb-new-button"
              disabled={readOnly}
              aria-label="Add to board"
              title="Add to board"
              aria-haspopup="menu"
              onClick={(event) =>
                menu(event, [
                  { title: 'Task', icon: 'circle-plus', action: () => create('task') },
                  {
                    title: 'Sticky note',
                    icon: 'sticky-note',
                    action: () => create('sticky'),
                  },
                  {
                    title: 'Link document',
                    icon: 'file-text',
                    action: () => create('note'),
                  },
                  {
                    title: 'Frame',
                    icon: 'frame',
                    action: () => create('frame'),
                  },
                ])
              }
            >
              <Icon name="plus" />
              <span>New</span>
              <Icon name="chevron-down" />
            </button>
          </>
        )}
      </header>
      {!preview && mode !== 'documents' && (searchOpen || filters.search) && (
        <div className="rb-search-panel">
          <Icon name="search" />
          <input
            autoFocus
            className="rb-search"
            aria-label="Search tasks"
            placeholder="Find a task by title, tag, or description…"
            value={filters.search}
            onChange={(event) => filter('search', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSearchOpen(false);
                filter('search', '');
                root.current?.focus();
              }
            }}
          />
          <span className="rb-muted">{matching.size} results</span>
          <button
            className="rb-icon-button"
            aria-label="Close search"
            onClick={() => {
              setSearchOpen(false);
              filter('search', '');
            }}
          >
            <Icon name="x" />
          </button>
        </div>
      )}
      {(state.issue || state.sourceOpen) && (
        <div className="rb-notice" role="alert">
          <span>
            <Icon
              name={
                state.status === 'Conflict'
                  ? 'git-merge'
                  : state.status === 'Error'
                    ? 'octagon-alert'
                    : 'info'
              }
            />
            {state.sourceOpen
              ? 'Source editing is open. Canvas writes are paused until all source editors close or switch to Reading view. '
              : ''}
            {state.issue}
          </span>
          {!preview && (
            <div>
              <button
                onClick={() =>
                  asyncAction(async () => {
                    const path = await host.session.saveLocalCopy();
                    host.notify(`Local copy saved: ${path}`);
                  })
                }
                disabled={!board}
              >
                Save local copy
              </button>
              <button onClick={() => asyncAction(() => host.session.reload(true))}>
                Preserve draft & reload
              </button>
              <button onClick={() => asyncAction(host.openSource)}>Open source</button>
            </div>
          )}
        </div>
      )}
      {!preview && state.overlaps.length > 0 && board && (
        <div className="rb-overlaps" role="region" aria-label="Overlapping edits">
          <div className="rb-overlaps-head">
            <span>
              <Icon name="git-merge" />
              {state.overlaps.length} overlapping {state.overlaps.length === 1 ? 'edit was' : 'edits were'}{' '}
              combined automatically. Review or dismiss.
            </span>
            <button onClick={() => host.session.clearOverlaps()}>Dismiss all</button>
          </div>
          <ul>
            {state.overlaps.slice(0, 6).map((o, i) => (
              <li key={`${o.kind}:${o.id}:${o.field}:${i}`}>
                <span>{describeOverlap(o)}</span>
                <span className="rb-overlap-actions">
                  <button onClick={() => host.session.resolveOverlap(o, 'keep')}>Keep</button>
                  {o.field !== 'orphan' && (
                    <button
                      disabled={readOnly}
                      onClick={() => host.session.resolveOverlap(o, o.chosen === 'mine' ? 'theirs' : 'mine')}
                    >
                      Use {o.chosen === 'mine' ? 'theirs' : 'mine'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!preview && filterOpen && mode !== 'documents' && (
        <div className="rb-filterbar">
          <div className="rb-segment">
            {[
              ['', 'All'],
              ['today', 'Today'],
              ['overdue', 'Overdue'],
              ['ready', 'Ready'],
            ].map(([v, label]) => (
              <button
                key={v}
                className={filters.preset === v ? 'is-active' : ''}
                onClick={() => filter('preset', v!)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter status"
            value={filters.status}
            onChange={(e) => filter('status', e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter priority"
            value={filters.priority}
            onChange={(e) => filter('priority', e.target.value)}
          >
            <option value="">All priorities</option>
            {priorities.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            aria-label="Filter tag"
            placeholder="Tag"
            value={filters.tag}
            onChange={(e) => filter('tag', e.target.value)}
          />
          <select
            aria-label="Filter assignee"
            value={filters.unassigned ? 'unassigned' : filters.assignee ? `name:${filters.assignee}` : ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                assignee: e.target.value.startsWith('name:') ? e.target.value.slice(5) : '',
                unassigned: e.target.value === 'unassigned',
              }))
            }
          >
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {[
              ...new Set(
                Object.values(board?.tasks ?? {})
                  .map((t) => t.assignee)
                  .filter(Boolean),
              ),
            ]
              .sort()
              .map((name) => (
                <option key={name} value={`name:${name}`}>
                  {name}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter due state"
            value={filters.due}
            onChange={(e) => filter('due', e.target.value)}
          >
            <option value="">Any due date</option>
            <option value="today">Today</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No date</option>
          </select>
          <select
            aria-label="Filter blocked state"
            value={filters.blocked}
            onChange={(e) => filter('blocked', e.target.value)}
          >
            <option value="">Any dependency state</option>
            <option value="blocked">Blocked</option>
            <option value="ready">Ready</option>
          </select>
          <button
            onClick={() => {
              setFilters(emptyFilters);
              setFocusTask(undefined);
            }}
          >
            Clear
          </button>
          <span>{matching.size} results</span>
        </div>
      )}
      <div className="rb-workspace">
        <main className="rb-main">
          {!preview && filtersActive(filters) && (
            <div className="rb-contextbar">
              {filtersActive(filters) && mode !== 'documents' && (
                <button className="rb-filter-summary" onClick={() => setFilters(emptyFilters)}>
                  <Icon name="x" />
                  Clear active filters
                </button>
              )}
              <span className="rb-spacer" />
              {unplaced.length > 0 && (
                <button className={trayOpen ? 'is-active' : ''} onClick={() => setTrayOpen(!trayOpen)}>
                  <Icon name="inbox" />
                  Unplaced {unplaced.length}
                </button>
              )}
            </div>
          )}
          {!preview && connectOpen && mode === 'canvas' && (
            <div className="rb-connectbar">
              <select
                aria-label="Connection kind"
                value={connectMode}
                onChange={(e) => setConnectMode(e.target.value)}
              >
                <option value="relationship">Solid · Relationship</option>
                <option value="dependency">Dashed · Prerequisite → dependent</option>
              </select>
              {connectMode === 'relationship' && (
                <input
                  aria-label="New connector label"
                  value={connectLabel}
                  onChange={(e) => setConnectLabel(e.target.value)}
                />
              )}
              <span>
                Drag from a card edge to another card, or drop on empty space to create a linked task. Or pick
                a target:
              </span>
              <select
                aria-label="Connect to card"
                value={connectTarget}
                onChange={(e) => setConnectTarget(e.target.value)}
              >
                <option value="">Choose target…</option>
                {board &&
                  Object.entries(board.nodes)
                    .filter(([id]) => id !== selectedNodeId)
                    .map(([id, n]) => (
                      <option key={id} value={id}>
                        {nodeTitle(n, board)}
                      </option>
                    ))}
              </select>
              <button
                disabled={readOnly || !selectedNodeId || !connectTarget}
                onClick={() => connectNodes(selectedNodeId!, connectTarget)}
              >
                Connect →
              </button>
            </div>
          )}
          {!preview && drawing && mode === 'canvas' && (
            <div className="rb-inkbar" role="toolbar" aria-label="Ink options">
              {tool === 'pen' ? (
                <>
                  <span className="rb-swatches" role="radiogroup" aria-label="Ink colour">
                    {inkColors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={inkStyle.color === c}
                        aria-label={`${c} ink`}
                        className={`rb-swatch rb-swatch-${c}${inkStyle.color === c ? ' is-active' : ''}`}
                        style={c === 'ink' ? { background: inkColor.ink } : undefined}
                        onClick={() => setInkStyle((s) => ({ ...s, color: c }))}
                      />
                    ))}
                  </span>
                  <span className="rb-segment" role="radiogroup" aria-label="Ink width">
                    {inkWidths.map((w) => (
                      <button
                        key={w.label}
                        type="button"
                        role="radio"
                        aria-checked={inkStyle.width === w.width}
                        aria-label={`${w.label} ink`}
                        className={inkStyle.width === w.width ? 'is-active' : ''}
                        onClick={() => setInkStyle((s) => ({ ...s, width: w.width }))}
                      >
                        <span className="rb-width-sample" style={{ height: Math.max(2, w.width) }} />
                        {w.label}
                      </button>
                    ))}
                  </span>
                  <span>
                    Draw with the mouse, trackpad, pen or finger. Scroll and pinch still move the canvas. Esc
                    returns to Select.
                  </span>
                </>
              ) : (
                <span>
                  Drag over strokes to erase them. One drag is one undo step. Esc returns to Select.
                </span>
              )}
              <span className="rb-spacer" />
              <button
                disabled={readOnly || !inkCount}
                onClick={() => {
                  void host
                    .confirm(
                      'Clear all ink?',
                      `This removes ${inkCount} stroke${inkCount === 1 ? '' : 's'} from the board. You can undo this action.`,
                    )
                    .then((ok) => {
                      if (ok) edit('Clear ink', (b) => clearInk(b));
                    });
                }}
              >
                <Icon name="eraser" />
                Clear all ink
              </button>
              <button onClick={() => setTool('select')}>Done</button>
            </div>
          )}
          {focusTask && (
            <div className="rb-focusbar">
              <Icon name="focus" />
              Focused on a task and its immediate prerequisites / dependents.
              <button onClick={() => setFocusTask(undefined)}>Clear focus</button>
            </div>
          )}
          {trayOpen && !preview && (
            <div className="rb-tray">
              <strong>Unplaced tasks · {unplaced.length}</strong>
              <button
                disabled={readOnly || !unplaced.length}
                onClick={() => {
                  edit('Place all tasks', (b) => {
                    placeAll(b);
                  });
                  setTimeout(fit, 30);
                }}
              >
                Place all in a new grid
              </button>
              {unplaced.map((id) => (
                <button key={id} onClick={() => selectTask(id)}>
                  {board?.tasks[id]?.title}
                </button>
              ))}
            </div>
          )}
          {mode === 'canvas' ? (
            <div
              className="rb-canvas"
              ref={canvas}
              onDoubleClick={(e) => {
                if (preview || readOnly || !(e.target as HTMLElement).classList.contains('react-flow__pane'))
                  return;
                const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
                createAt('task', { x: at.x - 150, y: at.y - 40 });
              }}
            >
              {!preview && (
                <div className="rb-tool-dock" role="toolbar" aria-label="Canvas tools">
                  {(
                    [
                      ['select', 'Select mode', 'Select (V)', 'mouse-pointer-2'],
                      ['hand', 'Hand mode', 'Hand (H)', 'hand'],
                      ['pen', 'Pen tool', 'Draw (P)', 'pen-line'],
                      ['eraser', 'Eraser tool', 'Erase (E)', 'eraser'],
                    ] as const
                  ).map(([value, label, title, icon]) => (
                    <button
                      key={value}
                      aria-label={label}
                      title={title}
                      aria-pressed={tool === value}
                      className={tool === value ? 'is-active' : ''}
                      disabled={
                        (value === 'pen' || value === 'eraser') &&
                        (readOnly || (value === 'eraser' && !inkCount))
                      }
                      onClick={() => setTool(value)}
                    >
                      <Icon name={icon} />
                      <span className="rb-tool-tip">{title}</span>
                    </button>
                  ))}
                  <span className="rb-divider" />
                  <button
                    aria-label="New task"
                    title="New task"
                    disabled={readOnly}
                    onClick={() => create('task')}
                  >
                    <Icon name="circle-plus" />
                    <span className="rb-tool-tip">Task</span>
                  </button>
                  <button
                    aria-label="New note"
                    title="New sticky note"
                    disabled={readOnly}
                    onClick={() => create('sticky')}
                  >
                    <Icon name="sticky-note" />
                    <span className="rb-tool-tip">Sticky note</span>
                  </button>
                  <button
                    aria-label="Vault note"
                    title="Link a document"
                    disabled={readOnly}
                    onClick={() => create('note')}
                  >
                    <Icon name="file-text" />
                    <span className="rb-tool-tip">Document</span>
                  </button>
                  <button
                    aria-label="New frame"
                    title="New frame"
                    disabled={readOnly}
                    onClick={() => create('frame')}
                  >
                    <Icon name="frame" />
                    <span className="rb-tool-tip">Frame</span>
                  </button>
                  <button
                    aria-label="Connect"
                    title="Connect cards"
                    aria-expanded={connectOpen}
                    className={connectOpen ? 'is-active' : ''}
                    onClick={() => setConnectOpen(!connectOpen)}
                  >
                    <Icon name="spline" />
                    <span className="rb-tool-tip">Connect</span>
                  </button>
                  <span className="rb-divider" />
                  <button
                    aria-label="Undo"
                    title={state.undoLabel ? `Undo ${state.undoLabel.toLowerCase()}` : 'Undo'}
                    disabled={readOnly || !state.canUndo}
                    onClick={host.session.undo}
                  >
                    <Icon name="undo-2" />
                    <span className="rb-tool-tip">Undo</span>
                  </button>
                  <button
                    aria-label="Redo"
                    title={state.redoLabel ? `Redo ${state.redoLabel.toLowerCase()}` : 'Redo'}
                    disabled={readOnly || !state.canRedo}
                    onClick={host.session.redo}
                  >
                    <Icon name="redo-2" />
                    <span className="rb-tool-tip">Redo</span>
                  </button>
                </div>
              )}
              <ReactFlow<FlowNode>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                elevateNodesOnSelect={false}
                onNodesChange={onNodesChange}
                onNodeDragStart={begin}
                onNodeDragStop={stopDrag}
                onSelectionDragStart={begin}
                onSelectionDragStop={(e, ns) => {
                  if (ns[0]) stopDrag(e.nativeEvent, ns[0], ns);
                }}
                onConnect={connect}
                onConnectEnd={connectEnd}
                connectionMode={ConnectionMode.Loose}
                connectionLineStyle={{
                  stroke: connectMode === 'dependency' ? '#F472B6' : '#8F8F9F',
                  strokeWidth: 1.5,
                  strokeDasharray: connectMode === 'dependency' ? '5 5' : undefined,
                }}
                onNodeClick={() => {
                  if (!preview) {
                    setSelectedTask(undefined);
                    setSelectedEdge(undefined);
                    setInspector(true);
                  }
                }}
                onNodeContextMenu={(e, node) =>
                  cardMenu(e, selectedIds.includes(node.id) ? selectedIds : [node.id])
                }
                onSelectionContextMenu={(e, ns) =>
                  cardMenu(
                    e,
                    ns.map((n) => n.id),
                  )
                }
                onPaneContextMenu={paneMenu}
                onEdgeContextMenu={edgeMenu}
                onEdgeClick={(_, e) => {
                  if (!preview) {
                    setSelectedEdge(e.id);
                    setSelectedTask(undefined);
                    selectOnly([]);
                    setInspector(true);
                  }
                }}
                onPaneClick={() => {
                  setSelectedTask(undefined);
                  setSelectedEdge(undefined);
                }}
                onMove={(_, v) => setZoom(v.zoom)}
                minZoom={0.15}
                maxZoom={2.5}
                defaultViewport={{ x: 64, y: 64, zoom: 0.9 }}
                fitView
                fitViewOptions={{ minZoom: 0.15, maxZoom: 1, padding: 0.15 }}
                nodesDraggable={!readOnly && !drawing}
                nodesConnectable={!readOnly && !drawing}
                elementsSelectable={!preview && !drawing}
                panOnScroll={!wheelZooms}
                panOnScrollSpeed={0.9}
                zoomOnScroll={wheelZooms}
                zoomOnPinch
                zoomOnDoubleClick={false}
                panOnDrag={drawing ? false : hand || preview ? [0, 1, 2] : [1, 2]}
                selectionOnDrag={!hand && !preview && !drawing}
                selectionMode={SelectionMode.Partial}
                multiSelectionKeyCode={multiKeys}
                selectionKeyCode="Shift"
                deleteKeyCode={null}
                nodeDragThreshold={2}
                snapToGrid={prefs.snap}
                snapGrid={snapGrid}
                onlyRenderVisibleElements={culling}
                colorMode="dark"
                preventScrolling
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#34343E" />
                {board && <InkLayer board={board} live={live} pending={pendingErase} />}
                {prefs.minimap && (
                  <MiniMap pannable zoomable nodeColor="#41414F" maskColor="rgba(17,17,19,.75)" />
                )}
              </ReactFlow>
              {drawing && !readOnly && board && (
                <DrawOverlay
                  tool={tool}
                  style={inkStyle}
                  board={board}
                  onLive={setLive}
                  onPending={setPendingErase}
                  onStroke={(stroke) =>
                    edit('Draw', (b) => {
                      addStroke(b, stroke);
                    })
                  }
                  onErase={(ids) => edit('Erase ink', (b) => eraseStrokes(b, ids))}
                />
              )}
              {board && Object.keys(board.nodes).length === 0 && (
                <div className="rb-empty">
                  <span>
                    <RoseMark />
                  </span>
                  <h2>Room for your next idea.</h2>
                  <p>
                    Double-click anywhere to add a task, or drop a note or frame.
                    <br />
                    {unplaced.length
                      ? `${unplaced.length} unplaced tasks are waiting in the tray.`
                      : 'Pan freely. Your board grows with you.'}
                  </p>
                  {!preview && (
                    <button disabled={readOnly} className="rb-primary" onClick={() => create('task')}>
                      <Icon name="plus" />
                      Create a task
                    </button>
                  )}
                </div>
              )}
              {!preview && selectedIds.length > 0 && (
                <div className="rb-selectionbar" role="toolbar" aria-label="Selection actions">
                  <span>{selectedIds.length} selected</span>
                  <span className="rb-swatches rb-swatches-mini">
                    <button
                      aria-label="No colour"
                      className="rb-swatch rb-swatch-none"
                      disabled={readOnly}
                      onClick={() => colorSelected(undefined)}
                    >
                      <Icon name="slash" />
                    </button>
                    {colors.map((c) => (
                      <button
                        key={c}
                        aria-label={`${c} colour`}
                        className={`rb-swatch rb-swatch-${c}`}
                        disabled={readOnly}
                        onClick={() => colorSelected(c)}
                      />
                    ))}
                  </span>
                  <button disabled={readOnly} onClick={duplicateSelected}>
                    <Icon name="copy" />
                    Duplicate
                  </button>
                  {selectedIds.length > 1 && (
                    <button
                      disabled={readOnly}
                      onClick={(e) =>
                        host.showMenu({ x: e.clientX, y: e.clientY }, [
                          {
                            title: 'Align left',
                            icon: 'align-start-vertical',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'left')),
                          },
                          {
                            title: 'Align centre',
                            icon: 'align-center-vertical',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'center-x')),
                          },
                          {
                            title: 'Align right',
                            icon: 'align-end-vertical',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'right')),
                          },
                          { separator: true },
                          {
                            title: 'Align top',
                            icon: 'align-start-horizontal',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'top')),
                          },
                          {
                            title: 'Align middle',
                            icon: 'align-center-horizontal',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'center-y')),
                          },
                          {
                            title: 'Align bottom',
                            icon: 'align-end-horizontal',
                            action: () => edit('Align', (b) => align(b, selectedIds, 'bottom')),
                          },
                          { separator: true },
                          {
                            title: 'Distribute horizontally',
                            icon: 'align-horizontal-space-around',
                            action: () => edit('Distribute', (b) => align(b, selectedIds, 'space-x')),
                          },
                          {
                            title: 'Distribute vertically',
                            icon: 'align-vertical-space-around',
                            action: () => edit('Distribute', (b) => align(b, selectedIds, 'space-y')),
                          },
                        ])
                      }
                    >
                      <Icon name="align-start-vertical" />
                      Align
                    </button>
                  )}
                  <button disabled={readOnly} onClick={remove}>
                    <Icon name="x" />
                    Remove card{selectedIds.length > 1 ? 's' : ''}
                  </button>
                </div>
              )}
              <div className="rb-navigation">
                <button
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() => void flow.zoomOut({ duration: animate })}
                >
                  <Icon name="minus" />
                </button>
                <button
                  aria-label="Reset zoom"
                  title="Reset to 100 % (1)"
                  onClick={() => void flow.zoomTo(1, { duration: animate })}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() => void flow.zoomIn({ duration: animate })}
                >
                  <Icon name="plus" />
                </button>
                <button aria-label="Fit all" title="Fit all (⇧1)" onClick={fit}>
                  <Icon name="maximize" />
                  Fit all
                </button>
                {!preview && (
                  <>
                    <button
                      aria-label="Fit selection"
                      title="Fit selection (⇧2)"
                      disabled={!selectedIds.length}
                      onClick={fitSelection}
                    >
                      <Icon name="scan" />
                    </button>
                    <button
                      aria-label="Canvas options"
                      title={`Canvas options · ${prefs.input === 'auto' ? `auto (${wheelZooms ? 'mouse' : 'trackpad'})` : prefs.input}`}
                      onClick={inputMenu}
                    >
                      <Icon name="settings-2" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : mode === 'documents' && board ? (
            <Documents
              host={host}
              board={board}
              selected={documentPath}
              select={setDocumentPath}
              readOnly={readOnly}
              add={() => {
                void host.pickNote().then((path) => {
                  if (!path) return;
                  const latest = host.session.getSnapshot().board;
                  if (!latest) return;
                  const linked =
                    Object.values(latest.nodes).some((n) => n.type === 'note' && n.notePath === path) ||
                    Object.values(latest.tasks).some((t) => t.notePath === path);
                  if (!linked) {
                    const bottom = Object.values(latest.nodes).reduce(
                      (y, node) => Math.max(y, node.y + node.height),
                      0,
                    );
                    createAt('note', { x: 100, y: bottom + 80 }, { path });
                  }
                  previewNote(path);
                });
              }}
            />
          ) : (mode === 'day' || mode === 'calendar') && board ? (
            <Planner
              host={host}
              board={board}
              matching={matching}
              today={today}
              date={plannerDate || today}
              setDate={(date) => setPlannerDate(date === today ? '' : date)}
              view={mode}
              readOnly={readOnly}
              activeTask={taskId}
              edit={edit}
              select={selectTask}
              complete={complete}
            />
          ) : mode === 'kanban' && board ? (
            <Kanban
              host={host}
              board={board}
              matching={matching}
              today={today}
              readOnly={readOnly}
              activeTask={taskId}
              edit={edit}
              select={selectTask}
              complete={complete}
            />
          ) : (
            <div className="rb-list" aria-label="Task list">
              <div className="rb-list-heading">
                <strong>{matching.size} tasks</strong>
                <label className="rb-inline-label">
                  Sort
                  <select
                    aria-label="Sort tasks"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as typeof sort)}
                  >
                    <option value="created">Board order</option>
                    <option value="status">Status</option>
                    <option value="priority">Priority</option>
                    <option value="due">Due date</option>
                    <option value="title">Title</option>
                  </select>
                </label>
              </div>
              {board &&
                listTasks.map(([id, t]) => (
                  <div
                    className={`rb-list-row${id === taskId ? ' is-active' : ''}${t.status === 'done' ? ' rb-done' : ''}`}
                    key={id}
                  >
                    <button
                      className="rb-complete"
                      disabled={readOnly}
                      aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Complete ${t.title}`}
                      onClick={() => complete(id)}
                    >
                      <Icon name={t.status === 'done' ? 'circle-check-big' : 'circle'} />
                    </button>
                    <button className="rb-list-title" onClick={() => selectTask(id)}>
                      <strong>{t.title}</strong>
                      <small>
                        {t.assignee ? `${t.assignee} · ` : ''}
                        {t.tags.map((tag) => `#${tag}`).join(' ')}
                        {blocked(t, board) && t.status !== 'done' ? ' · Blocked' : ''}
                      </small>
                    </button>
                    <span className={`rb-chip rb-status rb-status-${t.status}`}>
                      <Icon name={statusIcon[t.status]!} />
                      {statusLabel[t.status]}
                    </span>
                    <span className={`rb-list-priority rb-priority rb-priority-${t.priority}`}>
                      {t.priority !== 'none' && <Icon name={priorityIcon[t.priority]!} />}
                      {t.priority === 'none' ? '—' : t.priority}
                    </span>
                    <span className={`rb-list-due${overdue(t, today) ? ' rb-overdue' : ''}`}>
                      {t.dueDate ? formatDue(t.dueDate, today) : 'No date'}
                    </span>
                    {unplaced.includes(id) ? (
                      <button
                        disabled={readOnly}
                        onClick={() =>
                          edit('Place task', (b) => {
                            placeAll(b, [id]);
                          })
                        }
                      >
                        Place
                      </button>
                    ) : (
                      <button onClick={() => jump(id)}>
                        Jump
                        <Icon name="arrow-up-right" />
                      </button>
                    )}
                  </div>
                ))}
              {matching.size === 0 && (
                <p className="rb-muted">No matching tasks. Clear filters or create a task.</p>
              )}
            </div>
          )}
          <footer className="rb-footer">
            <span>
              {mode === 'canvas'
                ? drawing
                  ? tool === 'pen'
                    ? 'Drawing · Drag to draw a stroke · Scroll or pinch to move · Esc to finish'
                    : 'Erasing · Drag across strokes to remove them · Esc to finish'
                  : hand
                    ? `Drag to pan · ${wheelZooms ? 'Wheel zooms · Shift+wheel pans sideways' : 'Two fingers pan · Pinch zooms'} · Double-click adds a task`
                    : `Drag to select · Space+drag or ${wheelZooms ? 'middle-drag' : 'two fingers'} to pan · Right-click for menus`
                : mode === 'kanban'
                  ? 'Drag cards between columns to change status. Canvas positions are kept.'
                  : mode === 'documents'
                    ? 'Live previews of your linked Markdown notes. Edit originals in Obsidian.'
                    : mode === 'day' || mode === 'calendar'
                      ? 'Plan, complete, or reschedule tasks. Canvas positions are kept.'
                      : 'Task records stay linked to their canvas cards.'}
            </span>
            <span>{selectedIds.length ? `${selectedIds.length} selected` : 'Local-first · No account'}</span>
          </footer>
        </main>
        {activityOpen && !preview && board && (
          <aside className="rb-inspector rb-activity" aria-label="Activity">
            <div className="rb-inspector-heading">
              <span>
                <Icon name="activity" />
                Activity
              </span>
              <button
                aria-label="Close activity"
                className="rb-icon-button"
                onClick={() => setActivityOpen(false)}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="rb-inspector-body">
              {state.activity.length === 0 && (
                <p className="rb-muted">
                  Changes that arrive from other devices or from the source note will appear here while this
                  board is open.
                </p>
              )}
              {state.activity.map((entry) => (
                <div className="rb-activity-entry" key={entry.at}>
                  <div className="rb-activity-head">
                    <strong>{entry.by ?? 'Another device or editor'}</strong>
                    <span>
                      {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <ul>
                    {entry.changes.slice(0, 12).map((c, i) => (
                      <li key={i}>
                        <span>{describe(c)}</span>
                        {c.kind === 'task' && board.tasks[c.id] && (
                          <button className="rb-text-link" onClick={() => jump(c.id)}>
                            Jump
                          </button>
                        )}
                      </li>
                    ))}
                    {entry.changes.length > 12 && (
                      <li className="rb-muted">…and {entry.changes.length - 12} more</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </aside>
        )}
        {inspector &&
          !preview &&
          board &&
          (selectedEdge?.startsWith('dependency:') ? (
            <aside className="rb-inspector">
              <div className="rb-inspector-heading">
                <span>
                  <Icon name="git-branch" />
                  Dependency
                </span>
                <button
                  aria-label="Close inspector"
                  className="rb-icon-button"
                  onClick={() => setInspector(false)}
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="rb-inspector-body">
                <p className="rb-muted">
                  Dashed arrow: prerequisite → dependent. Stored only in the dependent task’s{' '}
                  <code>dependsOn</code>.
                </p>
                <button disabled={readOnly} onClick={remove}>
                  <Icon name="unlink" />
                  Remove dependency
                </button>
              </div>
            </aside>
          ) : (
            <Inspector
              key={taskId ?? selectedNodeId ?? selectedEdge ?? 'board'}
              host={host}
              board={board}
              nodeId={selectedNodeId}
              taskId={taskId}
              edgeId={selectedEdge}
              readOnly={readOnly}
              today={today}
              close={() => setInspector(false)}
              focus={(id) => {
                setFocusTask(id);
                jump(id);
              }}
              edit={edit}
              complete={complete}
              previewNote={previewNote}
            />
          ))}
      </div>
    </div>
  );
}
function nodeTitle(node: Board['nodes'][string], board: Board): string {
  return node.type === 'task'
    ? (board.tasks[node.taskId]?.title ?? node.taskId)
    : node.type === 'frame'
      ? node.title
      : node.type === 'note'
        ? node.notePath
        : node.content.slice(0, 40) || 'Note';
}
function RoseMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 4c7-5 14 4 8 9 8 4 3 15-4 11-1 9-13 9-13 1-9 0-11-11-3-14C2 3 11-1 16 4Z"
        transform="translate(3 4) scale(.84)"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 12 4 4-4 4-4-4 4-4Z" fill="currentColor" opacity=".5" />
    </svg>
  );
}
