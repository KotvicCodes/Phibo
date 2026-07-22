import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import type { ExploreDay } from "./correlations"
import {
  calculateExploreMetricImpacts,
  calculateSupportScore,
  calculateTagCorrelations,
  getRankedTagInsights
} from "./correlations"
import { isoDate, tagRow } from "./testHelpers"

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

describe("calculateSupportScore", () => {
  it("keeps the value unrounded so it can weight a delta faithfully", () => {
    // Both of these used to come back as 0.9, hiding a seven percent
    // difference in how much evidence stands behind the two tags.
    expect(calculateSupportScore(5, 7)).toBeCloseTo(Math.sqrt(7 / 8), 10)
    expect(calculateSupportScore(4, 8)).toBeCloseTo(Math.sqrt(0.8), 10)
    expect(calculateSupportScore(5, 7)).not.toBe(calculateSupportScore(4, 8))
  })

  it("still saturates at five tagged and eight comparison days", () => {
    expect(calculateSupportScore(5, 8)).toBe(1)
    expect(calculateSupportScore(40, 200)).toBe(1)
    expect(calculateSupportScore(0, 50)).toBe(0)
  })
})

describe("naive insight ranking support weighting", () => {
  it("orders two tags whose supports round to the same value", () => {
    // Twelve days: "alpha" on five, "beta" on four, both scoring 0.9 support
    // once rounded. Alpha has the smaller delta but the stronger support,
    // and only the unrounded weight puts it first.
    const alphaBonus = (9.7 + 40 / 7) * (14 / 9)
    const betaBonus = 10 + (5 * alphaBonus) / 8
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 12; i += 1) {
      const date = isoDate(i)
      if (i < 5) tags.push(tagRow(date, "alpha"))
      if (i >= 5 && i < 9) tags.push(tagRow(date, "beta"))
      metrics.push({
        date,
        sleepScore:
          70 + (i < 5 ? alphaBonus : 0) + (i >= 5 && i < 9 ? betaBonus : 0),
        readinessScore: null,
        activityScore: null
      } as DailyMetricRow)
    }

    const correlations = calculateTagCorrelations(metrics, tags)
    const alpha = correlations.find((item) => item.tag === "alpha")!
    const beta = correlations.find((item) => item.tag === "beta")!

    // The fixture's premise: beta has the larger observed delta, alpha the
    // better support, and the two supports are indistinguishable once
    // rounded to a tenth.
    expect(alpha.deltas.sleepScore).toBe(9.7)
    expect(beta.deltas.sleepScore).toBe(10)
    expect(alpha.supportScore).toBeGreaterThan(beta.supportScore)
    expect(Math.round(alpha.supportScore * 10)).toBe(
      Math.round(beta.supportScore * 10)
    )

    const ranked = getRankedTagInsights(correlations)
    expect(ranked.rewarding[0]?.tag).toBe("alpha")
  })
})
