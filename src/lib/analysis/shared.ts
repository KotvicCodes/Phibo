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

export function groupTagsByName(tags: TagEntryRow[]) {
  return tags.reduce((groups, entry) => {
    const dates = groups.get(entry.tag) ?? new Set<string>()
    dates.add(entry.date)
    groups.set(entry.tag, dates)

    return groups
  }, new Map<string, Set<string>>())
}
