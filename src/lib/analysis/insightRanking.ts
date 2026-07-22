import {
  getRankedTagInsights,
  takeTopInsights,
  type calculateTagCorrelations,
  type PrimaryInsightMetric,
  type TagInsight
} from "./correlations"
import type { InsightConfidenceModel } from "./insightConfidence"
import { roundToOne } from "./shared"
import { adjustedHeadlineEffect, type TagEffectsModel } from "./tagEffects"

const primaryMetrics: PrimaryInsightMetric[] = ["sleepScore", "readinessScore"]

// Same bar as the naive ranking's weighted-impact cutoff, but in plain
// score points: the ridge coefficients need no support weighting (the
// penalty already shrinks thin tags) and no per-metric weight heuristic.
const MIN_ADJUSTED_IMPACT = 1.5

// Ranks the rewarding and concerning insights by the model's guarded
// steady-state effect (only medium-plus components count), with the
// observed effect as an independent safety anchor. The model may refine an
// observed effect, and it may zero out a tag that merely rides along with
// another (the late-meal case), but it must never flip the direction of a
// strong significant observed effect: a tag is its whole lived bundle, and
// at low sample sizes a collinear ridge fit can redistribute effects into
// a sign flip that no in-model confidence can detect (precision is not
// truth). Decision per tag and metric:
// - guarded effect (medium-plus components) exists: use it, unless it
//   opposes a significant observed delta, then the observed delta wins
//   ("observed-conflict").
// - only low-confidence components: the raw sum's direction decides.
//   Opposing a significant observed delta -> observed wins
//   ("observed-conflict"); agreeing with meaningful magnitude -> observed
//   shows ("observed"); partialled under the impact bar -> no candidate,
//   so a confounded tag cannot resurrect through the fallback.
// - no model estimate at all: significant observed delta shows
//   ("observed"), else no candidate.
// observedConfidence null means the guard and the observed fallback are
// both off (guarded effects only); the view always passes the model once
// its deferred pass lands.
export function getAdjustedTagInsights(
  models: Record<PrimaryInsightMetric, TagEffectsModel | null>,
  correlations: ReturnType<typeof calculateTagCorrelations>,
  observedConfidence: InsightConfidenceModel | null
): { rewarding: TagInsight[]; concerning: TagInsight[] } {
  const naive = getRankedTagInsights(correlations)
  if (models.sleepScore === null && models.readinessScore === null) {
    return naive
  }

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
    for (const correlation of correlations) {
      const effect = model.effects.get(correlation.tag)
      const guarded = adjustedHeadlineEffect(effect)
      // The raw ungated sum distinguishes "the model estimated this tag
      // but cannot attest a reliable effect" from "the model was never
      // able to estimate it". Without this, a confounded tag partialled
      // to ~0 (whose tiny coefficient is low confidence BECAUSE it is
      // tiny) would resurrect through the observed fallback.
      const rawSum =
        effect == null ||
        (effect.sameDayEffect === null && effect.nextDayEffect === null)
          ? null
          : (effect.sameDayEffect ?? 0) + (effect.nextDayEffect ?? 0)
      const observedDelta = correlation.deltas[metric] ?? null
      const observedLevel = observedConfidence?.results.get(
        `${correlation.tag}-${metric}`
      )?.level
      const observedSignificant =
        (observedLevel === "medium" || observedLevel === "high") &&
        observedDelta !== null

      // A model value only makes a directional claim when it is itself
      // meaningful: a coefficient partialled to near zero with the
      // opposite sign is the desired confounding outcome, not a flip.
      const opposes = (modelValue: number) =>
        observedSignificant &&
        Math.abs(modelValue) >= MIN_ADJUSTED_IMPACT &&
        Math.sign(observedDelta as number) !== 0 &&
        Math.sign(modelValue) !== Math.sign(observedDelta as number)

      let value: number
      let evidence: TagInsight["evidence"]
      if (guarded !== null) {
        // Sign comparisons run on unrounded values; a guarded effect near
        // zero is the desired partialling outcome, not a flip.
        if (opposes(guarded)) {
          value = observedDelta as number
          evidence = "observed-conflict"
        } else {
          value = guarded
          evidence = "adjusted"
        }
      } else if (rawSum !== null) {
        // All components are low confidence. The model still estimated
        // the tag, so its direction decides what the observed effect may
        // do: a conflicting model is overruled by a significant observed
        // effect, a weakly agreeing model lets the observed effect show,
        // and a model that partialled the tag under the impact bar keeps
        // it out (the observed effect belongs to its co-travelers).
        if (opposes(rawSum)) {
          value = observedDelta as number
          evidence = "observed-conflict"
        } else if (
          observedSignificant &&
          Math.abs(rawSum) >= MIN_ADJUSTED_IMPACT
        ) {
          value = observedDelta as number
          evidence = "observed"
        } else {
          continue
        }
      } else if (observedSignificant) {
        // The model has no estimate for this tag at all.
        value = observedDelta as number
        evidence = "observed"
      } else {
        continue
      }

      // The bar applies to the unrounded value so it agrees with the
      // opposes() check above; otherwise a value just under the bar could
      // round up past it and slip through with an unguarded direction.
      if (Math.abs(value) < MIN_ADJUSTED_IMPACT) continue
      const delta = roundToOne(value)
      candidates.push({
        kind: delta > 0 ? "rewarding" : "concerning",
        metric,
        tag: correlation.tag,
        daysWithTag: correlation.daysWithTag,
        delta,
        supportScore: 1,
        weightedImpact: Math.abs(delta),
        evidence
      })
    }
  }

  return {
    rewarding: takeTopInsights(candidates, "rewarding"),
    concerning: takeTopInsights(candidates, "concerning")
  }
}
