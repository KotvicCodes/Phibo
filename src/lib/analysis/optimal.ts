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
  // Marginal effect on the summed target estimate of toggling this tag
  // against the current selection: for selected tags the cost of removing
  // them, for unselected tags the effect of adding them.
  targetImpact: number
}

export interface OptimalDayResult {
  target: OptimalTarget
  baselines: Record<ScoreCategory, number | null>
  bestDayAverages: Record<ScoreCategory, number | null>
  estimates: Record<ScoreCategory, number | null>
  estimateDeltas: Record<ScoreCategory, number | null>
  contributions: OptimalTagContribution[]
  otherEligibleTags: OptimalTagContribution[]
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
  options: {
    target?: OptimalTarget
    excludedTags?: string[]
    includedTags?: string[]
    // Days used for the best/worst-days bounds. Baselines and tag deltas
    // are anchored to `metrics` (the analysis set, which may exclude
    // untagged days for fair tag contrasts), but the saturation bounds are
    // physical limits: the optimal day cannot beat the user's actual best
    // days, tagged or not. Defaults to `metrics`.
    boundsMetrics?: DailyMetricRow[]
  } = {}
): OptimalDayResult {
  const target = options.target ?? "total"
  const excludedTags = new Set(options.excludedTags ?? [])
  const includedTags = new Set(options.includedTags ?? [])
  const boundsMetrics = options.boundsMetrics ?? metrics
  const targetCategories =
    optimalTargets.find((option) => option.id === target)?.categories ?? []
  const baselines = mapCategories((key) =>
    average(metrics.map((day) => day[key]))
  )

  const eligibleTags = Array.from(groupTagsByName(tags).entries())
    .map(([tag, dates]) => {
      const taggedDates = new Set(dates)
      const daysWithTag = metrics.filter((day) => taggedDates.has(day.date))
      const daysWithoutTag = metrics.filter(
        (day) => !taggedDates.has(day.date)
      )
      // Deltas compare tagged days against ALL days, not just untagged
      // ones. The baseline already contains the tagged days, so a
      // tagged-vs-untagged delta would be double-counted when added back,
      // and a near-daily tag would get a huge delta from a handful of
      // untagged nights. Against the overall average, a tag applied to
      // almost every day correctly contributes almost nothing.
      const deltas = mapCategories((key) => {
        const taggedAverage = average(daysWithTag.map((day) => day[key]))
        const overallAverage = baselines[key]

        return taggedAverage === null || overallAverage === null
          ? null
          : taggedAverage - overallAverage
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

  const bestDayAverages = mapCategories((key) =>
    tailAverage(
      boundsMetrics
        .map((day) => day[key])
        .filter((value): value is number => value != null),
      "top"
    )
  )
  const worstDayAverages = mapCategories((key) =>
    tailAverage(
      boundsMetrics
        .map((day) => day[key])
        .filter((value): value is number => value != null),
      "bottom"
    )
  )

  // The default set is optimized against the actual estimate, not a naive
  // "every positive contribution" rule, so no single tag added or removed
  // could improve the target estimate. User overrides then adjust it both
  // ways: excluded tags drop out even when helpful, included tags stay in
  // even when they hurt, so "what if" estimates stay honest.
  const selectedTags = optimizeSelection(
    eligibleTags,
    targetCategories,
    baselines,
    bestDayAverages,
    worstDayAverages
  )

  for (const tag of excludedTags) {
    selectedTags.delete(tag)
  }

  for (const candidate of eligibleTags) {
    if (includedTags.has(candidate.tag)) {
      selectedTags.add(candidate.tag)
    }
  }

  // The raw contribution of a tag says how it performs alone, but with the
  // damped combination a standalone-positive tag can still hurt the final
  // estimate. Rank each tag by its marginal effect against the current
  // selection instead, so the UI numbers match what toggling actually does.
  const currentTargetScore = selectionTargetScore(
    eligibleTags,
    selectedTags,
    targetCategories,
    baselines,
    bestDayAverages,
    worstDayAverages
  )

  const withTargetImpact = (candidate: (typeof eligibleTags)[number]) => {
    const trial = new Set(selectedTags)

    if (trial.has(candidate.tag)) {
      trial.delete(candidate.tag)
    } else {
      trial.add(candidate.tag)
    }

    const trialScore = selectionTargetScore(
      eligibleTags,
      trial,
      targetCategories,
      baselines,
      bestDayAverages,
      worstDayAverages
    )
    const { daysWithoutTag, ...contribution } = candidate

    return {
      ...contribution,
      targetImpact: roundToOne(
        selectedTags.has(candidate.tag)
          ? currentTargetScore - trialScore
          : trialScore - currentTargetScore
      )
    }
  }

  const contributions = eligibleTags
    .filter((candidate) => selectedTags.has(candidate.tag))
    .map(withTargetImpact)
    .sort((left, right) => right.targetImpact - left.targetImpact)

  const otherEligibleTags = eligibleTags
    .filter((candidate) => !selectedTags.has(candidate.tag))
    .map(withTargetImpact)
    .sort((left, right) => right.targetImpact - left.targetImpact)

  const estimates = mapCategories((key) => {
    const baseline = baselines[key]

    if (baseline === null) {
      return null
    }

    return roundToOne(
      clampScore(
        saturatedEstimate(
          baseline,
          dampedContributionSum(contributions, key),
          bestDayAverages[key] ?? baseline,
          worstDayAverages[key] ?? baseline
        )
      )
    )
  })

  return {
    target,
    baselines: mapCategories((key) => {
      const baseline = baselines[key]

      return baseline === null ? null : roundToOne(baseline)
    }),
    bestDayAverages: mapCategories((key) => {
      const bestDayAverage = bestDayAverages[key]

      return bestDayAverage === null ? null : roundToOne(bestDayAverage)
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
    otherEligibleTags,
    eligibleTagCount: eligibleTags.length
  }
}

// The optimal day cannot be better than the user's actually-observed best
// days. Contributions push the estimate toward the best-decile average with
// exponentially diminishing returns instead of past it: small sums behave
// like plain addition, large sums approach the ceiling asymptotically.
// Negative sums mirror this toward the worst-decile average.
function saturatedEstimate(
  baseline: number,
  contributionSum: number,
  ceiling: number,
  floor: number
) {
  if (contributionSum > 0) {
    const headroom = ceiling - baseline

    if (headroom <= 0) {
      return baseline
    }

    return baseline + headroom * (1 - Math.exp(-contributionSum / headroom))
  }

  if (contributionSum < 0) {
    const legroom = baseline - floor

    if (legroom <= 0) {
      return baseline
    }

    return baseline - legroom * (1 - Math.exp(contributionSum / legroom))
  }

  return baseline
}

function tailAverage(values: number[], tail: "bottom" | "top") {
  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((left, right) => right - left)
  const count = Math.max(1, Math.round(sorted.length * 0.1))
  const slice = tail === "top" ? sorted.slice(0, count) : sorted.slice(-count)

  return slice.reduce((total, value) => total + value, 0) / count
}

// Selected tags overlap heavily on the same good days, so summing their
// deltas would double-count. Harmonic rank damping keeps the strongest
// signal at full weight and gives correlated extras diminishing returns.
// Positive and negative values are damped separately: a large negative
// delta must not steal a top rank and demote every positive contribution.
function dampedContributionSum(
  contributions: Array<Pick<OptimalTagContribution, "weightedDeltas">>,
  key: ScoreCategory
) {
  const values = contributions
    .map((contribution) => contribution.weightedDeltas[key])
    .filter((value) => value !== 0)

  return (
    dampedSum(values.filter((value) => value > 0)) +
    dampedSum(values.filter((value) => value < 0))
  )
}

function dampedSum(values: number[]) {
  return values
    .sort((left, right) => Math.abs(right) - Math.abs(left))
    .reduce((total, value, index) => total + value / (index + 1), 0)
}

// Greedy local search over the eligible tags: starting from every tag with
// a positive raw contribution, repeatedly apply the single add or remove
// that most improves the summed target estimate, until no single change
// helps. This keeps the default set consistent with the nonlinear damped
// and saturated estimate the cards actually show.
// The summed target estimate for a candidate selection, shared by the
// optimizer and by the per-tag marginal impact numbers shown in the UI.
function selectionTargetScore(
  candidates: Array<{ tag: string } & Pick<OptimalTagContribution, "weightedDeltas">>,
  selection: Set<string>,
  targetCategories: ScoreCategory[],
  baselines: Record<ScoreCategory, number | null>,
  bestDayAverages: Record<ScoreCategory, number | null>,
  worstDayAverages: Record<ScoreCategory, number | null>
) {
  const selected = candidates.filter((candidate) =>
    selection.has(candidate.tag)
  )

  return targetCategories.reduce((total, key) => {
    const baseline = baselines[key]

    if (baseline === null) {
      return total
    }

    return (
      total +
      clampScore(
        saturatedEstimate(
          baseline,
          dampedContributionSum(selected, key),
          bestDayAverages[key] ?? baseline,
          worstDayAverages[key] ?? baseline
        )
      )
    )
  }, 0)
}

function optimizeSelection(
  candidates: Array<{ tag: string } & Pick<OptimalTagContribution, "weightedDeltas" | "targetContribution">>,
  targetCategories: ScoreCategory[],
  baselines: Record<ScoreCategory, number | null>,
  bestDayAverages: Record<ScoreCategory, number | null>,
  worstDayAverages: Record<ScoreCategory, number | null>
) {
  const scoreSelection = (selection: Set<string>) =>
    selectionTargetScore(
      candidates,
      selection,
      targetCategories,
      baselines,
      bestDayAverages,
      worstDayAverages
    )

  const selection = new Set(
    candidates
      .filter((candidate) => candidate.targetContribution > 0)
      .map((candidate) => candidate.tag)
  )
  let currentScore = scoreSelection(selection)

  for (let pass = 0; pass < 100; pass++) {
    let bestTag: string | null = null
    let bestScore = currentScore

    for (const candidate of candidates) {
      const trial = new Set(selection)

      if (trial.has(candidate.tag)) {
        trial.delete(candidate.tag)
      } else {
        trial.add(candidate.tag)
      }

      const trialScore = scoreSelection(trial)

      if (trialScore > bestScore + 1e-6) {
        bestScore = trialScore
        bestTag = candidate.tag
      }
    }

    if (bestTag === null) {
      break
    }

    if (selection.has(bestTag)) {
      selection.delete(bestTag)
    } else {
      selection.add(bestTag)
    }

    currentScore = bestScore
  }

  return selection
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
