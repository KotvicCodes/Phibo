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

  it("does not let one freak night flip the rewarding vs concerning read", () => {
    // Twelve tagged nights sit at 72 except a single 0, twelve other nights
    // at 70. Winsorizing (k = 1) clamps the freak back to 72, so the tag
    // reads a touch rewarding. A plain mean would drag the tagged side to 66
    // and report the tag as concerning, a classification a single night flips.
    const tagged = Array.from({ length: 12 }, (_, i) =>
      day(`2026-02-${String(i + 1).padStart(2, "0")}`, i === 0 ? 0 : 72)
    )
    const other = Array.from({ length: 12 }, (_, i) =>
      day(`2026-03-${String(i + 1).padStart(2, "0")}`, 70)
    )
    const comparison = buildMetricComparison(tagged, other, "sleepScore")
    expect(comparison.taggedAverage).toBeCloseTo(72, 10)
    expect(comparison.delta).toBeGreaterThan(0)
  })
})
