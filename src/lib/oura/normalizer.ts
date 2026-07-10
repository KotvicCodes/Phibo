import type { DailyMetricRow, TagEntryRow } from "../db/types"

type OuraRecord = Record<string, unknown>

const canonicalOuraTagLabels = new Map(
  [
    "alcohol",
    "blackout curtains",
    "blue light blockers",
    "dreams",
    "full moon",
    "high altitude",
    "home office",
    "late coffee",
    "late meal",
    "late screen time",
    "late work",
    "light therapy",
    "new bed",
    "nightmares",
    "no caffeine",
    "noisy",
    "social gathering",
    "stress",
    "temp high",
    "temp low"
  ].map((label) => [getTagKey(label), label])
)

const sleepPrefixedUniversalTagKeys = new Set([
  "alcohol",
  "blackout curtains",
  "blue light blockers",
  "dreams",
  "full moon",
  "late coffee",
  "late screen time",
  "late meal",
  "late work",
  "new bed",
  "nightmares",
  "noisy",
  "stress",
  "temp high",
  "temp low"
].map(getTagKey))

export type OuraDailySummary = OuraRecord
export type OuraDailyActivity = OuraRecord
export type OuraSleepSession = OuraRecord
export type OuraTag = OuraRecord

export interface OuraMetricInput {
  cardiovascularAge: OuraDailySummary[]
  dailyActivity: OuraDailyActivity[]
  dailyReadiness: OuraDailySummary[]
  dailyResilience: OuraDailySummary[]
  dailySleep: OuraDailySummary[]
  dailySpo2: OuraDailySummary[]
  dailyStress: OuraDailySummary[]
  sleepSessions: OuraSleepSession[]
  smoothedCardiovascularAge: OuraDailySummary[]
  vo2Max: OuraDailySummary[]
  workouts: OuraRecord[]
}

