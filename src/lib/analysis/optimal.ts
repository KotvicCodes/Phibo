import type { DailyMetricRow, TagEntryRow } from "../db/types"
import { calculateSupportScore } from "./correlations"
import { average, groupTagsByName, roundToOne } from "./shared"
import type { ConfidenceLevel } from "./stats"
import {
  adjustedHeadlineEffect,
  type TagEffect,
  type TagEffectsModel
} from "./tagEffects"

export const OPTIMAL_MIN_TAGGED_DAYS = 10
const OPTIMAL_MIN_UNTAGGED_DAYS = 8
// Sign-guard thresholds: the observed delta must be this large (points)
// before it can overrule the model, and a model value must be this large
// before its direction counts as a claim at all.
const OBSERVED_CONFLICT_MIN_DELTA = 2
const ADJUSTED_CONFLICT_MIN_EFFECT = 1.5

export type ScoreCategory = "activityScore" | "readinessScore" | "sleepScore"
export type OptimalTarget =
  | "activity"
  | "night"
  | "readiness"
  | "sleep"
  | "total"

interface OptimalTargetOption {
  id: OptimalTarget
  label: string
  categories: ScoreCategory[]
}

interface OptimalTagContribution {
  tag: string
  daysWithTag: number
  supportScore: number
  deltas: Record<ScoreCategory, number | null>
  weightedDeltas: Record<ScoreCategory, number>
  // Model confidence per category in adjusted mode (the weaker of the
  // same-day and next-day levels); all null in naive mode.
  confidences: Record<ScoreCategory, ConfidenceLevel | null>
  targetContribution: number
  // Marginal effect on the summed target estimate of toggling this tag
  // against the current selection: for selected tags the cost of removing
  // them, for unselected tags the effect of adding them.
  targetImpact: number
}

interface OptimalDayResult {
  target: OptimalTarget
  baselines: Record<ScoreCategory, number | null>
  bestDayAverages: Record<ScoreCategory, number | null>
  estimates: Record<ScoreCategory, number | null>
  estimateDeltas: Record<ScoreCategory, number | null>
  contributions: OptimalTagContribution[]
  otherEligibleTags: OptimalTagContribution[]
  eligibleTagCount: number
  // Categories whose deltas come from the ridge adjusted-effects model
  // instead of observed averages.
  adjustedCategories: ScoreCategory[]
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
    // Ridge models per category. A category with a non-null model switches
    // to adjusted deltas: the tag's steady-state coefficient (same-day plus
    // next-day carry-over) scaled by its absence share, with no support
    // weighting and no harmonic damping, since the regression already
    // shrinks thin coefficients and holds co-occurring tags constant.
    // Categories without a model keep the naive path unchanged.
    adjustedModels?: Partial<Record<ScoreCategory, TagEffectsModel | null>>
  } = {}
): OptimalDayResult {
  const target = options.target ?? "total"
  const excludedTags = new Set(options.excludedTags ?? [])
  const includedTags = new Set(options.includedTags ?? [])
  const boundsMetrics = options.boundsMetrics ?? metrics
  const adjustedModels = options.adjustedModels ?? {}
  const adjustedCategories = new Set<ScoreCategory>(
    scoreCategories
      .map((category) => category.key)
      .filter((key) => adjustedModels[key] != null)
  )
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
      // Naive deltas compare tagged days against ALL days, not just
      // untagged ones. The baseline already contains the tagged days, so a
      // tagged-vs-untagged delta would be double-counted when added back,
      // and a near-daily tag would get a huge delta from a handful of
      // untagged nights. Against the overall average, a tag applied to
      // almost every day correctly contributes almost nothing.
      //
      // Adjusted deltas apply the same reasoning to the ridge coefficient:
      // it measures a tagged-vs-untagged contrast (holding other tags,
      // weekday, and trend constant), so scaling by the tag's absence share
      // (1 - daysWithTag / days) converts it into the same baseline-relative
      // offset, and a near-daily tag again contributes almost nothing. The
      // steady-state effect includes next-day carry-over: an optimal day is
      // a repeatable routine, so each day earns today's same-day effect and
      // yesterday's lag effect.
      const observedDeltas = mapCategories((key) => {
        const taggedAverage = average(daysWithTag.map((day) => day[key]))
        const overallAverage = baselines[key]

        return taggedAverage === null || overallAverage === null
          ? null
          : taggedAverage - overallAverage
      })
      // Fallback flags per category: set when an adjusted category uses the
      // observed delta instead of the model (conflict or missing estimate),
      // so the row's confidence dims to low. Filled while deltas compute.
      const usedObservedFallback = mapCategories(() => false)
      const deltas = mapCategories((key) => {
        if (!adjustedCategories.has(key)) return observedDeltas[key]
        const effect = adjustedModels[key]?.effects.get(tag)
        const observed = observedDeltas[key]
        const guarded = adjustedHeadlineEffect(effect)
        const rawSum =
          effect == null ||
          (effect.sameDayEffect === null && effect.nextDayEffect === null)
            ? null
            : (effect.sameDayEffect ?? 0) + (effect.nextDayEffect ?? 0)
        // The model may refine an effect but never reverse the direction
        // of a solid observed one: at low n a collinear ridge fit can flip
        // signs, and its own confidence cannot detect that. Both sides
        // must be meaningful before a conflict is declared; a coefficient
        // partialled to near zero is the desired outcome, not a flip.
        const opposes = (value: number) =>
          observed !== null &&
          Math.abs(observed) >= OBSERVED_CONFLICT_MIN_DELTA &&
          Math.abs(value) >= ADJUSTED_CONFLICT_MIN_EFFECT &&
          Math.sign(observed) !== 0 &&
          Math.sign(value) !== Math.sign(observed)
        if (guarded !== null) {
          if (opposes(guarded)) {
            usedObservedFallback[key] = true
            return observed
          }
          if (metrics.length === 0) return null
          return guarded * (1 - daysWithTag.length / metrics.length)
        }
        if (rawSum !== null) {
          if (opposes(rawSum)) {
            usedObservedFallback[key] = true
            return observed
          }
          // Only low-confidence components and no conflict: contribute
          // nothing. Unlike the Insights lists, Optimal SUMS contributions,
          // so falling back to observed bundles here would double-count
          // co-occurring tags whose adjusted coefficients are also summed.
          return null
        }
        // No model estimate for this tag at all: the observed delta keeps
        // the row honest, exactly what the naive path would produce.
        if (observed !== null) {
          usedObservedFallback[key] = true
          return observed
        }
        return null
      })
      const supportScore = calculateSupportScore(
        daysWithTag.length,
        daysWithoutTag.length
      )
      // Adjusted deltas take no support weighting: the ridge penalty
      // already shrinks coefficients backed by few days. Observed
      // fallbacks in adjusted categories carry their own frequency
      // anchoring (delta vs the overall baseline), so weight 1 is right
      // for them too. Bounded double-count caveat: a conflict fallback is
      // an observed bundle plain-summed next to partialled coefficients of
      // co-occurring tags; saturation bounds the damage and conflicts are
      // rare by construction.
      const weightedDeltas = mapCategories((key) =>
        roundToOne(
          (deltas[key] ?? 0) * (adjustedCategories.has(key) ? 1 : supportScore)
        )
      )
      const confidences = mapCategories((key) =>
        adjustedCategories.has(key)
          ? usedObservedFallback[key]
            ? "low"
            : guardedEffectConfidence(adjustedModels[key]?.effects.get(tag))
          : null
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
        confidences,
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
    worstDayAverages,
    adjustedCategories
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
    worstDayAverages,
    adjustedCategories
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
      worstDayAverages,
      adjustedCategories
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
          contributionSum(contributions, key, adjustedCategories.has(key)),
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
    eligibleTagCount: eligibleTags.length,
    adjustedCategories: scoreCategories
      .map((category) => category.key)
      .filter((key) => adjustedCategories.has(key))
  }
}

