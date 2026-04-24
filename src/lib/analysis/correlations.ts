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
        deltas: calculateMetricDeltas(daysWithTag, daysWithoutTag)
      }
    })
    .filter((correlation) => correlation.daysWithTag > 0)
    .sort((left, right) => {
      const leftDelta = left.deltas.sleepScore ?? 0
      const rightDelta = right.deltas.sleepScore ?? 0

      return Math.abs(rightDelta) - Math.abs(leftDelta)
    })
    .filter((correlation) => metricsByDate.size > correlation.daysWithTag)
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
