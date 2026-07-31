export type SessionStatus = "active" | "closed"

export interface Session {
  id: string
  project_id: string
  issue_key: string
  branch_name: string | null
  start_time: number
  end_time: number | null
  total_active_ms: number
  total_idle_ms: number
  status: SessionStatus
}

export interface EventRecord {
  id: number
  project_id: string
  session_id: string
  timestamp: number
  type: string
  metadata: string | null
}

export interface FileActivity {
  id: number
  project_id: string
  session_id: string
  file_path: string
  start_accumulated_ms: number
  end_accumulated_ms: number
  duration_ms: number
  reasoning_duration_ms: number | null
  commit_hash: string | null
  metadata: string | null
}

export interface FileActivityInput {
  project_id: string
  session_id: string
  file_path: string
  start_accumulated_ms: number
  end_accumulated_ms: number
  duration_ms: number
  reasoning_duration_ms?: number | null
  commit_hash?: string | null
  metadata?: unknown
}

export interface MetricInput {
  project_id: string
  session_id?: string | null
  timestamp: number
  category: string
  dimension: string
  dimension_value?: string | null
  value: number
  unit: string
  metadata?: unknown
}

export interface Metric {
  id: number
  project_id: string
  session_id: string | null
  timestamp: number
  category: string
  dimension: string
  dimension_value: string | null
  value: number
  unit: string
  metadata: string | null
}

export interface UnassignedTime {
  totalDuration: number
  totalReasoning: number
}
