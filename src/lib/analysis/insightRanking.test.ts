import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import {
  calculateTagCorrelations,
  getRankedTagInsights
} from "./correlations"
import {
  calculateInsightConfidence,
  type InsightConfidenceModel,
  type InsightPairConfidence
} from "./insightConfidence"
import {
  getAdjustedTagInsights,
  getDiscoveryImpact
} from "./insightRanking"
import { createSeededRng, type ConfidenceLevel } from "./stats"
import {
  calculateTagEffects,
  type TagEffect,
  type TagEffectsModel
} from "./tagEffects"
import { isoDate, tagRow } from "./testHelpers"

function mockEffect(partial: Partial<TagEffect> & { tag: string }): TagEffect {
  return {
    daysWithTag: 30,
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
    modeledDays: 200,
    untaggedDays: 60,
    lambda: 4,
    covariance: null
  }
}

function mockObserved(
  levels: Record<string, ConfidenceLevel>
): InsightConfidenceModel {
  const results = new Map<string, InsightPairConfidence>()
  for (const [key, level] of Object.entries(levels)) {
    results.set(key, {
      level,
      pValue: level === "high" ? 0.001 : level === "medium" ? 0.05 : 0.5,
      qValue: level === "high" ? 0.01 : level === "medium" ? 0.1 : 0.7,
      taggedCount: 15,
      untaggedCount: 200
    })
  }
  return { results, familySize: results.size }
}

// 200 days: "alcohol" every 4th day with a real -8 sleep effect, and
// "late meal" only ever alongside alcohol (every 8th day) with no effect of
// its own. The naive delta blames late meal for alcohol's damage.
function buildConfounded() {
  const rng = createSeededRng(5)
  const metrics: DailyMetricRow[] = []
  const tags: TagEntryRow[] = []
  for (let i = 0; i < 200; i += 1) {
    const date = isoDate(i)
    const alcohol = i % 4 === 0
    if (alcohol) tags.push(tagRow(date, "alcohol"))
    if (i % 8 === 0) tags.push(tagRow(date, "late meal"))
    metrics.push({
      date,
      sleepScore: 70 - (alcohol ? 8 : 0) + (rng() - 0.5) * 5,
      readinessScore: 70 + (rng() - 0.5) * 5,
      activityScore: null
    } as DailyMetricRow)
  }
  return { metrics, tags }
}