const resilienceLevelScores = new Map([
  ["limited", 1],
  ["adequate", 2],
  ["solid", 3],
  ["strong", 4],
  ["exceptional", 5]
])

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

  input.dailySpo2.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.spo2AveragePercentage =
      getNestedNumber(
        record,
        ["spo2_percentage", "Spo2Percentage"],
        "average",
        "Average"
      ) ?? null
    row.breathingDisturbanceIndex =
      getNumber(
        record,
        "breathing_disturbance_index",
        "BreathingDisturbanceIndex"
      ) ?? null
  })

  input.dailyStress.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.stressHighMinutes = secondsToMinutes(
      getNumber(record, "stress_high", "StressHigh")
    )
    row.recoveryHighMinutes = secondsToMinutes(
      getNumber(record, "recovery_high", "RecoveryHigh")
    )
  })

  input.dailyResilience.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)
    const level = getString(record, "level", "Level")

    row.resilienceLevelScore = level
      ? (resilienceLevelScores.get(level.toLowerCase()) ?? null)
      : null
    row.resilienceContributorSleepRecovery =
      getContributor(record, "sleep_recovery", "SleepRecovery") ?? null
    row.resilienceContributorDaytimeRecovery =
      getContributor(record, "daytime_recovery", "DaytimeRecovery") ?? null
    row.resilienceContributorStress =
      getContributor(record, "stress", "Stress") ?? null
  })

  input.smoothedCardiovascularAge.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.cardiovascularAge =
      getNumber(record, "cardiovascular_age", "CardiovascularAge") ??
      row.cardiovascularAge
    row.pulseWaveVelocity =
      getNumber(record, "pulse_wave_velocity", "PulseWaveVelocity") ??
      row.pulseWaveVelocity
  })

  // Processed after the smoothed file so the per-day value wins when both exist.
  input.cardiovascularAge.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.cardiovascularAge =
      getNumber(record, "vascular_age", "VascularAge") ?? row.cardiovascularAge
    row.pulseWaveVelocity =
      getNumber(record, "pulse_wave_velocity", "PulseWaveVelocity") ??
      row.pulseWaveVelocity
  })

  input.vo2Max.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.vo2Max = getNumber(record, "vo2_max", "Vo2Max") ?? null
  })

  input.workouts.forEach((record) => {
    const day = getRecordDay(record)

    if (!day) {
      return
    }

    const row = getDailyRow(rowsByDate, day, syncedAt)

    row.workoutCount = (row.workoutCount ?? 0) + 1

    const calories = getNumber(record, "calories", "Calories")

    if (calories !== null) {
      row.workoutCalories = (row.workoutCalories ?? 0) + calories
    }

    const minutes = getWorkoutMinutes(record)

    if (minutes !== null) {
      row.workoutMinutes = (row.workoutMinutes ?? 0) + minutes
    }
  })

  const sleepSessionsByDay = new Map<string, OuraRecord[]>()

  input.sleepSessions.forEach((record) => {
    const day = getRecordDay(record)

    if (!day || !isSleepSession(record)) {
      return
    }

    const sessions = sleepSessionsByDay.get(day) ?? []
    sessions.push(record)
    sleepSessionsByDay.set(day, sessions)
  })

  sleepSessionsByDay.forEach((sessions, day) => {
    const row = getDailyRow(rowsByDate, day, syncedAt)
    // Durations are summed across the day's sessions and rate-like metrics
    // are weighted by sleep duration, so naps contribute proportionally
    // instead of overwriting the main night. Bedtimes, latency, and score
    // deltas only make sense for a single night, so they come from the
    // longest session.
    const mainSession = getLongestSleepSession(sessions)

    row.averageBreath =
      getWeightedSessionAverage(sessions, "average_breath", "AverageBreath") ??
      row.averageBreath
    row.averageHeartRate =
      getWeightedSessionAverage(
        sessions,
        "average_heart_rate",
        "AverageHeartRate"
      ) ?? row.averageHeartRate
    row.averageHrv =
      getWeightedSessionAverage(sessions, "average_hrv", "AverageHrv") ??
      row.averageHrv
    row.sleepEfficiency =
      getWeightedSessionAverage(sessions, "efficiency", "Efficiency") ??
      row.sleepEfficiency
    row.awakeMinutes =
      secondsToMinutes(getSessionSum(sessions, "awake_time", "AwakeTime")) ??
      row.awakeMinutes
    row.deepSleepMinutes = secondsToMinutes(
      getSessionSum(sessions, "deep_sleep_duration", "DeepSleepDuration")
    )
    row.lightSleepMinutes =
      secondsToMinutes(
        getSessionSum(sessions, "light_sleep_duration", "LightSleepDuration")
      ) ?? row.lightSleepMinutes
    row.remSleepMinutes = secondsToMinutes(
      getSessionSum(sessions, "rem_sleep_duration", "RemSleepDuration")
    )
    row.timeInBedMinutes = secondsToMinutes(
      getSessionSum(sessions, "time_in_bed", "TimeInBed")
    )
    row.totalSleepMinutes = secondsToMinutes(
      getSessionSum(sessions, "total_sleep_duration", "TotalSleepDuration")
    )
    row.restlessPeriods =
      getSessionSum(sessions, "restless_periods", "RestlessPeriods") ??
      row.restlessPeriods
    row.restingHeartRate =
      getSessionMin(sessions, "lowest_heart_rate", "LowestHeartRate") ??
      row.restingHeartRate
    row.sleepLatencyMinutes = secondsToMinutes(
      getNumber(mainSession, "latency", "Latency")
    )
    row.readinessScoreDelta =
      getNumber(mainSession, "readiness_score_delta", "ReadinessScoreDelta") ??
      row.readinessScoreDelta
    row.sleepScoreDelta =
      getNumber(mainSession, "sleep_score_delta", "SleepScoreDelta") ??
      row.sleepScoreDelta
    row.bedtimeStart =
      getString(mainSession, "bedtime_start", "BedtimeStart") ??
      row.bedtimeStart
    row.bedtimeEnd =
      getString(mainSession, "bedtime_end", "BedtimeEnd") ?? row.bedtimeEnd
    row.sourceUpdatedAt =
      getString(mainSession, "updated_at", "UpdatedAt", "InsertedDate") ??
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
      getString(tag, "custom_tag_name", "CustomTagName", "CustomName") ??
        getString(tag, "tag_type_code", "TagTypeCode", "text")
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
        source: "oura",
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
    breathingDisturbanceIndex: null,
    cardiovascularAge: null,
    pulseWaveVelocity: null,
    recoveryHighMinutes: null,
    resilienceContributorDaytimeRecovery: null,
    resilienceContributorSleepRecovery: null,
    resilienceContributorStress: null,
    resilienceLevelScore: null,
    spo2AveragePercentage: null,
    stressHighMinutes: null,
    vo2Max: null,
    workoutCalories: null,
    workoutCount: null,
    workoutMinutes: null,
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

// Rest periods are lying down without sleep; they carry no sleep metrics.
function isSleepSession(record: OuraRecord) {
  const sessionType = getString(record, "type", "Type")

  return !sessionType || (sessionType !== "rest" && sessionType !== "deleted")
}

function getLongestSleepSession(sessions: OuraRecord[]) {
  return sessions.reduce((longest, session) =>
    getSleepSessionDuration(session) > getSleepSessionDuration(longest)
      ? session
      : longest
  )
}

function getSleepSessionDuration(session: OuraRecord) {
  return (
    getNumber(session, "total_sleep_duration", "TotalSleepDuration") ??
    getNumber(session, "time_in_bed", "TimeInBed") ??
    0
  )
}

function getSessionSum(
  sessions: OuraRecord[],
  snakeCaseName: string,
  pascalCaseName: string
) {
  const values = sessions
    .map((session) => getNumber(session, snakeCaseName, pascalCaseName))
    .filter((value): value is number => value !== null)

  return values.length > 0
    ? values.reduce((total, value) => total + value, 0)
    : null
}

function getSessionMin(
  sessions: OuraRecord[],
  snakeCaseName: string,
  pascalCaseName: string
) {
  const values = sessions
    .map((session) => getNumber(session, snakeCaseName, pascalCaseName))
    .filter((value): value is number => value !== null)

  return values.length > 0 ? Math.min(...values) : null
}

function getWeightedSessionAverage(
  sessions: OuraRecord[],
  snakeCaseName: string,
  pascalCaseName: string
) {
  let weightedTotal = 0
  let weightTotal = 0

  for (const session of sessions) {
    const value = getNumber(session, snakeCaseName, pascalCaseName)

    if (value === null) {
      continue
    }

    const weight = getSleepSessionDuration(session) || 1
    weightedTotal += value * weight
    weightTotal += weight
  }

  return weightTotal > 0
    ? Math.round((weightedTotal / weightTotal) * 10) / 10
    : null
}

function getWorkoutMinutes(record: OuraRecord) {
  const start = getString(record, "start_datetime", "StartDatetime")
  const end = getString(record, "end_datetime", "EndDatetime")

  if (!start || !end) {
    return null
  }

  const elapsedMs = new Date(end).getTime() - new Date(start).getTime()

  return Number.isFinite(elapsedMs) && elapsedMs > 0
    ? Math.round(elapsedMs / 60_000)
    : null
}

function getNestedNumber(
  record: OuraRecord,
  outerKeys: string[],
  snakeCaseName: string,
  pascalCaseName: string
) {
  const container = getValue(record, outerKeys)

  return isRecord(container)
    ? getNumber(container, snakeCaseName, pascalCaseName)
    : null
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

export function normalizeTagLabel(value: string | null) {
  if (!value) {
    return null
  }

  const label = value
    .replace(/^tag_/, "")
    .replace(/_/g, " ")
    .trim()
  const genericLabel = label.replace(/^generic\s+(?=\S)/i, "").trim()
  const sleepLabel = genericLabel.replace(/^sleep\s+(?=\S)/i, "").trim()

  if (
    sleepLabel !== genericLabel &&
    sleepPrefixedUniversalTagKeys.has(getTagKey(sleepLabel))
  ) {
    return getCanonicalOuraTagLabel(sleepLabel)
  }

  return getCanonicalOuraTagLabel(genericLabel)
}

function getCanonicalOuraTagLabel(label: string) {
  return canonicalOuraTagLabels.get(getTagKey(label)) ?? label
}

function getTagKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function secondsToMinutes(value: number | null) {
  return value === null ? null : Math.round(value / 60)
}
