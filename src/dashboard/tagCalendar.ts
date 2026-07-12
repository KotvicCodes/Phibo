import type { ExploreDay } from "../lib/analysis/correlations"
import {
  calendarDateAtNoon,
  formatDate,
  formatInputDate,
  formatMonth,
  shiftDate
} from "./format"
import { formatTagList, sortTagsForDisplay } from "./tagLabels"

const calendarWeekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const tagCalendarDays = 365

interface ExploreTagCalendarCell {
  date: string | null
  day: ExploreDay | null
  taggedTags: string[]
}

interface ExploreTagCalendarWeekdayRow {
  cells: ExploreTagCalendarCell[]
  label: string
}

export interface ExploreTagCalendar {
  monthLabels: string[]
  rangeLabel: string
  rows: ExploreTagCalendarWeekdayRow[]
  taggedDayCount: number
}

export interface ExploreTagCalendarOption {
  id: string
  label: string
}

interface ExploreTagCalendarRange {
  firstDate: Date
  lastDate: Date
  label: string
}

export function buildExploreTagCalendar(
  days: ExploreDay[],
  selectedTags: string[],
  selectedRangeId: string
): ExploreTagCalendar {
  const sortedTags = sortTagsForDisplay(selectedTags)
  const sortedDays = [...days].sort((left, right) =>
    left.date.localeCompare(right.date)
  )
  const selectedRange = getExploreTagCalendarRange(
    sortedDays,
    selectedRangeId
  )

  if (!selectedRange) {
    return {
      monthLabels: [],
      rangeLabel: "Last 365 days",
      rows: calendarWeekdayLabels.map((label) => ({
        cells: [],
        label
      })),
      taggedDayCount: 0
    }
  }

  const daysByDate = new Map(sortedDays.map((day) => [day.date, day]))
  const cells: ExploreTagCalendarCell[] = []
  const date = new Date(selectedRange.firstDate)

  while (date <= selectedRange.lastDate) {
    const displayDate = formatInputDate(date)
    const metricDate = shiftDate(displayDate, 1)
    const day = daysByDate.get(metricDate) ?? null

    cells.push({
      date: displayDate,
      day,
      taggedTags: day
        ? sortedTags.filter((tag) => day.tags.includes(tag))
        : []
    })

    date.setDate(date.getDate() + 1)
  }

  if (cells.length === 0) {
    return {
      monthLabels: [],
      rangeLabel: selectedRange.label,
      rows: calendarWeekdayLabels.map((label) => ({
        cells: [],
        label
      })),
      taggedDayCount: 0
    }
  }

  const firstCellDate = cells[0].date
  const leadingEmptyDays = firstCellDate
    ? calendarWeekdayIndex(firstCellDate)
    : 0
  const paddedCells = [
    ...Array.from({ length: leadingEmptyDays }, (): ExploreTagCalendarCell => ({
      date: null,
      day: null,
      taggedTags: []
    })),
    ...cells
  ]
  const trailingEmptyDays =
    paddedCells.length === 0 ? 0 : (7 - (paddedCells.length % 7)) % 7

  paddedCells.push(
    ...Array.from({ length: trailingEmptyDays }, (): ExploreTagCalendarCell => ({
      date: null,
      day: null,
      taggedTags: []
    }))
  )

  const weeks = Array.from(
    { length: Math.ceil(paddedCells.length / 7) },
    (_, index) => paddedCells.slice(index * 7, index * 7 + 7)
  )

  return {
    monthLabels: weeks.map((week) => calendarWeekMonthLabel(week)),
    rangeLabel: selectedRange.label,
    rows: calendarWeekdayLabels.map((label, weekdayIndex) => ({
      cells: weeks.map((week) => week[weekdayIndex]),
      label
    })),
    taggedDayCount: cells.filter((cell) => cell.taggedTags.length > 0).length
  }
}

export function buildExploreTagCalendarOptions(
  days: ExploreDay[]
): ExploreTagCalendarOption[] {
  const years = Array.from(
    new Set(
      days.map((day) => getTagCalendarDisplayDate(day.date).slice(0, 4))
    )
  ).sort((left, right) => Number(right) - Number(left))

  return [
    {
      id: "last365",
      label: "Last 365"
    },
    ...years.map((year) => ({
      id: `year:${year}`,
      label: year
    }))
  ]
}

function getExploreTagCalendarRange(
  sortedDays: ExploreDay[],
  selectedRangeId: string
): ExploreTagCalendarRange | null {
  const selectedYear = selectedRangeId.startsWith("year:")
    ? Number(selectedRangeId.slice(5))
    : null

  if (selectedYear && Number.isFinite(selectedYear)) {
    return {
      firstDate: calendarDateAtNoon(`${selectedYear}-01-01`),
      lastDate: calendarDateAtNoon(`${selectedYear}-12-31`),
      label: String(selectedYear)
    }
  }

  const latestDay = sortedDays[sortedDays.length - 1]

  if (!latestDay) {
    return null
  }

  const lastDate = calendarDateAtNoon(
    getTagCalendarDisplayDate(latestDay.date)
  )
  const firstDate = new Date(lastDate)
  firstDate.setDate(lastDate.getDate() - tagCalendarDays + 1)

  return {
    firstDate,
    lastDate,
    label: "Last 365 days"
  }
}

function getTagCalendarDisplayDate(metricDate: string) {
  return shiftDate(metricDate, -1)
}

function calendarWeekdayIndex(date: string) {
  return (calendarDateAtNoon(date).getDay() + 6) % 7
}

function calendarWeekMonthLabel(week: ExploreTagCalendarCell[]) {
  const firstMonthDate = week.find((cell) => cell.date?.endsWith("-01"))?.date

  return firstMonthDate ? formatMonth(firstMonthDate) : ""
}

export function tagCalendarCellLabel(cell: ExploreTagCalendarCell) {
  if (!cell.date) {
    return "No date"
  }

  const tagText =
    cell.taggedTags.length > 0
      ? formatTagList(cell.taggedTags)
      : "No selected tags"

  return `Night of ${formatDate(cell.date)} - ${tagText}`
}
