import type { DailyMetricRow, TagEntryRow } from "../db/types"
import { calculateSupportScore } from "./correlations"

export const OPTIMAL_MIN_TAGGED_DAYS = 10
const OPTIMAL_MIN_UNTAGGED_DAYS = 8

export type ScoreCategory = "activityScore" | "readinessScore" | "sleepScore"
export type OptimalTarget =
  | "activity"
  | "night"
  | "readiness"
  | "sleep"
  | "total"

export interface OptimalTargetOption {
  id: OptimalTarget
  label: string
  categories: ScoreCategory[]
}

export interface OptimalTagContribution {
  tag: string
  daysWithTag: number
  supportScore: number
  deltas: Record<ScoreCategory, number | null>
  weightedDeltas: Record<ScoreCategory, number>
  targetContribution: number
}

export interface OptimalDayResult {
  target: OptimalTarget
  baselines: Record<ScoreCategory, number | null>
  estimates: Record<ScoreCategory, number | null>
  estimateDeltas: Record<ScoreCategory, number | null>
  contributions: OptimalTagContribution[]
  eligibleTagCount: number
}

export const scoreCategories: { key: ScoreCategory; label: string }[] = [
  { key: "sleepScore", label: "Sleep" },
  { key: "readinessScore", label: "Readiness" },
  { key: "activityScore", label: "Activity" }
]

export const optimalTargets: OptimalTargetOption[] = [
  {
    id: "total",
    label: "Total",
    categories: ["sleepScore", "readinessScore", "activityScore"]
  },
  { id: "night", label: "Night", categories: ["sleepScore", "readinessScore"] },
  { id: "sleep", label: "Sleep", categories: ["sleepScore"] },
  { id: "readiness", label: "Readiness", categories: ["readinessScore"] },
  { id: "activity", label: "Activity", categories: ["activityScore"] }
]

export function calculateOptimalDay(
  metrics: DailyMetricRow[],
  tags: TagEntryRow[],
  options: { target?: OptimalTarget; excludedTags?: string[] } = {}
): OptimalDayResult {
  const target = options.target ?? "total"
  const excludedTags = new Set(options.excludedTags ?? [])
  const targetCategories =
    optimalTargets.find((option) => option.id === target)?.categories ?? []
  const baselines = mapCategories((key) =>
    average(metrics.map((day) => day[key]))
  )

  const eligibleTags = Array.from(groupTagsByName(tags).entries())
    .filter(([tag]) => !excludedTags.has(tag))
    .map(([tag, dates]) => {
      const taggedDates = new Set(dates)
      const daysWithTag = metrics.filter((day) => taggedDates.has(day.date))
      const daysWithoutTag = metrics.filter(
        (day) => !taggedDates.has(day.date)
      )
      const deltas = mapCategories((key) => {
        const taggedAverage = average(daysWithTag.map((day) => day[key]))
        const untaggedAverage = average(daysWithoutTag.map((day) => day[key]))

        return taggedAverage === null || untaggedAverage === null
          ? null
          : taggedAverage - untaggedAverage
      })
      const supportScore = calculateSupportScore(
        daysWithTag.length,
        daysWithoutTag.length
      )
      const weightedDeltas = mapCategories(
        (key) => roundToOne((deltas[key] ?? 0) * supportScore)
      )

      return {
        tag,
        daysWithTag: daysWithTag.length,
        daysWithoutTag: daysWithoutTag.length,
        supportScore,
        deltas: mapCategories((key) => {
          const delta = deltas[key]

          return delta === null ? null : roundToOne(delta)
        }),
        weightedDeltas,
        targetContribution: roundToOne(
          targetCategories.reduce(
            (total, key) => total + weightedDeltas[key],
            0
          )
        )
      }
    })
    .filter(
      (candidate) =>
        candidate.daysWithTag >= OPTIMAL_MIN_TAGGED_DAYS &&
        candidate.daysWithoutTag >= OPTIMAL_MIN_UNTAGGED_DAYS
    )

  const contributions = eligibleTags
    .filter((candidate) => candidate.targetContribution > 0)
    .sort((left, right) => right.targetContribution - left.targetContribution)
    .map(({ daysWithoutTag, ...contribution }) => contribution)

  const estimates = mapCategories((key) => {
    const baseline = baselines[key]

    if (baseline === null) {
      return null
    }

    return roundToOne(
      clampScore(baseline + dampedContributionSum(contributions, key))
    )
  })

  return {
    target,
    baselines: mapCategories((key) => {
      const baseline = baselines[key]

      return baseline === null ? null : roundToOne(baseline)
    }),
    estimates,
    estimateDeltas: mapCategories((key) => {
      const baseline = baselines[key]
      const estimate = estimates[key]

      return baseline === null || estimate === null
        ? null
        : roundToOne(estimate - baseline)
    }),
    contributions,
    eligibleTagCount: eligibleTags.length
  }
}

// Selected tags overlap heavily on the same good days, so summing their
// deltas would double-count. Harmonic rank damping keeps the strongest
// signal at full weight and gives correlated extras diminishing returns.
function dampedContributionSum(
  contributions: OptimalTagContribution[],
  key: ScoreCategory
) {
  return contributions
    .map((contribution) => contribution.weightedDeltas[key])
    .filter((value) => value !== 0)
    .sort((left, right) => Math.abs(right) - Math.abs(left))
    .reduce((total, value, index) => total + value / (index + 1), 0)
}

function mapCategories<Value>(compute: (key: ScoreCategory) => Value) {
  return scoreCategories.reduce(
    (values, category) => {
      values[category.key] = compute(category.key)

      return values
    },
    {} as Record<ScoreCategory, Value>
  )
}

function groupTagsByName(tags: TagEntryRow[]) {
  return tags.reduce((groups, entry) => {
    const dates = groups.get(entry.tag) ?? new Set<string>()
    dates.add(entry.date)
    groups.set(entry.tag, dates)

    return groups
  }, new Map<string, Set<string>>())
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

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value))
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}
