import { describe, expect, it } from "vitest"

import type { DailyMetricRow, TagEntryRow } from "../db/types"

import {
  adjustedHeadlineEffect,
  adjustedHeadlineEffectWithSe,
  calculateTagEffects,
  calculateTagEffectsMemoized,
  combinedGuardedSameDayEffect,
  combinedGuardedSameDayEffectWithSe,
  peekTagEffects,
  type TagEffect,
  type TagEffectsModel
} from "./tagEffects"
import { confidenceFromEffectSe, createSeededRng } from "./stats"
import { isoDate, shiftIso, tagRow } from "./testHelpers"

function metricRow(date: string, sleepScore: number | null): DailyMetricRow {
  return {
    date,
    sleepScore,
    readinessScore: null,
    activityScore: null
  } as DailyMetricRow
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

describe("annual seasonality controls", () => {
  // Two years of data with a strong annual sleep rhythm and a tag logged
  // only during the high season.
  function buildSeasonal(options: { tagEffect: number; seed?: number }) {
    const rng = createSeededRng(options.seed ?? 21)
    const metrics: DailyMetricRow[] = []
    const tags: TagEntryRow[] = []
    for (let i = 0; i < 730; i += 1) {
      const date = isoDate(i)
      const season = Math.sin((2 * Math.PI * i) / 365.25)
      const tagged = season > 0.5 && i % 3 === 0
      if (tagged) tags.push(tagRow(date, "winter habit"))
      metrics.push(
        metricRow(
          date,
          70 +
            season * 6 +
            (tagged ? options.tagEffect : 0) +
            (rng() - 0.5) * 4
        )
      )
    }
    return { metrics, tags }
  }

  it("absorbs a seasonal rhythm instead of crediting a season-bound tag", () => {
    const { metrics, tags } = buildSeasonal({ tagEffect: 0 })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const effect = model.effects.get("winter habit")!
    // Without the sin/cos columns this tag would soak up several points of
    // the +6 seasonal swing it always co-occurs with.
    expect(Math.abs(effect.sameDayEffect!)).toBeLessThan(1.5)
  })

  it("still recovers a real effect from a season-bound tag", () => {
    const { metrics, tags } = buildSeasonal({ tagEffect: 7 })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const effect = model.effects.get("winter habit")!
    expect(effect.sameDayEffect!).toBeGreaterThan(4)
  })
})

describe("activity metric support", () => {
  it("recovers an injected activity effect", () => {
    const { metrics, tags } = build({ tagEvery: { gym: 4 } })
    const withActivity = metrics.map((day, index) => ({
      ...day,
      activityScore:
        60 + (index % 7) + (index % 4 === 0 && day.sleepScore !== null ? 9 : 0)
    }))
    const model = calculateTagEffects(withActivity, tags, "activityScore")
    expect(model).not.toBeNull()
    expect(model!.metric).toBe("activityScore")
    const gym = model!.effects.get("gym")!
    expect(gym.sameDayEffect).toBeGreaterThan(5)
  })

  it("memoizes the three metrics independently", () => {
    const { metrics, tags } = build({ tagEvery: { gym: 4 } })
    const withActivity = metrics.map((day) => ({ ...day, activityScore: 60 }))
    const sleep = calculateTagEffectsMemoized(withActivity, tags, "sleepScore")
    const activity = calculateTagEffectsMemoized(
      withActivity,
      tags,
      "activityScore"
    )
    expect(peekTagEffects(withActivity, tags, "sleepScore")).toBe(sleep)
    expect(peekTagEffects(withActivity, tags, "activityScore")).toBe(activity)
    expect(peekTagEffects(withActivity, tags, "readinessScore")).toBe(
      undefined
    )
  })
})

function guardEffect(partial: Partial<TagEffect> & { tag: string }): TagEffect {
  return {
    daysWithTag: 20,
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

function guardModel(effects: TagEffect[]): TagEffectsModel {
  return {
    metric: "sleepScore",
    effects: new Map(effects.map((effect) => [effect.tag, effect])),
    modeledDays: 200,
    untaggedDays: 60,
    lambda: 4,
    covariance: null
  }
}

describe("adjustedHeadlineEffect", () => {
  it("sums only medium-plus components", () => {
    expect(
      adjustedHeadlineEffect(
        guardEffect({
          tag: "a",
          sameDayEffect: 3,
          sameDayConfidence: "high",
          nextDayEffect: 2,
          nextDayConfidence: "medium"
        })
      )
    ).toBe(5)
    // A low-confidence next-day component must not swing the headline.
    expect(
      adjustedHeadlineEffect(
        guardEffect({
          tag: "a",
          sameDayEffect: 3,
          sameDayConfidence: "medium",
          nextDayEffect: 4,
          nextDayConfidence: "low"
        })
      )
    ).toBe(3)
    expect(
      adjustedHeadlineEffect(
        guardEffect({
          tag: "a",
          sameDayEffect: 3,
          sameDayConfidence: "low",
          nextDayEffect: -2,
          nextDayConfidence: "medium"
        })
      )
    ).toBe(-2)
  })

  it("returns null when no component is trustworthy or present", () => {
    expect(adjustedHeadlineEffect(null)).toBeNull()
    expect(adjustedHeadlineEffect(undefined)).toBeNull()
    expect(
      adjustedHeadlineEffect(
        guardEffect({
          tag: "a",
          sameDayEffect: 3,
          sameDayConfidence: "low",
          nextDayEffect: 4,
          nextDayConfidence: "low"
        })
      )
    ).toBeNull()
    expect(adjustedHeadlineEffect(guardEffect({ tag: "a" }))).toBeNull()
  })
})

describe("combinedGuardedSameDayEffect", () => {
  const model = guardModel([
    guardEffect({ tag: "solid", sameDayEffect: 4, sameDayConfidence: "high" }),
    guardEffect({ tag: "shaky", sameDayEffect: 3, sameDayConfidence: "low" }),
    guardEffect({
      tag: "second",
      sameDayEffect: -1,
      sameDayConfidence: "medium"
    })
  ])

  it("sums medium-plus same-day coefficients over the selection", () => {
    expect(combinedGuardedSameDayEffect(model, ["solid"])).toBe(4)
    expect(combinedGuardedSameDayEffect(model, ["solid", "second"])).toBe(3)
  })

  it("returns null when any selected tag lacks a trustworthy coefficient", () => {
    expect(combinedGuardedSameDayEffect(model, ["solid", "shaky"])).toBeNull()
    expect(combinedGuardedSameDayEffect(model, ["missing"])).toBeNull()
    expect(combinedGuardedSameDayEffect(model, [])).toBeNull()
    expect(combinedGuardedSameDayEffect(null, ["solid"])).toBeNull()
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


describe("standard errors for summed effects", () => {
  it("prices a pair of near-independent tags like independent errors", () => {
    // Cadences 4 and 5 only coincide every 20 days, so the two columns are
    // almost uncorrelated and the sum's error should land near the
    // root-sum-of-squares of the parts.
    const { metrics, tags } = build({
      days: 300,
      tagEvery: { alpha: 4, beta: 5 },
      sameDayBoost: { alpha: -8, beta: 6 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const alpha = model.effects.get("alpha")!
    const beta = model.effects.get("beta")!
    const combined = combinedGuardedSameDayEffectWithSe(model, [
      "alpha",
      "beta"
    ])!
    const independent = Math.hypot(
      alpha.sameDayStandardError!,
      beta.sameDayStandardError!
    )

    expect(combined.effect).toBeCloseTo(
      alpha.sameDayEffect! + beta.sameDayEffect!,
      10
    )
    expect(combined.standardError! / independent).toBeGreaterThan(0.85)
    expect(combined.standardError! / independent).toBeLessThan(1.15)
  })

  it("prices an identical-twin pair above the independent-errors guess", () => {
    // Two tags always logged on the same nights are one column as far as the
    // fit is concerned: it splits the effect evenly and noise moves both
    // halves together, so their errors add rather than cancel. Treating the
    // pair as independent would understate how loose the sum really is,
    // which is the case a diagonal-only fit gets backwards.
    const { metrics, tags } = build({
      days: 300,
      tagEvery: { twinA: 4, twinB: 4 },
      sameDayBoost: { twinA: -4, twinB: -4 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const first = model.effects.get("twinA")!
    const second = model.effects.get("twinB")!
    const combined = combinedGuardedSameDayEffectWithSe(model, [
      "twinA",
      "twinB"
    ])!
    const independent = Math.hypot(
      first.sameDayStandardError!,
      second.sameDayStandardError!
    )

    expect(combined.standardError!).toBeGreaterThan(independent)
    expect(
      model.covariance![first.sameDayIndex!][second.sameDayIndex!]
    ).toBeGreaterThan(0)
  })

  it("prices the steady-state sum of a tag's own two coefficients", () => {
    const { metrics, tags } = build({
      days: 300,
      tagEvery: { magnesium: 4 },
      sameDayBoost: { magnesium: 5 },
      nextDayBoost: { magnesium: 4 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const effect = model.effects.get("magnesium")!
    const headline = adjustedHeadlineEffectWithSe(model, "magnesium")!

    expect(headline.effect).toBe(adjustedHeadlineEffect(effect))
    expect(headline.standardError).not.toBeNull()
    expect(headline.standardError!).toBeGreaterThan(0)
    // The sum is priced from the covariance, not from either component or
    // from treating the two as unrelated.
    expect(headline.standardError).not.toBe(effect.sameDayStandardError)
    expect(headline.standardError).not.toBe(effect.nextDayStandardError)
  })

  it("agrees with the scalar helpers and keeps their null semantics", () => {
    const { metrics, tags } = build({
      days: 300,
      tagEvery: { alpha: 4, beta: 5 },
      sameDayBoost: { alpha: -8 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!

    expect(combinedGuardedSameDayEffectWithSe(model, ["alpha"])?.effect).toBe(
      combinedGuardedSameDayEffect(model, ["alpha"])
    )
    // "beta" has no real effect, so it never earns a trusted coefficient and
    // the whole selection stays null rather than reporting a partial sum.
    expect(model.effects.get("beta")?.sameDayConfidence).not.toBe("high")
    expect(combinedGuardedSameDayEffectWithSe(model, ["alpha", "unknown"])).toBeNull()
    expect(combinedGuardedSameDayEffectWithSe(model, [])).toBeNull()
    expect(combinedGuardedSameDayEffectWithSe(null, ["alpha"])).toBeNull()
    expect(adjustedHeadlineEffectWithSe(model, "unknown")).toBeNull()
    expect(adjustedHeadlineEffectWithSe(null, "alpha")).toBeNull()
  })

  it("reports no standard error when the fit produced no covariance", () => {
    const { metrics, tags } = build({
      days: 300,
      tagEvery: { alpha: 4 },
      sameDayBoost: { alpha: -8 }
    })
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const without: TagEffectsModel = { ...model, covariance: null }

    expect(combinedGuardedSameDayEffectWithSe(without, ["alpha"])).toEqual({
      effect: combinedGuardedSameDayEffect(model, ["alpha"]),
      standardError: null
    })
  })
})

describe("coefficient confidence multiplicity", () => {
  // Many tags, none with any real effect: the fit will still hand one of
  // them the largest z-score by chance, and that is the tag the product
  // would otherwise present as a trustworthy finding.
  function buildNoiseTags(tagCount: number, seed: number) {
    const tagEvery: Record<string, number> = {}
    for (let i = 0; i < tagCount; i += 1) {
      tagEvery[`noise${i}`] = 3 + (i % 9)
    }
    return build({ days: 300, seed, tagEvery, noiseSpread: 6 })
  }

  it("does not trust the luckiest coefficient in a family of noise", () => {
    const { metrics, tags } = buildNoiseTags(24, 13)
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const effects = [...model.effects.values()]

    // Left uncorrected, the luckiest of these ~48 coefficients clears the
    // medium bar on its own z-score, and medium is the bar the guarded
    // helpers treat as trustworthy, so a pure-noise tag would reach the
    // Insights cards and the Optimal sums as a real finding.
    const uncorrected = effects.map((effect) =>
      confidenceFromEffectSe(
        effect.sameDayEffect ?? 0,
        effect.sameDayStandardError ?? 0,
        effect.daysWithTag,
        model.modeledDays - effect.daysWithTag
      )
    )
    expect(uncorrected).toContain("medium")

    // After the family correction none of them is trusted, so every tag
    // falls back to its observed effect instead.
    for (const effect of effects) {
      expect(effect.sameDayConfidence).toBe("low")
      expect(adjustedHeadlineEffect(effect)).toBeNull()
    }
  })

  it("still trusts one clearly real effect standing among noise", () => {
    const { metrics, tags } = buildNoiseTags(24, 12)
    const realDates = new Set<string>()
    for (let i = 0; i < 300; i += 4) realDates.add(isoDate(i))
    for (const date of realDates) tags.push(tagRow(date, "alcohol"))
    const shifted = metrics.map((day) =>
      realDates.has(day.date)
        ? metricRow(day.date, (day.sleepScore ?? 0) - 12)
        : day
    )
    const model = calculateTagEffects(shifted, tags, "sleepScore")!

    expect(model.effects.get("alcohol")?.sameDayConfidence).toBe("high")
  })

  it("only ever demotes a coefficient relative to its own z-score", () => {
    // BH raises p to q, never lowers it, so a tag the corrected badge trusts
    // would always have been trusted uncorrected too. That direction is what
    // keeps the sign guard safe: a demoted coefficient falls back to the
    // observed effect rather than newly overruling it.
    const { metrics, tags } = buildNoiseTags(16, 13)
    const model = calculateTagEffects(metrics, tags, "sleepScore")!
    const rank = { low: 0, medium: 1, high: 2 }

    for (const effect of model.effects.values()) {
      if (effect.sameDayEffect === null) continue
      const uncorrected = confidenceFromEffectSe(
        effect.sameDayEffect,
        effect.sameDayStandardError ?? 0,
        effect.daysWithTag,
        model.modeledDays - effect.daysWithTag
      )
      expect(rank[effect.sameDayConfidence ?? "low"]).toBeLessThanOrEqual(
        rank[uncorrected]
      )
    }
  })
})
