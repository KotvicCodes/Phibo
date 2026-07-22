import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import { calculateOptimalDay, OPTIMAL_MIN_TAGGED_DAYS } from "./optimal"
import { createSeededRng, type ConfidenceLevel } from "./stats"
import {
  calculateTagEffects,
  type TagEffect,
  type TagEffectsModel
} from "./tagEffects"
import { isoDate, tagRow } from "./testHelpers"

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
    expect(result.adjustedCategories).toEqual([])
  })
})

function mockEffect(partial: Partial<TagEffect> & { tag: string }): TagEffect {
  return {
    daysWithTag: 0,
    sameDayEffect: null,
    sameDayConfidence: null,
    sameDayStandardError: null,
    sameDayIndex: null,
    nextDayEffect: null,
    nextDayConfidence: null,
    nextDayStandardError: null,
    nextDayIndex: null,
    ...partial
  }
}

function mockModel(effects: TagEffect[]): TagEffectsModel {
  return {
    metric: "sleepScore",
    effects: new Map(effects.map((effect) => [effect.tag, effect])),
    modeledDays: 120,
    untaggedDays: 40,
    lambda: 4,
    covariance: null
  }
}

describe("calculateOptimalDay adjusted mode", () => {
  it("scales the steady-state coefficient by the absence share", () => {
    // Tag on every 3rd of 120 days: p = 1/3. Coefficients 6 same-day and
    // 3 next-day give steady state 9, so delta = 9 * (2/3) = 6.
    const { metrics, tags } = build({ tagEvery: { mag: 3 }, noiseSpread: 0 })
    const model = mockModel([
      mockEffect({
        tag: "mag",
        sameDayEffect: 6,
        sameDayConfidence: "high",
        nextDayEffect: 3,
        nextDayConfidence: "high"
      })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "mag"
    )!
    expect(row.deltas.sleepScore).toBeCloseTo(6, 1)
    expect(row.weightedDeltas.sleepScore).toBeCloseTo(6, 1)
    expect(result.adjustedCategories).toEqual(["sleepScore"])
  })

  it("gives a near-daily tag almost nothing despite a large coefficient", () => {
    const days = 120
    const { metrics } = build({ days, noiseSpread: 0 })
    const tags: TagEntryRow[] = []
    for (let i = 0; i < days - 10; i += 1) tags.push(tagRow(isoDate(i), "daily"))
    const model = mockModel([
      mockEffect({ tag: "daily", sameDayEffect: 6, sameDayConfidence: "high" })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "daily"
    )!
    // 6 * (10 / 120) = 0.5
    expect(row.deltas.sleepScore).toBeCloseTo(0.5, 1)
  })

  it("sums adjusted deltas plainly instead of damping them", () => {
    // Two disjoint tags, boost 6 each, p = 1/4, no noise. The naive delta
    // for each tag is 3 (the other tag lifts the shared baseline by 1.5,
    // and the own-frequency share removes another 1.5), while the adjusted
    // delta is coefficient * (1 - p) = 4.5, since ridge holds the other
    // tag constant. The naive path additionally damps the second
    // contribution to half, so the adjusted estimate is strictly higher.
    const days = 120
    const { metrics } = build({ days, noiseSpread: 0 })
    const tags: TagEntryRow[] = []
    const aDates = new Set<string>()
    const bDates = new Set<string>()
    for (let i = 0; i < days; i += 4) {
      aDates.add(isoDate(i))
      tags.push(tagRow(isoDate(i), "a"))
    }
    for (let i = 2; i < days; i += 4) {
      bDates.add(isoDate(i))
      tags.push(tagRow(isoDate(i), "b"))
    }
    const boosted = metrics.map((day) => {
      let sleep = day.sleepScore as number
      if (aDates.has(day.date)) sleep += 6
      if (bDates.has(day.date)) sleep += 6
      return { ...day, sleepScore: sleep } as DailyMetricRow
    })
    const naive = calculateOptimalDay(boosted, tags, { target: "sleep" })
    const model = mockModel([
      mockEffect({ tag: "a", sameDayEffect: 6, sameDayConfidence: "high" }),
      mockEffect({ tag: "b", sameDayEffect: 6, sameDayConfidence: "high" })
    ])
    const adjusted = calculateOptimalDay(boosted, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const naiveRow = naive.contributions.find((row) => row.tag === "a")!
    const adjustedRow = adjusted.contributions.find((row) => row.tag === "a")!
    expect(naiveRow.weightedDeltas.sleepScore).toBeCloseTo(3, 1)
    expect(adjustedRow.weightedDeltas.sleepScore).toBeCloseTo(4.5, 1)
    expect(adjusted.estimates.sleepScore!).toBeGreaterThan(
      naive.estimates.sleepScore!
    )
  })

  it("does not double-count co-occurring twins with a real fitted model", () => {
    // One behavior logged under two tag names on exactly the same days.
    // Naive gives each twin the full delta; ridge splits the effect, and
    // the adjusted estimate stays close to the single-tag estimate.
    const single = build({
      days: 200,
      tagEvery: { wine: 4 },
      sleepBoost: { wine: 8 },
      noiseSpread: 2
    })
    const twins = [
      ...single.tags,
      ...single.tags.map((entry) => tagRow(entry.date, "party"))
    ]
    const singleModel = calculateTagEffects(
      single.metrics,
      single.tags,
      "sleepScore"
    )
    const twinModel = calculateTagEffects(single.metrics, twins, "sleepScore")
    expect(singleModel).not.toBeNull()
    expect(twinModel).not.toBeNull()
    const oneAdjusted = calculateOptimalDay(single.metrics, single.tags, {
      target: "sleep",
      adjustedModels: { sleepScore: singleModel }
    })
    const twinAdjusted = calculateOptimalDay(single.metrics, twins, {
      target: "sleep",
      adjustedModels: { sleepScore: twinModel }
    })
    expect(twinAdjusted.estimates.sleepScore!).toBeCloseTo(
      oneAdjusted.estimates.sleepScore!,
      0
    )
  })

  it("counts a lag-only coefficient through the steady state", () => {
    const { metrics, tags } = build({ tagEvery: { tea: 3 }, noiseSpread: 0 })
    const model = mockModel([
      mockEffect({ tag: "tea", nextDayEffect: 6, nextDayConfidence: "medium" })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "tea"
    )!
    expect(row.deltas.sleepScore).toBeCloseTo(4, 1)
  })

  it("falls back to the observed delta for a tag the model never estimated", () => {
    const { metrics: baseMetrics, tags } = build({
      tagEvery: { known: 3, unknown: 4 },
      noiseSpread: 0
    })
    // The unknown tag has a real observed sleep effect on its days.
    const unknownDates = new Set(
      tags.filter((entry) => entry.tag === "unknown").map((entry) => entry.date)
    )
    const metrics = baseMetrics.map((day) =>
      unknownDates.has(day.date)
        ? ({
            ...day,
            sleepScore: (day.sleepScore as number) - 6
          } as DailyMetricRow)
        : day
    )
    const model = mockModel([
      mockEffect({ tag: "known", sameDayEffect: 6, sameDayConfidence: "high" })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "unknown"
    )!
    // Observed vs overall: -6 * (1 - 1/4) = -4.5, with low row confidence.
    expect(row.deltas.sleepScore).toBeCloseTo(-4.5, 1)
    expect(row.confidences.sleepScore).toBe("low")
    expect(result.contributions.map((item) => item.tag)).not.toContain(
      "unknown"
    )
  })

  it("keeps a low-confidence non-conflicting estimate out of the sums", () => {
    const { metrics, tags } = build({
      tagEvery: { shaky: 3 },
      noiseSpread: 0
    })
    const model = mockModel([
      mockEffect({ tag: "shaky", sameDayEffect: 4, sameDayConfidence: "low" })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "shaky"
    )!
    // No observed effect to conflict with and no trustworthy component:
    // Optimal sums contributions, so an untrusted estimate contributes
    // nothing rather than an observed bundle that could double-count.
    expect(row.deltas.sleepScore).toBeNull()
    expect(row.weightedDeltas.sleepScore).toBe(0)
  })

  it("never lets a flipped model recommend a harmful tag (Beer scenario)", () => {
    // Beer every 8th day with a strong observed negative readiness effect;
    // the model reports a flipped positive with a low-confidence chaser.
    const { metrics: baseMetrics, tags } = build({
      days: 160,
      noiseSpread: 2
    })
    const beerDates = new Set<string>()
    const beerTags: TagEntryRow[] = []
    for (let i = 0; i < 160; i += 8) {
      beerDates.add(isoDate(i))
      beerTags.push(tagRow(isoDate(i), "beer"))
    }
    const metrics = baseMetrics.map((day) =>
      beerDates.has(day.date)
        ? ({
            ...day,
            readinessScore: (day.readinessScore as number) - 10
          } as DailyMetricRow)
        : day
    )
    const model: TagEffectsModel = {
      ...mockModel([
        mockEffect({
          tag: "beer",
          sameDayEffect: 3.5,
          sameDayConfidence: "medium",
          nextDayEffect: 3.1,
          nextDayConfidence: "low"
        })
      ]),
      metric: "readinessScore"
    }
    const result = calculateOptimalDay(metrics, [...tags, ...beerTags], {
      target: "readiness",
      adjustedModels: { readinessScore: model }
    })
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "beer"
    )!
    // The observed delta overrules the flipped estimate: negative, dimmed,
    // and never selected for the optimal day.
    expect(row.deltas.readinessScore!).toBeLessThan(-5)
    expect(row.confidences.readinessScore).toBe("low")
    expect(result.contributions.map((item) => item.tag)).not.toContain("beer")

    // Force-including beer must lower the estimate, not flatter it.
    const forced = calculateOptimalDay(metrics, [...tags, ...beerTags], {
      target: "readiness",
      includedTags: ["beer"],
      adjustedModels: { readinessScore: model }
    })
    expect(forced.estimates.readinessScore!).toBeLessThan(
      result.estimates.readinessScore!
    )
  })

  it("mixes adjusted and naive categories independently", () => {
    const { metrics, tags } = build({
      tagEvery: { boost: 3 },
      sleepBoost: { boost: 6 },
      readinessBoost: { boost: 6 },
      noiseSpread: 0
    })
    const model = mockModel([
      mockEffect({ tag: "boost", sameDayEffect: 9, sameDayConfidence: "high" })
    ])
    const result = calculateOptimalDay(metrics, tags, {
      target: "night",
      adjustedModels: { sleepScore: model }
    })
    expect(result.adjustedCategories).toEqual(["sleepScore"])
    const row = [...result.contributions, ...result.otherEligibleTags].find(
      (item) => item.tag === "boost"
    )!
    // Adjusted sleep: 9 * (1 - 1/3) = 6. Naive readiness: 6 * (1 - 1/3) = 4.
    expect(row.deltas.sleepScore).toBeCloseTo(6, 1)
    expect(row.deltas.readinessScore).toBeCloseTo(4, 1)
  })

  it("treats a null model entry as naive mode", () => {
    const { metrics, tags } = build({
      tagEvery: { boost: 3 },
      sleepBoost: { boost: 6 },
      noiseSpread: 0
    })
    const plain = calculateOptimalDay(metrics, tags, { target: "sleep" })
    const withNull = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: null }
    })
    expect(withNull.adjustedCategories).toEqual([])
    expect(withNull.estimates).toEqual(plain.estimates)
    expect(withNull.contributions).toEqual(plain.contributions)
  })

  it("passes through the weaker of the two confidence levels", () => {
    const { metrics, tags } = build({ tagEvery: { mag: 3 } })
    const model = mockModel([
      mockEffect({
        tag: "mag",
        sameDayEffect: 6,
        sameDayConfidence: "high" as ConfidenceLevel,
        nextDayEffect: 2,
        nextDayConfidence: "medium" as ConfidenceLevel
      })
    ])
    const adjusted = calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
    const row = [
      ...adjusted.contributions,
      ...adjusted.otherEligibleTags
    ].find((item) => item.tag === "mag")!
    expect(row.confidences.sleepScore).toBe("medium")
    expect(row.confidences.readinessScore).toBeNull()

    const naive = calculateOptimalDay(metrics, tags, { target: "sleep" })
    const naiveRow = [
      ...naive.contributions,
      ...naive.otherEligibleTags
    ].find((item) => item.tag === "mag")!
    expect(naiveRow.confidences.sleepScore).toBeNull()
  })
})

describe("calculateOptimalDay contribution rounding", () => {
  // Every tag lands on the same 30 of 120 days, so the absence share is 0.75
  // and a same-day coefficient of e becomes a delta of 0.75 * e.
  function subRoundingScenario(coefficient: number, tagCount: number, spread = 4) {
    const tagNames = Array.from({ length: tagCount }, (_, i) => `tag${i}`)
    const { metrics, tags } = build({
      base: spread > 40 ? 50 : 70,
      noiseSpread: spread,
      tagEvery: Object.fromEntries(tagNames.map((tag) => [tag, 4]))
    })
    const model = mockModel(
      tagNames.map((tag) =>
        mockEffect({
          tag,
          sameDayEffect: coefficient,
          sameDayConfidence: "high" as ConfidenceLevel
        })
      )
    )
    return calculateOptimalDay(metrics, tags, {
      target: "sleep",
      adjustedModels: { sleepScore: model }
    })
  }

  it("sums contributions that each round away to nothing", () => {
    // 0.04 points per tag: every displayed contribution is 0.0, but eight of
    // them are worth a third of a point together. Rounding before the sum
    // discarded them entirely and pinned the estimate to the baseline.
    const result = subRoundingScenario(0.04 / 0.75, 8)
    const rows = [...result.contributions, ...result.otherEligibleTags]

    expect(rows).toHaveLength(8)
    for (const row of rows) {
      expect(row.weightedDeltas.sleepScore).toBe(0)
      expect(row.deltas.sleepScore).toBe(0)
    }
    expect(result.estimateDeltas.sleepScore ?? 0).toBeGreaterThan(0)
  })

  it("selects a tag whose contribution is real but rounds to zero", () => {
    const result = subRoundingScenario(0.04 / 0.75, 8)

    expect(result.contributions.map((row) => row.tag).sort()).toEqual(
      Array.from({ length: 8 }, (_, i) => `tag${i}`).sort()
    )
    expect(result.otherEligibleTags).toEqual([])
  })

  it("keeps sub-rounding differences out of the estimate comparison", () => {
    // 1.049 versus 1.000 per tag: identical once rounded to 0.1, so the old
    // pre-rounded sums made these two worlds indistinguishable.
    const nudged = subRoundingScenario(1.049 / 0.75, 16, 80)
    const plain = subRoundingScenario(1 / 0.75, 16, 80)

    expect(nudged.estimateDeltas.sleepScore ?? 0).toBeGreaterThan(
      plain.estimateDeltas.sleepScore ?? 0
    )
  })

  it("still rounds the numbers the cards display", () => {
    const result = subRoundingScenario(1.04 / 0.75, 4)
    const rows = [...result.contributions, ...result.otherEligibleTags]

    for (const row of rows) {
      expect(row.weightedDeltas.sleepScore).toBe(1)
      expect(row.deltas.sleepScore).toBe(1)
      expect(row.targetContribution).toBe(1)
      expect(row.targetImpact * 10).toBeCloseTo(
        Math.round(row.targetImpact * 10),
        10
      )
    }
  })
})
