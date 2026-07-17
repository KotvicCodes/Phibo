import {
  getRankedTagInsights,
  takeTopInsights,
  type calculateTagCorrelations,
  type PrimaryInsightMetric,
  type TagInsight
} from "./correlations"
import { roundToOne } from "./shared"
import type { TagEffectsModel } from "./tagEffects"

const primaryMetrics: PrimaryInsightMetric[] = ["sleepScore", "readinessScore"]

// Same bar as the naive ranking's weighted-impact cutoff, but in plain
// score points: the ridge coefficients need no support weighting (the
// penalty already shrinks thin tags) and no per-metric weight heuristic.
const MIN_ADJUSTED_IMPACT = 1.5

// Ranks the rewarding and concerning insights by the model's steady-state
// effect (same-day plus next-day carry-over) instead of the observed
// average delta, so a tag is ranked for what the model credits to it
// rather than for what a co-occurring habit did. Metrics whose model is
// below its data gates fall back to the naive ranking for that metric;
// with no models at all the result is exactly the naive ranking.
export function getAdjustedTagInsights(
  models: Record<PrimaryInsightMetric, TagEffectsModel | null>,
  correlations: ReturnType<typeof calculateTagCorrelations>
): { rewarding: TagInsight[]; concerning: TagInsight[] } {
  const naive = getRankedTagInsights(correlations)
  if (models.sleepScore === null && models.readinessScore === null) {
    return naive
  }

  // Nights shown on the cards stay the analysis-sample counts the rest of
  // the view uses; the model's own span count is only a fallback.
  const nightsByTag = new Map(
    correlations.map((correlation) => [
      correlation.tag,
      correlation.daysWithTag
    ])
  )

  const candidates: TagInsight[] = []
  for (const metric of primaryMetrics) {
    const model = models[metric]
    if (model === null) {
      candidates.push(
        ...[...naive.rewarding, ...naive.concerning].filter(
          (insight) => insight.metric === metric
        )
      )
      continue
    }
    for (const effect of model.effects.values()) {
      if (effect.sameDayEffect === null && effect.nextDayEffect === null) {
        continue
      }
      const delta = roundToOne(
        (effect.sameDayEffect ?? 0) + (effect.nextDayEffect ?? 0)
      )
      if (Math.abs(delta) < MIN_ADJUSTED_IMPACT) continue
      candidates.push({
        kind: delta > 0 ? "rewarding" : "concerning",
        metric,
        tag: effect.tag,
        daysWithTag: nightsByTag.get(effect.tag) ?? effect.daysWithTag,
        delta,
        supportScore: 1,
        weightedImpact: Math.abs(delta)
      })
    }
  }

  return {
    rewarding: takeTopInsights(candidates, "rewarding"),
    concerning: takeTopInsights(candidates, "concerning")
  }
}
