import type { DailyMetricRow, TagEntryRow } from "../db/types"

import type { PrimaryInsightMetric } from "./correlations"
import { fitRidge, selectRidgeLambda } from "./regression"
import { groupTagsByName } from "./shared"
import { confidenceFromEffectSe, type ConfidenceLevel } from "./stats"

export interface TagEffect {
  tag: string
  daysWithTag: number
  sameDayEffect: number | null
  sameDayConfidence: ConfidenceLevel | null
  nextDayEffect: number | null
  nextDayConfidence: ConfidenceLevel | null
}

export interface TagEffectsModel {
  metric: PrimaryInsightMetric
  effects: Map<string, TagEffect>
  modeledDays: number
  untaggedDays: number
  lambda: number
}

const MIN_MODELED_DAYS = 60
const MIN_UNTAGGED_DAYS = 8
const MIN_TAG_DAYS = 5

// Local calendar shift; src/dashboard/format.ts has the same helper, but the
// analysis layer must not import from the dashboard layer.
function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00`)
  shifted.setDate(shifted.getDate() + days)
  const year = shifted.getFullYear()
  const month = String(shifted.getMonth() + 1).padStart(2, "0")
  const day = String(shifted.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00`).getDay()
}

function dayNumber(date: string) {
  return Date.parse(`${date}T12:00:00`) / 86400000
}

