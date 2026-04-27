import type { DailyMetricRow, TagEntryRow } from "../db/types"

type OuraRecord = Record<string, unknown>

const sleepPrefixedUniversalTags = new Set([
  "alcohol",
  "blackout curtains",
  "blue light blockers",
  "dreams",
  "full moon",
  "late coffee",
  "late screen time",
  "late mean",
  "late work",
  "new bed",
  "nightmares",
  "noisy",
  "stress",
  "temp high",
  "temp low"
])

export type OuraDailySummary = OuraRecord
export type OuraDailyActivity = OuraRecord
export type OuraSleepSession = OuraRecord
export type OuraTag = OuraRecord

export interface OuraMetricInput {
  dailyActivity: OuraDailyActivity[]
  dailyReadiness: OuraDailySummary[]
  dailySleep: OuraDailySummary[]
  sleepSessions: OuraSleepSession[]
}

export function mergeDailyMetrics(input: OuraMetricInput) {
  const syncedAt = new Date().toISOString()
  const rowsByDate = new Map<string, DailyMetricRow>()

  input.dailySleep.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.sleepScore = getNumber(record, "score", "Score") ?? null
    row.sleepContributorDeepSleep =
      getContributor(record, "deep_sleep", "DeepSleep") ?? null
    row.sleepContributorEfficiency =
      getContributor(record, "efficiency", "Efficiency") ?? null
    row.sleepContributorLatency =
      getContributor(record, "latency", "Latency") ?? null
    row.sleepContributorRemSleep =
      getContributor(record, "rem_sleep", "RemSleep") ?? null
    row.sleepContributorRestfulness =
      getContributor(record, "restfulness", "Restfulness") ?? null
    row.sleepContributorTiming =
      getContributor(record, "timing", "Timing") ?? null
    row.sleepContributorTotalSleep =
      getContributor(record, "total_sleep", "TotalSleep") ?? null
  })

  input.dailyReadiness.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.readinessScore = getNumber(record, "score", "Score") ?? null
    row.readinessContributorActivityBalance =
      getContributor(record, "activity_balance", "ActivityBalance") ?? null
    row.readinessContributorBodyTemperature =
      getContributor(record, "body_temperature", "BodyTemperature") ?? null
    row.readinessContributorHrvBalance =
      getContributor(record, "hrv_balance", "HrvBalance") ?? null
    row.readinessContributorPreviousDayActivity =
      getContributor(record, "previous_day_activity", "PreviousDayActivity") ??
      null
    row.readinessContributorPreviousNight =
      getContributor(record, "previous_night", "PreviousNight") ?? null
    row.readinessContributorRecoveryIndex =
      getContributor(record, "recovery_index", "RecoveryIndex") ?? null
    row.readinessContributorRestingHeartRate =
      getContributor(record, "resting_heart_rate", "RestingHeartRate") ?? null
    row.readinessContributorSleepBalance =
      getContributor(record, "sleep_balance", "SleepBalance") ?? null
  })

  input.dailyActivity.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.activityScore = getNumber(record, "score", "Score") ?? null
    row.activeCalories = getNumber(record, "active_calories", "ActiveCalories")
    row.activityContributorMeetDailyTargets =
      getContributor(record, "meet_daily_targets", "MeetDailyTargets") ?? null
    row.activityContributorMoveEveryHour =
      getContributor(record, "move_every_hour", "MoveEveryHour") ?? null
    row.activityContributorRecoveryTime =
      getContributor(record, "recovery_time", "RecoveryTime") ?? null
    row.activityContributorStayActive =
      getContributor(record, "stay_active", "StayActive") ?? null
    row.activityContributorTrainingFrequency =
      getContributor(record, "training_frequency", "TrainingFrequency") ?? null
    row.activityContributorTrainingVolume =
      getContributor(record, "training_volume", "TrainingVolume") ?? null
    row.averageMetMinutes = getNumber(
      record,
      "average_met_minutes",
      "AverageMetMinutes"
    )
    row.equivalentWalkingDistance = getNumber(
      record,
      "equivalent_walking_distance",
      "EquivalentWalkingDistance"
    )
    row.highActivityMetMinutes = getNumber(
      record,
      "high_activity_met_minutes",
      "HighActivityMetMinutes"
    )
    row.highActivityMinutes = secondsToMinutes(
      getNumber(record, "high_activity_time", "HighActivityTime")
    )
    row.lowActivityMinutes = secondsToMinutes(
      getNumber(record, "low_activity_time", "LowActivityTime")
    )
    row.mediumActivityMetMinutes = getNumber(
      record,
      "medium_activity_met_minutes",
      "MediumActivityMetMinutes"
    )
    row.mediumActivityMinutes = secondsToMinutes(
      getNumber(record, "medium_activity_time", "MediumActivityTime")
    )
    row.nonWearMinutes = secondsToMinutes(
      getNumber(record, "non_wear_time", "NonWearTime")
    )
    row.restingMinutes = secondsToMinutes(
      getNumber(record, "resting_time", "RestingTime")
    )
    row.sedentaryMinutes = secondsToMinutes(
      getNumber(record, "sedentary_time", "SedentaryTime")
    )
    row.steps = getNumber(record, "steps", "Steps")
    row.targetCalories = getNumber(record, "target_calories", "TargetCalories")
    row.totalCalories = getNumber(record, "total_calories", "TotalCalories")
  })

  input.sleepSessions.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.averageBreath =
      getNumber(record, "average_breath", "AverageBreath") ?? row.averageBreath
    row.averageHeartRate =
      getNumber(record, "average_heart_rate", "AverageHeartRate") ??
      row.averageHeartRate
    row.averageHrv =
      getNumber(record, "average_hrv", "AverageHrv") ?? row.averageHrv
    row.awakeMinutes =
      secondsToMinutes(getNumber(record, "awake_time", "AwakeTime")) ??
      row.awakeMinutes
    row.restingHeartRate =
      getNumber(record, "lowest_heart_rate", "LowestHeartRate") ??
      row.restingHeartRate
    row.sleepEfficiency =
      getNumber(record, "efficiency", "Efficiency") ?? row.sleepEfficiency
    row.sleepLatencyMinutes = secondsToMinutes(
      getNumber(record, "latency", "Latency")
    )
    row.deepSleepMinutes = secondsToMinutes(
      getNumber(record, "deep_sleep_duration", "DeepSleepDuration")
    )
    row.lightSleepMinutes =
      secondsToMinutes(
        getNumber(record, "light_sleep_duration", "LightSleepDuration")
      ) ?? row.lightSleepMinutes
    row.remSleepMinutes = secondsToMinutes(
      getNumber(record, "rem_sleep_duration", "RemSleepDuration")
    )
    row.readinessScoreDelta =
      getNumber(record, "readiness_score_delta", "ReadinessScoreDelta") ??
      row.readinessScoreDelta
    row.restlessPeriods =
      getNumber(record, "restless_periods", "RestlessPeriods") ??
      row.restlessPeriods
    row.sleepScoreDelta =
      getNumber(record, "sleep_score_delta", "SleepScoreDelta") ??
      row.sleepScoreDelta
    row.timeInBedMinutes = secondsToMinutes(
      getNumber(record, "time_in_bed", "TimeInBed")
    )
    row.totalSleepMinutes = secondsToMinutes(
      getNumber(record, "total_sleep_duration", "TotalSleepDuration")
    )
    row.bedtimeStart =
      getString(record, "bedtime_start", "BedtimeStart") ?? row.bedtimeStart
    row.bedtimeEnd =
      getString(record, "bedtime_end", "BedtimeEnd") ?? row.bedtimeEnd
    row.sourceUpdatedAt =
      getString(record, "updated_at", "UpdatedAt", "InsertedDate") ??
      row.sourceUpdatedAt
  })

  return Array.from(rowsByDate.values()).sort((left, right) =>
    left.date.localeCompare(right.date)
  )
}

