import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import {
  calculateTagEffects,
  calculateTagEffectsMemoized,
  combinedAdjustedEffect,
  peekTagEffects
} from "./tagEffects"
import { createSeededRng } from "./stats"

function isoDate(dayIndex: number, start = "2026-01-01") {
  const date = new Date(`${start}T12:00:00`)
  date.setDate(date.getDate() + dayIndex)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function metricRow(date: string, sleepScore: number | null): DailyMetricRow {
  return {
    date,
    sleepScore,
    readinessScore: null,
    activityScore: null
  } as DailyMetricRow
}

let tagId = 0
function tagRow(date: string, tag: string): TagEntryRow {
  tagId += 1
  return {
    id: `test-${tagId}`,
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
  tagEvery?: Record<string, number>
  sameDayBoost?: Record<string, number>
  nextDayBoost?: Record<string, number>
  mondayBoost?: number
  skipMetricDates?: string[]
}

// Builds a synthetic history: tags land on a fixed cadence and inject
// same-day or next-day score effects, on top of seeded noise.
function build(options: BuildOptions) {
  const days = options.days ?? 120
  const base = options.base ?? 70
  const rng = createSeededRng(options.seed ?? 1)
  const spread = options.noiseSpread ?? 4
  const metrics: DailyMetricRow[] = []
  const tags: TagEntryRow[] = []
  const tagDates = new Map<string, Set<string>>()
  for (const [tag, cadence] of Object.entries(options.tagEvery ?? {})) {
    const dates = new Set<string>()
    for (let i = 0; i < days; i += cadence) dates.add(isoDate(i))
    tagDates.set(tag, dates)
    for (const date of dates) tags.push(tagRow(date, tag))
  }
  for (let i = 0; i <= days; i += 1) {
    const date = isoDate(i)
    if (options.skipMetricDates?.includes(date)) continue
    let score = base + (rng() - 0.5) * spread
    for (const [tag, boost] of Object.entries(options.sameDayBoost ?? {})) {
      if (tagDates.get(tag)?.has(date)) score += boost
    }
    for (const [tag, boost] of Object.entries(options.nextDayBoost ?? {})) {
      if (tagDates.get(tag)?.has(isoDate(i - 1))) score += boost
    }
    if (options.mondayBoost && new Date(`${date}T12:00:00`).getDay() === 1) {
      score += options.mondayBoost
    }
    metrics.push(metricRow(date, score))
  }
  return { metrics, tags }
}

describe("calculateTagEffects", () => {
  it("recovers a same-day effect in score points", () => {
    const { metrics, tags } = build({
      tagEvery: { alcohol: 4 },
      sameDayBoost: { alcohol: -8 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(model).not.toBeNull()
    const effect = model!.effects.get("alcohol")!
    expect(effect.sameDayEffect).toBeLessThan(-5)
    expect(effect.sameDayEffect).toBeGreaterThan(-11)
    expect(effect.daysWithTag).toBe(30)
  })

  it("lands a day-after effect on the lag coefficient, not the same-day one", () => {
    const { metrics, tags } = build({
      tagEvery: { magnesium: 4 },
      nextDayBoost: { magnesium: 7 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const effect = model.effects.get("magnesium")!
    expect(effect.nextDayEffect).toBeGreaterThan(4)
    expect(Math.abs(effect.sameDayEffect ?? 0)).toBeLessThan(2)
  })

  it("matches lag by calendar date, not the previous metric row", () => {
    // Every day right after a tag is missing from the metrics. Calendar
    // matching then finds zero lag targets and gates the lag column out
    // entirely. Matching by previous row instead would treat each
    // two-days-later row as a lag hit (its previous row is the tag day)
    // and produce a lag estimate.
    const tagDayIndices = Array.from({ length: 30 }, (_, i) => i * 4)
    const { metrics, tags } = build({
      days: 120,
      tagEvery: { melatonin: 4 },
      nextDayBoost: { melatonin: 9 },
      skipMetricDates: tagDayIndices.map((i) => isoDate(i + 1))
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(model).not.toBeNull()
    expect(model!.effects.get("melatonin")?.nextDayEffect ?? null).toBeNull()
  })

  it("is unchanged by duplicate same-day tag entries", () => {
    const { metrics, tags } = build({
      tagEvery: { coffee: 3 },
      sameDayBoost: { coffee: -5 }
    })
    const base = calculateTagEffects(metrics, tags, "sleepScore")
    const duplicated = [...tags, ...tags.slice(0, 10).map((t) => tagRow(t.date, t.tag))]
    const withDuplicates = calculateTagEffects(metrics, duplicated, "sleepScore")
    expect(withDuplicates).toEqual(base)
  })

  it("absorbs a weekday effect into the day-of-week dummies", () => {
    // "gym" lands only on Mondays, and Mondays carry a +6 boost that has
    // nothing to do with the tag. The dummy should soak up most of it.
    const { metrics, tags } = build({
      days: 180,
      tagEvery: { gym: 7 },
      mondayBoost: 6,
      seed: 5
    })
    // Cadence 7 from day 0 (Thursday 2026-01-01): shift tags onto Mondays.
    const mondayTags = tags.map((entry) => {
      const date = new Date(`${entry.date}T12:00:00`)
      const offset = (1 - date.getDay() + 7) % 7
      return tagRow(shiftIso(entry.date, offset), "gym")
    })
    const model = calculateTagEffects(metrics, mondayTags, "sleepScore")!
    const effect = model.effects.get("gym")!
    expect(Math.abs(effect.sameDayEffect ?? 99)).toBeLessThan(3)
  })

  it("splits the effect across always-co-occurring tags", () => {
    const { metrics, tags } = build({
      tagEvery: { wine: 4 },
      sameDayBoost: { wine: -8 }
    })
    const paired = [...tags, ...tags.map((t) => tagRow(t.date, "party"))]
    const model = calculateTagEffects(metrics, paired, "sleepScore")!
    const wine = model.effects.get("wine")!
    const party = model.effects.get("party")!
    expect(wine.sameDayEffect).toBeCloseTo(party.sameDayEffect!, 4)
    expect(wine.sameDayEffect! + party.sameDayEffect!).toBeLessThan(-4)
  })

  it("returns null below the modeled-days gate", () => {
    const { metrics, tags } = build({ days: 40, tagEvery: { coffee: 3 } })
    expect(calculateTagEffects(metrics, tags, "sleepScore")).toBeNull()
  })

  it("returns null when almost every day is tagged", () => {
    const { metrics, tags } = build({ days: 120, tagEvery: { coffee: 1 } })
    expect(calculateTagEffects(metrics, tags, "sleepScore")).toBeNull()
  })

  it("returns null when there are no tags", () => {
    const { metrics } = build({ days: 120 })
    expect(calculateTagEffects(metrics, [], "sleepScore")).toBeNull()
  })

  it("omits tags under the minimum day count", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const rare = [...tags, tagRow(isoDate(10), "sauna"), tagRow(isoDate(50), "sauna")]
    const model = calculateTagEffects(metrics, rare, "sleepScore")!
    expect(model.effects.has("sauna")).toBe(false)
    expect(model.effects.has("coffee")).toBe(true)
  })

  it("ignores an untagged era before tagging started", () => {
    const { metrics, tags } = build({
      days: 150,
      tagEvery: { alcohol: 4 },
      sameDayBoost: { alcohol: -8 }
    })
    const trimmed = calculateTagEffects(metrics, tags, "sleepScore")!
    // A long earlier era with much lower scores, no tags logged.
    const era: DailyMetricRow[] = []
    for (let i = 1; i <= 200; i += 1) {
      era.push(metricRow(isoDate(-i), 40))
    }
    const withEra = calculateTagEffects([...era, ...metrics], tags, "sleepScore")!
    expect(withEra.modeledDays).toBe(trimmed.modeledDays)
    expect(withEra.effects.get("alcohol")!.sameDayEffect).toBeCloseTo(
      trimmed.effects.get("alcohol")!.sameDayEffect!,
      8
    )
  })

  it("reacts to low-score untagged days inside the tagging span", () => {
    const { metrics, tags } = build({
      days: 150,
      tagEvery: { alcohol: 4 },
      sameDayBoost: { alcohol: -8 }
    })
    const inSpan = metrics.map((day, index) =>
      index % 4 === 2 ? metricRow(day.date, 40) : day
    )
    const base = calculateTagEffects(metrics, tags, "sleepScore")!
    const shifted = calculateTagEffects(inSpan, tags, "sleepScore")!
    expect(shifted.effects.get("alcohol")!.sameDayEffect).not.toBeCloseTo(
      base.effects.get("alcohol")!.sameDayEffect!,
      1
    )
  })

  it("includes the day after the last tag so its next-day effect has a target", () => {
    const { metrics, tags } = build({
      days: 120,
      tagEvery: { magnesium: 4 },
      nextDayBoost: { magnesium: 7 }
    })
    // Tag cadence 4 over 120 days: last tag is day 116, metrics run to 120.
    const lastTag = tags.map((t) => t.date).sort().at(-1)!
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const dayAfter = shiftIso(lastTag, 1)
    expect(metrics.some((m) => m.date === dayAfter)).toBe(true)
    expect(model.modeledDays).toBe(
      metrics.filter((m) => m.date >= tags[0].date && m.date <= dayAfter).length
    )
  })

  it("skips days whose outcome metric is null", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const withNulls = metrics.map((day, index) =>
      index % 5 === 0 ? metricRow(day.date, null) : day
    )
    const model = calculateTagEffects(withNulls, tags, "sleepScore")
    expect(model).not.toBeNull()
    expect(model!.modeledDays).toBeLessThan(metrics.length)
  })

  it("reports untagged days within the span", () => {
    const { metrics, tags } = build({ days: 99, tagEvery: { coffee: 3 } })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    expect(model.untaggedDays).toBe(model.modeledDays - 33)
  })
})

describe("combinedAdjustedEffect", () => {
  it("sums the same-day coefficients of the selected tags", () => {
    const { metrics, tags } = build({
      tagEvery: { alcohol: 4 },
      sameDayBoost: { alcohol: -8 }
    })
    const withSecond = [
      ...tags,
      ...Array.from({ length: 40 }, (_, i) => tagRow(isoDate(i * 3 + 1), "coffee"))
    ]
    const model = calculateTagEffects(metrics, withSecond, "sleepScore")!
    const alcohol = model.effects.get("alcohol")!.sameDayEffect!
    const coffee = model.effects.get("coffee")!.sameDayEffect!
    expect(combinedAdjustedEffect(model, ["alcohol"])).toBe(alcohol)
    expect(combinedAdjustedEffect(model, ["alcohol", "coffee"])).toBeCloseTo(
      alcohol + coffee,
      10
    )
  })

  it("returns null for a null model or empty selection", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(combinedAdjustedEffect(null, ["coffee"])).toBeNull()
    expect(combinedAdjustedEffect(model, [])).toBeNull()
  })

  it("returns null when any selected tag is unknown to the model", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    expect(combinedAdjustedEffect(model, ["coffee", "sauna"])).toBeNull()
  })

  it("returns null for a tag with only a lag coefficient", () => {
    // Metric rows are missing on every tag day but present the day after:
    // the same-day column is gated out, the lag column survives.
    const tagDayIndices = Array.from({ length: 30 }, (_, i) => i * 4)
    const { metrics, tags } = build({
      days: 120,
      tagEvery: { melatonin: 4 },
      nextDayBoost: { melatonin: 7 },
      skipMetricDates: tagDayIndices.map((i) => isoDate(i))
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")
    expect(model).not.toBeNull()
    const effect = model!.effects.get("melatonin")
    expect(effect?.nextDayEffect).not.toBeNull()
    expect(effect?.sameDayEffect ?? null).toBeNull()
    expect(combinedAdjustedEffect(model, ["melatonin"])).toBeNull()
  })
})

describe("calculateTagEffectsMemoized", () => {
  it("returns the same object for identical inputs and recomputes on change", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const first = calculateTagEffectsMemoized(metrics, tags, "sleepScore")
    const second = calculateTagEffectsMemoized(metrics, tags, "sleepScore")
    expect(second).toBe(first)
    const third = calculateTagEffectsMemoized([...metrics], tags, "sleepScore")
    expect(third).not.toBe(first)
    expect(third).toEqual(first)
  })

  it("peek returns undefined on a miss and the cached result on a hit", () => {
    const { metrics, tags } = build({ tagEvery: { tea: 3 } })
    expect(peekTagEffects(metrics, tags, "sleepScore")).toBeUndefined()
    const computed = calculateTagEffectsMemoized(metrics, tags, "sleepScore")
    expect(peekTagEffects(metrics, tags, "sleepScore")).toBe(computed)
    expect(peekTagEffects([...metrics], tags, "sleepScore")).toBeUndefined()
  })

  it("peek distinguishes a cached null from a miss", () => {
    const { metrics, tags } = build({ days: 40, tagEvery: { tea: 3 } })
    expect(peekTagEffects(metrics, tags, "sleepScore")).toBeUndefined()
    expect(calculateTagEffectsMemoized(metrics, tags, "sleepScore")).toBeNull()
    expect(peekTagEffects(metrics, tags, "sleepScore")).toBeNull()
  })

  it("caches per metric independently", () => {
    const { metrics, tags } = build({ tagEvery: { coffee: 3 } })
    const sleep = calculateTagEffectsMemoized(metrics, tags, "sleepScore")
    const readiness = calculateTagEffectsMemoized(metrics, tags, "readinessScore")
    expect(sleep).not.toBeNull()
    expect(readiness).toBeNull()
    expect(calculateTagEffectsMemoized(metrics, tags, "sleepScore")).toBe(sleep)
  })
})

function shiftIso(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00`)
  shifted.setDate(shifted.getDate() + days)
  const year = shifted.getFullYear()
  const month = String(shifted.getMonth() + 1).padStart(2, "0")
  const day = String(shifted.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
