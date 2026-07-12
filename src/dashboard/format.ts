import type { PrimaryInsightMetric } from "../lib/analysis/correlations"

// Local calendar date, not UTC: toISOString would report yesterday
// between local midnight and the UTC offset.
export function formatInputDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${date.getFullYear()}-${month}-${day}`
}

export function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)

  return date
}

export function shiftDate(date: string, days: number) {
  const shiftedDate = new Date(`${date}T12:00:00`)
  shiftedDate.setDate(shiftedDate.getDate() + days)

  return formatInputDate(shiftedDate)
}

export function calendarDateAtNoon(date: string) {
  return new Date(`${date}T12:00:00`)
}

export function formatMonth(date: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short"
  }).format(new Date(`${date}T12:00:00`))
}

export function formatConnectionDate(value: string | null | undefined) {
  if (!value) {
    return "Not yet"
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  }).format(new Date(value))
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short"
  }).format(new Date(`${date}T12:00:00`))
}

export function formatSleepNightDate(metricDate: string) {
  return formatDate(shiftDate(metricDate, -1))
}

export { average } from "../lib/analysis/shared"

export function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`
}

export function formatNullableDelta(value: number | null, suffix = "") {
  return value === null ? "n/a" : `${formatDelta(value)}${suffix}`
}

export function formatComparisonAverage(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value)}`
}

export function formatMetricDelta(value: number | null) {
  return value === null ? "n/a" : formatDelta(value)
}

export function formatScoreTrend(value: number | null) {
  if (value === null) {
    return "needs last week"
  }

  if (Math.abs(value) < 0.1) {
    return "same as last week"
  }

  return `${Math.abs(value).toFixed(1)} ${value > 0 ? "higher" : "lower"} than last week`
}

export function comparisonWidth(value: number | null) {
  return `${Math.max(0, Math.min(value ?? 0, 100))}%`
}

export function metricLabel(metric: PrimaryInsightMetric) {
  return metric === "sleepScore" ? "Sleep" : "Readiness"
}

export function metricPlainLabel(metric: PrimaryInsightMetric) {
  return metric === "sleepScore" ? "sleep score" : "readiness"
}
