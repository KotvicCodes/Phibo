import type {
  ExploreMetricCategory,
  ExploreMetricImpact,
  ExploreMetricKey
} from "../lib/analysis/correlations"
import { formatExploreDelta } from "./exploreCharts"

export interface ExploreImpactGroup {
  category: ExploreMetricCategory
  rows: ExploreMetricImpact[]
  strongest: ExploreMetricImpact | null
}

const exploreImpactCategoryOrder: ExploreMetricCategory[] = [
  "Sleep",
  "Readiness",
  "Activity"
]

export function isPrimaryScoreMetric(metric: ExploreMetricKey) {
  return (
    metric === "activityScore" ||
    metric === "readinessScore" ||
    metric === "sleepScore"
  )
}

export function impactTone(value: number | null) {
  if (value === null || Math.abs(value) <= 0.5) {
    return "neutral"
  }

  if (value >= 2) {
    return "excellent"
  }

  if (value > 0.5) {
    return "positive"
  }

  if (value <= -2) {
    return "negative"
  }

  return "warning"
}

export function impactWidth(
  row: ExploreMetricImpact,
  impacts: ExploreMetricImpact[]
) {
  const maxDelta = Math.max(
    ...impacts.map((impact) => Math.abs(impact.delta ?? 0)),
    1
  )

  return `${Math.min((Math.abs(row.delta ?? 0) / maxDelta) * 100, 100)}%`
}

export function groupExploreImpacts(
  rows: ExploreMetricImpact[]
): ExploreImpactGroup[] {
  return exploreImpactCategoryOrder
    .map((category) => {
      const categoryRows = rows.filter((row) => row.metric.category === category)

      return {
        category,
        rows: categoryRows,
        strongest: strongestExploreImpact(categoryRows)
      }
    })
    .filter((group) => group.rows.length > 0)
}

function strongestExploreImpact(rows: ExploreMetricImpact[]) {
  return rows.reduce<ExploreMetricImpact | null>((strongest, row) => {
    if (row.delta === null) {
      return strongest
    }

    if (strongest === null) {
      return row
    }

    const rowImpact = Math.abs(row.toneDelta ?? row.delta)
    const strongestImpact = Math.abs(strongest.toneDelta ?? strongest.delta ?? 0)

    return rowImpact > strongestImpact ? row : strongest
  }, null)
}

export function impactGroupTone(group: ExploreImpactGroup) {
  return impactTone(group.strongest?.toneDelta ?? null)
}

export function impactGroupDelta(group: ExploreImpactGroup) {
  return group.strongest ? formatExploreDelta(group.strongest) : "n/a"
}

export function impactGroupDeltaLabel(group: ExploreImpactGroup) {
  return group.strongest?.metric.label ?? "Strongest"
}

export function impactGroupMetricCount(group: ExploreImpactGroup) {
  return `${group.rows.length} ${group.rows.length === 1 ? "metric" : "metrics"}`
}
