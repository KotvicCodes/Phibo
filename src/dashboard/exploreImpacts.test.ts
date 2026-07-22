import { describe, expect, it } from "vitest"

import type { DailyMetricRow } from "../lib/db/types"

import {
  calculateExploreMetricImpacts,
  type ExploreDay
} from "../lib/analysis/correlations"
import { createSeededRng } from "../lib/analysis/stats"
import { isoDate } from "../lib/analysis/testHelpers"
import { groupExploreImpacts } from "./exploreImpacts"

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
