# Roseboard development and safe external editing

This repository is the development home of the plugin. Boards themselves live in the user's vault; the plugin bundle is installed into `<vault>/.obsidian/plugins/roseboard/`. Record substantive changes in `CHANGELOG.md`.

## Storage contract

- This is an Obsidian community plugin, not a standalone web application. Runtime code uses only browser APIs and the public Obsidian API. Keep Node APIs in build/test scripts.
- Each board is a normal Markdown note containing exactly one fenced `roseboard` JSON block. Preserve all bytes outside its payload when saving. The Markdown file is canonical; plugin preferences and recovery files are not task databases.
- Tasks are keyed by stable IDs; task nodes reference them. One placement per task. Removing a node must not delete its task. Never infer status or frame membership from spatial proximity.
- Schema v1 positions are absolute world coordinates. Frames have one explicit membership level. Dependencies are stored only in a task's `dependsOn`; visual arrows are derived. `color`, `updatedAt` and `updatedBy` are optional, as is the top-level `ink` record of freehand strokes; omit `ink` rather than writing an empty map.
- Since 1.3, tasks may have an optional `assignee` (up to 100 characters). Day and Calendar use `dueDate` for tasks; tasks never recur. Since 1.5, an optional top-level `routines` record holds repeating habits (`title`, ISO `days` 1–7, per-day `done` dates, optional `order`). Routines are not tasks: they have no placement or status and never generate tasks. Omit `routines` when empty, and treat `days` and `done` as sets. Keep at most 400 `done` dates, dropping the oldest. Documents read referenced Markdown through the host and never copy note bodies into board records.
- Since 1.4, Read expands a card only in the current view; temporary dimensions must not be saved. Content-fitted card heights (task checklists, cards being read or edited) are likewise view-only; the saved size is only a minimum.
- Tasks created from Day, Calendar or Kanban receive one placement at `freeSlot` (`src/domain/commands.ts`), which never overlaps existing cards or frames and never moves them. Tasks written without nodes by agents or older versions stay unplaced until placed explicitly. Inline Markdown editing uses one `NoteSession` per resolved note path, separate from board history, with explicit Save/Cancel, exact-baseline `Vault.process` writes and local note recovery drafts. Never overwrite a concurrent note change or save a truncated preview. Source editors and notes containing boards are guarded.
- Keep unknown extension fields on round-trip. Reject unsupported versions and invalid input without substituting or autosaving an empty board.
- A source file has one shared `BoardSession`, including undo history, across all views and previews. Camera, selection, filters and view mode belong to individual views.
- Serialize writes. Use synchronous `Vault.process` transformations and compare the current payload to the loaded baseline. Preserve surrounding prose edits; merge concurrent payload edits structurally (`src/domain/merge.ts`) and fall back to an explicit conflict only when the result would be invalid. Source editor views suspend writes; Reading view does not.
- Write records in canonical sorted key order (`serialize` in `src/domain/model.ts`) so line-based sync merges stay local.
- Local saves are not synchronization acknowledgements. Never connect to CouchDB or change vault sync settings.

## File-capable agents

1. Read the entire current source and validate the `roseboard` block before writing.
2. Preserve board IDs, task IDs, checklist IDs, node IDs, connector IDs, unknown extensions, existing coordinates and existing stamps. Add new tasks without nodes if placement is not intentional; Unplaced / Place all handles these.
3. Apply the smallest change and validate again. Do not silently reorganize or regenerate a board. Sorting the three record maps by key is the only reordering the plugin itself performs.
4. If you set `updatedAt` on records you change, use the current time with an offset; a stamp in the future would win every overlap. Leave `updatedBy` out unless you are a named collaborator.
5. Prefer atomic filesystem replacement where the filesystem permits it. Compare the current source with what you read before replacing it. `Vault.process` protects a local operation, not competing devices.
6. Editing concurrently with an open canvas is now tolerated: the canvas merges your record-level changes. Expect an overlap report if you change a field the person is also editing, and a conflict if your change would create a dependency cycle or an invalid board.
7. An example `notePath` only references a note. It does not authorize creating, reading for unrelated purposes, or modifying the referenced file.

## Verification

Run `npm test` and `npm run build`. Use a disposable test vault and isolated Obsidian profile for integration tests (`scripts/launch-test-vault.mjs`, `scripts/test-obsidian.mjs`, `scripts/reload-test-vault.mjs`). Never install test builds into the user's real vault without an explicit request. The test driver refuses to target any vault other than the one the launcher created.

Do not add features that would change the storage contract without bumping the documented schema rules. Keep `docs/TEST-REPORT.md` precise about automated tests, actual Obsidian tests, desktop emulation, and unavailable physical-device/LiveSync tests.
