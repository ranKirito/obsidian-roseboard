# Changelog

## 1.5.3 — 2026-09-24

- Fixed task-card descriptions shrinking to a faded, unreadable line. Cards reserve up to four lines for the description; longer text scrolls without a fade, including in read-only views.
- Small cards grow to a readable minimum in the current view. Open checklists reserve three wrapped rows (up to 320 px); Show more reserves up to ten. Resizing respects this minimum, while automatic fitting leaves saved sizes and positions unchanged.
- Checklist rows have more spacing, a separate header, and an always-visible Add step action outside the scrolling list. Step editors wrap and grow with their text and card width. Keyboard navigation inside card content no longer moves or deletes the card.

## 1.5.2 — 2026-09-24

- Task cards keep the size you give them and can be resized smaller than their content again. Content height no longer sets a minimum, except that an open checklist shows at least one step.
- The description is always visible: it fills the room the card has (one to six lines, fading when cut off). Cards without one show **Add a description…**.
- The checklist is a collapsible section: a header with a chevron, `done/total` and a progress bar, then a list that scrolls inside the card. **Show more** gives it room for ten steps in the current view; beyond ten it scrolls. **Show less** returns to the card's own size. The extra room is view-only and never saved. A bigger card shows more steps.
- The footer no longer repeats checklist progress; it lives in the checklist header.

## 1.5.1 — 2026-09-24

### Task cards
- Write the description and checklist directly on the task card. Hover a card for **Add description** / **Add checklist** in its top-right corner, or use **Add step** below existing steps. Enter adds a step and keeps the field open for the next one. Double-click a step or the description to edit it; blur or ⌘/Ctrl+Enter saves, Escape cancels. Steps have a remove button on hover. Each save is one undoable edit.
- Larger, easier-to-read card text: 13 px descriptions (Markdown, clamped to three lines with a fade) and 13 px steps with 16 px checkboxes. Checkboxes sit in the completion circle's column and all text starts level with the title.
- On the canvas the inspector no longer repeats the description and checklist; List, Kanban, Day and Calendar still edit them in the inspector. Clicking inside a card's description or checklist no longer opens the inspector, which could cover cards near the right edge mid double-click.

### Alignment
- The completion circle is centred on the first line of the task title everywhere. It was 6 px low on canvas cards, about 8 px in Kanban, up to 10 px in Day and 4.5 px in List. Obsidian's fixed button height had enlarged the circle's box. List rows now align status, priority, date and actions to the title's first line.
- The welcome example gives its longest card room, so it no longer overlaps the document card below it.

## 1.5.0 — 2026-09-23

### Day page
- Redesigned Day. The header gives a one-line summary. A Monday-first week strip shows open tasks and routine completion per day. The layout has a Tasks card, a Routines card and an Unscheduled tray. It adapts to its own width, so it reflows when the inspector opens.
- **Routines.** Repeating habits, kept apart from one-off tasks. Choose Every day, Weekdays, Weekends or specific weekdays. Tick them off per day. Streaks count scheduled days in a row, and an unfinished today does not break a streak. Rename, reorder or delete routines from their menu. Future days show routines but cannot be ticked early. Routines never become tasks or canvas cards.
- Drag and drop in Day: move tasks between the day list, the Unscheduled tray (clears the date) and any day in the week strip. Rows show a grip on hover.
- **Move all to today** for overdue work, and **Next week** and **Open details** in the row menu.
- Fixed a hover highlight that drew a box inside rows. The row now highlights as a whole. Removed the unexplained icon-only status badge from rows; “In progress” is shown in the row details instead.

### Resizing
- Every edge and corner of an editable card resizes it, without selecting it first. Edges show a pink line and a resize cursor on hover. Corner handles appear on hover or selection. Edge hit zones stay about 10 screen pixels wide at any zoom. The connection dots at edge midpoints sit on top, so dragging from them still connects cards or creates a linked task. Task cards cannot be resized smaller than their content.

### Accessibility and polish
- Panels, lists and toolbars are named with `aria-labelledby` instead of `aria-label`, because Obsidian shows every `aria-label` as a hover tooltip. Names are unchanged for assistive technology; hovering empty space no longer shows labels such as “Daily planner” or the document path.

### Storage
- New optional top-level `routines` record (see docs/STORAGE.md). Schema version stays 1. Boards without routines are unchanged; older readers keep the field as an unknown extension.

