import type {
  ExploreDay,
  ExploreMetricDefinition,
  ExploreMetricImpact,
  ExploreMetricKey
} from "../lib/analysis/correlations"
import { formatDate, formatDelta, scaleNumber } from "./format"

export const chartWidth = 640
export const chartHeight = 320
export const chartPadding = 56

export interface ChartPoint {
  day: ExploreDay
  x: number
  y: number
}

export interface ChartTick {
  label: string
  position: number
}

export function createScatterPoints(
  days: ExploreDay[],
  xMetric: ExploreMetricKey,
  yMetric: ExploreMetricKey,
  xExtent: readonly [number, number],
  yExtent: readonly [number, number]
): ChartPoint[] {
  return days
    .filter(
      (day) => day.metric[xMetric] != null && day.metric[yMetric] != null
    )
    .map((day) => ({
      day,
      x: scaleNumber(
        day.metric[xMetric] ?? 0,
        xExtent,
        chartPadding,
        chartWidth - chartPadding
      ),
      y: scaleNumber(
        day.metric[yMetric] ?? 0,
        yExtent,
        chartHeight - chartPadding,
        chartPadding
      )
    }))
}

export function createTimelinePoints(
  days: ExploreDay[],
  metric: ExploreMetricKey,
  yExtent: readonly [number, number]
): ChartPoint[] {
  const usableDays = days.filter((day) => day.metric[metric] != null)
  const xStep =
    usableDays.length <= 1
      ? 0
      : (chartWidth - chartPadding * 2) / (usableDays.length - 1)

  return usableDays.map((day, index) => ({
    day,
    x: chartPadding + xStep * index,
    y: scaleNumber(
      day.metric[metric] ?? 0,
      yExtent,
      chartHeight - chartPadding,
      chartPadding
    )
  }))
}

export function createMetricTicks(
  extent: readonly [number, number],
  metric: ExploreMetricDefinition,
  outputMin: number,
  outputMax: number
): ChartTick[] {
  const [min, max] = extent

  return [min, (min + max) / 2, max].map((value) => ({
    label: formatAxisValue(value, metric),
    position: scaleNumber(value, extent, outputMin, outputMax)
  }))
}

export function createTimelineDateTicks(points: ChartPoint[]): ChartTick[] {
  if (points.length === 0) {
    return []
  }

  const indexes = Array.from(
    new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])
  )

  return indexes.map((index) => ({
    label: formatDate(points[index].day.date),
    position: points[index].x
  }))
}

export function timelinePath(points: ChartPoint[]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ")
}

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
