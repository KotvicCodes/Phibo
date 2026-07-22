import { describe, expect, it } from "vitest"

import type { DailyMetricRow } from "../db/types"

import type { ExploreDay } from "./correlations"
import { calculateExploreMetricImpacts } from "./correlations"
import { isoDate } from "./testHelpers"

// Builds explore days carrying a single populated metric (sleep score), so
// the effect size under test is not diluted by other columns.
function buildDays(taggedScores: Array<number | null>, otherScores: Array<number | null>) {
  const days: ExploreDay[] = []
  const push = (score: number | null, matches: boolean) => {
    days.push({
      date: isoDate(days.length),
      matches,
      metric: {
        date: isoDate(days.length),
        sleepScore: score,
        readinessScore: null,
        activityScore: null,
        hrvBalance: null,
        averageHrv: null
      } as DailyMetricRow,
      tags: matches ? ["late meal"] : []
    })
  }
  taggedScores.forEach((score) => push(score, true))
  otherScores.forEach((score) => push(score, false))
  return days
}

function sleepImpact(days: ExploreDay[]) {
  const impact = calculateExploreMetricImpacts(days).find(
    (row) => row.metric.key === "sleepScore"
  )
  if (impact === undefined) {
    throw new Error("sleep score is not a comparable explore metric")
  }
  return impact
}

describe("calculateExploreMetricImpacts effect size", () => {
  it("divides the delta by the within-group spread", () => {
    // Both groups spread by the same sample sd of sqrt(20/3) = 2.582, and the
    // group means sit 10 points apart, so Cohen's d is 10 / 2.582 = 3.87.
    const impact = sleepImpact(
      buildDays([80, 82, 84, 86], [70, 72, 74, 76])
    )

    expect(impact.delta).toBe(10)
    expect(impact.effectSize).toBeCloseTo(3.87, 2)
  })

  it("does not let a large real gap deflate its own effect size", () => {
    // The same within-group spread with a wider gap must scale the effect
    // size up linearly. Dividing by the sd of all days pooled together would
    // fold the gap into the denominator and flatten the two cases toward each
    // other instead.
    const narrow = sleepImpact(buildDays([80, 82, 84, 86], [70, 72, 74, 76]))
    const wide = sleepImpact(buildDays([100, 102, 104, 106], [70, 72, 74, 76]))

    expect(wide.delta).toBe(30)
    expect(wide.effectSize).toBeCloseTo(11.62, 2)
    expect(wide.effectSize ?? 0).toBeCloseTo((narrow.effectSize ?? 0) * 3, 1)
  })

  it("flips the sign for metrics where lower is better", () => {
    const days = buildDays([80, 82, 84, 86], [70, 72, 74, 76])
    days.forEach((day) => {
      day.metric.restingHeartRate = day.metric.sleepScore
    })
    const impact = calculateExploreMetricImpacts(days).find(
      (row) => row.metric.key === "restingHeartRate"
    )

    expect(impact?.delta).toBe(10)
    expect(impact?.effectSize).toBeCloseTo(-3.87, 2)
  })

  it("reports no effect size when a group is too small to have a spread", () => {
    const impact = sleepImpact(buildDays([84], [70, 72, 74, 76]))

    expect(impact.delta).toBe(11)
    expect(impact.effectSize).toBeNull()
  })

  it("reports no effect size when neither group varies", () => {
    const impact = sleepImpact(buildDays([84, 84, 84], [70, 70, 70]))

    expect(impact.delta).toBe(14)
    expect(impact.effectSize).toBeNull()
  })

  it("skips missing values in both the delta and the spread", () => {
    const impact = sleepImpact(
      buildDays([80, null, 82, 84, 86], [70, 72, null, 74, 76])
    )

    expect(impact.delta).toBe(10)
    expect(impact.effectSize).toBeCloseTo(3.87, 2)
  })
})