export function mapTagEntries(tags: OuraTag[]) {
  const syncedAt = new Date().toISOString()

  return tags.flatMap((tag): TagEntryRow[] => {
    const date = getRecordDay(tag)
    const label = normalizeTagLabel(
      getString(tag, "text", "CustomName", "Comment") ??
        getString(tag, "tag_type_code", "TagTypeCode")
    )

    if (!date || !label) {
      return []
    }

    return [
      {
        id:
          getString(tag, "id", "ID", "EnhancedTagKey") ??
          `${date}-${label}-${getString(tag, "StartTime") ?? ""}`,
        date,
        tag: label,
        comment: getString(tag, "comment", "Comment", "text") ?? null,
        sourceUpdatedAt:
          getString(tag, "updated_at", "UpdatedAt", "InsertedDate") ?? null,
        syncedAt
      }
    ]
  })
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

function getContributor(
  record: OuraRecord,
  snakeCaseName: string,
  pascalCaseName: string
) {
  const contributors = parseRecordValue(
    record.contributors ?? record.Contributors
  )

  if (isRecord(contributors)) {
    return getNumber(contributors, snakeCaseName, pascalCaseName)
  }

  return getNumber(record, `Contributors${pascalCaseName}`)
}

function getNumber(record: OuraRecord, ...keys: string[]) {
  const value = getValue(record, keys)

  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value)

    return Number.isFinite(numericValue) ? numericValue : null
  }

  return null
}

