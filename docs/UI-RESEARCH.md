# Canvas workspace research — 1.4

Reviewed official product documentation and UI screenshots on 20 September 2026. The references informed the hierarchy and interactions; Roseboard retains its own charcoal and rose palette and Obsidian's bundled icons. No third-party UI assets or code were copied.

| Reference | Observed pattern | Applied to Roseboard |
| --- | --- | --- |
| [Notion database views](https://www.notion.com/help/views-filters-and-sorts) | Views stay close to the database name; compact controls sit apart from the content. | One view picker beside the board title, with all six views. Search opens on demand. |
| [Linear display options](https://linear.app/docs/display-options) | Secondary presentation settings are grouped into a small menu. | Canvas options groups grid, minimap, input interpretation and culling. |
| [Miro toolbars](https://help.miro.com/hc/en-us/articles/360017730553-Toolbars) | Board actions, creation tools and camera controls have separate locations. | Header for workspace actions, a floating palette for canvas tools, and a small navigation cluster. |
| [FigJam guide](https://help.figma.com/hc/en-us/articles/1500004362321-Guide-to-FigJam) | A lightweight title/page picker and grouped canvas tools leave the board visible. | Reduced header chrome, separators between navigation, creation and history tools, and a clear selected tool. |
| [tldraw](https://www.tldraw.com/) and [UI components](https://tldraw.dev/sdk-features/ui-components) | Compact floating tool and navigation palettes; names and shortcuts exposed through controls. | Icon palette with hover/focus labels, accessible names and preserved keyboard shortcuts. |
| [Obsidian Canvas](https://obsidian.md/canvas) | Notes can be read and edited in the spatial workspace. | Read expands the existing card into a scrollable document; double-click enters the card's Markdown editor. |

## Interaction decisions

- The normal desktop header is 52 CSS pixels tall. Narrow panes use two rows with touch-sized header controls. The tool palette scrolls within a narrow pane.
- Expand/collapse is view state. Existing card coordinates, saved dimensions, history and board schema stay intact; the camera does not jump when Read is clicked.
- Note text is selectable. Wheel input remains in the document and does not change canvas input-device detection, pan or zoom.
- Editing uses a textarea with explicit Save/Cancel, rather than a second rich-text system. This preserves the original Markdown and properties. It is deliberately separate from board undo.
- Saving compares the entire note against the editor's baseline in a synchronous Vault.process transformation. Conflicts preserve the draft and offer Save a copy; there is no automatic text merge.

## Code map

Graphify was already installed. Local, code-only AST extraction was used to trace BoardSurface → Card → NoteContent/CanvasNote and host → persistence. Its ignored `graphify-out/` folder includes an interactive graph, `GRAPH_TREE.html` and the generated report; it does not index vault notes or call a model API. The graph is a navigation aid, not proof of runtime behavior. Its diagnostic reports a self-loop and post-build aggregation of relationships, so code and tests remain authoritative.

To rebuild locally:

```sh
graphify extract src --code-only --out . --no-cluster
graphify cluster-only . --no-label
graphify tree --label Roseboard
```