describe("getAdjustedTagInsights", () => {
  it("drops a confounded tag even with the real observed-confidence family", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const naive = getRankedTagInsights(correlations)
    const naiveTags = naive.concerning.map((insight) => insight.tag)
    expect(naiveTags).toContain("alcohol")
    expect(naiveTags).toContain("late meal")
    // Late meal's observed sleep delta IS significant (it rides along on
    // alcohol nights), which is exactly why the fallback must not use it.
    const observed = calculateInsightConfidence(metrics, tags)
    const lateMeal = observed.results.get("late meal-sleepScore")!
    expect(["medium", "high"]).toContain(lateMeal.level)

    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(model).not.toBeNull()
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      observed
    )
    const adjustedTags = adjusted.concerning.map((insight) => insight.tag)
    expect(adjustedTags).toContain("alcohol")
    expect(adjustedTags).not.toContain("late meal")
  })

  it("reproduces the Beer bug: a flipped model cannot overrule the observed effect", () => {
    // 15 beer nights of 195, observed readiness strongly negative, but the
    // model reports a flipped positive same-day and a low-confidence
    // positive next-day. The card must stay concerning by the observed
    // delta and say so.
    const rng = createSeededRng(8)
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 195; i += 1) {
      const date = isoDate(i)
      const beer = i % 13 === 0
      if (beer) tags.push(tagRow(date, "beer"))
      metrics.push({
        date,
        sleepScore: 70 + (rng() - 0.5) * 5,
        readinessScore: 75 - (beer ? 10.6 : 0) + (rng() - 0.5) * 5,
        activityScore: null
      } as DailyMetricRow)
    }
    const correlations = calculateTagCorrelations(metrics, tags)
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
    const adjusted = getAdjustedTagInsights(
      { sleepScore: null, readinessScore: model },
      correlations,
      mockObserved({ "beer-readinessScore": "high" })
    )
    const beer = [...adjusted.rewarding, ...adjusted.concerning].find(
      (insight) => insight.tag === "beer" && insight.metric === "readinessScore"
    )
    expect(beer).toBeDefined()
    expect(beer!.kind).toBe("concerning")
    expect(beer!.delta).toBeLessThan(-8)
    expect(beer!.evidence).toBe("observed-conflict")
    expect(adjusted.rewarding.map((insight) => insight.tag)).not.toContain(
      "beer"
    )
  })

  it("excludes low-confidence components from the headline", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: 2,
        sameDayConfidence: "high",
        nextDayEffect: 4,
        nextDayConfidence: "low"
      })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      null
    )
    const alcohol = adjusted.rewarding.find(
      (insight) => insight.tag === "alcohol"
    )
    // Headline is the guarded 2, not 6; the low next-day does not count.
    expect(alcohol?.delta).toBe(2)
    expect(alcohol?.evidence).toBe("adjusted")
  })

  it("lets the observed effect show when a low-confidence model weakly agrees", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: -6,
        sameDayConfidence: "low"
      })
    ])
    const observedDelta = correlations.find(
      (correlation) => correlation.tag === "alcohol"
    )!.deltas.sleepScore!
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      mockObserved({ "alcohol-sleepScore": "high" })
    )
    const alcohol = adjusted.concerning.find(
      (insight) => insight.tag === "alcohol"
    )
    expect(alcohol?.evidence).toBe("observed")
    expect(alcohol?.delta).toBeCloseTo(observedDelta, 1)
  })

  it("keeps a partialled-away tag out despite a significant observed delta", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: -8,
        sameDayConfidence: "high"
      }),
      // The model estimated late meal and partialled it to nearly nothing.
      mockEffect({
        tag: "late meal",
        sameDayEffect: 0.4,
        sameDayConfidence: "low"
      })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      mockObserved({
        "alcohol-sleepScore": "high",
        "late meal-sleepScore": "high"
      })
    )
    expect(
      [...adjusted.rewarding, ...adjusted.concerning].map(
        (insight) => insight.tag
      )
    ).not.toContain("late meal")
  })

  it("returns exactly the naive ranking when both models are null", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    expect(
      getAdjustedTagInsights(
        { sleepScore: null, readinessScore: null },
        correlations,
        null
      )
    ).toEqual(getRankedTagInsights(correlations))
  })

  it("ranks by the guarded steady-state effect including trusted carry-over", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: 2,
        sameDayConfidence: "high",
        nextDayEffect: 2,
        nextDayConfidence: "medium"
      }),
      mockEffect({
        tag: "late meal",
        sameDayEffect: 1.2,
        sameDayConfidence: "high"
      })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      null
    )
    const alcohol = adjusted.rewarding.find(
      (insight) => insight.tag === "alcohol"
    )
    expect(alcohol?.delta).toBe(4)
    // 1.2 points sits under the 1.5-point bar.
    expect(
      adjusted.rewarding.some((insight) => insight.tag === "late meal")
    ).toBe(false)
  })

  it("shows a tag the model never estimated when its observed effect is significant", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    // Empty model: neither tag has any coefficient.
    const adjusted = getAdjustedTagInsights(
      { sleepScore: mockModel([]), readinessScore: null },
      correlations,
      mockObserved({ "alcohol-sleepScore": "high" })
    )
    const alcohol = adjusted.concerning.find(
      (insight) => insight.tag === "alcohol"
    )
    expect(alcohol?.evidence).toBe("observed")
  })

  it("falls back to the naive ranking for a metric without a model", () => {
    // Readiness has no model; a strong naive readiness insight must stay.
    const rng = createSeededRng(9)
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 200; i += 1) {
      const date = isoDate(i)
      const sauna = i % 5 === 0
      if (sauna) tags.push(tagRow(date, "sauna"))
      metrics.push({
        date,
        sleepScore: 70 + (rng() - 0.5) * 5,
        readinessScore: 70 + (sauna ? 7 : 0) + (rng() - 0.5) * 5,
        activityScore: null
      } as DailyMetricRow)
    }
    const correlations = calculateTagCorrelations(metrics, tags)
    const adjusted = getAdjustedTagInsights(
      { sleepScore: mockModel([]), readinessScore: null },
      correlations,
      null
    )
    const sauna = adjusted.rewarding.find((insight) => insight.tag === "sauna")
    expect(sauna?.metric).toBe("readinessScore")
  })

  it("property: a candidate never opposes a significant observed direction", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const levels: Array<ConfidenceLevel | null> = [
      null,
      "low",
      "medium",
      "high"
    ]
    const rng = createSeededRng(42)
    for (let round = 0; round < 200; round += 1) {
      const effects = ["alcohol", "late meal"].map((tag) => {
        const sameDay = rng() < 0.2 ? null : (rng() - 0.5) * 16
        const nextDay = rng() < 0.4 ? null : (rng() - 0.5) * 10
        return mockEffect({
          tag,
          sameDayEffect: sameDay,
          sameDayConfidence:
            sameDay === null ? null : levels[1 + Math.floor(rng() * 3)],
          nextDayEffect: nextDay,
          nextDayConfidence:
            nextDay === null ? null : levels[1 + Math.floor(rng() * 3)]
        })
      })
      const observedLevels: Record<string, ConfidenceLevel> = {}
      for (const tag of ["alcohol", "late meal"]) {
        const pick = levels[Math.floor(rng() * 4)]
        if (pick !== null) observedLevels[`${tag}-sleepScore`] = pick
      }
      const observed = mockObserved(observedLevels)
      const adjusted = getAdjustedTagInsights(
        { sleepScore: mockModel(effects), readinessScore: null },
        correlations,
        observed
      )
      for (const insight of [...adjusted.rewarding, ...adjusted.concerning]) {
        const level = observed.results.get(
          `${insight.tag}-${insight.metric}`
        )?.level
        if (level !== "medium" && level !== "high") continue
        const observedDelta = correlations.find(
          (correlation) => correlation.tag === insight.tag
        )?.deltas[insight.metric]
        if (observedDelta == null || Math.sign(observedDelta) === 0) continue
        expect(Math.sign(insight.delta)).toBe(Math.sign(observedDelta))
      }
    }
  })
})

