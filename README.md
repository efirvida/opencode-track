# opencode-track

Time tracking plugin for OpenCode — local-first observability for AI-assisted development.

## What it does

- Tracks active coding time per file with automatic idle detection
- Infers LLM reasoning time from gaps between events
- Injects time reports directly into git commit messages
- All data stored in local SQLite (`.opencode/tracking.db`) — no external servers

## Install

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-track@1.0.0"]
}
```

## Commands

| Command | Description |
|---|---|
| `/track start [ISSUE-123]` | Start a tracking session |
| `/track stop` | Stop current session |
| `/track status` | Show real-time accumulated time |
| `/track commit` | Commit with time injection |
| `/track report` | Generate session report (markdown / json) |

## How it works

The plugin listens to OpenCode events (`file.edited`, `tool.execute.before/after`, `tui.prompt.append`, `session.idle`) and maintains a running active-time counter. Time is imputed per file and later assigned to commits.

## Config

```json
{
  "tracker": {
    "idleThresholdMinutes": 5,
    "dbPath": ".opencode/tracking.db",
    "branchPattern": "([A-Z]+-[0-9]+)",
    "commitTimeFormat": "human",
    "reasoningGapThresholdMs": 30000
  }
}
```
