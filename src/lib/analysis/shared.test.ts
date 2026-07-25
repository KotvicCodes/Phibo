import { describe, expect, it } from "vitest"

import { createSeededRng } from "./stats"
import {
  average,
  winsorizedMean,
  winsorizedMeanOfFinite,
  WINSORIZE_FRACTION
} from "./shared"

// A deliberately naive winsorized mean (full sort, no quickselect) to check
// the fast path against, on random inputs the hand-rolled selection could
// otherwise get subtly wrong.
function referenceWinsorized(values: number[], fraction = WINSORIZE_FRACTION) {
  const n = values.length
  if (n === 0) return null
  const k = Math.floor(fraction * n)
  const sorted = [...values].sort((left, right) => left - right)
  const low = sorted[k]
  const high = sorted[n - 1 - k]
  let sum = 0
  for (const value of sorted) {
    sum += value < low ? low : value > high ? high : value
  }
  return sum / n
}

describe("winsorizedMeanOfFinite", () => {
  it("is the plain mean below one point per tail (k = 0)", () => {
    // Nine values: floor(0.1 * 9) = 0, so nothing is clamped.
    const values = [0, 10, 10, 10, 10, 10, 10, 10, 100]
    expect(winsorizedMeanOfFinite(values)).toBeCloseTo(average(values)!, 10)
  })

  it("clamps the extremes once the group is large enough", () => {
    // Ten values, k = 1: the low 0 clamps up to 10 and the high 100 clamps
    // down to 10, so every value becomes 10.
    const values = [0, 10, 10, 10, 10, 10, 10, 10, 10, 100]
    expect(winsorizedMeanOfFinite(values)).toBeCloseTo(10, 10)
    // The plain mean would be dragged to 18 by the two extremes.
    expect(average(values)).toBeCloseTo(18, 10)
  })

  it("respects a custom fraction", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100]
    // fraction 0.2 -> k = 2: clamp the two lowest up to values[2] = 2 and the
    // two highest down to values[7] = 7.
    expect(winsorizedMeanOfFinite(values, 0.2)).toBeCloseTo(
      referenceWinsorized(values, 0.2)!,
      10
    )
  })

  it("matches the naive full-sort reference on random inputs", () => {
    const rng = createSeededRng(99)
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + Math.floor(rng() * 60)
      const values = Array.from({ length: n }, () => rng() * 200 - 50)
      const expected = referenceWinsorized([...values])
      expect(winsorizedMeanOfFinite([...values])).toBeCloseTo(expected!, 9)
    }
  })

  it("returns null on empty input", () => {
    expect(winsorizedMeanOfFinite([])).toBeNull()
  })
})

describe("winsorizedMean", () => {
  it("drops null and non-finite gaps before winsorizing", () => {
    const withGaps = [0, 10, 10, 10, 10, 10, 10, 10, 10, 100, null, undefined]
    expect(winsorizedMean(withGaps)).toBeCloseTo(10, 10)
    expect(winsorizedMean([null, undefined])).toBeNull()
  })
})
