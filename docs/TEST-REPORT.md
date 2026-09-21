# Roseboard 1.4.0 — implementation and test report

Date: 2026-09-20. Branch: `v1.4-canvas-workspace`, based on 1.3.0 (`28bdd6b`).

**Final packaged build: 91/91 automated checks and 54/54 actual Obsidian scenarios pass** (34 existing regression scenarios plus 20 document, planner and toolbar scenarios). Both integration reports contain zero captured renderer errors. Strict TypeScript checking, production bundling, license generation and packaging pass. The release ZIP, repository runtime files and isolated test installation match byte-for-byte; hashes are in `release-verification.json`.

Public distribution check, 2026-09-21: a clean `npm ci`, all 91 automated checks and `npm run build` passed in the public repository. The rebuilt runtime files match the previously tested 1.4.0 release byte-for-byte. The 54 integration scenarios below describe the original release validation, not a second run.

## Implemented in 1.4

- Compact header with a view picker, on-demand search, filters, properties, a New menu and grouped board actions. Canvas tools use a floating palette with accessible names, active states and hover/focus labels; camera options sit beside zoom. The desktop header is 52 CSS pixels tall and narrow panes use two rows.
- Read expands a linked note or task's note on its existing canvas card. The document scrolls independently; reading preserves the camera, saved card dimensions, positions and board source. Collapse restores the original size.
- Double-click document content or choose Edit to edit full Markdown inside the card, including properties. Save note or Cmd/Ctrl+Enter commits; Cancel asks before discarding changes. Editing is separate from board undo.
- Shared note sessions and local recovery drafts preserve edits across cards, view changes and plugin reloads. Drafts follow note/folder renames. Exact-baseline Vault.process writes stop on concurrent note changes and retain the draft; Save a copy preserves it separately. Source editors, notes containing boards, missing notes and oversized documents are guarded.
- Inline task/sticky/frame text cancellation no longer commits through a subsequent blur. New tasks created from Day/Calendar use the selected date and stay unplaced.
- Schema 1 is unchanged. Note bodies and temporary reading dimensions are not written into board records. The existing planner, document library, assignment, drawing and board-merge features remain available.

## Test environment and safeguards

Integration tests run against the installed **Obsidian desktop application**, driven through Playwright/CDP, not a browser mock. Environment: macOS 25.6.0, Apple M4 Pro, arm64, 1440 × 1000. Toolbar checks also cover 900, 700, 430 and 390 CSS-pixel viewport widths. These are desktop viewport simulations. The harness did not report the host API version, so this does not certify the minimum supported Obsidian version.

The launcher creates a disposable vault and separate application profile. Both test drivers verify the connected vault's real path before changing anything. All creation, deletion, rename, conflict and recovery exercises use synthetic notes there. No test driver targets the regular vault, and LiveSync settings were not changed.

## Automated checks

Command: `npx vitest run --reporter=json --outputFile=docs/unit-test-results.json`.

The 85 existing checks cover board schema and dependency invariants; stable IDs and absolute coordinates; Markdown fence/surrounding byte preservation; serialized saves, source guards and recovery; structural merging and undo; ink geometry; scoped CSS and contrast; manifest consistency; calendar/date arithmetic; planner grouping and filtering; assignments; and safe Markdown/link rendering.

Six note-session checks were added to the existing persistence suite:

- Explicit saving preserves full Markdown and properties.
- Concurrent changes preserve the original and recover the draft; discarding clears only the draft.
- A source editor opened while a save is starting still blocks the transaction.
- Board-containing and oversized notes cannot enter the inline editor.
- A missing target keeps the pending draft recoverable.
- Serialized recovery writes cannot resurrect a draft after a successful save.

Raw output: `unit-test-results.json`.

## Actual Obsidian scenarios

`npm run test:obsidian` passes 34 regression scenarios: plugin load; creation/edit/save/reopen; drag/resize/undo; source editing and reading previews; shared views; external changes and overlap review; invalid input and recovery; linked-note creation/rename/deletion; frames/relationships/dependencies; Kanban and filters; keyboard routing; wheel/pan/zoom; drawing/erasing; narrow layouts; stress fixture; and repeated view cleanup.

`npm run test:planner` passes all 20 scenarios below, including seven new 1.4 scenarios.

