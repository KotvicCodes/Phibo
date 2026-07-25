import type { TagEntryRow } from "../db/types"

// Small helpers shared by the correlation and optimal day analysis and by
// the dashboard formatters, so each module does not carry its own copy.

export function average(values: Array<number | null | undefined>) {
  const usableValues = values.filter((value): value is number => value != null)

  if (usableValues.length === 0) {
    return null
  }

  return (
    usableValues.reduce((total, value) => total + value, 0) /
    usableValues.length
  )
}

export function roundToOne(value: number) {
  return Math.round(value * 10) / 10
}

// Tail fraction winsorized off each end before averaging. Count-based:
// k = floor(fraction * n) values per tail are pulled in, so below
// 1 / fraction points per tail (k = 0) the estimator is exactly the mean.
export const WINSORIZE_FRACTION = 0.1

// In-place quickselect: leaves the value that belongs at `position` in the
// fully sorted array at arr[position], with everything smaller to its left.
// A median-of-three pivot keeps near-sorted inputs (score columns often are)
// off the quadratic path. Reorders arr, so callers must pass a disposable
// array. Order statistics are permutation-invariant, so two successive calls
// on the same array both return correct results.
function selectNth(arr: number[], position: number): number {
  let left = 0
  let right = arr.length - 1
  while (left < right) {
    const mid = (left + right) >> 1
    const a = arr[left]
    const b = arr[mid]
    const c = arr[right]
    const pivot =
      a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b
    let i = left
    let j = right
    while (i <= j) {
      while (arr[i] < pivot) i += 1
      while (arr[j] > pivot) j -= 1
      if (i <= j) {
        const swap = arr[i]
        arr[i] = arr[j]
        arr[j] = swap
        i += 1
        j -= 1
      }
    }
    if (position <= j) right = j
    else if (position >= i) left = i
    else break
  }
  return arr[position]
}

// Winsorized mean of already-finite numbers: the k most extreme values on
// each tail are clamped to the nearest retained value before averaging, so
// one freak night cannot drag a well-sampled group's average far. The
// smallest groups (k = 0) fall back to the plain mean, since a handful of
// nights cannot distinguish an outlier from signal. Returns null on empty.
// Reorders `values` (via the quickselect above); callers pass throwaways.
export function winsorizedMeanOfFinite(
  values: number[],
  fraction = WINSORIZE_FRACTION
): number | null {
  const n = values.length
  if (n === 0) return null
  const k = Math.floor(fraction * n)
  if (k === 0) {
    let sum = 0
    for (const value of values) sum += value
    return sum / n
  }
  // Only the two clamp thresholds are needed, not a full sort.
  const low = selectNth(values, k)
  const high = selectNth(values, n - 1 - k)
  let sum = 0
  for (const value of values) {
    sum += value < low ? low : value > high ? high : value
  }
  return sum / n
}

// Null-filtering wrapper mirroring average(), for callers holding raw metric
// columns that may contain gaps.
export function winsorizedMean(
  values: Array<number | null | undefined>,
  fraction = WINSORIZE_FRACTION
): number | null {
  const usable = values.filter(
    (value): value is number => value != null && Number.isFinite(value)
  )
  return winsorizedMeanOfFinite(usable, fraction)
}

export function groupTagsByName(tags: TagEntryRow[]) {
  return tags.reduce((groups, entry) => {
    const dates = groups.get(entry.tag) ?? new Set<string>()
    dates.add(entry.date)
    groups.set(entry.tag, dates)

    return groups
  }, new Map<string, Set<string>>())
}
