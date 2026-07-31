import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TrackerDatabase } from "./database"

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-track-"))
  return join(dir, "tracking.db")
}

describe("TrackerDatabase schema", () => {
  let db: TrackerDatabase

  beforeEach(() => {
    db = new TrackerDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  test("creates schema with user_version 1", () => {
    expect(db.getSchemaVersion()).toBe(1)
  })

  test("init() is idempotent on the same instance", () => {
    expect(() => db.init()).not.toThrow()
    expect(db.getSchemaVersion()).toBe(1)
    expect(() => db.init()).not.toThrow()
  })

  test("re-opening an existing DB file does not re-run migrations", () => {
    const path = tempDbPath()
    const first = new TrackerDatabase(path)
    expect(first.getSchemaVersion()).toBe(1)
    first.createSession("proj-a", "ABC-1", "feature/ABC-1")
    first.close()

    const second = new TrackerDatabase(path)
    expect(second.getSchemaVersion()).toBe(1)
    expect(second.getActiveSession("proj-a")).not.toBeNull()
    second.close()
  })
})

describe("TrackerDatabase sessions", () => {
  let db: TrackerDatabase

  beforeEach(() => {
    db = new TrackerDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  test("createSession returns an active session with defaults", () => {
    const session = db.createSession("proj-a", "ABC-123", "feature/ABC-123")
    expect(session.id).toBeString()
    expect(session.id).not.toBeEmpty()
    expect(session.project_id).toBe("proj-a")
    expect(session.issue_key).toBe("ABC-123")
    expect(session.branch_name).toBe("feature/ABC-123")
    expect(session.status).toBe("active")
    expect(session.start_time).toBeGreaterThan(0)
    expect(session.end_time).toBeNull()
    expect(session.total_active_ms).toBe(0)
    expect(session.total_idle_ms).toBe(0)
  })

  test("getActiveSession returns the active session for the project", () => {
    const session = db.createSession("proj-a", "ABC-123", "feature/ABC-123")
    const active = db.getActiveSession("proj-a")
    expect(active).not.toBeNull()
    expect(active!.id).toBe(session.id)
  })

  test("getActiveSession returns null when no active session", () => {
    expect(db.getActiveSession("proj-a")).toBeNull()
  })

  test("getActiveSession does not leak sessions across projects", () => {
    db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    expect(db.getActiveSession("proj-b")).toBeNull()
  })

  test("closeSession closes the session and persists totals", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.closeSession(session.id, 123456, 654)
    const closed = db.getSessionById(session.id)
    expect(closed).not.toBeNull()
    expect(closed!.status).toBe("closed")
    expect(closed!.end_time).not.toBeNull()
    expect(closed!.end_time).toBeGreaterThanOrEqual(closed!.start_time)
    expect(closed!.total_active_ms).toBe(123456)
    expect(closed!.total_idle_ms).toBe(654)
    expect(db.getActiveSession("proj-a")).toBeNull()
  })

  test("getSessionById returns null for unknown id", () => {
    expect(db.getSessionById("missing")).toBeNull()
  })
})

describe("TrackerDatabase events", () => {
  let db: TrackerDatabase

  beforeEach(() => {
    db = new TrackerDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  test("insertEvent + getEventsBySession round-trip in order with JSON metadata", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.insertEvent("proj-a", session.id, "tui.prompt.append", { text: "hello" })
    db.insertEvent("proj-a", session.id, "file.edited", { file: "src/a.ts" })
    db.insertEvent("proj-a", session.id, "session.idle", { idle: true })

    const events = db.getEventsBySession(session.id)
    expect(events).toHaveLength(3)
    expect(events[0]!.type).toBe("tui.prompt.append")
    expect(events[1]!.type).toBe("file.edited")
    expect(events[2]!.type).toBe("session.idle")
    expect(events[0]!.project_id).toBe("proj-a")
    expect(events[0]!.timestamp).toBeGreaterThan(0)
    expect(JSON.parse(events[0]!.metadata!)).toEqual({ text: "hello" })
  })

  test("insertEvent stores null metadata when not provided", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.insertEvent("proj-a", session.id, "session.idle")
    const events = db.getEventsBySession(session.id)
    expect(events[0]!.metadata).toBeNull()
  })
})

describe("TrackerDatabase file_activity", () => {
  let db: TrackerDatabase

  beforeEach(() => {
    db = new TrackerDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  test("insertFileActivity + getFileActivityBySession round-trip all fields", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/a.ts",
      start_accumulated_ms: 100,
      end_accumulated_ms: 1100,
      duration_ms: 1000,
      reasoning_duration_ms: 500,
      metadata: { model: "gpt-4o" },
    })

    const rows = db.getFileActivityBySession(session.id)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.file_path).toBe("src/a.ts")
    expect(row.start_accumulated_ms).toBe(100)
    expect(row.end_accumulated_ms).toBe(1100)
    expect(row.duration_ms).toBe(1000)
    expect(row.reasoning_duration_ms).toBe(500)
    expect(row.commit_hash).toBeNull()
    expect(JSON.parse(row.metadata!)).toEqual({ model: "gpt-4o" })
  })

  test("getUnassignedTime sums only rows with NULL commit_hash", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/a.ts",
      start_accumulated_ms: 0,
      end_accumulated_ms: 2000,
      duration_ms: 2000,
      reasoning_duration_ms: null,
    })
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/a.ts",
      start_accumulated_ms: 2000,
      end_accumulated_ms: 5000,
      duration_ms: 3000,
      reasoning_duration_ms: 500,
    })
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/committed.ts",
      start_accumulated_ms: 0,
      end_accumulated_ms: 1000,
      duration_ms: 1000,
      reasoning_duration_ms: 200,
    })

    db.assignCommitHash("abc123", ["src/committed.ts"], session.id)

    const result = db.getUnassignedTime(["src/a.ts", "src/committed.ts"], session.id)
    expect(result.totalDuration).toBe(5000)
    expect(result.totalReasoning).toBe(500)
  })

  test("assignCommitHash updates only rows with NULL commit_hash", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/a.ts",
      start_accumulated_ms: 0,
      end_accumulated_ms: 1000,
      duration_ms: 1000,
    })
    db.insertFileActivity({
      project_id: "proj-a",
      session_id: session.id,
      file_path: "src/b.ts",
      start_accumulated_ms: 0,
      end_accumulated_ms: 2000,
      duration_ms: 2000,
    })
    db.assignCommitHash("abc123", ["src/a.ts"], session.id)

    const rows = db.getFileActivityBySession(session.id)
    const a = rows.find((r) => r.file_path === "src/a.ts")!
    const b = rows.find((r) => r.file_path === "src/b.ts")!
    expect(a.commit_hash).toBe("abc123")
    expect(b.commit_hash).toBeNull()
  })

  test("getUnassignedTime with empty file list returns zeros", () => {
    const session = db.createSession("proj-a", "ABC-1", "feature/ABC-1")
    expect(db.getUnassignedTime([], session.id)).toEqual({
      totalDuration: 0,
      totalReasoning: 0,
    })
  })
})
