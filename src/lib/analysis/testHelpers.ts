import type { TagEntryRow } from "../db/types"

// Shared builders for the analysis test suites. Only test files import
// this module, so it never reaches the shipped bundle.

export function isoDate(dayIndex: number, start = "2026-01-01") {
  const date = new Date(`${start}T12:00:00`)
  date.setDate(date.getDate() + dayIndex)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function shiftIso(date: string, days: number) {
  return isoDate(days, date)
}

let tagIdCounter = 0

export function tagRow(date: string, tag: string): TagEntryRow {
  tagIdCounter += 1
  return {
    id: `test-${tagIdCounter}`,
    date,
    tag,
    comment: null,
    sourceUpdatedAt: null,
    syncedAt: "2026-01-01T00:00:00Z"
  }
}