describe("getAdjustedTagInsights mixed-mode ranking", () => {
  // Sleep has no model and falls back to naive insights; readiness has one.
  // "sauna" moves sleep by exactly 2.0 points and "plunge" moves readiness
  // by 2.2, with no noise, so the ordering is decided purely by the weights.
  function buildMixed() {
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 200; i += 1) {
      const date = isoDate(i)
      const sauna = i % 5 === 0
      const plunge = i % 7 === 0
      if (sauna) tags.push(tagRow(date, "sauna"))
      if (plunge) tags.push(tagRow(date, "plunge"))
      metrics.push({
        date,
        sleepScore: 70 + (sauna ? 2 : 0),
        readinessScore: 70 + (plunge ? 2.2 : 0),
        activityScore: null
      } as DailyMetricRow)
    }
    return { metrics, tags }
  }

  it("compares fallback and adjusted candidates on the same scale", () => {
    const { metrics, tags } = buildMixed()
    const correlations = calculateTagCorrelations(metrics, tags)
    const readinessModel = mockModel([
      mockEffect({
        tag: "plunge",
        sameDayEffect: 2.2,
        sameDayConfidence: "high"
      })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: null, readinessScore: readinessModel },
      correlations,
      null
    )

    const sauna = adjusted.rewarding.find((insight) => insight.tag === "sauna")
    const plunge = adjusted.rewarding.find((insight) => insight.tag === "plunge")
    expect(sauna?.metric).toBe("sleepScore")
    expect(plunge?.metric).toBe("readinessScore")
    // The naive sleep weight would have been 2.0 * 1.2 = 2.4, enough to beat
    // the larger adjusted readiness effect purely through the multiplier.
    expect(sauna?.weightedImpact).toBe(2)
    expect(plunge?.weightedImpact).toBeCloseTo(2.2, 5)
    expect(adjusted.rewarding[0]?.tag).toBe("plunge")
  })

  it("leaves the naive weights alone when no model fit at all", () => {
    const { metrics, tags } = buildMixed()
    const correlations = calculateTagCorrelations(metrics, tags)
    const naive = getRankedTagInsights(correlations)
    const adjusted = getAdjustedTagInsights(
      { sleepScore: null, readinessScore: null },
      correlations,
      null
    )

    expect(adjusted).toEqual(naive)
    expect(
      naive.rewarding.find((insight) => insight.tag === "sauna")?.weightedImpact
    ).toBe(2.4)
  })
})

