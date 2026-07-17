import { describe, expect, it } from "vitest"

import { createSeededRng } from "./stats"
import { fitRidge, selectRidgeLambda, solveSymmetric } from "./regression"

describe("solveSymmetric", () => {
  it("solves a hand-checked 3x3 system", () => {
    // A = [[4,2,0],[2,5,1],[0,1,3]], x = [1,2,3] gives b = [8,15,11].
    const solution = solveSymmetric(
      [
        [4, 2, 0],
        [2, 5, 1],
        [0, 1, 3]
      ],
      [8, 15, 11]
    )
    expect(solution).not.toBeNull()
    expect(solution![0]).toBeCloseTo(1, 8)
    expect(solution![1]).toBeCloseTo(2, 8)
    expect(solution![2]).toBeCloseTo(3, 8)
  })

  it("returns null for a non positive definite matrix", () => {
    expect(
      solveSymmetric(
        [
          [1, 2],
          [2, 1]
        ],
        [1, 1]
      )
    ).toBeNull()
  })

  it("returns null for a singular matrix", () => {
    expect(
      solveSymmetric(
        [
          [1, 1],
          [1, 1]
        ],
        [2, 2]
      )
    ).toBeNull()
  })
})

// Builds n rows of synthetic data: y = intercept + sum(beta_j x_j) + noise.
function synthetic(
  seed: number,
  n: number,
  betas: number[],
  intercept: number,
  noiseSpread: number
) {
  const rng = createSeededRng(seed)
  const rows: number[][] = []
  const outcomes: number[] = []
  for (let i = 0; i < n; i += 1) {
    const row = betas.map(() => (rng() < 0.4 ? 1 : 0))
    let y = intercept + (rng() - 0.5) * noiseSpread
    for (let j = 0; j < betas.length; j += 1) y += betas[j] * row[j]
    rows.push(row)
    outcomes.push(y)
  }
  return { rows, outcomes }
}

describe("fitRidge", () => {
  it("recovers known coefficients on noiseless data with tiny lambda", () => {
    const { rows, outcomes } = synthetic(3, 200, [5, -3, 2], 70, 0)
    const fit = fitRidge(rows, outcomes, { lambda: 1e-6 })
    expect(fit).not.toBeNull()
    expect(fit!.intercept).toBeCloseTo(70, 4)
    expect(fit!.coefficients[0]).toBeCloseTo(5, 4)
    expect(fit!.coefficients[1]).toBeCloseTo(-3, 4)
    expect(fit!.coefficients[2]).toBeCloseTo(2, 4)
  })

  it("reports coefficients in raw outcome units despite standardization", () => {
    // A rare binary feature has a small standard deviation; its raw-scale
    // coefficient must still equal the injected point effect.
    const rng = createSeededRng(9)
    const rows: number[][] = []
    const outcomes: number[] = []
    for (let i = 0; i < 400; i += 1) {
      const rare = rng() < 0.06 ? 1 : 0
      rows.push([rare])
      outcomes.push(60 + rare * 8)
    }
    const fit = fitRidge(rows, outcomes, { lambda: 1e-6 })
    expect(fit!.coefficients[0]).toBeCloseTo(8, 3)
  })

  it("shrinks coefficients monotonically as lambda grows", () => {
    const { rows, outcomes } = synthetic(4, 150, [6], 70, 4)
    const magnitudes = [0.01, 1, 10, 100, 1000].map(
      (lambda) => Math.abs(fitRidge(rows, outcomes, { lambda })!.coefficients[0])
    )
    for (let i = 1; i < magnitudes.length; i += 1) {
      expect(magnitudes[i]).toBeLessThan(magnitudes[i - 1])
    }
  })

  it("moves only the intercept when a constant is added to outcomes", () => {
    const { rows, outcomes } = synthetic(5, 150, [4, -2], 70, 4)
    const base = fitRidge(rows, outcomes, { lambda: 2 })!
    const shifted = fitRidge(
      rows,
      outcomes.map((value) => value + 100),
      { lambda: 2 }
    )!
    expect(shifted.intercept).toBeCloseTo(base.intercept + 100, 6)
    expect(shifted.coefficients[0]).toBeCloseTo(base.coefficients[0], 8)
    expect(shifted.coefficients[1]).toBeCloseTo(base.coefficients[1], 8)
  })

  it("gives a constant column a zero coefficient without NaN", () => {
    const { rows, outcomes } = synthetic(6, 100, [5], 70, 2)
    const withConstant = rows.map((row) => [...row, 1])
    const fit = fitRidge(withConstant, outcomes, { lambda: 1 })
    expect(fit).not.toBeNull()
    expect(fit!.coefficients[1]).toBe(0)
    expect(fit!.standardErrors[1]).toBe(0)
    expect(fit!.coefficients.every((value) => Number.isFinite(value))).toBe(true)
    expect(fit!.intercept).toBeGreaterThan(60)
  })

  it("splits the effect across perfectly collinear columns", () => {
    const { rows, outcomes } = synthetic(7, 200, [6], 70, 2)
    const duplicated = rows.map((row) => [row[0], row[0]])
    const fit = fitRidge(duplicated, outcomes, { lambda: 1 })
    expect(fit).not.toBeNull()
    expect(fit!.coefficients[0]).toBeCloseTo(fit!.coefficients[1], 6)
    expect(fit!.coefficients[0] + fit!.coefficients[1]).toBeGreaterThan(4)
    expect(fit!.coefficients[0] + fit!.coefficients[1]).toBeLessThan(7)
  })

  it("shrinks standard errors as the sample grows", () => {
    const small = synthetic(8, 80, [5], 70, 10)
    const large = synthetic(8, 1200, [5], 70, 10)
    const smallFit = fitRidge(small.rows, small.outcomes, { lambda: 2 })!
    const largeFit = fitRidge(large.rows, large.outcomes, { lambda: 2 })!
    expect(largeFit.standardErrors[0]).toBeLessThan(smallFit.standardErrors[0])
  })

  it("keeps a strong effect above 2 standard errors and pure noise below", () => {
    const strong = synthetic(10, 400, [8], 70, 6)
    const strongFit = fitRidge(strong.rows, strong.outcomes, { lambda: 2 })!
    expect(Math.abs(strongFit.coefficients[0])).toBeGreaterThan(
      2 * strongFit.standardErrors[0]
    )
    const noise = synthetic(11, 400, [0], 70, 6)
    const noiseFit = fitRidge(noise.rows, noise.outcomes, { lambda: 2 })!
    expect(Math.abs(noiseFit.coefficients[0])).toBeLessThan(
      2 * noiseFit.standardErrors[0]
    )
  })

  it("skipping standard errors changes nothing but the errors", () => {
    const { rows, outcomes } = synthetic(20, 300, [5, -3, 2], 70, 6)
    const full = fitRidge(rows, outcomes, { lambda: 4 })!
    const fast = fitRidge(rows, outcomes, {
      lambda: 4,
      computeStandardErrors: false
    })!
    expect(fast.coefficients).toEqual(full.coefficients)
    expect(fast.intercept).toBe(full.intercept)
    expect(fast.standardErrors.every((value) => value === 0)).toBe(true)
    expect(full.standardErrors.some((value) => value > 0)).toBe(true)
  })

  it("returns null on empty input", () => {
    expect(fitRidge([], [], { lambda: 1 })).toBeNull()
    expect(fitRidge([[]], [70], { lambda: 1 })).toBeNull()
  })

  it("handles a single row without exploding", () => {
    const fit = fitRidge([[1]], [70], { lambda: 1 })
    expect(fit).not.toBeNull()
    expect(fit!.coefficients[0]).toBe(0)
    expect(fit!.intercept).toBe(70)
  })
})

