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