### Canvas and documents
- Tasks created in Day, Calendar or Kanban (quick capture, **New → Task**, column **+**) now also get a card on the canvas, in the first free grid slot near existing work. The slot search skips frames and never overlaps or moves existing cards. Older unplaced tasks still appear in **Unplaced**.
- Removed the separate **Documents** view. Linked notes are read and edited on their canvas cards; **Read on canvas** in the inspector expands the card, or opens the note in Obsidian when the task has no card.
- **Edit** is available directly on document cards; no need to click **Read** first. The editor marks unsaved changes and the card grows with the draft.
- Task cards and cards being read or edited grow to fit their content (up to 1,600 and 900 px). This height is display-only: the saved size stays the minimum and is never rewritten. Collapsed document cards too short for a preview show only their actions.

### Tasks
- Task cards list up to eight checklist steps, each with a checkbox that toggles in place. Longer lists show “+N more steps”. Steps are hidden when zoomed far out.
- Inspector checklist fields wrap long steps and grow with their text. Enter moves from a step to the new-step field and adds a new step. The inspector is 340 px wide (was 312).

### Layout and alignment
- Selection actions no longer slide under the zoom controls. Their position follows the canvas width, which shrinks when the inspector opens: centred, then right-aligned, then stacked above the zoom controls; icon-only on phone widths.
- Fixed invisible colour swatches in the selection bar. A generic floating-button rule removed their fill.
- List view uses fixed columns, so status, priority, due date and actions line up across rows. On narrow panes the row wraps into two lines.
- Day heading progress aligns with the date heading. Document text aligns with the card edge and hint. Phone-width tool palettes drop Undo/Redo, still available in **•••** and ⌘/Ctrl+Z, instead of clipping. Their scrollbars are hidden.

## 1.4.1 — 2026-09-21

- Published in the Obsidian Community Directory with installation enabled after the automated release review completed without blocking errors. Version 1.4.1 is the sole downloadable release; development and public repositories each retain only main.

- Use the public workspace activation API available in the declared minimum Obsidian version and Obsidian’s CSS helper for inspector sizing.
- Remove script-element and script-resource creation from the bundled React renderer. The public, deterministic build transform fails if the pinned renderer changes unexpectedly. Existing Markdown rendering remains restricted.
- Verification: 91 automated tests and 55 isolated desktop Obsidian scenarios pass, including four blocked renderer script paths with no network requests. Minimum-version, physical mobile and peer-device sync testing remain unavailable.

## Distribution — 2026-09-21

- Consolidated development onto main and published the tested 1.4.0 build in the public plugin repository. Added installation links and structured feedback forms, and published the Community Directory listing for automated review. The initial public release was 1.4.0; 1.4.1 supersedes it as the sole supported downloadable release; older work remains in Git history.

## 1.4.0 — 2026-09-20

- Rebuilt the header around a compact view picker, on-demand task search, filters, a New menu, and one board-actions menu. Canvas tools live in a floating palette with active states, labels on hover/focus, and existing keyboard shortcuts. Navigation preferences are grouped under Canvas options.
- Read expands a linked note or task's note on the canvas into a scrollable document. Collapse restores the original card size; neither action changes saved positions, dimensions, or the camera. The Documents library remains available through the view picker.
- Double-click document content (or choose Edit) to edit the original Markdown inside the card. Save / Cmd-or-Ctrl+Enter commits; Cancel confirms discarding a dirty draft. Frontmatter is retained. Exact-baseline Vault.process writes refuse concurrent replacements, and Save a copy preserves a conflicting draft separately.
- Note editing sessions are shared across cards/views. Debounced recovery drafts survive view changes and plugin reloads; active drafts follow note/folder renames. Source editors, board-containing notes, and notes over 100,000 characters are guarded. Board undo remains separate from note editing.
- Contained document wheel events, prevented note interaction from opening the inspector, and made Escape cancellation of task/sticky/frame inline text ignore the following blur.
- No schema migration or new board fields. Design references and decisions are recorded in docs/UI-RESEARCH.md; verification is recorded in docs/TEST-REPORT.md.

## 1.3.0 — 2026-09-19

