# Changelog

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
