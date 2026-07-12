import type { DailyMetricRow, TagEntryRow } from "../db/types"
import { average, groupTagsByName, roundToOne } from "./shared"

type MetricKey =
  | "averageHrv"
  | "readinessScore"
  | "recoveryHighMinutes"
  | "restingHeartRate"
  | "sleepEfficiency"
  | "sleepScore"
  | "stressHighMinutes"

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
  | "bedtimeEndHour"
  | "bedtimeStartHour"
  | "breathingDisturbanceIndex"
  | "cardiovascularAge"
  | "deepSleepMinutes"
  | "equivalentWalkingDistance"
  | "highActivityMetMinutes"
  | "highActivityMinutes"
  | "lightSleepMinutes"
  | "lowActivityMinutes"
  | "mediumActivityMetMinutes"
  | "mediumActivityMinutes"
  | "nonWearMinutes"
  | "pulseWaveVelocity"
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
  | "recoveryHighMinutes"
  | "remSleepMinutes"
  | "resilienceContributorDaytimeRecovery"
  | "resilienceContributorSleepRecovery"
  | "resilienceContributorStress"
  | "resilienceLevelScore"
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
  | "spo2AveragePercentage"
  | "steps"
  | "stressHighMinutes"
  | "targetCalories"
  | "timeInBedMinutes"
  | "totalCalories"
  | "totalSleepMinutes"
  | "vo2Max"
  | "workoutCalories"
  | "workoutCount"
  | "workoutMinutes"

export type ExploreMetricCategory = "Activity" | "Health" | "Readiness" | "Sleep"

export interface ExploreMetricDefinition {
  category: ExploreMetricCategory
  // Long durations are stored in minutes but read better as hours (7h 24m).
  // Short durations like sleep latency stay in plain minutes.
  displayAsHours?: boolean
  // Hard bounds for chart axes: the axis range never extends past these,
  // regardless of padding or tick rounding. Left unset for signed deltas
  // and past-noon clock hours, which are legitimately unbounded.
  domainMax?: number
  domainMin?: number
  higherIsBetter: boolean
  key: ExploreMetricKey
  label: string
  // Slow-moving metrics (weeks-scale outcomes) opt out of day-level tag
  // comparisons, where the deltas would be coincidence rather than signal.
  tagComparable?: boolean
  unit: string
}

interface TagMetricCorrelation {
  tag: string
  daysWithTag: number
  daysWithoutTag: number
  deltas: Record<MetricKey, number | null>
  supportScore: number
  weightedImpact: number
}

type InsightKind = "concerning" | "rewarding"

export interface TagInsight {
  kind: InsightKind
  metric: PrimaryInsightMetric
  tag: string
  daysWithTag: number
  delta: number
  supportScore: number
  weightedImpact: number
}

