# Roseboard 1.2.0 — implementation and test report

Date: 2026-09-18. Final packaged build: **73/73 automated tests passing; 34/34 actual-Obsidian integration scenarios passing; zero captured renderer errors.** Strict TypeScript checking and the production bundle build pass. The 1.0.0 report is preserved in the repository history (`git show 072b1a7:docs/TEST-REPORT.md`).

## Implemented

**1.2 (this branch):** freehand ink with Draw and Erase tools, seven colours and three widths, stroke simplification, viewport-attached rendering, wheel forwarding while drawing, Clear all ink, and full participation of strokes in undo, stamps, activity and the three-way merge. The `ink` record is optional and invisible to readers before 1.2.

**1.1:** everything from 1.0.0 plus: record-level three-way merging of concurrent changes with overlap review, edit stamps and device attribution, an activity feed with remote-change highlighting, canonical serialization, debounced recovery drafts, undo rebasing, trackpad/mouse input detection with Shift+wheel panning, double-click creation, inline renaming, drag-to-empty-space task creation, context menus, arrow nudging, align/distribute, card colours, Kanban view, list sorting, viewport culling, node-object reuse, and the visual redesign with host Lucide icons. Bare-letter creation shortcuts were removed.

## Actually tested

**Environment:** macOS Darwin 25.6.0, Apple M4 Pro (arm64); installed Obsidian application bundle 1.11.7 (its updater fetched 1.13.7 into the separate test profile; the test process was not restarted into it). Tests were driven through Playwright/CDP against this running Obsidian application with a separate profile. This was not a standalone browser mock or a mocked Obsidian runtime.

A temporary vault was created by `scripts/launch-test-vault.mjs` in the system temporary directory (`Roseboard Test Vault` inside a fresh `roseboard-obsidian-*` folder).

The harness verifies that the connected app's vault path matches this temporary vault before performing mutations. It contains copied examples and synthetic test records only. No test build was installed into the user's regular `.obsidian/plugins`, and no existing notes or LiveSync settings were modified. The test vault sets `nativeMenus: false` so context menus render in the DOM and can be observed; the plugin itself respects the user's setting. Build dependencies live outside any notes vault.

### Automated domain, merge, file, and artifact checks (`npm test`)

- Schema/defaults; unsupported versions; invalid shapes/references; IDs and unknown fields; valid calendar dates; vault-only paths; optional stamps validated as ISO date-times.
- Fence parsing; exactly-one-block enforcement; longer/nested fences; CRLF; byte-preservation of surrounding Markdown; canonical sorted round trips.
- Missing/self/cyclic prerequisites; blocked/ready/overdue/Today semantics across UTC boundaries and DST; date-only day arithmetic.
- Independent duplication; placement removal versus task deletion; incoming prerequisite cleanup; explicit frame membership/movement/ungrouping; non-disruptive placement; undo/redo; stamping of only the changed records.
- **Merge (`tests/merge.test.ts`):** disjoint edits combine without overlaps; same-card moves and same-field edits report overlaps, resolved by recency stamps or local preference and reversible either way; additions on both sides; removals versus edits; prerequisite repair after a remote deletion; tag/prerequisite set merging; checklist merging by item ID; duplicate placement repair keeping the synced card; refusal of cycle-producing combinations; extension-field and board-level merging; change diffing; history rebasing.
- **Persistence against real temporary Markdown files:** debounced serialized saves; a burst of edits produces one recovery draft and none when the save lands first; stamps written through the storage port; external reloads keep coordinates and undo; concurrent external edits merge at file-event time and at commit time (inside the write transaction); overlaps listed and resolvable; unmergeable changes conflict and recover when the source is fixed; invalid JSON retention; source suspension; source edits combined after the editor closes; draft recovery combined with newer source; deletion recovery; edits during an in-flight save, including a merging save; subscriber cleanup.
- **Ink (`tests/ink.test.ts`):** stroke schema defaults and rejections; Markdown round trips with sorted keys and omission of an empty map; survival through a reader that ignores `ink`; segment distance, bounds, RDP simplification keeping corners, smoothed SVG paths, hit testing; add/erase/clear as stamped undoable edits; merging strokes drawn on two devices with erasures honoured; diff of ink changes.
- Built CSS selector/animation isolation; local runtime assets; manifest/version consistency; schema publication of the new optional fields; seventeen text/surface colour pairs at or above 4.5:1 contrast. This is token-level contrast verification, not a complete accessibility certification.

Raw machine-readable output: `unit-test-results.json` (regenerate with `npx vitest run --reporter=json --outputFile=docs/unit-test-results.json`).

