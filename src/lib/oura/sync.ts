import { db } from "../db"
import type { DailyMetricRow, TagEntryRow } from "../db/types"
import { fetchOuraCollection } from "./client"

interface OuraDailySummary {
  day: string
  score?: number
  timestamp?: string
}

interface OuraSleepSession {
  day: string
  average_hrv?: number
  bedtime_end?: string
  bedtime_start?: string
  deep_sleep_duration?: number
  efficiency?: number
  latency?: number
  lowest_heart_rate?: number
  rem_sleep_duration?: number
  total_sleep_duration?: number
  updated_at?: string
}

interface OuraTag {
  id?: string
  day?: string
  start_datetime?: string
  text?: string
  tag_type_code?: string
  updated_at?: string
}

export async function syncOuraRange(
  accessToken: string,
  startDate: string,
  endDate: string
) {
  const importRunId = crypto.randomUUID()
  const startedAt = new Date().toISOString()

  await db.importRuns.add({
    id: importRunId,
    startedAt,
    finishedAt: null,
    status: "running",
    startDate,
    endDate,
    recordsSynced: 0,
    errorMessage: null
  })

  try {
    const [dailySleep, dailyReadiness, dailyActivity, sleepSessions, tags] =
      await Promise.all([
        fetchOuraCollection<OuraDailySummary>(accessToken, "daily_sleep", {
          start_date: startDate,
          end_date: endDate
        }),
        fetchOuraCollection<OuraDailySummary>(accessToken, "daily_readiness", {
          start_date: startDate,
          end_date: endDate
        }),
        fetchOuraCollection<OuraDailySummary>(accessToken, "daily_activity", {
          start_date: startDate,
          end_date: endDate
        }),
        fetchOuraCollection<OuraSleepSession>(accessToken, "sleep", {
          start_date: startDate,
          end_date: endDate
        }),
        fetchOuraCollection<OuraTag>(accessToken, "tag", {
          start_date: startDate,
          end_date: endDate
        })
      ])

    const dailyMetrics = mergeDailyMetrics({
      dailyActivity,
      dailyReadiness,
      dailySleep,
      sleepSessions
    })
    const tagEntries = mapTagEntries(tags)

    await db.transaction("rw", db.dailyMetrics, db.tagEntries, db.importRuns, async () => {
      await db.dailyMetrics.bulkPut(dailyMetrics)
      await db.tagEntries.bulkPut(tagEntries)
      await db.importRuns.update(importRunId, {
        finishedAt: new Date().toISOString(),
        status: "success",
        recordsSynced: dailyMetrics.length + tagEntries.length
      })
    })

    return {
      dailyMetrics,
      tagEntries
    }
  } catch (error) {
    await db.importRuns.update(importRunId, {
      finishedAt: new Date().toISOString(),
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown sync error"
    })

    throw error
  }
}

function mergeDailyMetrics(input: {
  dailyActivity: OuraDailySummary[]
  dailyReadiness: OuraDailySummary[]
  dailySleep: OuraDailySummary[]
  sleepSessions: OuraSleepSession[]
}) {
  const syncedAt = new Date().toISOString()
  const rowsByDate = new Map<string, DailyMetricRow>()

  input.dailySleep.forEach((record) => {
    getDailyRow(rowsByDate, record.day, syncedAt).sleepScore = record.score ?? null
  })

  input.dailyReadiness.forEach((record) => {
    getDailyRow(rowsByDate, record.day, syncedAt).readinessScore =
      record.score ?? null
  })

  input.dailyActivity.forEach((record) => {
    getDailyRow(rowsByDate, record.day, syncedAt).activityScore =
      record.score ?? null
  })

  input.sleepSessions.forEach((record) => {
    const row = getDailyRow(rowsByDate, record.day, syncedAt)

    row.averageHrv = record.average_hrv ?? row.averageHrv
    row.restingHeartRate = record.lowest_heart_rate ?? row.restingHeartRate
    row.sleepEfficiency = record.efficiency ?? row.sleepEfficiency
    row.sleepLatencyMinutes = secondsToMinutes(record.latency)
    row.deepSleepMinutes = secondsToMinutes(record.deep_sleep_duration)
    row.remSleepMinutes = secondsToMinutes(record.rem_sleep_duration)
    row.totalSleepMinutes = secondsToMinutes(record.total_sleep_duration)
    row.bedtimeStart = record.bedtime_start ?? row.bedtimeStart
    row.bedtimeEnd = record.bedtime_end ?? row.bedtimeEnd
    row.sourceUpdatedAt = record.updated_at ?? row.sourceUpdatedAt
  })

  return Array.from(rowsByDate.values()).sort((left, right) =>
    left.date.localeCompare(right.date)
  )
}

function getDailyRow(
  rowsByDate: Map<string, DailyMetricRow>,
  date: string,
  syncedAt: string
) {
  const existingRow = rowsByDate.get(date)

  if (existingRow) {
    return existingRow
  }

  const row: DailyMetricRow = {
    date,
    sleepScore: null,
    readinessScore: null,
    activityScore: null,
    hrvBalance: null,
    averageHrv: null,
    restingHeartRate: null,
    sleepEfficiency: null,
    sleepLatencyMinutes: null,
    deepSleepMinutes: null,
    remSleepMinutes: null,
    totalSleepMinutes: null,
    bedtimeStart: null,
    bedtimeEnd: null,
    sourceUpdatedAt: null,
    syncedAt
  }

  rowsByDate.set(date, row)

  return row
}

function mapTagEntries(tags: OuraTag[]) {
  const syncedAt = new Date().toISOString()

  return tags.flatMap((tag): TagEntryRow[] => {
    const date = tag.day ?? tag.start_datetime?.slice(0, 10)
    const label = tag.text ?? tag.tag_type_code

    if (!date || !label) {
      return []
    }

    return [
      {
        id: tag.id ?? `${date}-${label}`,
        date,
        tag: label,
        comment: tag.text ?? null,
        sourceUpdatedAt: tag.updated_at ?? null,
        syncedAt
      }
    ]
  })
}

function secondsToMinutes(value: number | undefined) {
  return value === undefined ? null : Math.round(value / 60)
}
