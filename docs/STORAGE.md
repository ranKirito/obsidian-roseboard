# Roseboard storage v1

Schema: `schema/roseboard-v1.schema.json`. Strict TypeScript and the runtime validator are in `src/domain/model.ts`. The JSON Schema describes structure; runtime refinements also enforce the invariants below. Unknown object fields survive parsing, editing, duplication, undo, merging, and saving. The schema version stays **1**: fields added in 1.1–1.3 are optional, so older readers preserve them as ordinary extensions.

## Envelope and defaults

One ordinary Markdown note, exactly one backtick or tilde fenced block with the language identifier `roseboard`. The parser recognizes fences of at least three characters and does not mistake an example fence nested in a longer Markdown fence for a second board. Newlines inside JSON may be normalized to the note's fence-line newline convention; everything outside the payload remains byte-for-byte unchanged. Canonical saves include only domain data, never React Flow measurements, selection, camera, temporary filters, or internal parent positions.

Required board fields: `schemaVersion: 1`, nonempty `boardId`, and nonempty `title`. Defaults are the device's local IANA `timeZone`, and empty maps for `tasks`, `nodes`, and `edges`. Boards created in the UI explicitly write the timezone. ID keys are nonempty strings up to 200 characters; `__proto__`, `constructor`, and `prototype` are reserved.

Task records live in `tasks[taskId]`:

| Field | Default / meaning |
| --- | --- |
| `title` | Required; nonempty, up to 500 characters |
| `description` | Empty Markdown string |
| `status` | `todo`; one of `backlog`, `todo`, `doing`, `done` |
| `priority` | `none`; one of `none`, `low`, `medium`, `high` |
| `dueDate` | Absent; valid date-only `YYYY-MM-DD`, never UTC-parsed |
| `tags` | Empty string array |
| `checklist` | Empty array of `{id, text, done}`; `done` defaults to false |
| `dependsOn` | Empty array of prerequisite task IDs |
| `notePath` | Absent; visible relative vault path, normally a full `.md` path |
| `assignee` | Absent; optional person or team label, up to 100 characters (since 1.3) |
| `updatedAt` | Absent; ISO 8601 date-time with offset, written by the device that last changed this record |
| `updatedBy` | Absent; up to 100 characters, the editing device's configured name |

A missing prerequisite, duplicate checklist ID, duplicate prerequisite, self-dependency, or cycle is an error. `blocked` is derived from existing unfinished prerequisites and is never stored as status. Completion after a warning is allowed. Completed tasks are never overdue. Today means equal to the current date formatted in the board timezone; Overdue means unfinished and strictly earlier. Ready means unfinished with all prerequisites complete.

Node records live in `nodes[nodeId]`. All nodes require `type`, finite `x`, and finite `y`. Width defaults to 300 and height to 190; stored dimensions must be positive within the schema bounds (minimum 160 × 100). The UI resizer has a practical minimum of 180 × 120, or 240 × 140 for frames. Coordinates have no artificial 10,000-pixel cap.

| Type | Fields |
| --- | --- |
| `task` | Required `taskId`, pointing to one existing task; at most one placement per task |
| `sticky` | `content` Markdown string, default empty |
| `note` | Required `notePath`; reference only, no copied note body |
| `frame` | `title`, default `Frame` |

Every node may also carry `color` (one of `rose`, `amber`, `mint`, `sky`, `violet`, `slate`; a named tint, never a raw colour value), `updatedAt` and `updatedBy` as above. Non-frame nodes may contain `frameId`, an existing frame's node ID. Frame nesting is rejected. All positions—including members' positions—are **absolute world coordinates**. Frame movement translates explicit members once; joint selection does not double-translate them. Frame deletion ungroups members. Spatial overlap does not establish membership or modify status. A frame's count is derived from its task members.

`edges[edgeId] = {source, target, label}` stores ordinary visual relationships between existing node IDs. `label` defaults to empty. Dependencies must never be copied here: prerequisite A → dependent B is exclusively `tasks[B].dependsOn` containing A. Both arrow endpoints must have placements to display the derived arrow; all prerequisites remain editable in List/inspector regardless of placement.