describe("getAdjustedTagInsights model confidence", () => {
  it("badges the adjusted number and leaves observed ones unbadged", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    // A real fit, so the covariance behind the summed effect is real too.
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      mockObserved({ "alcohol-sleepScore": "high" })
    )
    const all = [...adjusted.rewarding, ...adjusted.concerning]

    for (const insight of all) {
      if (insight.evidence === "adjusted") {
        expect(insight.adjustedConfidence).toBeTruthy()
      } else {
        expect(insight.adjustedConfidence).toBeUndefined()
      }
    }
    expect(
      all.some((insight) => insight.evidence === "adjusted")
    ).toBe(true)
  })

  it("shows no model badge when the fit exported no covariance", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: -6,
        sameDayConfidence: "high"
      })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      null
    )
    const alcohol = adjusted.concerning.find(
      (insight) => insight.tag === "alcohol"
    )

    expect(alcohol?.evidence).toBe("adjusted")
    expect(alcohol?.adjustedConfidence).toBeUndefined()
  })
})

describe("getDiscoveryImpact", () => {
  const noModels = { sleepScore: null, readinessScore: null }

  it("shows the observed delta when no model estimated the tag", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const correlation = correlations.find((item) => item.tag === "alcohol")
    const impact = getDiscoveryImpact(
      correlation,
      noModels,
      mockObserved({ "alcohol-sleepScore": "high" })
    )

    expect(impact?.evidence).toBe("observed")
    expect(impact?.metric).toBe("sleepScore")
    expect(impact?.delta).toBe(correlation?.deltas.sleepScore)
    expect(impact?.confidence).toBe("high")
  })

  it("prefers the model's guarded effect when it speaks", () => {
    const { metrics, tags } = buildConfounded()
    // Readiness blanked out so the comparison between the two metrics
    // cannot decide this case: the point is which evidence sleep uses.
    const sleepOnly = metrics.map((day) => ({ ...day, readinessScore: null }))
    const correlations = calculateTagCorrelations(sleepOnly, tags)
    const correlation = correlations.find((item) => item.tag === "late meal")
    const model = mockModel([
      mockEffect({
        tag: "late meal",
        sameDayEffect: -0.4,
        sameDayConfidence: "high"
      })
    ])
    const impact = getDiscoveryImpact(
      correlation,
      { sleepScore: model, readinessScore: null },
      null
    )

    // The naive delta blames late meal for alcohol's damage; the model
    // partialled it to almost nothing, and the discovery card follows.
    expect(impact?.evidence).toBe("adjusted")
    expect(impact?.delta).toBe(-0.4)
    expect(Math.abs(correlation!.deltas.sleepScore!)).toBeGreaterThan(2)
  })

  it("never shows a model value that opposes a significant observed one", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const correlation = correlations.find((item) => item.tag === "alcohol")
    const flipped = mockModel([
      mockEffect({
        tag: "alcohol",
        sameDayEffect: 6,
        sameDayConfidence: "high"
      })
    ])
    const impact = getDiscoveryImpact(
      correlation,
      { sleepScore: flipped, readinessScore: null },
      mockObserved({ "alcohol-sleepScore": "high" })
    )

    expect(impact?.evidence).toBe("observed-conflict")
    expect(impact?.delta).toBeLessThan(0)
    expect(impact?.confidence).toBe("high")
  })

  it("picks the metric with the larger magnitude", () => {
    const { metrics, tags } = buildMixedDiscovery()
    const correlations = calculateTagCorrelations(metrics, tags)
    const impact = getDiscoveryImpact(
      correlations.find((item) => item.tag === "sauna"),
      noModels,
      null
    )

    expect(impact?.metric).toBe("readinessScore")
  })

  it("returns null for a tag with no correlation or no deltas", () => {
    expect(getDiscoveryImpact(undefined, noModels, null)).toBeNull()
  })

  function buildMixedDiscovery() {
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 60; i += 1) {
      const date = isoDate(i)
      const sauna = i % 5 === 0
      if (sauna) tags.push(tagRow(date, "sauna"))
      metrics.push({
        date,
        sleepScore: 70 + (sauna ? 1 : 0),
        readinessScore: 70 + (sauna ? 6 : 0),
        activityScore: null
      } as DailyMetricRow)
    }
    return { metrics, tags }
  }
})

