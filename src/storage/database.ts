import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  EventRecord,
  FileActivity,
  FileActivityInput,
  Session,
  UnassignedTime,
} from "./models"

export const DEFAULT_DB_PATH = ".opencode/tracking.db"

interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          issue_key TEXT NOT NULL,
          branch_name TEXT,
          start_time INTEGER NOT NULL,
          end_time INTEGER,
          total_active_ms INTEGER DEFAULT 0,
          total_idle_ms INTEGER DEFAULT 0,
          status TEXT DEFAULT 'active'
        )
      `)
      db.exec(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL,
          metadata TEXT
        )
      `)
      db.exec(`
        CREATE TABLE file_activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          start_accumulated_ms INTEGER NOT NULL,
          end_accumulated_ms INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          reasoning_duration_ms INTEGER,
          commit_hash TEXT,
          metadata TEXT
        )
      `)
      db.exec(`CREATE INDEX idx_sessions_project ON sessions(project_id)`)
      db.exec(`CREATE INDEX idx_events_project ON events(project_id, timestamp)`)
      db.exec(`CREATE INDEX idx_events_session ON events(session_id)`)
      db.exec(`CREATE INDEX idx_file_activity_commit ON file_activity(commit_hash)`)
      db.exec(`CREATE INDEX idx_file_activity_session ON file_activity(session_id)`)
      db.exec(`CREATE INDEX idx_file_activity_project ON file_activity(project_id)`)
    },
  },
]

/**
 * Conceptual `metrics` table (PRD §6.2) — documented for v1.1+ aggregation
 * verticals (tokens, costs, productivity). NOT created in v1.0; adding it in
 * a future release is a forward-only migration, no destructive schema changes.
 */
const METRICS_SCHEMA_SQL = `
  CREATE TABLE metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    session_id TEXT,
    timestamp INTEGER NOT NULL,
    category TEXT NOT NULL,
    dimension TEXT NOT NULL,
    dimension_value TEXT,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    metadata TEXT
  )
`

export class TrackerDatabase {
  private readonly db: Database

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.init()
  }

  init(): void {
    const current = this.getSchemaVersion()
    for (const migration of MIGRATIONS) {
      if (migration.version > current) {
        this.applyMigration(migration)
      }
    }
  }

  close(): void {
    this.db.close()
  }

  getSchemaVersion(): number {
    const row = this.db.query("PRAGMA user_version").get() as { user_version: number }
    return row.user_version
  }

  private applyMigration(migration: Migration): void {
    const run = this.db.transaction(() => {
      migration.up(this.db)
      this.db.exec(`PRAGMA user_version = ${migration.version}`)
    })
    run()
  }

  createSession(project_id: string, issue_key: string, branch_name: string | null): Session {
    const session: Session = {
      id: randomUUID(),
      project_id,
      issue_key,
      branch_name,
      start_time: Date.now(),
      end_time: null,
      total_active_ms: 0,
      total_idle_ms: 0,
      status: "active",
    }
    this.db
      .query(
        `INSERT INTO sessions (id, project_id, issue_key, branch_name, start_time, end_time, total_active_ms, total_idle_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.project_id,
        session.issue_key,
        session.branch_name,
        session.start_time,
        session.end_time,
        session.total_active_ms,
        session.total_idle_ms,
        session.status
      )
    return session
  }

  getActiveSession(project_id: string): Session | null {
    const row = this.db
      .query(`SELECT * FROM sessions WHERE project_id = ? AND status = 'active' LIMIT 1`)
      .get(project_id)
    return (row as Session | undefined) ?? null
  }

  getSessionById(id: string): Session | null {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(id)
    return (row as Session | undefined) ?? null
  }

  closeSession(session_id: string, total_active_ms: number, total_idle_ms: number): void {
    this.db
      .query(
        `UPDATE sessions
         SET status = 'closed', end_time = ?, total_active_ms = ?, total_idle_ms = ?
         WHERE id = ?`
      )
      .run(Date.now(), total_active_ms, total_idle_ms, session_id)
  }

  insertEvent(project_id: string, session_id: string, type: string, metadata?: unknown): void {
    this.db
      .query(
        `INSERT INTO events (project_id, session_id, timestamp, type, metadata)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(project_id, session_id, Date.now(), type, serializeMetadata(metadata))
  }

  getEventsBySession(session_id: string): EventRecord[] {
    const rows = this.db
      .query(`SELECT * FROM events WHERE session_id = ? ORDER BY id`)
      .all(session_id)
    return rows as EventRecord[]
  }

  insertFileActivity(input: FileActivityInput): void {
    this.db
      .query(
        `INSERT INTO file_activity
           (project_id, session_id, file_path, start_accumulated_ms, end_accumulated_ms,
            duration_ms, reasoning_duration_ms, commit_hash, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.project_id,
        input.session_id,
        input.file_path,
        input.start_accumulated_ms,
        input.end_accumulated_ms,
        input.duration_ms,
        input.reasoning_duration_ms ?? null,
        input.commit_hash ?? null,
        serializeMetadata(input.metadata)
      )
  }

  getFileActivityBySession(session_id: string): FileActivity[] {
    const rows = this.db
      .query(`SELECT * FROM file_activity WHERE session_id = ? ORDER BY id`)
      .all(session_id)
    return rows as FileActivity[]
  }

  getUnassignedTime(filePaths: string[], session_id: string): UnassignedTime {
    if (filePaths.length === 0) {
      return { totalDuration: 0, totalReasoning: 0 }
    }
    const placeholders = filePaths.map(() => "?").join(", ")
    const row = this.db
      .query(
        `SELECT COALESCE(SUM(duration_ms), 0) AS totalDuration,
                COALESCE(SUM(reasoning_duration_ms), 0) AS totalReasoning
         FROM file_activity
         WHERE session_id = ? AND commit_hash IS NULL AND file_path IN (${placeholders})`
      )
      .get(session_id, ...filePaths) as { totalDuration: number; totalReasoning: number }
    return { totalDuration: row.totalDuration, totalReasoning: row.totalReasoning }
  }

  assignCommitHash(commitHash: string, filePaths: string[], session_id: string): void {
    if (filePaths.length === 0) {
      return
    }
    const placeholders = filePaths.map(() => "?").join(", ")
    this.db
      .query(
        `UPDATE file_activity
         SET commit_hash = ?
         WHERE session_id = ? AND commit_hash IS NULL AND file_path IN (${placeholders})`
      )
      .run(commitHash, session_id, ...filePaths)
  }
}

function serializeMetadata(metadata: unknown): string | null {
  if (metadata === undefined || metadata === null) {
    return null
  }
  return JSON.stringify(metadata)
}
