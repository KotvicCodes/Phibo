import type {
  ExploreMetricDefinition,
  ExploreMetricImpact
} from "../lib/analysis/correlations"
import { formatDelta } from "./format"

export function metricAxisLabel(metric: ExploreMetricDefinition) {
  // Scores have no meaningful unit and bedtime hours render as clock times,
  // so neither gets a unit suffix.
  if (metric.unit === "pts" || metric.unit === "h") {
    return metric.label
  }

  if (metric.displayAsHours) {
    return `${metric.label} (h)`
  }

  return `${metric.label} (${metric.unit})`
}

// Bedtime metrics store hours on a past-noon clock (00:30 is 24.5, 06:00 is
// 30) so averages around midnight do not wrap. Display them as wall-clock
// time instead of the raw shifted number.
export function formatClockHour(value: number) {
  const normalized = ((value % 24) + 24) % 24
  const totalMinutes = Math.round(normalized * 60)
  const hours = Math.floor(totalMinutes / 60) % 24
  const minutes = totalMinutes % 60

  return `${`${hours}`.padStart(2, "0")}:${`${minutes}`.padStart(2, "0")}`
}

// Turns stored minutes into a readable duration: 444 becomes "7h 24m",
// 45 stays "45m", 420 becomes "7h".
export function formatHoursMinutes(minutes: number) {
  const sign = minutes < 0 ? "-" : ""
  const totalMinutes = Math.round(Math.abs(minutes))
  const hours = Math.floor(totalMinutes / 60)
  const remainder = totalMinutes % 60

  if (hours === 0) {
    return `${sign}${remainder}m`
  }

  if (remainder === 0) {
    return `${sign}${hours}h`
  }

  return `${sign}${hours}h ${remainder}m`
}

export function formatAxisValue(value: number, metric: ExploreMetricDefinition) {
  if (metric.unit === "h") {
    return formatClockHour(value)
  }

  if (metric.displayAsHours) {
    return `${Math.round((value / 60) * 10) / 10}h`
  }

  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`
  }

  if (metric.unit === "MET" || metric.unit === "br/min") {
    return value.toFixed(1)
  }

  return `${Math.round(value)}`
}

export function formatMetricValue(
  value: number | null,
  metric: ExploreMetricDefinition
) {
  if (value === null) {
    return "n/a"
  }

  if (metric.unit === "h") {
    return formatClockHour(value)
  }

  if (metric.displayAsHours) {
    return formatHoursMinutes(value)
  }

  const rounded =
    Number.isInteger(value) || Math.abs(value) >= 10
      ? `${Math.round(value)}`
      : value.toFixed(1)

  return metric.unit === "pts" ? rounded : `${rounded} ${metric.unit}`
}

export function formatAverage(
  value: number | null,
  metric: ExploreMetricDefinition
) {
  return value === null ? "n/a" : formatMetricValue(value, metric)
}

export function formatExploreDelta(row: ExploreMetricImpact) {
  if (row.delta === null) {
    return "n/a"
  }

  if (row.metric.displayAsHours) {
    return `${row.delta >= 0 ? "+" : "-"}${formatHoursMinutes(Math.abs(row.delta))}`
  }

  return `${formatDelta(row.delta)} ${row.metric.unit}`
}