### Documents and daily planning
- Live Markdown previews inside vault-note cards and the inspector, plus a Documents library and full in-board reader. Previews refresh on note changes, handle missing notes, and keep the original note as the source of truth. Tables, read-only checklists and wiki links are supported; code remains literal, raw HTML is skipped, and remote images do not load.
- Day view with quick task capture, daily completion progress, overdue work and an Unscheduled tray. Tasks created here remain unplaced until explicitly placed on the canvas.
- Monday-first month calendar with a selected-day agenda. Drag tasks onto dates or use the Reschedule menu; dates change without moving cards. All planning uses existing task due dates and the board timezone.
- Optional task assignees with suggestions, card/list/kanban visibility, owner search, and Everyone / Unassigned / person filters. Assignments participate in existing stamps, undo, structural merging and overlap review.
- Visible Clear active filters action, larger new document cards, responsive planning and reading layouts, and canvas-only placement shortcuts to prevent hidden card edits in other views.
- Version stays compatible with schema 1. The only new persisted field is optional `tasks[id].assignee`; document bodies, calendar cells and view state are not copied into board data.

## 1.2.1 — 2026-09-18

### Community directory preparation
- Settings tab follows the Obsidian guidelines: general settings at the top without a heading.
- Open board leaves are no longer detached when the plugin unloads, so an update reopens them where they were.
- Manifest carries the author and author URL; neutral example device names in the UI and docs.

## 1.2.0 — 2026-09-18

### Freehand drawing
- **Draw** and **Erase** tools on the canvas. Strokes are drawn with a mouse, trackpad, pen or finger, simplified on release, and stored in the board note as an optional `ink` record of world-coordinate point lists with a named colour and width.
- Ink pans and zooms with the cards (rendered inside the React Flow viewport), so annotations stay attached to what they annotate. Scrolling and pinching keep working while a drawing tool is active.
- Seven ink colours (foreground plus the card tints) and three widths. Eraser drags remove every stroke they cross as one undo step. **Clear all ink…** in the canvas menu and the ink bar.
- Strokes are ordinary records: undo/redo, edit stamps, the activity feed and the three-way merge all apply. Strokes drawn on two devices combine; a stroke erased on one device disappears on the other.
- Boards without drawings do not carry an `ink` field. Readers before 1.2 keep an `ink` field as an unknown extension and never delete it. Schema version stays 1.
- `P` and `E` switch to the drawing tools; `Esc` returns to Select. No bare key draws anything.

## 1.1.0 — 2026-09-18

### Working together
- Concurrent changes from another device, editor or agent are merged into an open board record by record (three-way merge of base, local and remote). Same-field overlaps resolve by `updatedAt` recency, otherwise keep the local value, and are listed in a review bar with **Keep** / **Use theirs** / **Use mine**. Impossible combinations (dependency cycles, invalid source) still enter the explicit Conflict path.
- Merges also happen at commit time inside `Vault.process`, when a source editor closes, and when a recovered draft meets a newer source.
- Undo history is rebased across merged remote changes instead of being cleared.
- Optional `updatedAt` / `updatedBy` stamps on tasks and cards; a **Device name** setting supplies attribution.
- Activity panel listing remote changes with attribution and **Jump**; cards changed remotely glow briefly.
- Records are serialized in canonical sorted key order so line-based sync merges stay local.
- Recovery drafts are debounced (one write per 0.8 s burst) and skipped when the save lands first.

### Canvas and input
- Input-device detection: trackpad scroll pans and pinch zooms; a mouse wheel zooms, Shift+wheel pans sideways. Manual override in the navigation cluster and settings.
- Double-click empty canvas to create a task; double-click titles, frame names and notes to edit in place.
- Drag a connection onto empty space to create a linked task. Connections start from any card edge.
- Native context menus for cards, connectors, selections and the canvas.
- Arrow-key nudging (8 px, Shift 32 px), align/distribute for multi-selections, select all, fit shortcuts.
- Card, note and frame colours (named tints).
- Removed bare-letter creation shortcuts; content is never created from stray typing.

### Views
- Kanban view with drag-and-drop between status columns (touch: per-card Move menu). Canvas positions are unaffected.
- List view sorting.

### Design
- Redesigned cards with status/priority chips, checklist progress, relative due dates, Lucide icons from the host, floating selection bar, refreshed inspector with quick due-date buttons and an inline checklist composer.

### Performance
- React Flow node objects are reused when nothing changed; edges are cached per ID.
- Viewport culling (automatic above 120 cards, or forced on/off).

### Compatibility
- Schema version stays 1. Boards written by 1.0.0 open unchanged; new fields are optional.

## 1.0.0 — 2026-09-16

- First release: Canvas/List over shared tasks; unbounded pan/zoom; selection, drag, resize; tasks, checklists, dependencies, connectors, sticky notes, vault references, frames; filters and presets; unplaced tray; undo/redo; safe Markdown persistence with conflict detection and recovery.
