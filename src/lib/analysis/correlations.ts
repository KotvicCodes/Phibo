import type { DailyMetricRow, TagEntryRow } from "../db/types"

export type MetricKey =
  | "averageHrv"
  | "readinessScore"
  | "restingHeartRate"
  | "sleepEfficiency"
  | "sleepScore"

export type PrimaryInsightMetric = "readinessScore" | "sleepScore"

export type ExploreMetricKey =
  | "activeCalories"
  | "activityScore"
  | "activityContributorMeetDailyTargets"
  | "activityContributorMoveEveryHour"
  | "activityContributorRecoveryTime"
  | "activityContributorStayActive"
  | "activityContributorTrainingFrequency"
  | "activityContributorTrainingVolume"
  | "averageBreath"
  | "averageHeartRate"
  | "averageHrv"
  | "averageMetMinutes"
  | "awakeMinutes"
  | "deepSleepMinutes"
  | "equivalentWalkingDistance"
  | "highActivityMetMinutes"
  | "highActivityMinutes"
  | "lightSleepMinutes"
  | "lowActivityMinutes"
  | "mediumActivityMetMinutes"
  | "mediumActivityMinutes"
  | "nonWearMinutes"
  | "readinessContributorActivityBalance"
  | "readinessContributorBodyTemperature"
  | "readinessContributorHrvBalance"
  | "readinessContributorPreviousDayActivity"
  | "readinessContributorPreviousNight"
  | "readinessContributorRecoveryIndex"
  | "readinessContributorRestingHeartRate"
  | "readinessContributorSleepBalance"
  | "readinessScoreDelta"
  | "readinessScore"
  | "remSleepMinutes"
  | "restingMinutes"
  | "restingHeartRate"
  | "restlessPeriods"
  | "sedentaryMinutes"
  | "sleepContributorDeepSleep"
  | "sleepContributorEfficiency"
  | "sleepContributorLatency"
  | "sleepContributorRemSleep"
  | "sleepContributorRestfulness"
  | "sleepContributorTiming"
  | "sleepContributorTotalSleep"
  | "sleepEfficiency"
  | "sleepLatencyMinutes"
  | "sleepScoreDelta"
  | "sleepScore"
  | "steps"
  | "targetCalories"
  | "timeInBedMinutes"
  | "totalCalories"
  | "totalSleepMinutes"

export interface ExploreMetricDefinition {
  higherIsBetter: boolean
  key: ExploreMetricKey
  label: string
  unit: string
}

export interface TagMetricCorrelation {
  tag: string
  daysWithTag: number
  daysWithoutTag: number
  deltas: Record<MetricKey, number | null>
  supportScore: number
  weightedImpact: number
}

export type InsightKind = "concerning" | "rewarding"

