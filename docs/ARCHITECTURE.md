# Architecture and verified API choices

## Layers

- `src/domain/model.ts`: versioned Zod definitions, TypeScript types, defaults, safe path/calendar/reference checks, dependency validation, board-local dates, filters, and canonical serialization (sorted record keys).
- `src/domain/commands.ts`: immutable commands, stable-ID duplication, removal/deletion semantics, absolute-coordinate frame moves, nudging, align/distribute, grid placement, edit stamping, and bounded undo/redo with history rebasing. Immer preserves unchanged task/node references, which the stamp pass and the renderer rely on.
- `src/domain/ink.ts`: pure freehand geometry: point-list conversion, iterative Ramer–Douglas–Peucker simplification, smoothed SVG path generation, and stroke hit testing for the eraser.
- `src/domain/merge.ts`: pure three-way merge of two divergent boards over a common base, per record and per field, with set semantics for tags/prerequisites, ID-keyed checklist merging, overlap reporting, post-merge repair, a change diff for the activity feed, and single-overlap resolution. No I/O.
- `src/persistence/markdown.ts`: fence-aware payload extraction/replacement with surrounding byte preservation; canonical JSON output.
- `src/persistence/session.ts`: one observable document per source path. Debounced serialized saves with a maximum wait, debounced recovery drafts, baseline comparison, in-transaction merging when the file moved on, external-change merging, source-editor suspension, draft/snapshot recovery, overlap list and activity feed.
- `src/main.tsx`: public Obsidian `ItemView`, Markdown processor, commands, picker/dialogs, native `Menu` adapter, settings (device name, stamps, input device, culling, folder), file events and `Vault.process` adapter. Shares sessions and cleans roots/subscriptions on close.
- `src/ui/`: React + React Flow custom nodes (`Nodes.tsx`, with inline editing and four connection handles), the board surface (`Board.tsx`: canvas, list, wheel-device detection, keyboard, context menus, selection bar, activity and overlap UI), `Ink.tsx` (an SVG stroke layer inside React Flow's `ViewportPortal` plus a pointer-capturing drawing/erasing overlay that forwards wheel events to the pane), `Kanban.tsx`, the inspector, safe Markdown, and `icons.tsx`, which renders the host's Lucide icons through `getIcon`. Camera/selection/filter/gesture/view-mode state stays here. Stable card data, memoized node components, reused node/edge objects, a low-zoom selector and optional viewport culling limit renders.
- `esbuild.config.mjs`: bundles all browser runtime dependencies; only `obsidian` remains external. Prefixes upstream React Flow CSS under `.roseboard-root`, then appends scoped styles. There is no Node/Electron runtime import, remote font, telemetry, account, or backend.

## Input handling

React Flow receives `panOnScroll`/`zoomOnScroll` according to the effective device. In `auto`, a capture-phase wheel listener on the canvas classifies events: `deltaMode !== 0`, legacy `wheelDeltaY` multiples of 120, or integer notch-sized `deltaY` with no `deltaX` indicate a mouse wheel; small fractional or two-axis deltas indicate a trackpad; `ctrlKey` wheels are pinches and never count. Two consistent events switch the interpretation. In mouse mode the same listener turns Shift+wheel into horizontal panning before React Flow's zoom handler sees it. Space+drag panning in Select mode is React Flow's default `panActivationKeyCode`.

Bare letters never create content. `V`/`H` switch tools, `1`/`⇧1`/`⇧2` zoom, arrows nudge, and modifier chords (undo, redo, duplicate, select all) are also registered through the view's Obsidian `Scope` so they win over app-level bindings while the board is focused and lose to text fields.

## API and dependency review — 2026-09-18

Registry metadata was checked before implementation. Core packages are pinned in `package.json` and all resolved versions in `package-lock.json`.

| Component | Pinned / resolved version at implementation | License |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT |
| `@xyflow/react` | 12.11.6 | MIT |
| Obsidian public API types | 1.13.1 | MIT |
| esbuild | 0.28.2 | MIT |
| React Markdown | 10.1.0 | MIT |
| Immer | 10.1.1 | MIT |
| Zod | 4.6.5 (lockfile) | MIT |

The installed desktop application's bundle version is 1.11.7 (its updater fetched 1.13.7 in the test profile). The build compiles against public API typings, but the minimum declared application version (1.6.0) has not separately been installed/tested. Mobile APIs and gesture support are available in the engine; physical Android testing remains outstanding. `isDesktopOnly: false` reflects the absence of Node/Electron runtime dependencies, not a certification of every device.

Public APIs relied on in 1.1 and checked against the installed `obsidian.d.ts`: `Menu`, `MenuItem.setTitle/setIcon/setChecked/setDisabled/setWarning/setIsLabel/onClick`, `Menu.showAtPosition`, `getIcon`, `Platform.isMobile/isMacOS`, `Setting.setHeading/addDropdown/addToggle`. No submenu API is public, so context menus stay flat. React Flow props checked against the installed typings: `onConnectEnd` (`FinalConnectionState` with `fromNode`/`toNode`), `ConnectionMode.Loose`, `onlyRenderVisibleElements`, `panActivationKeyCode`, `zoomOnDoubleClick`, `onNodeContextMenu`/`onPaneContextMenu`/`onEdgeContextMenu`/`onSelectionContextMenu`, `nodeDragThreshold`.

Primary sources inspected:

- [Obsidian custom views](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/User%20interface/Views.md): `ItemView`, registration, leaf view state, lifecycle cleanup.
- [Obsidian Markdown post processing](https://raw.githubusercontent.com/obsidianmd/obsidian-developer-docs/main/en/Plugins/Editor/Markdown%20post%20processing.md): language-specific processor and render-child lifecycle.
- [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault): public read/process behavior, synchronous transforms, local atomicity and explicit baseline comparison.
- [Obsidian API declarations](https://github.com/obsidianmd/obsidian-api): `getMode`, `openLinkText`, file events, `getFirstLinkpathDest`, `Vault.process`, `Menu`, `getIcon`, and `FuzzySuggestModal` checked against the installed package.
- [Obsidian mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development): browser APIs on mobile; Node and Electron unavailable.
- [React Flow documentation](https://reactflow.dev/learn), [performance guidance](https://reactflow.dev/learn/advanced-use/performance), and [touch example](https://reactflow.dev/examples/interaction/touch-device): public custom-node, handle, resize, selection, pan/pinch, provider, and minimap APIs. No paid example code is used.
- [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/): reviewed as a later export target; Roseboard's source is deliberately its own versioned Markdown schema.
- [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync): acknowledged as the user's independent synchronization layer. Its Markdown auto-merge motivates canonical key order; the plugin never talks to it.

## Known limits and decisions

Only currently acquired boards receive reference-rename updates. Scanning and silently rewriting every board in a vault would exceed the safe scope of a file event. File-explorer drag payloads have no public typed contract here, so the supported picker remains the creation path.

Background source detection includes every Markdown leaf, not only the active one. Switching away from a source tab is insufficient: close it or choose Reading view. Commands and save transformations query the guard directly; registered layout/editor events plus a cleaned-up interval refresh the visible message.

The engine has no finite translate extent. Viewport culling is available and automatic above 120 cards; the measured stress fixture in `TEST-REPORT.md` records its effect. Full task lists and node wrappers still cost time proportional to board size, so measured desktop results are not a universal mobile performance claim.

The merge is structural, not semantic: it does not understand Markdown inside descriptions (a description edited on both sides is one overlap, resolved whole), it trusts device clocks for recency, and it cannot combine changes that would violate the schema, which fall back to the explicit conflict path. Recovery drafts are debounced, so up to 0.8 s of the newest edits can be missing from a draft after a hard crash; successful saves make the draft unnecessary.
