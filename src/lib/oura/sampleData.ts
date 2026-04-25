import type { DailyMetricRow, TagEntryRow } from "../db/types"

const syncedAt = "2026-04-24T08:00:00.000Z"

export const sampleDailyMetrics: DailyMetricRow[] = withSampleExtras([
  {
    date: "2026-04-16",
    sleepScore: 83,
    readinessScore: 78,
    activityScore: 82,
    hrvBalance: 64,
    averageHrv: 63,
    restingHeartRate: 51,
    sleepEfficiency: 83,
    sleepLatencyMinutes: 19,
    deepSleepMinutes: 78,
    remSleepMinutes: 92,
    totalSleepMinutes: 421,
    bedtimeStart: "2026-04-15T22:58:00+02:00",
    bedtimeEnd: "2026-04-16T06:21:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-17",
    sleepScore: 86,
    readinessScore: 82,
    activityScore: 78,
    hrvBalance: 69,
    averageHrv: 68,
    restingHeartRate: 49,
    sleepEfficiency: 91,
    sleepLatencyMinutes: 9,
    deepSleepMinutes: 94,
    remSleepMinutes: 108,
    totalSleepMinutes: 462,
    bedtimeStart: "2026-04-16T22:24:00+02:00",
    bedtimeEnd: "2026-04-17T06:18:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-18",
    sleepScore: 85,
    readinessScore: 81,
    activityScore: 80,
    hrvBalance: 68,
    averageHrv: 66,
    restingHeartRate: 50,
    sleepEfficiency: 88,
    sleepLatencyMinutes: 13,
    deepSleepMinutes: 88,
    remSleepMinutes: 101,
    totalSleepMinutes: 448,
    bedtimeStart: "2026-04-17T22:41:00+02:00",
    bedtimeEnd: "2026-04-18T06:24:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-19",
    sleepScore: 80,
    readinessScore: 75,
    activityScore: 74,
    hrvBalance: 59,
    averageHrv: 60,
    restingHeartRate: 52,
    sleepEfficiency: 79,
    sleepLatencyMinutes: 26,
    deepSleepMinutes: 62,
    remSleepMinutes: 81,
    totalSleepMinutes: 388,
    bedtimeStart: "2026-04-19T00:18:00+02:00",
    bedtimeEnd: "2026-04-19T06:47:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-20",
    sleepScore: 84,
    readinessScore: 79,
    activityScore: 83,
    hrvBalance: 65,
    averageHrv: 64,
    restingHeartRate: 50,
    sleepEfficiency: 86,
    sleepLatencyMinutes: 15,
    deepSleepMinutes: 82,
    remSleepMinutes: 96,
    totalSleepMinutes: 435,
    bedtimeStart: "2026-04-19T22:36:00+02:00",
    bedtimeEnd: "2026-04-20T06:07:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-21",
    sleepScore: 85,
    readinessScore: 80,
    activityScore: 79,
    hrvBalance: 68,
    averageHrv: 67,
    restingHeartRate: 49,
    sleepEfficiency: 90,
    sleepLatencyMinutes: 11,
    deepSleepMinutes: 90,
    remSleepMinutes: 103,
    totalSleepMinutes: 456,
    bedtimeStart: "2026-04-20T22:29:00+02:00",
    bedtimeEnd: "2026-04-21T06:17:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-22",
    sleepScore: 81,
    readinessScore: 75,
    activityScore: 76,
    hrvBalance: 59,
    averageHrv: 60,
    restingHeartRate: 52,
    sleepEfficiency: 80,
    sleepLatencyMinutes: 24,
    deepSleepMinutes: 67,
    remSleepMinutes: 86,
    totalSleepMinutes: 397,
    bedtimeStart: "2026-04-21T23:51:00+02:00",
    bedtimeEnd: "2026-04-22T06:38:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  },
  {
    date: "2026-04-23",
    sleepScore: 87,
    readinessScore: 82,
    activityScore: 81,
    hrvBalance: 70,
    averageHrv: 69,
    restingHeartRate: 48,
    sleepEfficiency: 92,
    sleepLatencyMinutes: 8,
    deepSleepMinutes: 96,
    remSleepMinutes: 112,
    totalSleepMinutes: 468,
    bedtimeStart: "2026-04-22T22:18:00+02:00",
    bedtimeEnd: "2026-04-23T06:14:00+02:00",
    sourceUpdatedAt: null,
    syncedAt
  }
])

export const sampleTagEntries: TagEntryRow[] = [
  createTag("2026-03-18", "blackout curtains"),
  createTag("2026-04-16", "warm room"),
  createTag("2026-04-17", "dark bedroom"),
  createTag("2026-04-17", "cool room"),
  createTag("2026-04-18", "cool room"),
  createTag("2026-04-19", "late caffeine"),
  createTag("2026-04-20", "early dinner"),
  createTag("2026-04-21", "dark bedroom"),
  createTag("2026-04-21", "no screen"),
  createTag("2026-04-22", "late caffeine"),
  createTag("2026-04-23", "dark bedroom"),
  createTag("2026-04-23", "cool room")
]

function createTag(date: string, tag: string): TagEntryRow {
  return {
    id: `${date}-${tag.replaceAll(" ", "-")}`,
    date,
    tag,
    comment: null,
    sourceUpdatedAt: null,
    syncedAt
  }
}

function withSampleExtras(rows: DailyMetricRow[]) {
  return rows.map((row, index) => ({
    ...row,
    activeCalories: 280 + index * 18 + (row.activityScore ?? 0),
    activityContributorMeetDailyTargets: clampScore((row.activityScore ?? 0) + 2),
    activityContributorMoveEveryHour: clampScore((row.activityScore ?? 0) + 8),
    activityContributorRecoveryTime: clampScore((row.readinessScore ?? 0) + 4),
    activityContributorStayActive: clampScore((row.activityScore ?? 0) + 5),
    activityContributorTrainingFrequency: clampScore((row.activityScore ?? 0) - 4),
    activityContributorTrainingVolume: clampScore((row.activityScore ?? 0) - 2),
    averageBreath: 14.4 + index * 0.1,
    averageHeartRate: (row.restingHeartRate ?? 50) + 5,
    averageMetMinutes: 1.2 + index * 0.08,
    awakeMinutes: Math.max((row.timeInBedMinutes ?? 465) - (row.totalSleepMinutes ?? 420), 18),
    equivalentWalkingDistance: 5200 + index * 420,
    highActivityMetMinutes: 12 + index * 3,
    highActivityMinutes: 4 + index,
    lightSleepMinutes:
      (row.totalSleepMinutes ?? 0) -
      (row.deepSleepMinutes ?? 0) -
      (row.remSleepMinutes ?? 0),
    lowActivityMinutes: 210 + index * 8,
    mediumActivityMetMinutes: 38 + index * 4,
    mediumActivityMinutes: 26 + index * 2,
    nonWearMinutes: index % 3 === 0 ? 18 : 0,
    readinessContributorActivityBalance: clampScore((row.readinessScore ?? 0) - 1),
    readinessContributorBodyTemperature: clampScore((row.readinessScore ?? 0) + 3),
    readinessContributorHrvBalance: row.hrvBalance,
    readinessContributorPreviousDayActivity: clampScore((row.activityScore ?? 0) - 1),
    readinessContributorPreviousNight: clampScore((row.sleepScore ?? 0) - 2),
    readinessContributorRecoveryIndex: clampScore((row.readinessScore ?? 0) + 2),
    readinessContributorRestingHeartRate: clampScore(100 - ((row.restingHeartRate ?? 50) - 45) * 5),
    readinessContributorSleepBalance: clampScore((row.sleepScore ?? 0) - 1),
    readinessScoreDelta: Math.round(((row.readinessScore ?? 78) - 78) / 2),
    restingMinutes: 420 + index * 10,
    restlessPeriods: 4 + (index % 4),
    sedentaryMinutes: 430 - index * 12,
    sleepContributorDeepSleep: clampScore((row.deepSleepMinutes ?? 80) - 5),
    sleepContributorEfficiency: row.sleepEfficiency,
    sleepContributorLatency: clampScore(100 - (row.sleepLatencyMinutes ?? 15) * 2),
    sleepContributorRemSleep: clampScore((row.remSleepMinutes ?? 90) - 12),
    sleepContributorRestfulness: clampScore((row.sleepScore ?? 80) - 3),
    sleepContributorTiming: clampScore((row.sleepScore ?? 80) - 1),
    sleepContributorTotalSleep: clampScore(((row.totalSleepMinutes ?? 420) - 300) / 2),
    sleepScoreDelta: Math.round(((row.sleepScore ?? 82) - 82) / 2),
    steps: 6200 + index * 520,
    targetCalories: 420 + index * 12,
    timeInBedMinutes: (row.totalSleepMinutes ?? 420) + 42,
    totalCalories: 2180 + index * 34
  }))
}

function clampScore(value: number | null) {
  return value === null ? null : Math.max(0, Math.min(Math.round(value), 100))
}