| Scenario | Result |
| --- | --- |
| Read expands in place; scrolling stays inside the document and the board source is unchanged | PASS |
| Double-click edits inside the card; Save preserves properties and changes only the linked note | PASS |
| Unsaved note edits survive view changes and plugin reload | PASS |
| A conflicting note update cannot be overwritten; the draft can be saved separately | PASS |
| Cards of the same note share edits, and an active draft follows a file rename | PASS |
| Document cards render live Markdown; library deduplicates task and card links | PASS |
| Reader refreshes external note edits and resolves explicit Markdown links relative to the document | PASS |
| Document rename, deletion and restoration update the reader without altering note bodies | PASS |
| Library picker links a document below existing cards, avoids duplicates and supports search | PASS |
| Day view captures unplaced tasks, tracks progress, and keeps overdue work separate | PASS |
| Unscheduled planning and accessible rescheduling change only the due date and undo cleanly | PASS |
| Assignments are editable, searchable and filter the calendar and daily view | PASS |
| Calendar navigation and drag rescheduling preserve canvas positions and persist on disk | PASS |
| Blocked completion still requires the existing confirmation | PASS |
| Source editing makes planner controls read-only; they resume after the editor closes | PASS |
| Document and planning shortcuts never edit hidden selected canvas cards | PASS |
| Narrow desktop viewport keeps Day, Calendar and Documents usable without horizontal overflow | PASS |
| New in a planner uses the selected day and stays unplaced | PASS |
| Compact header and tool palette stay within desktop and narrow panes | PASS |
| Reopening preserves assignments and dates, and creates no copied document body | PASS |

Raw outputs: `obsidian-test-results.json` and `planner-test-results.json`. Document checks captured zero requests to the remote image fixture and verified that raw script content did not execute. The in-card editor check uses the real host keyboard route for Cmd/Ctrl+Enter. Wheel events, including Shift+wheel, leave the canvas camera unchanged when scrolling a reader.

The checks exposed and led to fixes for nested reader scroll containers, the host intercepting the save shortcut, and creation from planner views. Existing regression drivers were updated for native view/action menus and the on-demand search control. External changes are simulated through Obsidian's Vault API; they do not establish delivery between physical devices.

## Stress fixture measurements

300 task cards, 250 dependency arrows and 250 ordinary connectors in the actual desktop host. Measurements include automation/observation overhead and are not device FPS guarantees.

| Measurement | Final run |
| --- | --- |
| Open until all nodes/edges and two animation frames | 319 ms |
| One title edit to visible DOM update | 74 ms |
| Wheel-pan event to next frame | 8–18 ms, median 16 ms |
| Mounted cards at 100% with automatic culling | 20 of 300 |

## Screenshots

All screenshots use synthetic notes in the isolated Obsidian application.

- `roseboard-canvas-reader.png`: compact workspace and expanded on-canvas document.
- `roseboard-canvas-editor.png`: full Markdown editor inside that card.
- `roseboard-toolbar-narrow.png`: compact header and tool palette at a narrow width.
- `roseboard-documents.png`, `roseboard-day.png`, `roseboard-calendar.png`, `roseboard-planner-narrow.png`: existing document/planner views on 1.4.
- `roseboard-desktop.png`, `roseboard-ink.png`, `roseboard-stress.png`, `roseboard-narrow.png`: regression fixtures on the final bundle.

## Boundaries and unverified environments

- Physical two-device LiveSync was not tested. Local external-file and merge checks do not verify replication or server state.
- Android/iOS and physical touch, pen or trackpad were not tested. Narrow desktop emulation and injected pointer events do not establish those experiences.
- Other operating systems and minimum Obsidian 1.6.0 were not separately tested.
- Hard crash/power loss was not tested. The newest unsaved burst may be absent from a debounced recovery draft; note drafts are local plugin files and may not be included in sync.
- Reading/editing supports Markdown. The editor is a plain Markdown textarea with explicit save, not Obsidian Live Preview. PDF/Office/image previews, remote images and embedded plugin output remain outside scope; use Open in Obsidian for the full host experience.
- Planning uses task due dates on one board. Recurring tasks, calendar services and reminders are not implemented. Assignees are labels, not accounts, permissions, presence or notifications.