## Planning and document previews (1.3–1.4)

Day and Calendar project existing task `dueDate` values into the board timezone. Quick capture creates an ordinary task with that date and no placement. Rescheduling changes only `dueDate`; completion changes only status. Completed tasks remain visible on their date and never appear in Overdue or Unscheduled. Filters apply to all task views, including calendar counts and daily progress. There is no recurrence generation, separate calendar store, or cross-board task aggregation.

The optional `assignee` field is a label, independent of the editing device's `updatedBy` stamp. Its merge, overlap review, undo and canonical serialization use the ordinary task-field rules. Versions before 1.3 preserve it as an unknown extension. Existing boards need no migration and are not rewritten on open.

Document cards and the Documents library read linked Markdown through `Vault.cachedRead`. The library includes note cards and task note links, deduplicated by their stored path. Bodies are never embedded into board JSON. Mounted readers watch vault file events and release their listeners when closed. Card previews render at most 2,400 characters; full readers render at most 100,000 and show a truncation notice. YAML properties are omitted from the preview. Markdown tables, disabled checklist controls and wiki links render without executing raw HTML, code blocks, embeds or other plugins; images are omitted. Since 1.4, card editing can save the linked Markdown directly; the library itself remains a reader. The reader does not recursively mount Roseboard blocks, and a missing file is shown as missing rather than replaced.

## Ink (1.2)

An optional top-level `ink` record holds freehand strokes: `ink[strokeId] = {points, color, width}` plus the optional stamps. `points` is a flat array `[x0, y0, x1, y1, …]` of at least two absolute world-coordinate pairs (maximum 20,000 pairs); `color` is one of `ink`, `rose`, `amber`, `mint`, `sky`, `violet`, `slate` (default `ink`, the foreground colour); `width` is 1–40 world pixels (default 3). Strokes have no placement record and no relationship to cards; they simply share the coordinate space. A board with no strokes omits `ink` entirely; the plugin removes an empty map when saving. Readers that predate 1.2 treat `ink` as an unknown extension and preserve it. Stroke keys are sorted like the other records.

## Stamps

When the setting **Stamp edits with a time** is on (the default), every task or node record that an edit actually changes receives `updatedAt` (the device clock, ISO 8601 with offset) and, if a **Device name** is configured, `updatedBy`. Untouched records keep their previous stamps; undo restores the earlier stamps together with the earlier values. Records without stamps are fully valid; stamps only inform overlap resolution and the activity feed. Clocks are not synchronised between devices, so recency is a preference, not a guarantee.

## Canonical serialization

