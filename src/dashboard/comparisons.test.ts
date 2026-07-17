import { describe, expect, it } from "vitest"

import type { DailyMetricRow } from "../lib/db/types"

import { buildMetricComparison } from "./comparisons"

function day(date: string, sleepScore: number | null): DailyMetricRow {
  return {
    date,
    sleepScore,
    readinessScore: null,
    activityScore: null
  } as DailyMetricRow
}

describe("buildMetricComparison", () => {
  it("averages both sides and rounds the delta to one decimal", () => {
    const comparison = buildMetricComparison(
      [day("2026-01-01", 80), day("2026-01-02", 81)],
      [day("2026-01-03", 70), day("2026-01-04", 70.13)],
      "sleepScore"
    )
    expect(comparison.taggedAverage).toBeCloseTo(80.5, 10)
    expect(comparison.baselineAverage).toBeCloseTo(70.065, 10)
    expect(comparison.delta).toBe(10.4)
  })

  it("skips null values inside a side", () => {
    const comparison = buildMetricComparison(
      [day("2026-01-01", 80), day("2026-01-02", null)],
      [day("2026-01-03", 70)],
      "sleepScore"
    )
    expect(comparison.taggedAverage).toBe(80)
    expect(comparison.delta).toBe(10)
  })

  it("returns a null delta when either side has no values", () => {
    const empty = buildMetricComparison([], [day("2026-01-03", 70)], "sleepScore")
    expect(empty.taggedAverage).toBeNull()
    expect(empty.delta).toBeNull()
    const allNull = buildMetricComparison(
      [day("2026-01-01", 80)],
      [day("2026-01-03", null)],
      "sleepScore"
    )
    expect(allNull.baselineAverage).toBeNull()
    expect(allNull.delta).toBeNull()
  })
})