describe("selectRidgeLambda", () => {
  it("returns the fallback when the sample is too small", () => {
    const { rows, outcomes } = synthetic(12, 30, [5], 70, 4)
    expect(selectRidgeLambda(rows, outcomes)).toBe(16)
  })

  it("prefers light shrinkage for strong clean signal", () => {
    const { rows, outcomes } = synthetic(13, 400, [10, -8], 70, 2)
    const lambda = selectRidgeLambda(rows, outcomes)
    expect(lambda).toBeLessThanOrEqual(4)
  })

  it("prefers heavy shrinkage for pure noise", () => {
    const { rows, outcomes } = synthetic(14, 400, [0, 0, 0, 0], 70, 20)
    const lambda = selectRidgeLambda(rows, outcomes)
    expect(lambda).toBeGreaterThanOrEqual(16)
  })

  it("is deterministic", () => {
    const { rows, outcomes } = synthetic(15, 200, [5, -3], 70, 8)
    expect(selectRidgeLambda(rows, outcomes)).toBe(
      selectRidgeLambda(rows, outcomes)
    )
  })

  it("matches a brute-force per-lambda cross-validation exactly", () => {
    // Reference implementation: refit from scratch for every fold and
    // lambda. The production version prepares each fold once and reuses it
    // across lambdas; both must pick the same candidate.
    const candidates = [1, 4, 16, 64]
    const folds = 5
    const bruteForce = (rows: number[][], outcomes: number[]) => {
      const n = rows.length
      const foldSize = Math.floor(n / folds)
      let bestLambda = 16
      let bestError = Number.POSITIVE_INFINITY
      for (const lambda of candidates) {
        let total = 0
        let scored = 0
        for (let fold = 0; fold < folds; fold += 1) {
          const start = fold * foldSize
          const end = fold === folds - 1 ? n : start + foldSize
          const fit = fitRidge(
            [...rows.slice(0, start), ...rows.slice(end)],
            [...outcomes.slice(0, start), ...outcomes.slice(end)],
            { lambda, computeStandardErrors: false }
          )
          if (fit === null) continue
          let squared = 0
          for (let i = start; i < end; i += 1) {
            let predicted = fit.intercept
            for (let j = 0; j < rows[i].length; j += 1) {
              predicted += fit.coefficients[j] * rows[i][j]
            }
            squared += (outcomes[i] - predicted) ** 2
          }
          total += squared / (end - start)
          scored += 1
        }
        if (scored === 0) continue
        const mean = total / scored
        if (mean <= bestError) {
          bestError = mean
          bestLambda = lambda
        }
      }
      return bestLambda
    }
    for (const seed of [21, 22, 23, 24, 25]) {
      const { rows, outcomes } = synthetic(seed, 250, [6, -4, 0, 2], 70, 10)
      expect(selectRidgeLambda(rows, outcomes, { candidates, folds })).toBe(
        bruteForce(rows, outcomes)
      )
    }
  })

  it("always returns a candidate or the fallback", () => {
    const { rows, outcomes } = synthetic(16, 100, [5], 70, 8)
    const lambda = selectRidgeLambda(rows, outcomes, { candidates: [2, 8] })
    expect([2, 8, 16]).toContain(lambda)
  })
})
