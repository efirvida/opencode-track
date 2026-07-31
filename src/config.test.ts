import { describe, expect, test } from "bun:test"
import { COMMIT_TIME_FORMATS, DEFAULT_CONFIG, resolveConfig } from "./config"

describe("resolveConfig", () => {
  test("returns DEFAULT_CONFIG when no raw config given", () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  test("returns DEFAULT_CONFIG for an empty object", () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG)
  })

  test("merges provided overrides over defaults", () => {
    const config = resolveConfig({
      idleThresholdMinutes: 10,
      branchPattern: "XYZ-([0-9]+)",
      commitTimeFormat: "seconds",
    })
    expect(config.idleThresholdMinutes).toBe(10)
    expect(config.branchPattern).toBe("XYZ-([0-9]+)")
    expect(config.commitTimeFormat).toBe("seconds")
    expect(config.autoDetectIssue).toBe(DEFAULT_CONFIG.autoDetectIssue)
    expect(config.dbPath).toBe(DEFAULT_CONFIG.dbPath)
    expect(config.enableCommitIntercept).toBe(DEFAULT_CONFIG.enableCommitIntercept)
    expect(config.enableTrackCommitTool).toBe(DEFAULT_CONFIG.enableTrackCommitTool)
    expect(config.reasoningGapThresholdMs).toBe(DEFAULT_CONFIG.reasoningGapThresholdMs)
    expect(config.reportOutputPath).toBe(DEFAULT_CONFIG.reportOutputPath)
  })

  test("falls back to human for an invalid commitTimeFormat", () => {
    const config = resolveConfig({ commitTimeFormat: "bogus" as never })
    expect(config.commitTimeFormat).toBe("human")
  })

  test("does not mutate DEFAULT_CONFIG or the raw input", () => {
    const raw = { idleThresholdMinutes: 42 }
    const config = resolveConfig(raw)
    expect(config.idleThresholdMinutes).toBe(42)
    expect(DEFAULT_CONFIG.idleThresholdMinutes).toBe(5)
    expect(raw).toEqual({ idleThresholdMinutes: 42 })
  })

  test("COMMIT_TIME_FORMATS contains exactly the supported formats", () => {
    expect(COMMIT_TIME_FORMATS).toEqual(["human", "seconds", "iso", "gitlab"])
  })
})