const confidenceRank: Record<ConfidenceLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
}

// The weaker confidence among the components that actually feed the
// guarded headline (medium-plus only); a chain is only as trustworthy as
// its weakest used link. Null when no component qualifies.
function guardedEffectConfidence(effect: TagEffect | undefined) {
  if (effect == null) return null
  const levels = [
    effect.sameDayEffect !== null ? effect.sameDayConfidence : null,
    effect.nextDayEffect !== null ? effect.nextDayConfidence : null
  ].filter(
    (level): level is ConfidenceLevel =>
      level === "medium" || level === "high"
  )
  if (levels.length === 0) return null
  return levels.reduce((weakest, level) =>
    confidenceRank[level] < confidenceRank[weakest] ? level : weakest
  )
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

// Naive deltas of selected tags overlap heavily on the same good days, so
// summing them would double-count. Harmonic rank damping keeps the
// strongest signal at full weight and gives correlated extras diminishing
// returns. Positive and negative values are damped separately: a large
// negative delta must not steal a top rank and demote every positive
// contribution. Adjusted (ridge) deltas already hold co-occurring tags
// constant, so they sum plainly; damping them would double-correct.
function contributionSum(
  contributions: Array<Pick<OptimalTagContribution, "weightedDeltas">>,
  key: ScoreCategory,
  adjusted: boolean
) {
  const values = contributions
    .map((contribution) => contribution.weightedDeltas[key])
    .filter((value) => value !== 0)

  if (adjusted) {
    return values.reduce((total, value) => total + value, 0)
  }

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
  worstDayAverages: Record<ScoreCategory, number | null>,
  adjustedCategories: Set<ScoreCategory>
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
          contributionSum(selected, key, adjustedCategories.has(key)),
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
  worstDayAverages: Record<ScoreCategory, number | null>,
  adjustedCategories: Set<ScoreCategory>
) {
  const scoreSelection = (selection: Set<string>) =>
    selectionTargetScore(
      candidates,
      selection,
      targetCategories,
      baselines,
      bestDayAverages,
      worstDayAverages,
      adjustedCategories
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

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value))
}