export interface TagInsight {
  kind: InsightKind
  metric: PrimaryInsightMetric
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

export interface ExploreDay {
  date: string
  matches: boolean
  metric: DailyMetricRow
  tags: string[]
}

export interface ExploreMetricImpact {
  delta: number | null
  metric: ExploreMetricDefinition
  otherAverage: number | null
  otherCount: number
  taggedAverage: number | null
  taggedCount: number
  toneDelta: number | null
}

const metricKeys: MetricKey[] = [
  "sleepScore",
  "readinessScore",
  "averageHrv",
  "restingHeartRate",
  "sleepEfficiency"
]
export const exploreMetricDefinitions: ExploreMetricDefinition[] = [
  {
    higherIsBetter: true,
    key: "sleepScore",
    label: "Sleep score",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessScore",
    label: "Readiness",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityScore",
    label: "Activity",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activeCalories",
    label: "Active calories",
    unit: "cal"
  },
  {
    higherIsBetter: true,
    key: "totalCalories",
    label: "Total calories",
    unit: "cal"
  },
  {
    higherIsBetter: true,
    key: "targetCalories",
    label: "Target calories",
    unit: "cal"
  },
  {
    higherIsBetter: true,
    key: "steps",
    label: "Steps",
    unit: "steps"
  },
  {
    higherIsBetter: true,
    key: "equivalentWalkingDistance",
    label: "Walking distance",
    unit: "m"
  },
  {
    higherIsBetter: true,
    key: "averageMetMinutes",
    label: "Avg MET",
    unit: "MET"
  },
  {
    higherIsBetter: true,
    key: "highActivityMetMinutes",
    label: "High MET min",
    unit: "MET min"
  },
  {
    higherIsBetter: true,
    key: "mediumActivityMetMinutes",
    label: "Medium MET min",
    unit: "MET min"
  },
  {
    higherIsBetter: true,
    key: "highActivityMinutes",
    label: "High activity",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "mediumActivityMinutes",
    label: "Medium activity",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "lowActivityMinutes",
    label: "Low activity",
    unit: "min"
  },
  {
    higherIsBetter: false,
    key: "sedentaryMinutes",
    label: "Sedentary",
    unit: "min"
  },
  {
    higherIsBetter: false,
    key: "nonWearMinutes",
    label: "Non-wear",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "restingMinutes",
    label: "Resting",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "averageHrv",
    label: "HRV",
    unit: "ms"
  },
  {
    higherIsBetter: false,
    key: "averageHeartRate",
    label: "Avg sleep HR",
    unit: "bpm"
  },
  {
    higherIsBetter: false,
    key: "restingHeartRate",
    label: "Resting HR",
    unit: "bpm"
  },
  {
    higherIsBetter: true,
    key: "averageBreath",
    label: "Breathing rate",
    unit: "br/min"
  },
  {
    higherIsBetter: true,
    key: "sleepEfficiency",
    label: "Sleep efficiency",
    unit: "%"
  },
  {
    higherIsBetter: false,
    key: "sleepLatencyMinutes",
    label: "Latency",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "deepSleepMinutes",
    label: "Deep sleep",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "lightSleepMinutes",
    label: "Light sleep",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "remSleepMinutes",
    label: "REM sleep",
    unit: "min"
  },
  {
    higherIsBetter: true,
    key: "totalSleepMinutes",
    label: "Total sleep",
    unit: "min"
  },
  {
    higherIsBetter: false,
    key: "awakeMinutes",
    label: "Awake time",
    unit: "min"
  },
  {
    higherIsBetter: false,
    key: "timeInBedMinutes",
    label: "Time in bed",
    unit: "min"
  },
  {
    higherIsBetter: false,
    key: "restlessPeriods",
    label: "Restless periods",
    unit: "periods"
  },
  {
    higherIsBetter: true,
    key: "sleepScoreDelta",
    label: "Sleep score delta",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessScoreDelta",
    label: "Readiness delta",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorDeepSleep",
    label: "Deep contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorEfficiency",
    label: "Efficiency contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorLatency",
    label: "Latency contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorRemSleep",
    label: "REM contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorRestfulness",
    label: "Restfulness contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorTiming",
    label: "Timing contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "sleepContributorTotalSleep",
    label: "Total sleep contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorActivityBalance",
    label: "Activity balance",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorBodyTemperature",
    label: "Body temp contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorHrvBalance",
    label: "HRV balance",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorPreviousDayActivity",
    label: "Prev day activity",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorPreviousNight",
    label: "Previous night",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorRecoveryIndex",
    label: "Recovery index",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorRestingHeartRate",
    label: "RHR contributor",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "readinessContributorSleepBalance",
    label: "Sleep balance",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorMeetDailyTargets",
    label: "Meet targets",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorMoveEveryHour",
    label: "Move hourly",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorRecoveryTime",
    label: "Recovery time",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorStayActive",
    label: "Stay active",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorTrainingFrequency",
    label: "Training frequency",
    unit: "pts"
  },
  {
    higherIsBetter: true,
    key: "activityContributorTrainingVolume",
    label: "Training volume",
    unit: "pts"
  }
]
const primaryInsightMetrics: PrimaryInsightMetric[] = [
  "sleepScore",
  "readinessScore"
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
    primaryInsightMetrics.flatMap((metric): TagInsight[] => {
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

  return {
    rewarding: takeTopInsights(insights, "rewarding"),
    concerning: takeTopInsights(insights, "concerning")
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

export function getAvailableTags(tags: TagEntryRow[]) {
  return Array.from(new Set(tags.map((tag) => tag.tag))).sort((left, right) =>
    left.localeCompare(right)
  )
}

export function buildExploreDays(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  selectedTags: string[]
): ExploreDay[] {
  const tagsByDate = groupTagsByDate(tags)

  return metrics.map((metric) => {
    const dayTags = Array.from(tagsByDate.get(metric.date) ?? []).sort()

    return {
      date: metric.date,
      matches:
        selectedTags.length > 0 &&
        selectedTags.every((tag) => dayTags.includes(tag)),
      metric,
      tags: dayTags
    }
  })
}

export function calculateExploreMetricImpacts(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  selectedTags: string[]
): ExploreMetricImpact[] {
  const days = buildExploreDays(metrics, tags, selectedTags)
  const taggedDays = days.filter((day) => day.matches).map((day) => day.metric)
  const otherDays = days.filter((day) => !day.matches).map((day) => day.metric)

  return exploreMetricDefinitions.map((definition) => {
    const taggedAverage = average(
      taggedDays.map((day) => day[definition.key])
    )
    const otherAverage = average(otherDays.map((day) => day[definition.key]))
    const delta =
      taggedAverage === null || otherAverage === null
        ? null
        : roundToOne(taggedAverage - otherAverage)

    return {
      delta,
      metric: definition,
      otherAverage,
      otherCount: otherDays.length,
      taggedAverage,
      taggedCount: taggedDays.length,
      toneDelta: delta === null ? null : metricToneDelta(definition, delta)
    }
  })
}

export function getExploreMetric(key: ExploreMetricKey) {
  return (
    exploreMetricDefinitions.find((definition) => definition.key === key) ??
    exploreMetricDefinitions[0]
  )
}

export function metricToneDelta(
  metric: ExploreMetricDefinition,
  delta: number
) {
  return metric.higherIsBetter ? delta : -delta
}

function groupTagsByDate(tags: TagEntryRow[]) {
  return tags.reduce((groups, entry) => {
    const dates = groups.get(entry.date) ?? new Set<string>()
    dates.add(entry.tag)
    groups.set(entry.date, dates)

    return groups
  }, new Map<string, Set<string>>())
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
  return insights
    .filter((insight) => insight.kind === kind)
    .sort((left, right) => right.weightedImpact - left.weightedImpact)
    .slice(0, 4)
}

function average(values: Array<number | null | undefined>) {
  const usableValues = values.filter((value): value is number => value != null)

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
