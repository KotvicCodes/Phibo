import type {
  ExploreMetricDefinition,
  ExploreMetricImpact
} from "../lib/analysis/correlations"
import { formatDelta } from "./format"

export function metricAxisLabel(metric: ExploreMetricDefinition) {
  return metric.unit === "pts" ? metric.label : `${metric.label} (${metric.unit})`
}

export function formatAxisValue(value: number, metric: ExploreMetricDefinition) {
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

  return `${formatDelta(row.delta)} ${row.metric.unit}`
}
