const LAMBDA_CANDIDATES = [1, 4, 16, 64]
const FALLBACK_LAMBDA = 16
const MIN_CV_ROWS = 60
const DEFAULT_FOLDS = 5

// Cholesky factorization of a symmetric positive definite A into L L'.
// Returns null when A is not positive definite (or numerically singular).
// Factoring once and reusing the factor across right-hand sides keeps
// repeated solves (and full inversion) at O(k^2) per solve instead of
// redoing the O(k^3) decomposition every time.
function choleskyDecompose(matrix: number[][]): number[][] | null {
  const size = matrix.length
  const lower: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(0)
  )
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      let sum = matrix[row][col]
      for (let k = 0; k < col; k += 1) {
        sum -= lower[row][k] * lower[col][k]
      }
      if (row === col) {
        if (sum <= 1e-12) return null
        lower[row][row] = Math.sqrt(sum)
      } else {
        lower[row][col] = sum / lower[col][col]
      }
    }
  }
  return lower
}

function choleskySolve(lower: number[][], rhs: number[]): number[] {
  const size = lower.length
  // Forward substitution: L z = b
  const z = new Array<number>(size).fill(0)
  for (let row = 0; row < size; row += 1) {
    let sum = rhs[row]
    for (let k = 0; k < row; k += 1) sum -= lower[row][k] * z[k]
    z[row] = sum / lower[row][row]
  }
  // Back substitution: L' x = z
  const x = new Array<number>(size).fill(0)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = z[row]
    for (let k = row + 1; k < size; k += 1) sum -= lower[k][row] * x[k]
    x[row] = sum / lower[row][row]
  }
  return x
}

// Solves A x = b for a symmetric positive definite A via Cholesky.
export function solveSymmetric(
  matrix: number[][],
  rhs: number[]
): number[] | null {
  const lower = choleskyDecompose(matrix)
  return lower === null ? null : choleskySolve(lower, rhs)
}

function invertFromCholesky(lower: number[][]): number[][] {
  const size = lower.length
  const inverse: number[][] = []
  for (let col = 0; col < size; col += 1) {
    const unit = new Array<number>(size).fill(0)
    unit[col] = 1
    inverse.push(choleskySolve(lower, unit))
  }
  // Columns of the inverse, transposed back to rows (symmetric, so equal).
  return inverse
}

export interface RidgeFit {
  intercept: number
  coefficients: number[]
  standardErrors: number[]
  lambda: number
  usedDays: number
}

interface Standardized {
  columns: number[][]
  means: number[]
  scales: number[]
  constant: boolean[]
}

function standardizeColumns(rows: number[][], featureCount: number): Standardized {
  const n = rows.length
  const means = new Array<number>(featureCount).fill(0)
  const scales = new Array<number>(featureCount).fill(1)
  const constant = new Array<boolean>(featureCount).fill(false)
  const columns: number[][] = []
  for (let j = 0; j < featureCount; j += 1) {
    let sum = 0
    for (let i = 0; i < n; i += 1) sum += rows[i][j]
    const mean = sum / n
    let variance = 0
    for (let i = 0; i < n; i += 1) {
      const centered = rows[i][j] - mean
      variance += centered * centered
    }
    const scale = Math.sqrt(variance / n)
    means[j] = mean
    if (scale < 1e-9) {
      constant[j] = true
      scales[j] = 1
      columns.push(new Array<number>(n).fill(0))
    } else {
      scales[j] = scale
      const column = new Array<number>(n)
      for (let i = 0; i < n; i += 1) column[i] = (rows[i][j] - mean) / scale
      columns.push(column)
    }
  }
  return { columns, means, scales, constant }
}

