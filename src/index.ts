import { join } from "node:path"
import type { Plugin, Config as PluginConfig } from "@opencode-ai/plugin"
import { DEFAULT_CONFIG, resolveConfig, type TrackerConfig } from "./config"
import { createLogger, type Logger } from "./core/logger"
import { TrackerDatabase } from "./storage/database"

const GLOBAL_PROJECT_ID = "global"

function resolveDbPath(directory: string, dbPath: string): string {
  if (dbPath === ":memory:") {
    return dbPath
  }
  return join(directory, dbPath)
}

/**
 * M1 event dispatch layer (PRD §6.3 validation spy).
 * Every OpenCode event is logged at debug with its type and sessionID (when
 * present). M2/M3 will attach session/tracking handlers per event type here —
 * the switch below is the single dispatch point to extend.
 */
function handleEvent(
  event: { type: string; properties?: Record<string, unknown> },
  logger: Logger
): void {
  const { type, properties } = event
  const sessionID = typeof properties?.sessionID === "string" ? properties.sessionID : undefined

  switch (type) {
    case "session.created":
    case "session.idle":
    case "session.deleted":
    case "session.error":
    case "file.edited":
    case "tui.prompt.append":
    case "message.part.updated":
    case "command.executed":
      // M2: tracking logic hooks here (state machine transitions, imputation, commit intercept)
      break
    default:
      break
  }

  logger.debug(`event:${type}`, {
    ...(sessionID ? { sessionID } : {}),
    properties,
  })
}

/**
 * opencode-track plugin entry point.
 * Named export `opencodeTrack` so OpenCode's legacy plugin loader can pick it up.
 */
export const opencodeTrack: Plugin = async ({ client, project, directory }) => {
  const logger = createLogger(client)
  const projectId = project?.id ?? GLOBAL_PROJECT_ID

  let config: TrackerConfig = DEFAULT_CONFIG
  let dbPath = resolveDbPath(directory, config.dbPath)
  let db = new TrackerDatabase(dbPath)

  const reinitDatabase = (resolvedPath: string): void => {
    db.close()
    db = new TrackerDatabase(resolvedPath)
    dbPath = resolvedPath
  }

  logger.info("Plugin initialized", {
    projectId,
    directory,
    dbPath,
  })

  return {
    config: async (cfg: PluginConfig) => {
      const raw = (cfg as unknown as { tracker?: Partial<TrackerConfig> }).tracker
      config = resolveConfig(raw)

      const resolved = resolveDbPath(directory, config.dbPath)
      if (resolved !== dbPath) {
        reinitDatabase(resolved)
      }

      logger.debug("Configuration resolved", { config })
    },

    event: async ({ event }) => {
      handleEvent(event, logger)
    },

    "tool.execute.before": async (input) => {
      const { tool, sessionID, callID } = input
      logger.debug(`tool.execute.before:${tool}`, { sessionID, callID })
    },

    "tool.execute.after": async (input) => {
      const { tool, sessionID, callID } = input
      logger.debug(`tool.execute.after:${tool}`, { sessionID, callID })
    },

    dispose: async () => {
      db.close()
    },
  }
}

/**
 * M5: custom tools will be wired into the `tool` registry here:
 *   - track_start  (FR-06.1)
 *   - track_stop   (FR-06.2)
 *   - track_status (FR-06.3)
 *   - track_commit (FR-06.4 / FR-05 Modo B)
 *   - track_report (FR-06.5)
 * Not shipped in M1 — no dead/stub tools.
 */
