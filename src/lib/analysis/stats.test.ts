import { describe, expect, it } from "vitest"

import {
  confidenceFromEffectSe,
  confidenceFromPValue,
  createSeededRng,
  hashSeed,
  permutationTestDelta
} from "./stats"

describe("createSeededRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createSeededRng(42)
    const b = createSeededRng(42)
    for (let i = 0; i < 100; i += 1) {
      expect(a()).toBe(b())
    }
  })

  it("differs across seeds", () => {
    const a = createSeededRng(1)
    const b = createSeededRng(2)
    const streamA = Array.from({ length: 10 }, () => a())
    const streamB = Array.from({ length: 10 }, () => b())
    expect(streamA).not.toEqual(streamB)
  })

  it("stays in [0, 1) with a roughly centered mean", () => {
    const rng = createSeededRng(7)
    let sum = 0
    for (let i = 0; i < 10000; i += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      sum += value
    }
    expect(sum / 10000).toBeGreaterThan(0.45)
    expect(sum / 10000).toBeLessThan(0.55)
  })
})

describe("hashSeed", () => {
  it("is stable for the same parts", () => {
    expect(hashSeed("alcohol", "sleepScore", 400)).toBe(
      hashSeed("alcohol", "sleepScore", 400)
    )
  })

  it("changes when any part changes", () => {
    const base = hashSeed("alcohol", "sleepScore", 400)
    expect(hashSeed("alcohol", "sleepScore", 401)).not.toBe(base)
    expect(hashSeed("alcohol", "readinessScore", 400)).not.toBe(base)
    expect(hashSeed("coffee", "sleepScore", 400)).not.toBe(base)
  })

  it("does not collide on part boundaries", () => {
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"))
  })

  it("returns an unsigned 32-bit integer", () => {
    const seed = hashSeed("anything", 123)
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThan(4294967296)
  })
})

describe("permutationTestDelta", () => {
  const noise = (seed: number, count: number, mean: number, spread: number) => {
    const rng = createSeededRng(seed)
    return Array.from({ length: count }, () => mean + (rng() - 0.5) * spread)
  }

  it("returns null when either group is empty", () => {
    expect(permutationTestDelta([], [1, 2, 3])).toBeNull()
    expect(permutationTestDelta([1, 2], [])).toBeNull()
  })

  it("returns null when a group holds only non-finite values", () => {
    expect(permutationTestDelta([Number.NaN], [1, 2, 3])).toBeNull()
  })

  it("filters non-finite values instead of poisoning sums", () => {
    const clean = permutationTestDelta([70, 72], [60, 61, 62], { seed: 5 })
    const dirty = permutationTestDelta(
      [70, Number.NaN, 72],
      [60, 61, Number.POSITIVE_INFINITY, 62],
      { seed: 5 }
    )
    expect(dirty).toEqual(clean)
  })

  it("reports the observed tagged-minus-untagged delta", () => {
    const result = permutationTestDelta([80, 90], [60, 70], { resamples: 50 })
    expect(result?.delta).toBe(20)
  })

  it("does not flag a no-effect dataset as significant", () => {
    const tagged = noise(11, 30, 70, 20)
    const untagged = noise(22, 200, 70, 20)
    const result = permutationTestDelta(tagged, untagged, { seed: 3 })
    expect(result).not.toBeNull()
    expect(result!.pValue).toBeGreaterThan(0.05)
  })

  it("is roughly calibrated: null data rarely produces small p-values", () => {
    // Under the null, p-values are close to uniform, so the share below 0.1
    // over many independent null datasets should sit near 10%.
    let small = 0
    const datasets = 200
    for (let i = 0; i < datasets; i += 1) {
      const tagged = noise(1000 + i, 15, 70, 20)
      const untagged = noise(2000 + i, 80, 70, 20)
      const result = permutationTestDelta(tagged, untagged, {
        resamples: 300,
        seed: i
      })
      if (result!.pValue < 0.1) small += 1
    }
    expect(small / datasets).toBeGreaterThan(0.03)
    expect(small / datasets).toBeLessThan(0.2)
  })

  it("gives a low p-value for a strong injected effect", () => {
    const tagged = noise(11, 30, 78, 6)
    const untagged = noise(22, 200, 70, 6)
    const result = permutationTestDelta(tagged, untagged, { seed: 3 })
    expect(result).not.toBeNull()
    expect(result!.pValue).toBeLessThan(0.01)
  })

  it("is deterministic for the same seed and never exactly zero", () => {
    const tagged = noise(1, 12, 75, 8)
    const untagged = noise(2, 60, 70, 8)
    const first = permutationTestDelta(tagged, untagged, { seed: 99 })
    const second = permutationTestDelta(tagged, untagged, { seed: 99 })
    expect(first).toEqual(second)
    expect(first!.pValue).toBeGreaterThan(0)
  })

  it("is two-sided: a strong negative effect is also significant", () => {
    const tagged = noise(11, 30, 62, 6)
    const untagged = noise(22, 200, 70, 6)
    const result = permutationTestDelta(tagged, untagged, { seed: 3 })
    expect(result!.delta).toBeLessThan(0)
    expect(result!.pValue).toBeLessThan(0.01)
  })

  it("respects the resamples option", () => {
    const result = permutationTestDelta([70, 71], [60, 61, 62], {
      resamples: 25,
      seed: 1
    })
    expect(result?.resamples).toBe(25)
  })

  it("approximates the exact p-value on a tiny known case", () => {
    // One tagged value 10 vs untagged {0, 0, 0}: 1 of 4 possible subsets of
    // size 1 gives |delta| >= observed, so the exact two-sided p is 0.25.
    const result = permutationTestDelta([10], [0, 0, 0], {
      resamples: 4000,
      seed: 8
    })
    expect(result!.pValue).toBeGreaterThan(0.2)
    expect(result!.pValue).toBeLessThan(0.3)
  })
})

describe("confidence mapping", () => {
  it("requires both a small p and enough days for high", () => {
    expect(confidenceFromPValue(0.01, 10, 20)).toBe("high")
    expect(confidenceFromPValue(0.01, 9, 20)).toBe("medium")
    expect(confidenceFromPValue(0.01, 10, 19)).toBe("medium")
    expect(confidenceFromPValue(0.06, 10, 20)).toBe("medium")
  })

  it("falls to low on weak evidence or thin data", () => {
    expect(confidenceFromPValue(0.2, 50, 200)).toBe("low")
    expect(confidenceFromPValue(0.01, 4, 200)).toBe("low")
    expect(confidenceFromPValue(0.1, 5, 9)).toBe("low")
    expect(confidenceFromPValue(null, 50, 200)).toBe("low")
  })

  it("maps effect-to-se ratios with the same day gates", () => {
    expect(confidenceFromEffectSe(5, 2, 10, 20)).toBe("high")
    expect(confidenceFromEffectSe(-5, 2, 10, 20)).toBe("high")
    expect(confidenceFromEffectSe(3, 2, 10, 20)).toBe("medium")
    expect(confidenceFromEffectSe(1, 2, 10, 20)).toBe("low")
    expect(confidenceFromEffectSe(5, 2, 4, 20)).toBe("low")
    expect(confidenceFromEffectSe(5, 0, 10, 20)).toBe("low")
    expect(confidenceFromEffectSe(Number.NaN, 2, 10, 20)).toBe("low")
  })
})
