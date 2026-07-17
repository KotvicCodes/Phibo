import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import { calculateOptimalDay, OPTIMAL_MIN_TAGGED_DAYS } from "./optimal"
import { createSeededRng } from "./stats"

function isoDate(dayIndex: number) {
  const date = new Date("2026-01-01T12:00:00")
  date.setDate(date.getDate() + dayIndex)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

let tagId = 0
function tagRow(date: string, tag: string): TagEntryRow {
  tagId += 1
  return {
    id: `opt-${tagId}`,
    date,
    tag,
    comment: null,
    sourceUpdatedAt: null,
    syncedAt: "2026-01-01T00:00:00Z"
  }
}

interface BuildOptions {
  days?: number
  base?: number
  noiseSpread?: number
  seed?: number
  // tag -> cadence in days (tag lands on every cadence-th day)
  tagEvery?: Record<string, number>
  // tag -> sleep boost on tagged days
  sleepBoost?: Record<string, number>
  readinessBoost?: Record<string, number>
  nullActivity?: boolean
}

function build(options: BuildOptions = {}) {
  const days = options.days ?? 120
  const base = options.base ?? 70
  const rng = createSeededRng(options.seed ?? 1)
  const spread = options.noiseSpread ?? 4
  const tagDates = new Map<string, Set<string>>()
  const tags: TagEntryRow[] = []
  for (const [tag, cadence] of Object.entries(options.tagEvery ?? {})) {
    const dates = new Set<string>()
    for (let i = 0; i < days; i += cadence) dates.add(isoDate(i))
    tagDates.set(tag, dates)
    for (const date of dates) tags.push(tagRow(date, tag))
  }
  const metrics: DailyMetricRow[] = []
  for (let i = 0; i < days; i += 1) {
    const date = isoDate(i)
    let sleep = base + (rng() - 0.5) * spread
    let readiness = base + (rng() - 0.5) * spread
    const activity = options.nullActivity ? null : base + (rng() - 0.5) * spread
    for (const [tag, boost] of Object.entries(options.sleepBoost ?? {})) {
      if (tagDates.get(tag)?.has(date)) sleep += boost
    }
    for (const [tag, boost] of Object.entries(options.readinessBoost ?? {})) {
      if (tagDates.get(tag)?.has(date)) readiness += boost
    }
    metrics.push({
      date,
      sleepScore: sleep,
      readinessScore: readiness,
      activityScore: activity
    } as DailyMetricRow)
  }
  return { metrics, tags }
}

describe("calculateOptimalDay naive behavior (characterization)", () => {
  it("gates tags below the tagged-day minimum", () => {
    const { metrics, tags } = build({ tagEvery: { common: 4 } })
    const rare = Array.from({ length: OPTIMAL_MIN_TAGGED_DAYS - 1 }, (_, i) =>
      tagRow(isoDate(i * 5), "rare")
    )
    const result = calculateOptimalDay(metrics, [...tags, ...rare])
    const allTags = [...result.contributions, ...result.otherEligibleTags].map(
      (item) => item.tag
    )
    expect(allTags).toContain("common")
    expect(allTags).not.toContain("rare")
    expect(result.eligibleTagCount).toBe(1)
  })

  it("gates tags with too few untagged days", () => {
    const { metrics } = build({ days: 30 })
    // Tag on all but 7 days: 23 tagged (>= 10) but only 7 untagged (< 8).
    const tags = Array.from({ length: 23 }, (_, i) => tagRow(isoDate(i), "daily"))
    const result = calculateOptimalDay(metrics, tags)
    expect(result.eligibleTagCount).toBe(0)
  })

  it("anchors deltas to the overall baseline so near-daily tags contribute little", () => {
    const days = 120
    const { metrics } = build({ days, noiseSpread: 0 })
    // Tag on all but 10 days; tagged days get +6 sleep.
    const taggedDates = new Set<string>()
    const tags: TagEntryRow[] = []
    for (let i = 0; i < days - 10; i += 1) {
      taggedDates.add(isoDate(i))
      tags.push(tagRow(isoDate(i), "nearDaily"))
    }
    const boosted = metrics.map((day) =>
      taggedDates.has(day.date)
        ? ({ ...day, sleepScore: (day.sleepScore as number) + 6 } as DailyMetricRow)
        : day
    )
    const result = calculateOptimalDay(boosted, tags, { target: "sleep" })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "nearDaily"
    )!
    // taggedAvg - overallAvg = 6 - 6 * (110/120) = 0.5
    expect(row.deltas.sleepScore).toBeCloseTo(0.5, 1)
  })

  it("gives every eligible tag a support score of one", () => {
    // The 10-tagged / 8-untagged gate sits at or above both knees of
    // calculateSupportScore, so the weighting is inert for eligible tags.
    const { metrics, tags } = build({ tagEvery: { a: 3, b: 5 } })
    const result = calculateOptimalDay(metrics, tags)
    for (const row of [...result.contributions, ...result.otherEligibleTags]) {
      expect(row.supportScore).toBe(1)
    }
  })

  it("damps co-occurring duplicate tags instead of double-counting", () => {
    const single = build({
      tagEvery: { boost: 3 },
      sleepBoost: { boost: 8 },
      noiseSpread: 2
    })
    const one = calculateOptimalDay(single.metrics, single.tags, {
      target: "sleep"
    })
    // A twin tag on exactly the same days.
    const twin = [
      ...single.tags,
      ...single.tags.map((entry) => tagRow(entry.date, "boostTwin"))
    ]
    const two = calculateOptimalDay(single.metrics, twin, { target: "sleep" })
    const singleDelta = one.estimateDeltas.sleepScore!
    const twinDelta = two.estimateDeltas.sleepScore!
    // The twin adds at most half its delta again (harmonic damping), and
    // saturation compresses further; well under double.
    expect(twinDelta).toBeLessThan(singleDelta * 1.7)
    expect(twinDelta).toBeGreaterThanOrEqual(singleDelta - 0.2)
  })

  it("never estimates past the best-days ceiling", () => {
    const { metrics, tags } = build({
      tagEvery: { a: 2, b: 3, c: 5 },
      sleepBoost: { a: 10, b: 9, c: 8 },
      readinessBoost: { a: 10, b: 9 }
    })
    const result = calculateOptimalDay(metrics, tags)
    for (const key of ["sleepScore", "readinessScore", "activityScore"] as const) {
      if (result.estimates[key] === null) continue
      expect(result.estimates[key]!).toBeLessThanOrEqual(
        result.bestDayAverages[key]! + 0.05
      )
    }
  })

  it("takes the ceiling from boundsMetrics, not the analysis metrics", () => {
    const { metrics, tags } = build({
      tagEvery: { boost: 3 },
      sleepBoost: { boost: 8 }
    })
    const highBounds = metrics.map(
      (day) => ({ ...day, sleepScore: 95 }) as DailyMetricRow
    )
    const bounded = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      boundsMetrics: highBounds
    })
    expect(bounded.bestDayAverages.sleepScore).toBe(95)
  })

  it("honors excluded and included overrides", () => {
    const { metrics, tags } = build({
      tagEvery: { helpful: 3, harmful: 4 },
      sleepBoost: { helpful: 8, harmful: -8 }
    })
    const plain = calculateOptimalDay(metrics, tags, { target: "sleep" })
    expect(plain.contributions.map((row) => row.tag)).toContain("helpful")
    expect(plain.contributions.map((row) => row.tag)).not.toContain("harmful")

    const overridden = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      excludedTags: ["helpful"],
      includedTags: ["harmful"]
    })
    expect(overridden.contributions.map((row) => row.tag)).toContain("harmful")
    expect(overridden.contributions.map((row) => row.tag)).not.toContain(
      "helpful"
    )
    expect(overridden.estimates.sleepScore!).toBeLessThan(
      plain.estimates.sleepScore!
    )
  })

  it("reports targetImpact as the marginal toggle effect", () => {
    const { metrics, tags } = build({
      tagEvery: { boost: 3 },
      sleepBoost: { boost: 8 },
      noiseSpread: 2
    })
    const result = calculateOptimalDay(metrics, tags, { target: "sleep" })
    const top = result.contributions[0]
    expect(top.tag).toBe("boost")
    const without = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      excludedTags: ["boost"]
    })
    const drop = result.estimates.sleepScore! - without.estimates.sleepScore!
    expect(top.targetImpact).toBeCloseTo(drop, 0)
    expect(top.targetImpact).toBeGreaterThan(0)
  })

  it("scopes targetContribution to the target categories", () => {
    const { metrics, tags } = build({
      tagEvery: { sleeper: 3 },
      sleepBoost: { sleeper: 8 }
    })
    const sleepResult = calculateOptimalDay(metrics, tags, { target: "sleep" })
    const activityResult = calculateOptimalDay(metrics, tags, {
      target: "activity"
    })
    const sleepRow = [
      ...sleepResult.contributions,
      ...sleepResult.otherEligibleTags
    ].find((row) => row.tag === "sleeper")!
    const activityRow = [
      ...activityResult.contributions,
      ...activityResult.otherEligibleTags
    ].find((row) => row.tag === "sleeper")!
    expect(sleepRow.targetContribution).toBeGreaterThan(3)
    expect(Math.abs(activityRow.targetContribution)).toBeLessThan(1.5)
  })

  it("returns null estimates for categories without data", () => {
    const { metrics, tags } = build({
      tagEvery: { boost: 3 },
      nullActivity: true
    })
    const result = calculateOptimalDay(metrics, tags)
    expect(result.baselines.activityScore).toBeNull()
    expect(result.estimates.activityScore).toBeNull()
    expect(result.estimateDeltas.activityScore).toBeNull()
    expect(result.estimates.sleepScore).not.toBeNull()
  })

  it("handles empty inputs", () => {
    const result = calculateOptimalDay([], [])
    expect(result.eligibleTagCount).toBe(0)
    expect(result.contributions).toEqual([])
    expect(result.baselines.sleepScore).toBeNull()
  })
})
