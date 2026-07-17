import type { DailyMetricRow, TagEntryRow } from "../db/types"

import type { PrimaryInsightMetric } from "./correlations"
import { groupTagsByName } from "./shared"
import {
  benjaminiHochberg,
  confidenceFromPValue,
  hashSeed,
  permutationTestDelta,
  type ConfidenceLevel
} from "./stats"

export interface InsightPairConfidence {
  level: ConfidenceLevel
  pValue: number | null
  qValue: number | null
  taggedCount: number
  untaggedCount: number
}

export interface InsightConfidenceModel {
  // Keyed by `${tag}-${metric}`, matching the insight keys the view uses.
  results: Map<string, InsightPairConfidence>
  familySize: number
}

const primaryMetrics: PrimaryInsightMetric[] = ["sleepScore", "readinessScore"]

// The ranked insights are chosen BECAUSE their deltas are extreme, so a raw
// per-tag p-value is optimistic: the top delta among N candidates clears
// p < 0.05 easily under a global null (the winner's curse). The correction
// is to test the whole candidate pool the ranking selected from, every
// tag and score pair, and run Benjamini-Hochberg across that family, so a
// displayed badge accounts for the search that surfaced it.
//
// Resamples scale with the family: add-one smoothing floors p at
// 1 / (resamples + 1), and the rank-1 q multiplies that floor by the family
// size m, so resamples = 25 * m keeps the floor q near 0.04, safely under
// the 0.05 high cut, regardless of how many tags the user has.
const MIN_RESAMPLES = 2000
const RESAMPLES_PER_FAMILY_MEMBER = 25

export function calculateInsightConfidence(
  metrics: DailyMetricRow[],
  entries: TagEntryRow[]
): InsightConfidenceModel {
  const pairs: Array<{
    key: string
    tag: string
    metric: PrimaryInsightMetric
    tagged: number[]
    untagged: number[]
  }> = []
  for (const [tag, dates] of groupTagsByName(entries)) {
    for (const metric of primaryMetrics) {
      const tagged: number[] = []
      const untagged: number[] = []
      for (const day of metrics) {
        const value = day[metric]
        if (typeof value !== "number" || !Number.isFinite(value)) continue
        if (dates.has(day.date)) tagged.push(value)
        else untagged.push(value)
      }
      if (tagged.length === 0 || untagged.length === 0) continue
      pairs.push({ key: `${tag}-${metric}`, tag, metric, tagged, untagged })
    }
  }

  const familySize = pairs.length
  const resamples = Math.max(
    MIN_RESAMPLES,
    familySize * RESAMPLES_PER_FAMILY_MEMBER
  )
  const pValues = pairs.map((pair) => {
    // The two-sided permutation p is symmetric under swapping the groups,
    // so resampling the smaller side keeps near-daily tags cheap.
    const [smaller, larger] =
      pair.tagged.length <= pair.untagged.length
        ? [pair.tagged, pair.untagged]
        : [pair.untagged, pair.tagged]
    const test = permutationTestDelta(smaller, larger, {
      resamples,
      seed: hashSeed(pair.tag, pair.metric, metrics.length)
    })
    return test?.pValue ?? null
  })
  const qValues = benjaminiHochberg(pValues)

  const results = new Map<string, InsightPairConfidence>()
  pairs.forEach((pair, index) => {
    results.set(pair.key, {
      level: confidenceFromPValue(
        qValues[index],
        pair.tagged.length,
        pair.untagged.length
      ),
      pValue: pValues[index],
      qValue: qValues[index],
      taggedCount: pair.tagged.length,
      untaggedCount: pair.untagged.length
    })
  })
  return { results, familySize }
}

// InsightsView is destroyed on every view switch, so the memo lives at
// module scope, keyed on the input array identities like the model memo.
let memo: {
  metrics: DailyMetricRow[]
  entries: TagEntryRow[]
  result: InsightConfidenceModel
} | null = null

export function calculateInsightConfidenceMemoized(
  metrics: DailyMetricRow[],
  entries: TagEntryRow[]
): InsightConfidenceModel {
  const cached = peekInsightConfidence(metrics, entries)
  if (cached !== undefined) return cached
  const result = calculateInsightConfidence(metrics, entries)
  memo = { metrics, entries, result }
  return result
}

export function peekInsightConfidence(
  metrics: DailyMetricRow[],
  entries: TagEntryRow[]
): InsightConfidenceModel | undefined {
  if (memo && memo.metrics === metrics && memo.entries === entries) {
    return memo.result
  }
  return undefined
}