describe("model-side confidence counts", () => {
  // Tagged nights whose score never synced are still tag-days to the
  // correlations but invisible to the model, so the two disagree about how
  // much evidence backs the coefficient. The badge must follow the model.
  function buildPartlyScored() {
    const rng = createSeededRng(21)
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    const tagDays = new Set<number>()
    for (let i = 0; i < 200; i += 10) tagDays.add(i)
    for (let i = 0; i < 200; i += 1) {
      const date = isoDate(i)
      const tagged = tagDays.has(i)
      if (tagged) tags.push(tagRow(date, "focus"))
      // Only every third tagged night carries a score.
      const scoreMissing = tagged && i % 30 !== 0
      metrics.push({
        date,
        sleepScore: scoreMissing
          ? null
          : 70 + (rng() - 0.5) * 4 + (tagged ? 9 : 0),
        readinessScore: null,
        activityScore: null
      } as DailyMetricRow)
    }
    return { metrics, tags }
  }

  it("counts tagged nights the way the model saw them", () => {
    const { metrics, tags } = buildPartlyScored()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const correlation = correlations.find((item) => item.tag === "focus")!
    const effect = model.effects.get("focus")!

    // The premise: the two samples really do disagree.
    expect(correlation.daysWithTag).toBe(20)
    expect(effect.daysWithTag).toBe(7)

    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations,
      null
    )
    const focus = [...adjusted.rewarding, ...adjusted.concerning].find(
      (insight) => insight.tag === "focus"
    )

    expect(focus?.evidence).toBe("adjusted")
    // Seven modeled nights cannot reach the ten the high badge requires.
    // Passing the correlation's twenty would have promoted it.
    expect(focus?.adjustedConfidence).toBe("medium")
  })

  it("uses the model's counts for discoveries too", () => {
    const { metrics, tags } = buildPartlyScored()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const impact = getDiscoveryImpact(
      correlations.find((item) => item.tag === "focus"),
      { sleepScore: model, readinessScore: null },
      null
    )

    expect(impact?.evidence).toBe("adjusted")
    expect(impact?.confidence).toBe("medium")
  })
})
