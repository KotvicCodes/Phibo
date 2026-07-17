export type ConfidenceLevel = "high" | "medium" | "low"

const DEFAULT_RESAMPLES = 1000

// mulberry32: tiny deterministic PRNG so confidence labels are stable across
// reloads of the same data.
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a style hash over the string forms of the parts, for stable seeds
// derived from tag names, metric keys, and sample sizes.
export function hashSeed(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5
  for (const part of parts) {
    const text = String(part)
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export interface PermutationResult {
  delta: number
  pValue: number
  resamples: number
}

// Two-sided permutation test on the difference of group means. Shuffles which
// days carry the tag and counts how often a chance split produces a gap at
// least as large as the observed one. Each resample draws the tagged subset
// with a partial Fisher-Yates and uses the subset sum, so a resample costs
// O(taggedValues.length), not O(n).
export function permutationTestDelta(
  taggedValues: number[],
  untaggedValues: number[],
  options?: { resamples?: number; seed?: number }
): PermutationResult | null {
  const tagged = taggedValues.filter((value) => Number.isFinite(value))
  const untagged = untaggedValues.filter((value) => Number.isFinite(value))
  if (tagged.length === 0 || untagged.length === 0) return null

  const resamples = options?.resamples ?? DEFAULT_RESAMPLES
  const rng = createSeededRng(options?.seed ?? 1)
  const values = [...tagged, ...untagged]
  const total = values.reduce((sum, value) => sum + value, 0)
  const taggedCount = tagged.length
  const untaggedCount = untagged.length

  const taggedSum = tagged.reduce((sum, value) => sum + value, 0)
  const observedDelta =
    taggedSum / taggedCount - (total - taggedSum) / untaggedCount
  const observedMagnitude = Math.abs(observedDelta)

  const indices = values.map((_, index) => index)
  let hits = 0
  for (let resample = 0; resample < resamples; resample += 1) {
    let subsetSum = 0
    for (let position = 0; position < taggedCount; position += 1) {
      const pick =
        position + Math.floor(rng() * (indices.length - position))
      const picked = indices[pick]
      indices[pick] = indices[position]
      indices[position] = picked
      subsetSum += values[picked]
    }
    const shuffledDelta =
      subsetSum / taggedCount - (total - subsetSum) / untaggedCount
    if (Math.abs(shuffledDelta) >= observedMagnitude) hits += 1
  }

  return {
    delta: observedDelta,
    // Add-one smoothing keeps p above zero; a permutation test can never
    // certify impossibility, only rarity.
    pValue: (1 + hits) / (1 + resamples),
    resamples
  }
}

// Benjamini-Hochberg step-up adjustment: converts p-values from a family of
// simultaneous tests into q-values (false discovery rates). Position
// preserving; null entries pass through and do not count toward the family
// size. Uses the cumulative-minimum fix so q-values are monotone in p.
export function benjaminiHochberg(
  pValues: Array<number | null>
): Array<number | null> {
  const indexed = pValues
    .map((pValue, index) => ({ pValue, index }))
    .filter(
      (entry): entry is { pValue: number; index: number } =>
        entry.pValue !== null && Number.isFinite(entry.pValue)
    )
  const familySize = indexed.length
  const qValues: Array<number | null> = pValues.map(() => null)
  if (familySize === 0) return qValues

  indexed.sort((left, right) => left.pValue - right.pValue)
  let runningMinimum = 1
  for (let rank = familySize; rank >= 1; rank -= 1) {
    const entry = indexed[rank - 1]
    const raw = (entry.pValue * familySize) / rank
    runningMinimum = Math.min(runningMinimum, raw)
    qValues[entry.index] = Math.min(1, runningMinimum)
  }
  return qValues
}

function confidenceFromCounts(
  strength: "high" | "medium" | "none",
  taggedCount: number,
  untaggedCount: number
): ConfidenceLevel {
  if (strength === "high" && taggedCount >= 10 && untaggedCount >= 20) {
    return "high"
  }
  if (strength !== "none" && taggedCount >= 5 && untaggedCount >= 10) {
    return "medium"
  }
  return "low"
}

export function confidenceFromPValue(
  pValue: number | null,
  taggedCount: number,
  untaggedCount: number
): ConfidenceLevel {
  if (pValue === null || !Number.isFinite(pValue)) return "low"
  const strength = pValue < 0.05 ? "high" : pValue < 0.15 ? "medium" : "none"
  return confidenceFromCounts(strength, taggedCount, untaggedCount)
}

export function confidenceFromEffectSe(
  effect: number,
  standardError: number,
  taggedCount: number,
  untaggedCount: number
): ConfidenceLevel {
  if (!Number.isFinite(effect) || !Number.isFinite(standardError)) return "low"
  if (standardError <= 0) return "low"
  const ratio = Math.abs(effect) / standardError
  const strength = ratio > 2 ? "high" : ratio > 1.3 ? "medium" : "none"
  return confidenceFromCounts(strength, taggedCount, untaggedCount)
}