// Fits one ridge model per metric: outcome = intercept + tag effects
// + next-day (lag-1) tag effects + day-of-week + linear trend.
//
// The sample is the full metric history trimmed to the tagging span (first
// to last effective tag date, plus one trailing day so the last tag's
// next-day effect has a target). Untagged days inside the span identify the
// tag coefficients; days outside the span are excluded because an untracked
// era is not a tag-free era and would bias every coefficient.
//
// The caller passes timing-shifted tag entries (effectiveTagEntries), so
// each entry's date is already the day it counts for; the lag-1 column is
// always that date plus one calendar day. Do not special-case the timing
// mode here, or sameDay mode would double shift.
export function calculateTagEffects(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  metric: PrimaryInsightMetric
): TagEffectsModel | null {
  if (tags.length === 0) return null

  let firstTagDate = tags[0].date
  let lastTagDate = tags[0].date
  for (const entry of tags) {
    if (entry.date < firstTagDate) firstTagDate = entry.date
    if (entry.date > lastTagDate) lastTagDate = entry.date
  }
  const sampleEnd = shiftDate(lastTagDate, 1)

  const sampleDays = metrics
    .filter(
      (day) =>
        day.date >= firstTagDate &&
        day.date <= sampleEnd &&
        day[metric] != null
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const modeledDays = sampleDays.length
  if (modeledDays < MIN_MODELED_DAYS) return null

  const datesByTag = groupTagsByName(tags)
  const taggedDates = new Set<string>()
  for (const dates of datesByTag.values()) {
    for (const date of dates) taggedDates.add(date)
  }
  const untaggedDays = sampleDays.filter(
    (day) => !taggedDates.has(day.date)
  ).length
  if (untaggedDays < MIN_UNTAGGED_DAYS) return null

  // Gate columns: a tag needs enough same-day (and separately enough
  // next-day) matches inside the sample, and must not cover every day.
  const sameDayTags: Array<{ tag: string; dates: Set<string>; count: number }> =
    []
  const lagTags: Array<{ tag: string; dates: Set<string>; count: number }> = []
  for (const [tag, dates] of datesByTag) {
    let sameDayCount = 0
    let lagCount = 0
    for (const day of sampleDays) {
      if (dates.has(day.date)) sameDayCount += 1
      if (dates.has(shiftDate(day.date, -1))) lagCount += 1
    }
    if (sameDayCount >= MIN_TAG_DAYS && sameDayCount < modeledDays) {
      sameDayTags.push({ tag, dates, count: sameDayCount })
    }
    if (lagCount >= MIN_TAG_DAYS && lagCount < modeledDays) {
      lagTags.push({ tag, dates, count: lagCount })
    }
  }
  if (sameDayTags.length === 0 && lagTags.length === 0) return null

  const firstDayNumber = dayNumber(sampleDays[0].date)
  const lastDayNumber = dayNumber(sampleDays[modeledDays - 1].date)
  const span = lastDayNumber - firstDayNumber

  const rows: number[][] = []
  const outcomes: number[] = []
  for (const day of sampleDays) {
    const row: number[] = []
    for (const column of sameDayTags) {
      row.push(column.dates.has(day.date) ? 1 : 0)
    }
    for (const column of lagTags) {
      row.push(column.dates.has(shiftDate(day.date, -1)) ? 1 : 0)
    }
    // Day-of-week dummies, Monday through Saturday, Sunday as reference.
    const weekday = dayOfWeek(day.date)
    for (let dow = 1; dow <= 6; dow += 1) row.push(weekday === dow ? 1 : 0)
    row.push(span === 0 ? 0 : (dayNumber(day.date) - firstDayNumber) / span)
    rows.push(row)
    outcomes.push(day[metric] as number)
  }

  const lambda = selectRidgeLambda(rows, outcomes)
  const fit = fitRidge(rows, outcomes, { lambda })
  if (fit === null) return null

  const effects = new Map<string, TagEffect>()
  const effectFor = (tag: string): TagEffect => {
    const existing = effects.get(tag)
    if (existing) return existing
    const created: TagEffect = {
      tag,
      daysWithTag: 0,
      sameDayEffect: null,
      sameDayConfidence: null,
      nextDayEffect: null,
      nextDayConfidence: null
    }
    effects.set(tag, created)
    return created
  }
  sameDayTags.forEach((column, index) => {
    const effect = effectFor(column.tag)
    effect.daysWithTag = column.count
    effect.sameDayEffect = fit.coefficients[index]
    effect.sameDayConfidence = confidenceFromEffectSe(
      fit.coefficients[index],
      fit.standardErrors[index],
      column.count,
      modeledDays - column.count
    )
  })
  lagTags.forEach((column, lagIndex) => {
    const index = sameDayTags.length + lagIndex
    const effect = effectFor(column.tag)
    if (effect.daysWithTag === 0) {
      effect.daysWithTag = sampleDays.filter((day) =>
        column.dates.has(day.date)
      ).length
    }
    effect.nextDayEffect = fit.coefficients[index]
    effect.nextDayConfidence = confidenceFromEffectSe(
      fit.coefficients[index],
      fit.standardErrors[index],
      column.count,
      modeledDays - column.count
    )
  })

  return { metric, effects, modeledDays, untaggedDays, lambda }
}

// The dashboard recomputes reactive blocks on unrelated state changes, so
// memoize on input identities; DashboardPage only replaces the arrays when
// the underlying data or analysis settings actually change.
const memo = new Map<
  PrimaryInsightMetric,
  {
    metrics: DailyMetricRow[]
    tags: TagEntryRow[]
    result: TagEffectsModel | null
  }
>()

export function calculateTagEffectsMemoized(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  metric: PrimaryInsightMetric
): TagEffectsModel | null {
  const cached = peekTagEffects(metrics, tags, metric)
  if (cached !== undefined) return cached
  const result = calculateTagEffects(metrics, tags, metric)
  memo.set(metric, { metrics, tags, result })
  return result
}

// Returns the memoized model without computing: the result (possibly null,
// when the data is below the model gates) on a cache hit, undefined on a
// miss. Lets the view skip its deferred "computing" state on remounts.
export function peekTagEffects(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  metric: PrimaryInsightMetric
): TagEffectsModel | null | undefined {
  const cached = memo.get(metric)
  if (cached && cached.metrics === metrics && cached.tags === tags) {
    return cached.result
  }
  return undefined
}