// Closed-form ridge on standardized columns. Coefficients and standard
// errors are mapped back to the raw feature scale, so with binary tag
// features a coefficient reads directly in outcome units (score points).
// Standard errors use the sandwich estimate
// Var(b) = sigma^2 (Z'Z + lambda I)^-1 Z'Z (Z'Z + lambda I)^-1
// with sigma^2 = RSS / max(1, n - k), where k approximates the effective
// degrees of freedom (a slight overcount, so sigma^2 leans conservative).
export function fitRidge(
  rows: number[][],
  outcomes: number[],
  options: { lambda: number; computeStandardErrors?: boolean }
): RidgeFit | null {
  const n = rows.length
  if (n === 0) return null
  const featureCount = rows[0]?.length ?? 0
  if (featureCount === 0) return null
  const { lambda } = options
  const computeStandardErrors = options.computeStandardErrors ?? true

  const yMean = outcomes.reduce((sum, value) => sum + value, 0) / n
  const centeredY = outcomes.map((value) => value - yMean)
  const { columns, means, scales, constant } = standardizeColumns(
    rows,
    featureCount
  )

  // Z'Z + lambda I and Z'y over standardized columns.
  const gram: number[][] = Array.from({ length: featureCount }, () =>
    new Array<number>(featureCount).fill(0)
  )
  const zty = new Array<number>(featureCount).fill(0)
  for (let a = 0; a < featureCount; a += 1) {
    const colA = columns[a]
    for (let b = a; b < featureCount; b += 1) {
      const colB = columns[b]
      let dot = 0
      for (let i = 0; i < n; i += 1) dot += colA[i] * colB[i]
      gram[a][b] = dot
      gram[b][a] = dot
    }
    let dotY = 0
    for (let i = 0; i < n; i += 1) dotY += colA[i] * centeredY[i]
    zty[a] = dotY
  }
  const penalized = gram.map((row, index) =>
    row.map((value, col) => (index === col ? value + lambda : value))
  )

  const penalizedFactor = choleskyDecompose(penalized)
  if (penalizedFactor === null) return null
  const standardizedCoefficients = choleskySolve(penalizedFactor, zty)

  // Standard errors dominate the cost of a fit (matrix inversion), so the
  // cross-validation path skips them; it only needs predictions.
  const standardizedErrors = new Array<number>(featureCount).fill(0)
  if (computeStandardErrors) {
    // Residual variance on the standardized fit.
    let rss = 0
    for (let i = 0; i < n; i += 1) {
      let predicted = 0
      for (let j = 0; j < featureCount; j += 1) {
        predicted += columns[j][i] * standardizedCoefficients[j]
      }
      const residual = centeredY[i] - predicted
      rss += residual * residual
    }
    const sigmaSquared = rss / Math.max(1, n - featureCount)

    // Sandwich covariance on the standardized scale, reusing the Cholesky
    // factor already computed for the coefficient solve.
    const penalizedInverse = invertFromCholesky(penalizedFactor)
    for (let j = 0; j < featureCount; j += 1) {
      // Var(b_j) = sigma^2 * (P^-1 G P^-1)_jj where P = G + lambda I.
      let variance = 0
      for (let a = 0; a < featureCount; a += 1) {
        let inner = 0
        for (let b = 0; b < featureCount; b += 1) {
          inner += gram[a][b] * penalizedInverse[b][j]
        }
        variance += penalizedInverse[j][a] * inner
      }
      standardizedErrors[j] = Math.sqrt(Math.max(0, sigmaSquared * variance))
    }
  }

  const coefficients = new Array<number>(featureCount).fill(0)
  const standardErrors = new Array<number>(featureCount).fill(0)
  let intercept = yMean
  for (let j = 0; j < featureCount; j += 1) {
    if (constant[j]) continue
    coefficients[j] = standardizedCoefficients[j] / scales[j]
    standardErrors[j] = standardizedErrors[j] / scales[j]
    intercept -= coefficients[j] * means[j]
  }

  return { intercept, coefficients, standardErrors, lambda, usedDays: n }
}

function predictionError(
  trainRows: number[][],
  trainOutcomes: number[],
  testRows: number[][],
  testOutcomes: number[],
  lambda: number
): number | null {
  const fit = fitRidge(trainRows, trainOutcomes, {
    lambda,
    computeStandardErrors: false
  })
  if (fit === null) return null
  let squared = 0
  for (let i = 0; i < testRows.length; i += 1) {
    let predicted = fit.intercept
    for (let j = 0; j < testRows[i].length; j += 1) {
      predicted += fit.coefficients[j] * testRows[i][j]
    }
    const error = testOutcomes[i] - predicted
    squared += error * error
  }
  return squared / testRows.length
}

// Picks lambda by blocked k-fold cross-validation: folds are contiguous in
// the given row order (rows must arrive date-sorted), which respects the
// autocorrelation of daily health data. Ties break toward the larger lambda.
export function selectRidgeLambda(
  rows: number[][],
  outcomes: number[],
  options?: { candidates?: number[]; folds?: number }
): number {
  const candidates = options?.candidates ?? LAMBDA_CANDIDATES
  const folds = options?.folds ?? DEFAULT_FOLDS
  const n = rows.length
  if (n < MIN_CV_ROWS || candidates.length === 0) return FALLBACK_LAMBDA

  const foldSize = Math.floor(n / folds)
  let bestLambda = FALLBACK_LAMBDA
  let bestError = Number.POSITIVE_INFINITY
  for (const lambda of candidates) {
    let total = 0
    let scored = 0
    for (let fold = 0; fold < folds; fold += 1) {
      const start = fold * foldSize
      const end = fold === folds - 1 ? n : start + foldSize
      const trainRows = [...rows.slice(0, start), ...rows.slice(end)]
      const trainOutcomes = [
        ...outcomes.slice(0, start),
        ...outcomes.slice(end)
      ]
      const error = predictionError(
        trainRows,
        trainOutcomes,
        rows.slice(start, end),
        outcomes.slice(start, end),
        lambda
      )
      if (error === null) continue
      total += error
      scored += 1
    }
    if (scored === 0) continue
    const mean = total / scored
    // >= so ties move toward more shrinkage (candidates ascend).
    if (mean <= bestError) {
      bestError = mean
      bestLambda = lambda
    }
  }
  return bestLambda
}
