A board is an ordinary Markdown note. This paragraph is preserved when Roseboard saves.

# A little room to make things happen

```roseboard
{
  "schemaVersion": 1,
  "boardId": "board-welcome",
  "title": "A little room to make things happen",
  "timeZone": "Europe/Ljubljana",
  "tasks": {
    "brief": {
      "title": "Shape the idea",
      "description": "One small, concrete step forward.",
      "status": "done",
      "priority": "low",
      "tags": [
        "studio"
      ],
      "checklist": [],
      "dependsOn": []
    },
    "build": {
      "title": "Make a small, useful prototype",
      "description": "One small, concrete step forward.",
      "status": "todo",
      "priority": "medium",
      "tags": [
        "studio"
      ],
      "checklist": [],
      "dependsOn": [
        "sketch"
      ]
    },
    "later": {
      "title": "Collect ideas for next week",
      "description": "One small, concrete step forward.",
      "status": "backlog",
      "priority": "none",
      "tags": [
        "someday"
      ],
      "checklist": [],
      "dependsOn": []
    },
    "review": {
      "title": "Review with fresh eyes",
      "description": "One small, concrete step forward.",
      "status": "todo",
      "priority": "none",
      "tags": [
        "studio"
      ],
      "checklist": [],
      "dependsOn": [
        "build"
      ]
    },
    "ship": {
      "title": "Ship something thoughtful",
      "description": "One small, concrete step forward.",
      "status": "backlog",
      "priority": "high",
      "tags": [
        "studio"
      ],
      "checklist": [],
      "dependsOn": [
        "review"
      ]
    },
    "sketch": {
      "title": "Explore the first direction",
      "description": "## Make the work clear\n\nKeep the first version focused. Start with what somebody can actually use.\n\n- Sketch two directions\n- Choose one deliberately",
      "status": "doing",
      "priority": "high",
      "dueDate": "2026-09-18",
      "tags": [
        "studio"
      ],
      "checklist": [
        {
          "id": "check-1",
          "text": "Gather references",
          "done": true
        },
        {
          "id": "check-2",
          "text": "Sketch two directions",
          "done": false
        },
        {
          "id": "check-3",
          "text": "Pick the clearest one",
          "done": false
        }
      ],
      "dependsOn": [],
      "notePath": "Project notes.md"
    }
  },
  "nodes": {
    "frame-deliver": {
      "type": "frame",
      "title": "02  ·  Make it real",
      "x": 820,
      "y": 40,
      "width": 720,
      "height": 660
    },
    "frame-discover": {
      "type": "frame",
      "title": "01  ·  Discover & shape",
      "x": 40,
      "y": 40,
      "width": 720,
      "height": 660
    },
    "node-brief": {
      "type": "task",
      "taskId": "brief",
      "x": 72,
      "y": 112,
      "width": 300,
      "height": 180,
      "frameId": "frame-discover"
    },
    "node-note": {
      "type": "sticky",
      "content": "### A gentle reminder\n\nMake space for the important things.\n\n**One useful release** beats a hundred ideas left unfinished.",
      "x": 72,
      "y": 338,
      "width": 300,
      "height": 198,
      "frameId": "frame-discover"
    },
    "node-prototype": {
      "type": "task",
      "taskId": "build",
      "x": 852,
      "y": 112,
      "width": 300,
      "height": 190,
      "frameId": "frame-deliver"
    },
    "node-reference": {
      "type": "note",
      "notePath": "Project notes.md",
      "x": 416,
      "y": 478,
      "width": 300,
      "height": 178,
      "frameId": "frame-discover"
    },
    "node-review": {
      "type": "task",
      "taskId": "review",
      "x": 1196,
      "y": 112,
      "width": 300,
      "height": 190,
      "frameId": "frame-deliver"
    },
    "node-ship": {
      "type": "task",
      "taskId": "ship",
      "x": 1196,
      "y": 346,
      "width": 300,
      "height": 190,
      "frameId": "frame-deliver"
    },
    "node-sketch": {
      "type": "task",
      "taskId": "sketch",
      "x": 416,
      "y": 112,
      "width": 300,
      "height": 330,
      "frameId": "frame-discover"
    }
  },
  "edges": {
    "edge-brief-sketch": {
      "source": "node-brief",
      "target": "node-sketch",
      "label": "informs"
    }
  }
}
```

Your writing can continue below the board.