function getString(record: OuraRecord, ...keys: string[]) {
  const value = getValue(record, keys)

  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null
}

function getValue(record: OuraRecord, keys: string[]) {
  for (const key of keys) {
    const value = parseRecordValue(record[key])

    if (value != null && value !== "") {
      return value
    }
  }

  for (const key of keys) {
    const normalizedKey = normalizeRecordKey(key)

    for (const [recordKey, value] of Object.entries(record)) {
      const parsedValue = parseRecordValue(value)

      if (
        normalizeRecordKey(recordKey) === normalizedKey &&
        parsedValue != null &&
        parsedValue !== ""
      ) {
        return parsedValue
      }
    }
  }

  return null
}

function getRecordDay(record: OuraRecord) {
  const directDate = getString(
    record,
    "day",
    "Day",
    "date",
    "Date",
    "calendar_date",
    "CalendarDate",
    "summary_date",
    "SummaryDate",
    "start_day",
    "StartDay",
    "sleep_day",
    "SleepDay"
  )

  if (directDate) {
    return directDate.slice(0, 10)
  }

  return (
    getString(
      record,
      "timestamp",
      "Timestamp",
      "start_datetime",
      "StartTime",
      "bedtime_start",
      "BedtimeStart"
    )?.slice(0, 10) ?? null
  )
}

function normalizeRecordKey(key: string) {
  return key
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function isRecord(value: unknown): value is OuraRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseRecordValue(value: unknown) {
  if (typeof value !== "string") {
    return value
  }

  const trimmedValue = value.trim()

  if (!trimmedValue.startsWith("{") || !trimmedValue.endsWith("}")) {
    return value
  }

  try {
    return JSON.parse(trimmedValue)
  } catch {
    return parseOuraObjectLiteral(trimmedValue) ?? value
  }
}

function parseOuraObjectLiteral(value: string) {
  const jsonLikeValue = value
    .replace(/'/g, '"')
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")

  try {
    return JSON.parse(jsonLikeValue)
  } catch {
    return null
  }
}

function normalizeTagLabel(value: string | null) {
  if (!value) {
    return null
  }

  const label = value
    .replace(/^tag_/, "")
    .replace(/_/g, " ")
    .trim()
  const genericLabel = label.replace(/^generic\s+(?=\S)/, "").trim()
  const sleepLabel = genericLabel.replace(/^sleep\s+(?=\S)/, "").trim()

  return sleepPrefixedUniversalTags.has(sleepLabel) ? sleepLabel : genericLabel
}

function secondsToMinutes(value: number | null) {
  return value === null ? null : Math.round(value / 60)
}
