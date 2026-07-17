import { describe, expect, it } from "vitest"

import type { DailyMetricRow } from "../db/types"

import type { ExploreDay } from "./correlations"
import {
  calculateExploreConfidence,
  calculateExploreConfidenceMemoized,
  peekExploreConfidence
} from "./exploreConfidence"
import { createSeededRng } from "./stats"
import { isoDate } from "./testHelpers"

interface BuildOptions {
  days?: number
  matchEvery?: number
  seed?: number
  hrvBoostOnMatch?: number
  dropHrvOnMatchedDays?: boolean
}

// Builds ExploreDay rows with a handful of populated metrics: noisy HRV,
// resting heart rate, breath rate, and sleep score. Every matchEvery-th day
// matches the selection.
function buildDays(options: BuildOptions = {}): ExploreDay[] {
  const dayCount = options.days ?? 200
  const matchEvery = options.matchEvery ?? 4
  const rng = createSeededRng(options.seed ?? 1)
  const days: ExploreDay[] = []
  for (let i = 0; i < dayCount; i += 1) {
    const matches = i % matchEvery === 0
    const metric = {
      date: isoDate(i),
      sleepScore: 70 + (rng() - 0.5) * 16,
      readinessScore: 70 + (rng() - 0.5) * 16,
      activityScore: null,
      averageHrv:
        options.dropHrvOnMatchedDays && matches
          ? null
          : 45 +
            (rng() - 0.5) * 10 +
            (matches ? (options.hrvBoostOnMatch ?? 0) : 0),
      restingHeartRate: 58 + (rng() - 0.5) * 6,
      averageBreath: 14 + (rng() - 0.5) * 2
    } as DailyMetricRow
    days.push({
      date: metric.date,
      matches,
      metric,
      tags: matches ? ["alcohol", "late meal"] : []
    })
  }
  return days
}

const selection = ["late meal", "alcohol"]

describe("calculateExploreConfidence", () => {
  it("returns an empty map for an empty selection", () => {
    expect(calculateExploreConfidence(buildDays(), []).size).toBe(0)
  })

  it("gives a strong injected effect a high level despite FDR", () => {
    const days = buildDays({ hrvBoostOnMatch: 12 })
    const result = calculateExploreConfidence(days, selection)
    const hrv = result.get("averageHrv")!
    expect(hrv.level).toBe("high")
    expect(hrv.qValue).not.toBeNull()
    expect(hrv.qValue!).toBeLessThan(0.05)
  })

  it("gives pure noise no high levels", () => {
    const days = buildDays()
    const result = calculateExploreConfidence(days, selection)
    for (const [key, confidence] of result) {
      if (key === "sleepScore" || key === "readinessScore") continue
      expect(confidence.level).not.toBe("high")
    }
  })

  it("keeps exploratory q-values at or above their p-values", () => {
    const days = buildDays({ hrvBoostOnMatch: 6 })
    const result = calculateExploreConfidence(days, selection)
    for (const confidence of result.values()) {
      if (confidence.qValue === null || confidence.pValue === null) continue
      expect(confidence.qValue).toBeGreaterThanOrEqual(confidence.pValue)
    }
  })

  it("leaves primary scores outside the FDR family with raw-p levels", () => {
    const days = buildDays()
    const result = calculateExploreConfidence(days, selection)
    expect(result.get("sleepScore")!.qValue).toBeNull()
    expect(result.get("sleepScore")!.pValue).not.toBeNull()
    expect(result.get("averageHrv")!.qValue).not.toBeNull()
  })

  it("is deterministic and independent of selection order", () => {
    const days = buildDays({ hrvBoostOnMatch: 5 })
    const first = calculateExploreConfidence(days, ["alcohol", "late meal"])
    const second = calculateExploreConfidence(days, ["late meal", "alcohol"])
    expect(second).toEqual(first)
  })

  it("skips missing values and reports finite-value counts", () => {
    const days = buildDays({ dropHrvOnMatchedDays: true })
    const result = calculateExploreConfidence(days, selection)
    // Every matched day's HRV is null, so the tagged side is empty: no test.
    const hrv = result.get("averageHrv")!
    expect(hrv.pValue).toBeNull()
    expect(hrv.level).toBe("low")
    expect(hrv.taggedCount).toBe(0)
    // Other metrics keep their full counts.
    expect(result.get("restingHeartRate")!.taggedCount).toBe(50)
    expect(result.get("restingHeartRate")!.otherCount).toBe(150)
  })

  it("handles a selection matching most days via the group swap", () => {
    // 3 of every 4 days match: the tagged side is the larger group, so the
    // test runs on the swapped sides but must stay two-sided-correct.
    const rng = createSeededRng(9)
    const days: ExploreDay[] = []
    for (let i = 0; i < 200; i += 1) {
      const matches = i % 4 !== 0
      const metric = {
        date: isoDate(i),
        sleepScore: null,
        readinessScore: null,
        activityScore: null,
        averageHrv: 45 + (rng() - 0.5) * 8 + (matches ? 10 : 0)
      } as DailyMetricRow
      days.push({ date: metric.date, matches, metric, tags: [] })
    }
    const result = calculateExploreConfidence(days, ["anything"])
    const hrv = result.get("averageHrv")!
    expect(hrv.pValue).not.toBeNull()
    expect(hrv.pValue!).toBeLessThan(0.01)
    expect(hrv.taggedCount).toBe(150)
    expect(hrv.otherCount).toBe(50)
  })

  it("produces similar p-values regardless of which group is larger", () => {
    // Same data, mirrored match flag: the two-sided p is symmetric under
    // relabeling, so both orientations must agree on a strong effect.
    const build = (invert: boolean) => {
      const rng = createSeededRng(4)
      const days: ExploreDay[] = []
      for (let i = 0; i < 160; i += 1) {
        const inGroupA = i % 4 === 0
        const metric = {
          date: isoDate(i),
          sleepScore: null,
          readinessScore: null,
          activityScore: null,
          averageHrv: 45 + (rng() - 0.5) * 8 + (inGroupA ? 9 : 0)
        } as DailyMetricRow
        days.push({
          date: metric.date,
          matches: invert ? !inGroupA : inGroupA,
          metric,
          tags: []
        })
      }
      return days
    }
    const direct = calculateExploreConfidence(build(false), ["x"])
    const mirrored = calculateExploreConfidence(build(true), ["x"])
    expect(direct.get("averageHrv")!.pValue!).toBeLessThan(0.01)
    expect(mirrored.get("averageHrv")!.pValue!).toBeLessThan(0.01)
  })
})

describe("calculateExploreConfidenceMemoized", () => {
  it("caches on identities and selection signature", () => {
    const days = buildDays()
    const metrics = days.map((day) => day.metric)
    const entries: never[] = []
    const first = calculateExploreConfidenceMemoized(
      metrics,
      entries,
      days,
      ["alcohol", "late meal"]
    )
    // Reordered selection and a fresh days array still hit the cache.
    const second = calculateExploreConfidenceMemoized(
      metrics,
      entries,
      [...days],
      ["late meal", "alcohol"]
    )
    expect(second).toBe(first)
    expect(
      peekExploreConfidence(metrics, entries, ["alcohol", "late meal"])
    ).toBe(first)
    expect(peekExploreConfidence([...metrics], entries, selection)).toBe(
      undefined
    )
    const third = calculateExploreConfidenceMemoized(
      metrics,
      entries,
      days,
      ["alcohol"]
    )
    expect(third).not.toBe(first)
  })
})
