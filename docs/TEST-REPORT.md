# Roseboard — implementation and test reports

## 1.5.2 — 2026-09-24

**100/100 automated checks and 60/60 isolated Obsidian scenarios pass** (37 canvas, 23 planner/document), with no renderer errors. The 1.5.2 package contains the exact `main.js` and `styles.css` bytes exercised by these tests; only version metadata changed afterward.

- The checklist scenario checks a 330 px card with 12 steps. The card keeps its size and its list scrolls. **Show more** gives a 240 px (ten-row) list while the saved height stays unchanged, and **Show less** restores the card. Collapsing removes the list and expanding restores it. Dragging the bottom edge up shrinks the saved height below the content while one step stays visible. Undo restores steps and size.
- The on-card description and checklist editing scenario from 1.5.1 passes unchanged.

## 1.5.1 — 2026-09-24

**100/100 automated checks and 60/60 isolated Obsidian scenarios pass** (37 canvas, 23 planner/document), with no renderer errors. The 1.5.1 package contains the exact `main.js` and `styles.css` bytes exercised by these tests; only version metadata changed afterward.

- The on-card editor is exercised in the create-board scenario. It adds a Markdown description (raw HTML stays inert), adds two steps with Enter, removes one, and ticks the other. It renames a step by double-click and checks that arrow keys inside the field do not nudge the card. It also cancels a description edit with Escape. The inspector shows the on-card hint instead of the fields, and the stored task holds exactly the saved text and step.
- Alignment was measured in the real app as the vertical distance between the centre of the completion circle and the title's first text line. The offset is 0 px in Kanban, Day and List and 0.3 px on canvas cards (before: 7.5, 9.6, 4.5 and 6.3 px).

## 1.5.0 — 2026-09-23

Development validation on `main`, desktop Obsidian, isolated temporary vault and profile. **100/100 automated checks and 60/60 actual Obsidian scenarios pass**: 37 canvas regressions and 23 document, planner, toolbar and renderer-security scenarios. Neither integration report captured a renderer error, and no remote image request was made. TypeScript checking, schema generation and the production bundle pass. The 1.5.0 package contains the exact `main.js` and `styles.css` bytes exercised by these integration tests; only version metadata changed afterward (see `release-verification.json`).

What changed and how it was checked:

- **Planner and Kanban tasks get canvas cards.** Two unit tests cover `placeTask`/`freeSlot`: no overlap with cards or frames, existing records unchanged, idempotent placement, and a fixed origin on empty boards. Integration checks Day quick capture and **New → Task** in Calendar (one added card; all existing nodes unchanged; undo removes both).
- **Documents view removed.** Its scenarios now run on the canvas card: safe rendering, live refresh, relative links, rename/delete/restore, and **Read on canvas** from a planner.
- **Checklist on task cards and content-fitted heights.** A step is toggled on the card and undone. Added steps grow the displayed card while the stored height stays unchanged.
- **Selection bar placement.** At four widths, with and without the inspector, it never intersects the zoom controls, and its swatches are filled.
- **Edge resizing.** On an unselected card, elements under the pointer report `ew-resize`, `ns-resize` and `nwse-resize` at edges and corners. An edge midpoint resolves to the connection dot. Dragging the right edge widens the card; undo restores it. The linked-task-by-connection scenario still passes.
- **Routines.** Seven unit tests cover the optional record: defaults, extensions and omission when empty; weekday scheduling; stamped per-day toggles with bounded history; streaks; ordering; set-merging of ticks from two devices; and edit-versus-remove overlaps. The integration scenario adds a routine, ticks today and yesterday (streak 2), and confirms future days cannot be ticked. It then switches to Weekdays, checks that a Saturday hides it, and confirms the file on disk. Finally it deletes with confirmation and undoes. Tasks and nodes are unchanged throughout.
- **Day drag and drop.** Integration moves a task day list → Unscheduled (date cleared), Unscheduled → day list, and day list → week strip (tomorrow). **Move all to today** is exercised with undo. Canvas nodes are unchanged.
- **Hover tooltips.** A probe dispatching hover to every labelled non-control element in a board found no Obsidian tooltip after the change.
- Screenshots were reviewed manually at 1440, 1000, 700 and 430 px for Canvas, Kanban, List, Day and Calendar, plus reading and editing a document card, the inspector checklist, the routine menu and resize hover.

## 1.4.1 — 2026-09-21

The historical 1.4.1 results below are unchanged.


Compatibility-fix validation, 2026-09-21, on `main`: **91/91 automated checks and 55/55 actual Obsidian scenarios pass** (34 canvas regressions plus 21 document, planner, toolbar and renderer-security scenarios). Both integration reports contain zero captured renderer errors. TypeScript checking and production bundling pass. The 1.4.1 package contains the exact JavaScript and CSS bytes exercised by these integration tests; only version metadata changed afterward, and all 91 automated tests passed again. Both repository builds and the ZIP contents match. Current hashes and scope are in `release-verification.json`.

The renderer-security scenario exercises script resource initialization, module initialization, ordinary script elements and async script elements; all four are rejected, with no script inserted and no network request. The build transform in `scripts/restrict-react-dom.mjs` removes these unused capabilities from the pinned React renderer and rejects unexpected dependency changes. It retains dependency license comments.

The original 1.4.0 release passed 91 automated checks and 54 integration scenarios on 2026-09-20. Its historical package hashes remain in Git history.

Community Directory verification, 2026-09-21: the release scan for public commit `42265f4` completed with no blocking errors. Obsidian reproduced the released `main.js` byte-for-byte. The public listing reports version 1.4.1 and exposes an active **Add to Obsidian** link. Nonblocking source/CSS warnings and release-provenance recommendations remain; this is not a claim that every recommendation has been resolved.

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
