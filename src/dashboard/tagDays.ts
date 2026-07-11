import type {
  DailyMetricRow,
  DeletedTagIdRow,
  TagEntryRow
} from "../lib/db/types"
import { formatDate, formatInputDate, formatMonth, shiftDate } from "./format"
import { scoreRangeTone, type ScoreRangeTone } from "./scoreTones"
import { formatTagLabel, sortTagsForDisplay } from "./tagLabels"

export interface TagChipGroup {
  key: string
  label: string
  entries: TagEntryRow[]
  title: string
}

export interface DeletedTagChipGroup {
  key: string
  label: string
  rows: DeletedTagIdRow[]
  title: string
}

export interface TagDay {
  date: string
  entries: TagEntryRow[]
  deleted: DeletedTagIdRow[]
  activeGroups: TagChipGroup[]
  deletedGroups: DeletedTagChipGroup[]
}

export interface TagStripDay {
  date: string
  monthLabel: string | null
  tagCount: number
  barHeight: number
  tone: ScoreRangeTone
  dimmed: boolean
  title: string
}

export function buildTagsByDate(entries: TagEntryRow[]) {
  return entries.reduce(
    (groups, tag) => {
      groups[tag.date] = [...(groups[tag.date] ?? []), tag.tag]

      return groups
    },
    {} as Record<string, string[]>
  )
}

export function getTaggedMetricDates(entries: TagEntryRow[]) {
  return new Set(entries.map((tag) => tag.date))
}

// The Oura export can log the same tag several times on one day. Chips are
// grouped by label so each tag shows once; acting on a chip covers every
// entry in its group.
function buildDayChipGroups(day: TagDay) {
  const active = new Map<string, TagChipGroup>()

  for (const entry of day.entries) {
    const key = entry.tag.toLocaleLowerCase()
    const group = active.get(key)

    if (group) {
      group.entries.push(entry)
    } else {
      active.set(key, { key, label: entry.tag, entries: [entry], title: "" })
    }
  }

  const deleted = new Map<string, DeletedTagChipGroup>()

  for (const row of day.deleted) {
    const label = row.entry?.tag ?? ""
    const key = label.toLocaleLowerCase()

    // Labels that still have an active entry show as a normal chip; their
    // tombstones surface as one crossed chip only once all are deleted.
    if (active.has(key)) {
      continue
    }

    const group = deleted.get(key)

    if (group) {
      group.rows.push(row)
    } else {
      deleted.set(key, { key, label, rows: [row], title: "" })
    }
  }

  for (const group of active.values()) {
    group.title = group.entries
      .map((entry) => entry.comment)
      .filter((comment): comment is string => Boolean(comment))
      .join("; ")
  }

  for (const group of deleted.values()) {
    group.title = group.rows
      .map((row) => row.entry?.comment)
      .filter((comment): comment is string => Boolean(comment))
      .join("; ")
  }

  day.activeGroups = Array.from(active.values())
  day.deletedGroups = Array.from(deleted.values())
}

export function buildTagDays(
  entries: TagEntryRow[],
  deletedRows: DeletedTagIdRow[]
) {
  const days = new Map<string, TagDay>()
  const getDay = (date: string) => {
    let day = days.get(date)

    if (!day) {
      day = { date, entries: [], deleted: [], activeGroups: [], deletedGroups: [] }
      days.set(date, day)
    }

    return day
  }

  for (const entry of entries) {
    getDay(entry.date).entries.push(entry)
  }

  for (const row of deletedRows) {
    if (row.entry) {
      getDay(row.entry.date).deleted.push(row)
    }
  }

  for (const day of days.values()) {
    buildDayChipGroups(day)
  }

  return Array.from(days.values()).sort((left, right) =>
    right.date.localeCompare(left.date)
  )
}

export function buildTagStripDays(
  metrics: DailyMetricRow[],
  days: TagDay[],
  filteredDays: TagDay[],
  filterActive: boolean
): TagStripDay[] {
  const today = formatInputDate(new Date())
  const startCandidates = [metrics[0]?.date, days.at(-1)?.date]
    .filter((date): date is string => Boolean(date))
    .sort()
  const start = startCandidates[0]

  if (!start || start > today) {
    return []
  }

  const dayByDate = new Map(days.map((day) => [day.date, day]))
  const filteredDates = new Set(filteredDays.map((day) => day.date))
  const sleepScoreByDate = new Map(
    metrics.map((metric) => [metric.date, metric.sleepScore])
  )
  // Bars reflect only active tags; deletion tombstones must not inflate
  // column heights.
  const maxCount = Math.max(
    1,
    ...days.map((day) => day.activeGroups.length)
  )
  const stripDays: TagStripDay[] = []

  for (let date = start; date <= today; date = shiftDate(date, 1)) {
    const day = dayByDate.get(date)
    const count = day ? day.activeGroups.length : 0

    stripDays.push({
      date,
      monthLabel: date.endsWith("-01") ? formatMonth(date) : null,
      tagCount: count,
      barHeight:
        count === 0 ? 0 : Math.max(18, Math.round((count / maxCount) * 100)),
      tone: scoreRangeTone(sleepScoreByDate.get(date) ?? null),
      dimmed: filterActive && !filteredDates.has(date),
      title: `${formatDate(date)} · ${count} ${count === 1 ? "tag" : "tags"}`
    })
  }

  return stripDays
}

export function filterTagsByQuery(tags: string[], search: string) {
  const query = search.trim().toLocaleLowerCase()

  if (query.length === 0) {
    return tags
  }

  return tags.filter(
    (tag) =>
      formatTagLabel(tag).toLocaleLowerCase().includes(query) ||
      tag.toLocaleLowerCase().includes(query)
  )
}

export function buildAllKnownTags(
  entries: TagEntryRow[],
  deletedRows: DeletedTagIdRow[]
) {
  const labelsByKey = new Map<string, string>()

  for (const entry of entries) {
    const key = entry.tag.toLocaleLowerCase()

    if (!labelsByKey.has(key)) {
      labelsByKey.set(key, entry.tag)
    }
  }

  for (const row of deletedRows) {
    const label = row.entry?.tag

    if (!label) {
      continue
    }

    const key = label.toLocaleLowerCase()

    if (!labelsByKey.has(key)) {
      labelsByKey.set(key, label)
    }
  }

  return sortTagsForDisplay(Array.from(labelsByKey.values()))
}