interface TagDiscovery {
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
  effectSize: number | null
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
  "sleepEfficiency",
  "stressHighMinutes",
  "recoveryHighMinutes"
]
export const exploreMetricDefinitions: ExploreMetricDefinition[] = [
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepScore",
    label: "Sleep score",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessScore",
    label: "Readiness",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityScore",
    label: "Activity",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "activeCalories",
    label: "Active calories",
    unit: "cal"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "totalCalories",
    label: "Total calories",
    unit: "cal"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "targetCalories",
    label: "Target calories",
    unit: "cal"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "steps",
    label: "Steps",
    unit: "steps"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "equivalentWalkingDistance",
    label: "Walking distance",
    unit: "m"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "averageMetMinutes",
    label: "Avg MET",
    unit: "MET"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "highActivityMetMinutes",
    label: "High MET min",
    unit: "MET min"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "mediumActivityMetMinutes",
    label: "Medium MET min",
    unit: "MET min"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "highActivityMinutes",
    label: "High activity",
    unit: "min"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "mediumActivityMinutes",
    label: "Medium activity",
    unit: "min"
  },
  {
    category: "Activity",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "lowActivityMinutes",
    label: "Low activity",
    unit: "min"
  },
  {
    category: "Activity",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: false,
    key: "sedentaryMinutes",
    label: "Sedentary",
    unit: "min"
  },
  {
    category: "Activity",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: false,
    key: "nonWearMinutes",
    label: "Non-wear",
    unit: "min"
  },
  {
    category: "Activity",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "restingMinutes",
    label: "Resting",
    unit: "min"
  },
  {
    category: "Readiness",
    domainMin: 0,
    higherIsBetter: true,
    key: "averageHrv",
    label: "HRV",
    unit: "ms"
  },
  {
    category: "Readiness",
    domainMin: 0,
    higherIsBetter: false,
    key: "averageHeartRate",
    label: "Avg sleep HR",
    unit: "bpm"
  },
  {
    category: "Readiness",
    domainMin: 0,
    higherIsBetter: false,
    key: "restingHeartRate",
    label: "Resting HR",
    unit: "bpm"
  },
  {
    category: "Readiness",
    domainMin: 0,
    higherIsBetter: true,
    key: "averageBreath",
    label: "Breathing rate",
    unit: "br/min"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepEfficiency",
    label: "Sleep efficiency",
    unit: "%"
  },
  {
    category: "Sleep",
    domainMin: 0,
    higherIsBetter: false,
    key: "sleepLatencyMinutes",
    label: "Latency",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "deepSleepMinutes",
    label: "Deep sleep",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "lightSleepMinutes",
    label: "Light sleep",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "remSleepMinutes",
    label: "REM sleep",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "totalSleepMinutes",
    label: "Total sleep",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: false,
    key: "awakeMinutes",
    label: "Awake time",
    unit: "min"
  },
  {
    category: "Sleep",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: false,
    key: "timeInBedMinutes",
    label: "Time in bed",
    unit: "min"
  },
  {
    category: "Sleep",
    domainMin: 0,
    higherIsBetter: false,
    key: "restlessPeriods",
    label: "Restless periods",
    unit: "periods"
  },
  {
    category: "Sleep",
    higherIsBetter: false,
    key: "bedtimeStartHour",
    label: "Bedtime",
    unit: "h"
  },
  {
    category: "Sleep",
    higherIsBetter: false,
    key: "bedtimeEndHour",
    label: "Wake time",
    unit: "h"
  },
  // sleepScoreDelta stays in the data model but is not offered in Explore:
  // real exports carry almost no variation in it, so it reads as noise.
  {
    category: "Readiness",
    higherIsBetter: true,
    key: "readinessScoreDelta",
    label: "Readiness delta",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorDeepSleep",
    label: "Deep contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorEfficiency",
    label: "Efficiency contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorLatency",
    label: "Latency contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorRemSleep",
    label: "REM contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorRestfulness",
    label: "Restfulness contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorTiming",
    label: "Timing contributor",
    unit: "pts"
  },
  {
    category: "Sleep",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "sleepContributorTotalSleep",
    label: "Total sleep contributor",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorActivityBalance",
    label: "Activity balance",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorBodyTemperature",
    label: "Body temp contributor",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorHrvBalance",
    label: "HRV balance",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorPreviousDayActivity",
    label: "Prev day activity",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorPreviousNight",
    label: "Previous night",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorRecoveryIndex",
    label: "Recovery index",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorRestingHeartRate",
    label: "RHR contributor",
    unit: "pts"
  },
  {
    category: "Readiness",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "readinessContributorSleepBalance",
    label: "Sleep balance",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "workoutCount",
    label: "Workouts",
    unit: "count"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "workoutMinutes",
    label: "Workout time",
    unit: "min"
  },
  {
    category: "Activity",
    domainMin: 0,
    higherIsBetter: true,
    key: "workoutCalories",
    label: "Workout calories",
    unit: "cal"
  },
  {
    category: "Health",
    domainMin: 0,
    higherIsBetter: true,
    key: "vo2Max",
    label: "VO2 max",
    tagComparable: false,
    unit: "ml/kg/min"
  },
  {
    category: "Health",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "spo2AveragePercentage",
    label: "Blood oxygen",
    unit: "%"
  },
  {
    category: "Health",
    domainMin: 0,
    higherIsBetter: false,
    key: "breathingDisturbanceIndex",
    label: "Breathing disturbance",
    unit: "idx"
  },
  {
    category: "Health",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: false,
    key: "stressHighMinutes",
    label: "Stress high",
    unit: "min"
  },
  {
    category: "Health",
    displayAsHours: true,
    domainMin: 0,
    higherIsBetter: true,
    key: "recoveryHighMinutes",
    label: "Recovery high",
    unit: "min"
  },
  {
    category: "Health",
    domainMin: 0,
    higherIsBetter: true,
    key: "resilienceLevelScore",
    label: "Resilience level",
    unit: "lvl"
  },
  {
    category: "Health",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "resilienceContributorSleepRecovery",
    label: "Sleep recovery",
    unit: "pts"
  },
  {
    category: "Health",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "resilienceContributorDaytimeRecovery",
    label: "Daytime recovery",
    unit: "pts"
  },
  {
    category: "Health",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "resilienceContributorStress",
    label: "Stress resilience",
    unit: "pts"
  },
  {
    category: "Health",
    domainMin: 0,
    higherIsBetter: false,
    key: "cardiovascularAge",
    label: "Cardiovascular age",
    tagComparable: false,
    unit: "yrs"
  },
  {
    category: "Health",
    domainMin: 0,
    higherIsBetter: false,
    key: "pulseWaveVelocity",
    label: "Pulse wave velocity",
    tagComparable: false,
    unit: "m/s"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityContributorMeetDailyTargets",
    label: "Meet targets",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityContributorMoveEveryHour",
    label: "Move hourly",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityContributorRecoveryTime",
    label: "Recovery time",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityContributorStayActive",
    label: "Stay active",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
    higherIsBetter: true,
    key: "activityContributorTrainingFrequency",
    label: "Training frequency",
    unit: "pts"
  },
  {
    category: "Activity",
    domainMax: 100,
    domainMin: 0,
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

// Bedtime hours are derived from the stored bedtime timestamps at load time
// so previously imported data gets them without a re-import. The bedtime
// start hour uses a past-noon clock (00:30 becomes 24.5) so averages of
// nights around midnight do not wrap.
export function withDerivedMetricFields(metrics: DailyMetricRow[]) {
  return metrics.map((metric) => ({
    ...metric,
    bedtimeStartHour: getClockHour(metric.bedtimeStart, true),
    bedtimeEndHour: getClockHour(metric.bedtimeEnd, false)
  }))
}

function getClockHour(
  timestamp: string | null | undefined,
  shiftPastMidnight: boolean
) {
  // Read the wall-clock time as written, keeping the wearer's local timezone.
  const match = timestamp?.match(/T(\d{2}):(\d{2})/)

  if (!match) {
    return null
  }

  const hour = Number(match[1]) + Number(match[2]) / 60
  const shiftedHour = shiftPastMidnight && hour < 12 ? hour + 24 : hour

  return Math.round(shiftedHour * 10) / 10
}

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
          kind: classifyInsight(delta),
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

export function getTagNightCounts(tags: TagEntryRow[]) {
  const counts = new Map<string, number>()

  for (const [tag, dates] of groupTagsByName(tags)) {
    counts.set(tag, dates.size)
  }

  return counts
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

// Works on prebuilt explore days so callers that already computed them
// (the Explore view) do not pay for building the day list twice.
export function calculateExploreMetricImpacts(
  days: ExploreDay[]
): ExploreMetricImpact[] {
  const taggedDays = days.filter((day) => day.matches).map((day) => day.metric)
  const otherDays = days.filter((day) => !day.matches).map((day) => day.metric)

  const comparableDefinitions = exploreMetricDefinitions.filter(
    (definition) => definition.tagComparable !== false
  )

  return comparableDefinitions.map((definition) => {
    const taggedAverage = average(
      taggedDays.map((day) => day[definition.key])
    )
    const otherAverage = average(otherDays.map((day) => day[definition.key]))
    const delta =
      taggedAverage === null || otherAverage === null
        ? null
        : roundToOne(taggedAverage - otherAverage)
    const toneDelta = delta === null ? null : metricToneDelta(definition, delta)
    const deviation = standardDeviation(
      days.map((day) => day.metric[definition.key])
    )

    return {
      delta,
      effectSize:
        toneDelta === null || deviation === null || deviation === 0
          ? null
          : roundToTwo(toneDelta / deviation),
      metric: definition,
      otherAverage,
      otherCount: otherDays.length,
      taggedAverage,
      taggedCount: taggedDays.length,
      toneDelta
    }
  })
}

export function getExploreMetric(key: ExploreMetricKey) {
  return (
    exploreMetricDefinitions.find((definition) => definition.key === key) ??
    exploreMetricDefinitions[0]
  )
}

function metricToneDelta(
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

export function calculateSupportScore(daysWithTag: number, daysWithoutTag: number) {
  const taggedSupport = Math.min(daysWithTag / 5, 1)
  const comparisonSupport = Math.min(daysWithoutTag / 8, 1)

  return roundToOne(Math.sqrt(taggedSupport * comparisonSupport))
}

function classifyInsight(delta: number): InsightKind {
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
  const seenTags = new Set<string>()

  return insights
    .filter((insight) => insight.kind === kind)
    .sort((left, right) => right.weightedImpact - left.weightedImpact)
    .filter((insight) => {
      if (seenTags.has(insight.tag)) {
        return false
      }

      seenTags.add(insight.tag)
      return true
    })
    .slice(0, 4)
}

function standardDeviation(values: Array<number | null | undefined>) {
  const usableValues = values.filter((value): value is number => value != null)

  if (usableValues.length < 2) {
    return null
  }

  const mean =
    usableValues.reduce((total, value) => total + value, 0) /
    usableValues.length
  const variance =
    usableValues.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (usableValues.length - 1)

  return Math.sqrt(variance)
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100
}
