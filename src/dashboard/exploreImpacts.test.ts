import { describe, expect, it } from "vitest"

import type { DailyMetricRow } from "../lib/db/types"

import {
  calculateExploreMetricImpacts,
  type ExploreDay,
  type ExploreMetricKey
} from "../lib/analysis/correlations"
import type { ExploreMetricConfidence } from "../lib/analysis/exploreConfidence"
import type { ConfidenceLevel } from "../lib/analysis/stats"
import { createSeededRng } from "../lib/analysis/stats"
import { isoDate } from "../lib/analysis/testHelpers"
import {
  groupExploreImpacts,
  type ExploreImpactConfidence
} from "./exploreImpacts"

function confidenceMap(
  levels: Partial<Record<ExploreMetricKey, ConfidenceLevel>>
): ExploreImpactConfidence {
  const map = new Map<ExploreMetricKey, ExploreMetricConfidence>()
  for (const [key, level] of Object.entries(levels)) {
    map.set(key as ExploreMetricKey, {
      level: level as ConfidenceLevel,
      pValue: null,
      qValue: null,
      taggedCount: 0,
      otherCount: 0
    })
  }
  return map
}

// Sleep score carries the only real effect. Steps move by a few hundred,
// which is nothing in step terms but a huge raw number next to a handful of
// score points, so it is the metric that hijacks a unit-blind ranking.
function buildDays(matchingCount: number): ExploreDay[] {
  const rng = createSeededRng(2)
  const days: ExploreDay[] = []
  for (let i = 0; i < 120; i += 1) {
    const matches = i < matchingCount
    days.push({
      date: isoDate(i),
      matches,
      metric: {
        date: isoDate(i),
        sleepScore: 70 + (rng() - 0.5) * 8 + (matches ? 6 : 0),
        readinessScore: 70 + (rng() - 0.5) * 8,
        activityScore: 70 + (rng() - 0.5) * 8,
        steps: 9000 + (rng() - 0.5) * 3000 + (matches ? 400 : 0),
        activeCalories: 500 + (rng() - 0.5) * 200,
        totalCalories: 2600 + (rng() - 0.5) * 400
      } as DailyMetricRow,
      tags: matches ? ["sauna"] : []
    })
  }
  return days
}

function groupsFor(matchingCount: number) {
  return groupExploreImpacts(
    calculateExploreMetricImpacts(buildDays(matchingCount))
  )
}

function groupNamed(matchingCount: number, category: string) {
  const group = groupsFor(matchingCount).find(
    (item) => item.category === category
  )
  if (group === undefined) {
    throw new Error(`no ${category} impact group`)
  }
  return group
}

describe("groupExploreImpacts strongest metric", () => {
  it("ranks the headline by effect size, not by raw units", () => {
    const activity = groupNamed(8, "Activity")

    expect(activity.strongest?.effectSize).not.toBeNull()
    for (const row of activity.rows) {
      if (row.effectSize === null) continue
      expect(Math.abs(activity.strongest!.effectSize!)).toBeGreaterThanOrEqual(
        Math.abs(row.effectSize)
      )
    }
  })

  it("names no strongest metric when a single matching day leaves no effect size", () => {
    // One matching day: every effect size is null, and the raw deltas that
    // remain are in different units, so any winner would be an artifact of
    // the unit rather than the effect. Steps is the one that used to win.
    const activity = groupNamed(1, "Activity")

    expect(activity.rows.every((row) => row.effectSize === null)).toBe(true)
    expect(activity.rows.some((row) => row.delta !== null)).toBe(true)
    expect(activity.strongest).toBeNull()
  })

  it("keeps the rows themselves even when no headline can be named", () => {
    const activity = groupNamed(1, "Activity")

    expect(activity.rows.length).toBeGreaterThan(1)
  })

  it("ignores rows without an effect size when others have one", () => {
    const impacts = calculateExploreMetricImpacts(buildDays(8)).map((row) =>
      row.metric.key === "steps"
        ? { ...row, effectSize: null, delta: 100000 }
        : row
    )
    const activity = groupExploreImpacts(impacts).find(
      (group) => group.category === "Activity"
    )

    expect(activity?.strongest?.metric.key).not.toBe("steps")
    expect(activity?.strongest?.effectSize).not.toBeNull()
  })
})

describe("groupExploreImpacts strongest trustworthy metric", () => {
  // Pull the biggest- and smallest-effect metrics of a category straight from
  // the data, so the tests do not hard-code which metric wins.
  function activityByEffect() {
    const impacts = calculateExploreMetricImpacts(buildDays(8))
    const rows = impacts
      .filter(
        (row) => row.metric.category === "Activity" && row.effectSize !== null
      )
      .sort((a, b) => Math.abs(b.effectSize!) - Math.abs(a.effectSize!))
    return { impacts, top: rows[0], bottom: rows[rows.length - 1] }
  }

  it("skips a larger but untrusted effect for a smaller trusted one", () => {
    const { impacts, top, bottom } = activityByEffect()
    expect(top.metric.key).not.toBe(bottom.metric.key)
    const groups = groupExploreImpacts(
      impacts,
      confidenceMap({ [top.metric.key]: "low", [bottom.metric.key]: "medium" })
    )
    const activity = groups.find((group) => group.category === "Activity")!
    expect(activity.strongest?.metric.key).toBe(bottom.metric.key)
  })

  it("keeps the largest effect when it is itself trusted", () => {
    const { impacts, top } = activityByEffect()
    const groups = groupExploreImpacts(
      impacts,
      confidenceMap({ [top.metric.key]: "high" })
    )
    const activity = groups.find((group) => group.category === "Activity")!
    expect(activity.strongest?.metric.key).toBe(top.metric.key)
  })

  it("falls back to the largest effect when none clear medium confidence", () => {
    const { impacts, top } = activityByEffect()
    const groups = groupExploreImpacts(
      impacts,
      confidenceMap({ [top.metric.key]: "low" })
    )
    const activity = groups.find((group) => group.category === "Activity")!
    // No metric is trusted, so the headline is the plain largest effect,
    // exactly what the no-confidence path returns.
    const fallback = groupExploreImpacts(impacts).find(
      (group) => group.category === "Activity"
    )!
    expect(activity.strongest?.metric.key).toBe(fallback.strongest?.metric.key)
    expect(activity.strongest?.metric.key).toBe(top.metric.key)
  })
})
