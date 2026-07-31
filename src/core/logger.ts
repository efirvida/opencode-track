export type LogLevel = "debug" | "info" | "warn" | "error"

export const LOGGER_SERVICE = "opencode-track"

export interface AppLogClient {
  app: {
    log(options: {
      body: {
        service: string
        level: LogLevel
        message: string
        extra?: Record<string, unknown>
      }
    }): Promise<unknown>
  }
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): Promise<void>
  info(message: string, extra?: Record<string, unknown>): Promise<void>
  warn(message: string, extra?: Record<string, unknown>): Promise<void>
  error(message: string, extra?: Record<string, unknown>): Promise<void>
}

export function createLogger(
  client: AppLogClient,
  service: string = LOGGER_SERVICE
): Logger {
  const log = async (
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<void> => {
    try {
      await client.app.log({ body: { service, level, message, extra } })
    } catch {
      // Logging must never throw — swallow failures to keep the plugin resilient.
    }
  }

  return {
    debug: (message, extra) => log("debug", message, extra),
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
  }
}
