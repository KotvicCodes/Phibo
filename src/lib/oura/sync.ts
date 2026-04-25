import { db } from "../db"
import type { DailyMetricRow, TagEntryRow } from "../db/types"
import { fetchOuraCollection } from "./client"

interface OuraDailySummary {
  contributors?: Record<string, number | undefined>
  day: string
  score?: number
  timestamp?: string
}

interface OuraDailyActivity extends OuraDailySummary {
  active_calories?: number
  average_met_minutes?: number
  equivalent_walking_distance?: number
  high_activity_met_minutes?: number
  high_activity_time?: number
  low_activity_time?: number
  medium_activity_met_minutes?: number
  medium_activity_time?: number
  non_wear_time?: number
  resting_time?: number
  sedentary_time?: number
  steps?: number
  target_calories?: number
  total_calories?: number
}

interface OuraSleepSession {
  average_breath?: number
  average_heart_rate?: number
  day: string
  average_hrv?: number
  awake_time?: number
  bedtime_end?: string
  bedtime_start?: string
  deep_sleep_duration?: number
  efficiency?: number
  latency?: number
  light_sleep_duration?: number
  lowest_heart_rate?: number
  rem_sleep_duration?: number
  readiness_score_delta?: number
  restless_periods?: number
  sleep_score_delta?: number
  time_in_bed?: number
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

function mergeDailyMetrics(input: {
  dailyActivity: OuraDailyActivity[]
  dailyReadiness: OuraDailySummary[]
  dailySleep: OuraDailySummary[]
  sleepSessions: OuraSleepSession[]
}) {
  const syncedAt = new Date().toISOString()
  const rowsByDate = new Map<string, DailyMetricRow>()

  input.dailySleep.forEach((record) => {
    const row = getDailyRow(rowsByDate, record.day, syncedAt)

    row.sleepScore = record.score ?? null
    row.sleepContributorDeepSleep = record.contributors?.deep_sleep ?? null
    row.sleepContributorEfficiency = record.contributors?.efficiency ?? null
    row.sleepContributorLatency = record.contributors?.latency ?? null
    row.sleepContributorRemSleep = record.contributors?.rem_sleep ?? null
    row.sleepContributorRestfulness = record.contributors?.restfulness ?? null
    row.sleepContributorTiming = record.contributors?.timing ?? null
    row.sleepContributorTotalSleep = record.contributors?.total_sleep ?? null
  })

  input.dailyReadiness.forEach((record) => {
    const row = getDailyRow(rowsByDate, record.day, syncedAt)

    row.readinessScore = record.score ?? null
    row.readinessContributorActivityBalance =
      record.contributors?.activity_balance ?? null
    row.readinessContributorBodyTemperature =
      record.contributors?.body_temperature ?? null
    row.readinessContributorHrvBalance = record.contributors?.hrv_balance ?? null
    row.readinessContributorPreviousDayActivity =
      record.contributors?.previous_day_activity ?? null
    row.readinessContributorPreviousNight =
      record.contributors?.previous_night ?? null
    row.readinessContributorRecoveryIndex =
      record.contributors?.recovery_index ?? null
    row.readinessContributorRestingHeartRate =
      record.contributors?.resting_heart_rate ?? null
    row.readinessContributorSleepBalance =
      record.contributors?.sleep_balance ?? null
  })

  input.dailyActivity.forEach((record) => {
    const row = getDailyRow(rowsByDate, record.day, syncedAt)

    row.activityScore = record.score ?? null
    row.activeCalories = record.active_calories ?? null
    row.activityContributorMeetDailyTargets =
      record.contributors?.meet_daily_targets ?? null
    row.activityContributorMoveEveryHour =
      record.contributors?.move_every_hour ?? null
    row.activityContributorRecoveryTime =
      record.contributors?.recovery_time ?? null
    row.activityContributorStayActive = record.contributors?.stay_active ?? null
    row.activityContributorTrainingFrequency =
      record.contributors?.training_frequency ?? null
    row.activityContributorTrainingVolume =
      record.contributors?.training_volume ?? null
    row.averageMetMinutes = record.average_met_minutes ?? null
    row.equivalentWalkingDistance = record.equivalent_walking_distance ?? null
    row.highActivityMetMinutes = record.high_activity_met_minutes ?? null
    row.highActivityMinutes = secondsToMinutes(record.high_activity_time)
    row.lowActivityMinutes = secondsToMinutes(record.low_activity_time)
    row.mediumActivityMetMinutes = record.medium_activity_met_minutes ?? null
    row.mediumActivityMinutes = secondsToMinutes(record.medium_activity_time)
    row.nonWearMinutes = secondsToMinutes(record.non_wear_time)
    row.restingMinutes = secondsToMinutes(record.resting_time)
    row.sedentaryMinutes = secondsToMinutes(record.sedentary_time)
    row.steps = record.steps ?? null
    row.targetCalories = record.target_calories ?? null
    row.totalCalories = record.total_calories ?? null
  })

  input.sleepSessions.forEach((record) => {
    const row = getDailyRow(rowsByDate, record.day, syncedAt)

    row.averageBreath = record.average_breath ?? row.averageBreath
    row.averageHeartRate = record.average_heart_rate ?? row.averageHeartRate
    row.averageHrv = record.average_hrv ?? row.averageHrv
    row.awakeMinutes = secondsToMinutes(record.awake_time) ?? row.awakeMinutes
    row.restingHeartRate = record.lowest_heart_rate ?? row.restingHeartRate
    row.sleepEfficiency = record.efficiency ?? row.sleepEfficiency
    row.sleepLatencyMinutes = secondsToMinutes(record.latency)
    row.deepSleepMinutes = secondsToMinutes(record.deep_sleep_duration)
    row.lightSleepMinutes =
      secondsToMinutes(record.light_sleep_duration) ?? row.lightSleepMinutes
    row.remSleepMinutes = secondsToMinutes(record.rem_sleep_duration)
    row.readinessScoreDelta =
      record.readiness_score_delta ?? row.readinessScoreDelta
    row.restlessPeriods = record.restless_periods ?? row.restlessPeriods
    row.sleepScoreDelta = record.sleep_score_delta ?? row.sleepScoreDelta
    row.timeInBedMinutes = secondsToMinutes(record.time_in_bed)
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
    activeCalories: null,
    activityContributorMeetDailyTargets: null,
    activityContributorMoveEveryHour: null,
    activityContributorRecoveryTime: null,
    activityContributorStayActive: null,
    activityContributorTrainingFrequency: null,
    activityContributorTrainingVolume: null,
    date,
    sleepScore: null,
    readinessScore: null,
    activityScore: null,
    averageBreath: null,
    averageHeartRate: null,
    hrvBalance: null,
    averageHrv: null,
    averageMetMinutes: null,
    awakeMinutes: null,
    equivalentWalkingDistance: null,
    highActivityMetMinutes: null,
    highActivityMinutes: null,
    lightSleepMinutes: null,
    lowActivityMinutes: null,
    mediumActivityMetMinutes: null,
    mediumActivityMinutes: null,
    nonWearMinutes: null,
    readinessContributorActivityBalance: null,
    readinessContributorBodyTemperature: null,
    readinessContributorHrvBalance: null,
    readinessContributorPreviousDayActivity: null,
    readinessContributorPreviousNight: null,
    readinessContributorRecoveryIndex: null,
    readinessContributorRestingHeartRate: null,
    readinessContributorSleepBalance: null,
    readinessScoreDelta: null,
    restingMinutes: null,
    restingHeartRate: null,
    restlessPeriods: null,
    sedentaryMinutes: null,
    sleepContributorDeepSleep: null,
    sleepContributorEfficiency: null,
    sleepContributorLatency: null,
    sleepContributorRemSleep: null,
    sleepContributorRestfulness: null,
    sleepContributorTiming: null,
    sleepContributorTotalSleep: null,
    sleepEfficiency: null,
    sleepLatencyMinutes: null,
    sleepScoreDelta: null,
    steps: null,
    targetCalories: null,
    timeInBedMinutes: null,
    totalCalories: null,
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