### Actual Obsidian integration scenarios (`npm run test:obsidian`)

| Scenario | Result |
| --- | --- |
| Bundled plugin loads in installed Obsidian; full-pane example canvas; host icons render | PASS |
| Create board command, task record, inspector edits, quick dates, checklist composer and stamps persist | PASS |
| Completed pointer drag is one undo step; resize and 10,000+ coordinates persist | PASS |
| Reopen restores same task IDs and coordinates from Markdown | PASS |
| Inline rename, arrow nudging and card colours edit the record in place | PASS |
| Double-click on empty canvas creates a task there; context menu completes it | PASS |
| List editing, unplaced tray, placement removal, duplicate/delete and undo | PASS |
| External JSON edit reloads valid data, preserves coordinates, keeps undo, highlights the change, shows attribution in Activity | PASS |
| Invalid JSON retains last valid display, disables writes, never overwrites source | PASS |
| Two open board views share one model and source-editor suspension prevents writes | PASS |
| Local edits racing an external change to another record are merged, not conflicted | PASS |
| Same-field overlap keeps local work, is listed for review, and can take the other side | PASS |
| Uncombinable changes enter Conflict; recovery copy and preserve/reload work | PASS |
| Reading-view preview is resizable and read-only; it does not suspend board writes | PASS |
| Vault-note picker creates a reference; target rename follows; deletion is explicit | PASS |
| Sticky safe preview does not mount raw HTML or fetch remote images | PASS |
| Frames move their explicit members once and ungroup without deleting tasks | PASS |
| Labelled connectors and dependency connectors have distinct storage; cycles are rejected | PASS |
| Dragging a connection onto empty canvas creates a linked task | PASS |
| Blocked completion warns, can be cancelled or accepted, and remains undoable | PASS |
| Kanban drag changes status only and keeps canvas positions; column add; undo | PASS |
| Search, status/priority/tag/due/blocked filters, presets and sorting preserve positions | PASS |
| Multi-selection, keyboard duplicate/undo; shortcuts stay out of text inputs; stray typing never creates content | PASS |
| Source-editor in-progress text is revalidated after closing; raw export command works | PASS |
| Wheel input: trackpad deltas pan, mouse-wheel deltas zoom, Shift+wheel pans sideways; no camera writes | PASS |
| Zoom, fit, minimap, snapping and marquee selection operate without camera saves | PASS |
| Tags commit while typing, retain delimiters, and refresh after undo | PASS |
| Unsupported schema and deleted source stay recoverable without replacement writes | PASS |
| Narrow viewport uses a drawer and usable List view (desktop emulation only) | PASS |
| Stress fixture: 300 nodes, 500 connections; load and interaction timings; culling mounts a subset | PASS |
| Repeated open/close releases React roots, subscriptions and clean sessions | PASS |
| Pen draws strokes (colour, width, simplified points, stamp), eraser removes only crossed strokes, undo restores, Clear all ink from the canvas menu, wheel still pans while drawing, cards never move | PASS |
| Ink written by another device is merged with pending local edits, rendered, and listed in Activity | PASS |
| Disabling the plugin leaves readable fenced JSON in the source note | PASS |

Raw results: `obsidian-test-results.json`. Pointer, wheel and keyboard events were injected by the automation driver. The "other device" in the merge scenarios is simulated by writing the note through `Vault.modify`, which is the same public API the installed LiveSync client uses to reflect incoming files; a live two-device LiveSync round trip was not performed (see below). Wheel-device detection was exercised with synthetic `deltaMode`/fractional deltas, not a physical trackpad.

The 1.2 ink scenario draws with injected mouse events on the drawing overlay; pen pressure, palm rejection and finger drawing on a touch screen were not exercised. These checks (1.1 and 1.2 runs) caught and led to fixes for: a card-level `position: relative` that clipped resize and connection handles; double-clicks on card titles also creating tasks; a wheel-detection hysteresis that could never flip to mouse; a low-zoom mode that hid the missing-note indicator; and bare-letter creation shortcuts that turned stray typing into tasks. The final suite passes after those corrections.

### Measured stress fixture

`examples/stress-300.md` is reproducible: **300 task nodes, 250 acyclic dependency arrows, and 250 ordinary connectors**. Measurements were collected in the running Obsidian application at 1440 × 1000 pixels on the Mac above, with ordinary background applications running and viewport culling off unless stated.

| Measurement in final integration run | Observed |
| --- | --- |
| Open board until 300 nodes / 500 edges exist and two animation frames elapse | 279 ms |
| Change one task title until the new text is observed in the DOM | 73 ms |
| Wheel-pan event to next animation frame, 15 samples | 10–25 ms; median 17 ms |
| Cards mounted at 100 % zoom with automatic culling (board > 120 cards) | 20 of 300 |

