export type CommitTimeFormat = "human" | "seconds" | "iso" | "gitlab"

export const COMMIT_TIME_FORMATS: readonly CommitTimeFormat[] = [
  "human",
  "seconds",
  "iso",
  "gitlab",
]

export interface TrackerConfig {
  idleThresholdMinutes: number
  dbPath: string
  autoDetectIssue: boolean
  branchPattern: string
  commitTimeFormat: CommitTimeFormat
  enableCommitIntercept: boolean
  enableTrackCommitTool: boolean
  reasoningGapThresholdMs: number
  reportOutputPath: string
  projectId?: string
}

export const DEFAULT_CONFIG: TrackerConfig = {
  idleThresholdMinutes: 5,
  dbPath: ".opencode/tracking.db",
  autoDetectIssue: true,
  branchPattern: "([A-Z]+-[0-9]+)",
  commitTimeFormat: "human",
  enableCommitIntercept: true,
  enableTrackCommitTool: true,
  reasoningGapThresholdMs: 30000,
  reportOutputPath: ".opencode/reports/",
}

export function resolveConfig(raw: Partial<TrackerConfig> | undefined): TrackerConfig {
  const config: TrackerConfig = { ...DEFAULT_CONFIG, ...raw }
  if (!COMMIT_TIME_FORMATS.includes(config.commitTimeFormat)) {
    config.commitTimeFormat = "human"
  }
  return config
}
