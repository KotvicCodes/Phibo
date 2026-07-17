import { average } from "../lib/analysis/shared"
import type { DailyMetricRow } from "../lib/db/types"

export type InsightComparisonMetric = keyof Pick<
  DailyMetricRow,
  "activityScore" | "readinessScore" | "sleepScore"
>

export interface MetricComparison {
  baselineAverage: number | null
  delta: number | null
  taggedAverage: number | null
}

export interface InsightComparison {
  comparison: MetricComparison
  label: string
  metric: InsightComparisonMetric
}

export const insightComparisonMetrics: Array<
  Pick<InsightComparison, "label" | "metric">
> = [
  { label: "Sleep", metric: "sleepScore" },
  { label: "Readiness", metric: "readinessScore" },
  { label: "Activity", metric: "activityScore" }
]

// The tagged-vs-other average comparison behind the Insights detail bars
// and the Explore score panel; both views split the days their own way and
// share the averaging and delta rounding here.
export function buildMetricComparison(
  taggedDays: DailyMetricRow[],
  otherDays: DailyMetricRow[],
  metric: InsightComparisonMetric
): MetricComparison {
  const taggedAverage = average(taggedDays.map((day) => day[metric]))
  const baselineAverage = average(otherDays.map((day) => day[metric]))

  return {
    baselineAverage,
    delta:
      taggedAverage === null || baselineAverage === null
        ? null
        : Math.round((taggedAverage - baselineAverage) * 10) / 10,
    taggedAverage
  }
}
