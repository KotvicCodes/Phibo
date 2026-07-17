import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import {
  calculateTagCorrelations,
  getRankedTagInsights
} from "./correlations"
import { getAdjustedTagInsights } from "./insightRanking"
import { createSeededRng } from "./stats"
import {
  calculateTagEffects,
  type TagEffect,
  type TagEffectsModel
} from "./tagEffects"

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
    id: `ir-${tagId}`,
    date,
    tag,
    comment: null,
    sourceUpdatedAt: null,
    syncedAt: "2026-01-01T00:00:00Z"
  }
}

function mockEffect(partial: Partial<TagEffect> & { tag: string }): TagEffect {
  return {
    daysWithTag: 30,
    sameDayEffect: null,
    sameDayConfidence: null,
    nextDayEffect: null,
    nextDayConfidence: null,
    ...partial
  }
}

function mockModel(effects: TagEffect[]): TagEffectsModel {
  return {
    metric: "sleepScore",
    effects: new Map(effects.map((effect) => [effect.tag, effect])),
    modeledDays: 200,
    untaggedDays: 60,
    lambda: 4
  }
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
  it("drops a confounded tag the naive ranking blames", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const naive = getRankedTagInsights(correlations)
    const naiveTags = naive.concerning.map((insight) => insight.tag)
    expect(naiveTags).toContain("alcohol")
    expect(naiveTags).toContain("late meal")

    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(model).not.toBeNull()
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations
    )
    const adjustedTags = adjusted.concerning.map((insight) => insight.tag)
    expect(adjustedTags).toContain("alcohol")
    expect(adjustedTags).not.toContain("late meal")
  })

  it("returns exactly the naive ranking when both models are null", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    expect(
      getAdjustedTagInsights(
        { sleepScore: null, readinessScore: null },
        correlations
      )
    ).toEqual(getRankedTagInsights(correlations))
  })

  it("ranks by the steady-state effect including next-day carry-over", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({ tag: "alcohol", sameDayEffect: 2, nextDayEffect: 2 }),
      mockEffect({ tag: "late meal", sameDayEffect: 1.2 })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations
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

  it("counts a lag-only effect and skips tags with no coefficients", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const model = mockModel([
      mockEffect({ tag: "alcohol", nextDayEffect: -3 }),
      mockEffect({ tag: "late meal" })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations
    )
    expect(adjusted.concerning.map((insight) => insight.tag)).toEqual([
      "alcohol"
    ])
  })

  it("shows analysis-sample nights on adjusted candidates", () => {
    const { metrics, tags } = buildConfounded()
    const correlations = calculateTagCorrelations(metrics, tags)
    const analysisNights = correlations.find(
      (correlation) => correlation.tag === "alcohol"
    )!.daysWithTag
    const model = mockModel([
      mockEffect({ tag: "alcohol", sameDayEffect: -5, daysWithTag: 999 })
    ])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations
    )
    expect(adjusted.concerning[0].daysWithTag).toBe(analysisNights)
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
    const model = mockModel([])
    const adjusted = getAdjustedTagInsights(
      { sleepScore: model, readinessScore: null },
      correlations
    )
    const sauna = adjusted.rewarding.find((insight) => insight.tag === "sauna")
    expect(sauna?.metric).toBe("readinessScore")
  })
})
