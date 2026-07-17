import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import {
  calculateInsightConfidence,
  calculateInsightConfidenceMemoized,
  peekInsightConfidence
} from "./insightConfidence"
import { createSeededRng } from "./stats"
import { isoDate, tagRow } from "./testHelpers"

// Builds days of pure noise plus many random tags; optionally one tag with
// a genuine injected sleep effect.
function build(options: {
  days?: number
  nullTags?: number
  seed?: number
  boostTag?: { name: string; effect: number; cadence: number }
}) {
  const days = options.days ?? 250
  const rng = createSeededRng(options.seed ?? 1)
  const tags: TagEntryRow[] = []
  const boostDates = new Set<string>()
  if (options.boostTag) {
    for (let i = 0; i < days; i += options.boostTag.cadence) {
      boostDates.add(isoDate(i))
      tags.push(tagRow(isoDate(i), options.boostTag.name))
    }
  }
  for (let t = 0; t < (options.nullTags ?? 0); t += 1) {
    for (let i = 0; i < days; i += 1) {
      if (rng() < 0.08) tags.push(tagRow(isoDate(i), `null-${t}`))
    }
  }
  const metrics: DailyMetricRow[] = []
  for (let i = 0; i < days; i += 1) {
    const date = isoDate(i)
    metrics.push({
      date,
      sleepScore:
        70 +
        (rng() - 0.5) * 16 +
        (boostDates.has(date) ? (options.boostTag?.effect ?? 0) : 0),
      readinessScore: 70 + (rng() - 0.5) * 16,
      activityScore: null
    } as DailyMetricRow)
  }
  return { metrics, tags }
}

describe("calculateInsightConfidence", () => {
  it("does not give the best-looking null tag a high badge (winner's curse)", () => {
    const { metrics, tags } = build({ nullTags: 25, seed: 7 })
    const model = calculateInsightConfidence(metrics, tags)
    expect(model.familySize).toBe(50)
    for (const result of model.results.values()) {
      expect(result.level).not.toBe("high")
    }
  })

  it("lets a genuine effect survive the family correction", () => {
    const { metrics, tags } = build({
      nullTags: 20,
      seed: 3,
      boostTag: { name: "alcohol", effect: -10, cadence: 5 }
    })
    const model = calculateInsightConfidence(metrics, tags)
    const alcohol = model.results.get("alcohol-sleepScore")!
    expect(alcohol.level).toBe("high")
    expect(alcohol.qValue!).toBeLessThan(0.05)
    // The same tag has no readiness effect and must not ride along.
    expect(model.results.get("alcohol-readinessScore")!.level).not.toBe("high")
  })

  it("keeps q-values at or above p-values", () => {
    const { metrics, tags } = build({
      nullTags: 10,
      boostTag: { name: "mag", effect: 6, cadence: 4 }
    })
    const model = calculateInsightConfidence(metrics, tags)
    for (const result of model.results.values()) {
      if (result.pValue === null || result.qValue === null) continue
      // Allow a float ulp: q = p * m / rank equals p exactly at rank m,
      // give or take rounding.
      expect(result.qValue).toBeGreaterThanOrEqual(result.pValue - 1e-9)
    }
  })

  it("scales resamples so a lone extreme can still reach high in a big family", () => {
    // 30 tags = family of 60: with a fixed 1000 resamples the smoothed
    // p floor times 60 would exceed 0.05 and high would be unreachable.
    const { metrics, tags } = build({
      days: 300,
      nullTags: 29,
      seed: 11,
      boostTag: { name: "strong", effect: -12, cadence: 4 }
    })
    const model = calculateInsightConfidence(metrics, tags)
    expect(model.familySize).toBe(60)
    expect(model.results.get("strong-sleepScore")!.level).toBe("high")
  })

  it("is deterministic and keys by tag-metric", () => {
    const { metrics, tags } = build({ nullTags: 5 })
    const first = calculateInsightConfidence(metrics, tags)
    const second = calculateInsightConfidence(metrics, tags)
    expect(second.results).toEqual(first.results)
    expect([...first.results.keys()].every((key) => /-(sleep|readiness)Score$/.test(key))).toBe(
      true
    )
  })

  it("skips pairs with an empty side", () => {
    const { metrics } = build({})
    // A tag on every single day has no untagged side.
    const everyday: TagEntryRow[] = metrics.map((day) => tagRow(day.date, "daily"))
    const model = calculateInsightConfidence(metrics, everyday)
    expect(model.familySize).toBe(0)
    expect(model.results.size).toBe(0)
  })

  it("memoizes on input identities", () => {
    const { metrics, tags } = build({ nullTags: 3 })
    const first = calculateInsightConfidenceMemoized(metrics, tags)
    expect(calculateInsightConfidenceMemoized(metrics, tags)).toBe(first)
    expect(peekInsightConfidence(metrics, tags)).toBe(first)
    expect(peekInsightConfidence([...metrics], tags)).toBeUndefined()
  })
})
