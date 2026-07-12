import { db } from "../db"
import { filterTombstonedTagEntries, getDeletedTagIdSet } from "../tags/store"
import { fetchOuraCollection } from "./client"
import {
  mapTagEntries,
  mergeDailyMetrics,
  mergeWithStoredRow,
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
      cardiovascularAge: [],
      dailyActivity,
      dailyReadiness,
      dailyResilience: [],
      dailySleep,
      dailySpo2: [],
      dailyStress: [],
      sleepSessions,
      smoothedCardiovascularAge: [],
      vo2Max: [],
      workouts: []
    })
    const tagEntries = mapTagEntries(tags)

    await db.transaction(
      "rw",
      db.dailyMetrics,
      db.tagEntries,
      db.deletedTagIds,
      db.importRuns,
      async () => {
        // Merge into any previously stored rows: a sync only fetches a few
        // collections, so putting whole rows would null out file-only
        // fields (SpO2, stress, resilience, cardiovascular age, VO2 max,
        // workouts) from an earlier import.
        const storedRows = await db.dailyMetrics.bulkGet(
          dailyMetrics.map((metric) => metric.date)
        )

        await db.dailyMetrics.bulkPut(
          dailyMetrics.map((metric, index) =>
            mergeWithStoredRow(storedRows[index], metric)
          )
        )

        // Skip tags the user deleted in the app so a resync does not
        // resurrect them.
        const deletedIds = await getDeletedTagIdSet()

        await db.tagEntries.bulkPut(
          filterTombstonedTagEntries(tagEntries, deletedIds)
        )
        await db.importRuns.update(importRunId, {
          finishedAt: new Date().toISOString(),
          status: "success",
          recordsSynced: dailyMetrics.length + tagEntries.length
        })
      }
    )

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