These are one-run desktop automation measurements, including CDP, event dispatch, observation, and polling overhead. They are **not a measured FPS guarantee**, an Android benchmark, or a universal performance claim. The 1.0.0 run measured 211 ms / 145 ms / median 10 ms on the same machine under different background load; the single-edit path is faster because unchanged node objects are now reused.

### Real screenshots

- `roseboard-desktop.png`: actual full-pane plugin in Obsidian after this run.
- `roseboard-narrow.png`: actual plugin at a 430 × 900 desktop viewport, showing the responsive drawer. **Not an Android screenshot.**
- `roseboard-stress.png`: actual 300-task stress fixture.
- `roseboard-ink.png`: two rose strokes drawn with the pen tool during the run.

## Implemented but not verified on the target environment

- **Physical Mac trackpad and mouse:** wheel classification, pinch, Shift+wheel and Space+drag are implemented and exercised with injected events; physical two-finger/pinch gestures and a real wheel mouse were not available to the automation.
- **Two-device LiveSync:** the merge path was exercised by writing the note through the public Vault API in the temporary vault. No LiveSync was installed there, and no round trip through the user's CouchDB server with a second device was performed. A second device's configuration remains unverified.
- **Android:** browser-only runtime, touch-friendly modes, Kanban Move menu, List and drawer are implemented. Android WebView, soft keyboard, real touch/pinch, backgrounding and device performance were not tested.
- **Native context menus:** the plugin uses Obsidian's `Menu`, which renders natively on macOS by default. Tests observed the DOM variant; the native variant was opened manually only.
- **Crash/power-loss durability:** draft recovery was exercised through the automated persistence adapter. Drafts are now debounced, so up to 0.8 s of the newest edits may be absent from a draft after a hard crash.
- Minimum declared Obsidian version 1.6.0, Windows, Linux, and iOS were not independently tested.

## Manual smoke-test checklists

### Mac trackpad and mouse

- [ ] With the pointer setting on Auto, scroll with two fingers: the canvas pans, the zoom label is unchanged. Pinch: it zooms around the fingers.
- [ ] Plug in a wheel mouse and roll two notches: the pointer button in the bottom-left cluster switches to the mouse icon and the wheel zooms. Shift+wheel pans sideways; middle-drag pans.
- [ ] In Select mode hold Space and drag empty canvas: it pans, no marquee. Release Space: marquee returns.
- [ ] Double-click empty canvas, double-click a title, right-click a card and the canvas, drag a connection to empty space. Undo each once.

### Two devices over LiveSync

- [ ] Set a distinct **Device name** on each device. Open the same board on both.
- [ ] Move one card on device A and a different card on device B within a few seconds. Both boards should show both moves, the moved cards glow on the receiving device, and the Activity panel names the other device. No Conflict banner.
- [ ] Rename the same task on both devices. The later rename should win on both; the overlap bar should offer the other value.
- [ ] Add a task on A while B has the source note open in Source mode; close the editor on B. B should merge, not conflict.
- [ ] Deliberately create a cycle from both sides; confirm the Conflict banner, Save local copy, and Preserve draft & reload.
- [ ] Check LiveSync's own log for text-merge conflicts on the note; with sorted records they should be rare. If LiveSync writes invalid JSON, Roseboard must show the error and keep the last valid board.

### Ink on touch and pen devices

- [ ] Draw with a finger on Android and with a stylus if available; confirm strokes commit on lift and the note gains an `ink` record.
- [ ] While Draw is active, confirm two-finger panning is unavailable (switch to Hand) and that Esc/Done returns to Select.
- [ ] Erase by dragging across a stroke; undo; Clear all ink from the canvas menu.

### Android

- [ ] Install the three release files into a new local vault and enable Roseboard.
- [ ] Switch Canvas/Kanban/List, use Hand/Select, pan/pinch, and operate explicit zoom controls.
- [ ] Create/edit a task; use the soft keyboard, checklist composer, quick due dates, tags, note picker and drawer close button.
- [ ] Move a task between Kanban columns with the Move menu; verify the canvas position is unchanged.
- [ ] Background/resume, close/reopen, and verify saved local data and pending draft recovery.

## Deferred

Collapsible frames, templates, selected-checkbox import, Markdown checklist export, and native `.canvas` export remain unimplemented. Ink is stroke-only: no shapes, text tool, stroke selection or moving, pressure-sensitive width, or image export. Calendars, Gantt, recurring scheduling, AI chat, Tasks/Dataview bidirectional integration, and multiplayer with presence remain outside scope.
