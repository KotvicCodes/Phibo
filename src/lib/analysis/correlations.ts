import type { DailyMetricRow, TagEntryRow } from "../db/types"

export type MetricKey =
  | "averageHrv"
  | "readinessScore"
  | "restingHeartRate"
  | "sleepEfficiency"
  | "sleepScore"

export interface TagMetricCorrelation {
  tag: string
  daysWithTag: number
  daysWithoutTag: number
  deltas: Record<MetricKey, number | null>
  supportScore: number
  weightedImpact: number
}

export type InsightKind = "concerning" | "notable" | "rewarding"

export interface TagInsight {
  kind: InsightKind
  metric: MetricKey
  tag: string
  daysWithTag: number
  delta: number
  supportScore: number
  weightedImpact: number
}

export interface TagDiscovery {
  tag: string
  daysWithTag: number
  lastSeenDate: string
  reason: "new" | "neglected"
}

const metricKeys: MetricKey[] = [
  "sleepScore",
  "readinessScore",
  "averageHrv",
  "restingHeartRate",
  "sleepEfficiency"
]

export function calculateTagCorrelations(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[]
): TagMetricCorrelation[] {
  const metricsByDate = new Map(metrics.map((metric) => [metric.date, metric]))
  const tagsByName = groupTagsByName(tags)

  return Array.from(tagsByName.entries())
    .map(([tag, dates]) => {
      const taggedDates = new Set(dates)
      const daysWithTag = metrics.filter((metric) => taggedDates.has(metric.date))
      const daysWithoutTag = metrics.filter(
        (metric) => !taggedDates.has(metric.date)
      )

      return {
        tag,
        daysWithTag: daysWithTag.length,
        daysWithoutTag: daysWithoutTag.length,
        deltas: calculateMetricDeltas(daysWithTag, daysWithoutTag),
        supportScore: calculateSupportScore(
          daysWithTag.length,
          daysWithoutTag.length
        ),
        weightedImpact: 0
      }
    })
    .map((correlation) => ({
      ...correlation,
      weightedImpact: roundToOne(
        Math.abs(correlation.deltas.sleepScore ?? 0) * correlation.supportScore
      )
    }))
    .filter((correlation) => correlation.daysWithTag > 0)
    .sort((left, right) => {
      return right.weightedImpact - left.weightedImpact
    })
    .filter((correlation) => metricsByDate.size > correlation.daysWithTag)
}

export function getRankedTagInsights(correlations: TagMetricCorrelation[]) {
  const insights = correlations.flatMap((correlation) =>
    (["sleepScore"] as const).flatMap((metric): TagInsight[] => {
      const delta = correlation.deltas[metric]

      if (delta === null) {
        return []
      }

      const weightedImpact = roundToOne(
        Math.abs(delta) * correlation.supportScore * metricWeight(metric)
      )

      if (weightedImpact < 1.5) {
        return []
      }

      return [
        {
          kind: classifyInsight(metric, delta),
          metric,
          tag: correlation.tag,
          daysWithTag: correlation.daysWithTag,
          delta,
          supportScore: correlation.supportScore,
          weightedImpact
        }
      ]
    })
  )

  const rewarding = takeTopInsights(insights, "rewarding")
  const concerning = takeTopInsights(insights, "concerning")
  const usedInsightIds = new Set(
    [...rewarding, ...concerning].map((insight) => insightId(insight))
  )

  return {
    rewarding,
    concerning,
    notable: takeTopInsights(
      insights.filter((insight) => !usedInsightIds.has(insightId(insight))),
      "notable"
    )
  }
}

export function getTagDiscoveries(tags: TagEntryRow[], latestDate: string) {
  const latestTime = new Date(`${latestDate}T12:00:00`).getTime()
  const groupedTags = Array.from(groupTagsByName(tags).entries())

  return groupedTags
    .map(([tag, dates]): TagDiscovery | null => {
      const sortedDates = Array.from(dates).sort()
      const lastSeenDate = sortedDates.at(-1)

      if (!lastSeenDate) {
        return null
      }

      const daysSinceSeen = Math.floor(
        (latestTime - new Date(`${lastSeenDate}T12:00:00`).getTime()) /
          86_400_000
      )
      const reason =
        sortedDates.length <= 2 && daysSinceSeen <= 14
          ? "new"
          : daysSinceSeen >= 21
            ? "neglected"
            : null

      if (!reason) {
        return null
      }

      return {
        tag,
        daysWithTag: sortedDates.length,
        lastSeenDate,
        reason
      }
    })
    .filter((discovery): discovery is TagDiscovery => discovery !== null)
    .sort((left, right) => {
      if (left.reason !== right.reason) {
        return left.reason === "new" ? -1 : 1
      }

      return right.lastSeenDate.localeCompare(left.lastSeenDate)
    })
    .slice(0, 4)
}

function groupTagsByName(tags: TagEntryRow[]) {
  return tags.reduce((groups, entry) => {
    const dates = groups.get(entry.tag) ?? new Set<string>()
    dates.add(entry.date)
    groups.set(entry.tag, dates)

    return groups
  }, new Map<string, Set<string>>())
}

function calculateMetricDeltas(
  daysWithTag: DailyMetricRow[],
  daysWithoutTag: DailyMetricRow[]
) {
  return metricKeys.reduce(
    (deltas, key) => {
      const taggedAverage = average(daysWithTag.map((day) => day[key]))
      const untaggedAverage = average(daysWithoutTag.map((day) => day[key]))

      deltas[key] =
        taggedAverage === null || untaggedAverage === null
          ? null
          : roundToOne(taggedAverage - untaggedAverage)

      return deltas
    },
    {} as Record<MetricKey, number | null>
  )
}

function calculateSupportScore(daysWithTag: number, daysWithoutTag: number) {
  const taggedSupport = Math.min(daysWithTag / 5, 1)
  const comparisonSupport = Math.min(daysWithoutTag / 8, 1)

  return roundToOne(Math.sqrt(taggedSupport * comparisonSupport))
}

function classifyInsight(metric: MetricKey, delta: number): InsightKind {
  if (metric === "restingHeartRate") {
    return delta < 0 ? "rewarding" : "concerning"
  }

  return delta > 0 ? "rewarding" : "concerning"
}

function metricWeight(metric: MetricKey) {
  if (metric === "sleepScore") {
    return 1.2
  }

  if (metric === "readinessScore") {
    return 1.05
  }

  return 0.9
}

function takeTopInsights(insights: TagInsight[], kind: InsightKind) {
  const matchingInsights =
    kind === "notable"
      ? insights
      : insights.filter((insight) => insight.kind === kind)

  return matchingInsights
    .sort((left, right) => right.weightedImpact - left.weightedImpact)
    .slice(0, 3)
}

function insightId(insight: TagInsight) {
  return `${insight.tag}-${insight.metric}`
}

function average(values: Array<number | null>) {
  const usableValues = values.filter((value): value is number => value !== null)

  if (usableValues.length === 0) {
    return null
  }

  return (
    usableValues.reduce((total, value) => total + value, 0) / usableValues.length
  )
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}
