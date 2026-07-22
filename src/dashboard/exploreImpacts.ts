import type {
  ExploreMetricCategory,
  ExploreMetricImpact,
  ExploreMetricKey
} from "../lib/analysis/correlations"
import { formatExploreDelta } from "./exploreCharts"

interface ExploreImpactGroup {
  category: ExploreMetricCategory
  rows: ExploreMetricImpact[]
  strongest: ExploreMetricImpact | null
}

const exploreImpactCategoryOrder: ExploreMetricCategory[] = [
  "Sleep",
  "Readiness",
  "Activity",
  "Health"
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

// The strongest effect in a pass is scanned once per impacts array, not
// once per rendered row: tone and width run for every one of ~65 rows.
const maxEffectSizeCache = new WeakMap<ExploreMetricImpact[], number>()

function maxEffectSize(impacts: ExploreMetricImpact[]) {
  const cached = maxEffectSizeCache.get(impacts)

  if (cached !== undefined) {
    return cached
  }

  const max = Math.max(
    ...impacts.map((impact) => Math.abs(impact.effectSize ?? 0)),
    0.1
  )

  maxEffectSizeCache.set(impacts, max)

  return max
}

function effectIntensity(
  effectSize: number | null,
  impacts: ExploreMetricImpact[]
) {
  if (effectSize === null) {
    return 0
  }

  return Math.min(Math.abs(effectSize) / maxEffectSize(impacts), 1)
}

export function impactEffectTone(
  effectSize: number | null,
  impacts: ExploreMetricImpact[]
) {
  if (effectSize === null || effectSize === 0) {
    return "neutral"
  }

  const intensity = effectIntensity(effectSize, impacts)

  if (intensity < 0.2) {
    return "neutral"
  }

  const strong = intensity >= 0.66

  if (effectSize > 0) {
    return strong ? "excellent" : "positive"
  }

  return strong ? "negative" : "warning"
}

export function impactWidth(
  row: ExploreMetricImpact,
  impacts: ExploreMetricImpact[]
) {
  return `${effectIntensity(row.effectSize, impacts) * 100}%`
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

// The headline metric of a category, ranked by standardized effect size so
// that points, minutes, calories, and steps stay comparable. A raw delta
// must never enter this comparison: a 480-step difference would outrank
// every effect size that can exist, and the category would headline
// whichever metric happens to have the largest units.
//
// A selection matching a single day yields no effect size anywhere (one
// observation has no spread), and there is no honest way to name a
// strongest metric across different units without one, so the group
// reports none and the rows still show their own deltas.
function strongestExploreImpact(rows: ExploreMetricImpact[]) {
  return rows.reduce<ExploreMetricImpact | null>((strongest, row) => {
    if (row.delta === null || row.effectSize === null) {
      return strongest
    }

    if (strongest === null || strongest.effectSize === null) {
      return row
    }

    return Math.abs(row.effectSize) > Math.abs(strongest.effectSize)
      ? row
      : strongest
  }, null)
}

export function impactGroupTone(
  group: ExploreImpactGroup,
  impacts: ExploreMetricImpact[]
) {
  return impactEffectTone(group.strongest?.effectSize ?? null, impacts)
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
