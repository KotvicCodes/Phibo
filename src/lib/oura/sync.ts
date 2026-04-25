import { db } from "../db"
import { fetchOuraCollection } from "./client"
import {
  mapTagEntries,
  mergeDailyMetrics,
  type OuraDailyActivity,
  type OuraDailySummary,
  type OuraSleepSession,
  type OuraTag
} from "./normalizer"

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
    errorMessage: null,
    source: "api_sync"
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
        fetchOuraCollection<OuraDailyActivity>(accessToken, "daily_activity", {
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