Saves and exports write `tasks`, `nodes` and `edges` with their keys sorted (plain code-unit order). Checklist and tag order is meaningful and kept as authored. Key order inside a record follows the schema, then any unknown fields. Two devices that hold the same records therefore write identical lines, so a line-based sync merge (LiveSync's Markdown auto-merge) sees only the records that actually differ. The first save of a board written by 1.0.0 reorders it once.

## Minimal example for an agent

````markdown
Notes above the board remain intact.

```roseboard
{
  "schemaVersion": 1,
  "boardId": "board-weekly",
  "title": "Weekly work",
  "timeZone": "Europe/Ljubljana",
  "tasks": {
    "task-first": { "title": "Write the first draft" },
    "task-review": { "title": "Review the draft", "dependsOn": ["task-first"] }
  },
  "nodes": {
    "node-first": { "type": "task", "taskId": "task-first", "x": 100, "y": 120, "color": "mint" }
  },
  "edges": {}
}
```

Notes below the board remain intact too.
````

`task-review` appears in Unplaced, List and Kanban. Adding it does not move `node-first`. Place all adds a new grid below existing card bounds. Removing `node-first` preserves `task-first`. Explicitly deleting `task-first` removes its incoming dependencies and placement, with an undoable confirmation.

## Save protocol

1. Each source path acquires one shared `BoardSession`, holding the baseline payload text and its parsed board. Normalized in-memory defaults do not rewrite the source merely by opening it.
2. A validated command commits one immutable domain state, stamps the changed records, coalesces short typing groups where appropriate, schedules a recovery draft (at most one write per 0.8 s), and schedules a save 0.5 s later, or at most 2 s after the first pending edit while typing continues. Pointer movement is transient until completion.
3. Writes are serialized per session. In the synchronous `Vault.process` callback, source-editor presence is checked again and the current fenced payload is compared to the baseline. Different surrounding Markdown is allowed and preserved. A changed payload is parsed and merged (below) inside the same callback; only an unmergeable payload stops the write.
4. Own saves are recognized by exact payload identity, not a timer. Valid external updates with no pending local edits load directly and are reported in the activity feed. Invalid updates preserve the last valid display and disable writes. Unsupported versions remain read-only.
5. A conflict retains the local model. Recovery-copy creation does not overwrite the source. Preserve-and-reload writes a snapshot before replacing local state. If either recovery preservation or source validation fails, the local model remains available.

## Merge protocol

When the source changes while local edits are pending (a file event, a save that finds a newer payload, a source editor closing, or a recovered draft on reopen), the session performs a three-way merge of **base** (the payload this device last loaded or wrote), **mine** (the local board) and **theirs** (the new payload), in `src/domain/merge.ts`:

- Records (`tasks`, `nodes`, `edges`, `ink`) are matched by ID. A record added on one side is kept. A record removed on one side and untouched on the other is removed. A record removed on one side but edited on the other is kept and reported.
- Inside a record, each field takes whichever side changed it. `x`/`y` and `width`/`height` are treated as single fields. `tags` and `dependsOn` merge as sets: additions from both sides are kept, removals from either side apply. Checklists merge by item ID, item fields individually.
- A field changed on both sides to different values is an **overlap**. If both records carry `updatedAt`, the newer wins; otherwise the local value wins. Every overlap is reported with both values and remains resolvable either way from the review bar. `updatedAt` becomes the newer of the two; `updatedBy` follows the record's winning side.
- The merged board is then repaired and validated: cards whose task no longer exists are dropped, a task placed on both sides keeps the card the other side already synced, prerequisites on deleted tasks are removed, and connectors with missing endpoints are removed. Each repair is reported. If validation still fails (for example a dependency cycle produced by two independent additions), the merge is abandoned and the session enters **Conflict** with local work preserved.
- On success the merged board becomes the local model, the new payload becomes the baseline, and undo history is rebased so that undo steps back through local edits only and never reverts the other side's work. The merged result is saved if it differs from the new payload.

The merge never contacts another device and never resolves by silent last-writer-wins at the whole-board level. Two boards that diverged in unmergeable ways still surface the existing conflict path. There is no cross-device lock, CRDT, or claim that Markdown storage alone verifies LiveSync behavior.

## Inline note editing and recovery (1.4)

Expanded reading bounds are transient, per-view state and never written to node records. Read/Collapse do not create board history entries or move the camera.

A shared `NoteSession` edits a resolved visible Markdown path. It reads the entire note (at most 100,000 characters for editing), including properties. Saving uses synchronous `Vault.process` compare-and-replace against the original text; a changed baseline is a conflict, not an invitation to replace the file. An already identical result is accepted as an idempotent save. Notes open in source editors and notes containing Roseboard fences are excluded. No text merge or board-undo entry is created.

Unsaved note drafts use `note-<SHA-256-of-path>.json` in the plugin recovery folder, with `{path, baseline, text}`. They are distinct from board recovery and contain no task database. Draft writes are serialized and debounced by 400 ms; unmount/background/unload attempts to flush them. Save and confirmed Cancel clear the draft. Restored drafts still compare against the original baseline, and conflicts offer a separately created `- recovered.md` copy without overwriting an existing note. Active drafts follow file/folder renames. Local draft persistence is not a sync acknowledgement or a hard-crash guarantee.
