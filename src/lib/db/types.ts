export type OuraScope =
  | "daily"
  | "email"
  | "heartrate"
  | "personal"
  | "session"
  | "spo2"
  | "tag"
  | "workout"

export interface AuthTokenRow {
  id: "oura"
  accessToken: string
  expiresAt: string | null
  lastSyncedAt?: string | null
  lastValidatedAt?: string | null
  scopes: OuraScope[]
  source?: "user_token"
  tokenType: "bearer"
  updatedAt: string
}

export interface DailyMetricRow {
  activeCalories?: number | null
  activityContributorMeetDailyTargets?: number | null
  activityContributorMoveEveryHour?: number | null
  activityContributorRecoveryTime?: number | null
  activityContributorStayActive?: number | null
  activityContributorTrainingFrequency?: number | null
  activityContributorTrainingVolume?: number | null
  date: string
  sleepScore: number | null
  readinessScore: number | null
  activityScore: number | null
  averageBreath?: number | null
  averageHeartRate?: number | null
  hrvBalance: number | null
  averageHrv: number | null
  averageMetMinutes?: number | null
  awakeMinutes?: number | null
  equivalentWalkingDistance?: number | null
  highActivityMetMinutes?: number | null
  highActivityMinutes?: number | null
  lightSleepMinutes?: number | null
  lowActivityMinutes?: number | null
  mediumActivityMetMinutes?: number | null
  mediumActivityMinutes?: number | null
  nonWearMinutes?: number | null
  readinessContributorActivityBalance?: number | null
  readinessContributorBodyTemperature?: number | null
  readinessContributorHrvBalance?: number | null
  readinessContributorPreviousDayActivity?: number | null
  readinessContributorPreviousNight?: number | null
  readinessContributorRecoveryIndex?: number | null
  readinessContributorRestingHeartRate?: number | null
  readinessContributorSleepBalance?: number | null
  readinessScoreDelta?: number | null
  restingMinutes?: number | null
  restingHeartRate: number | null
  restlessPeriods?: number | null
  sedentaryMinutes?: number | null
  sleepContributorDeepSleep?: number | null
  sleepContributorEfficiency?: number | null
  sleepContributorLatency?: number | null
  sleepContributorRemSleep?: number | null
  sleepContributorRestfulness?: number | null
  sleepContributorTiming?: number | null
  sleepContributorTotalSleep?: number | null
  sleepEfficiency: number | null
  sleepLatencyMinutes: number | null
  sleepScoreDelta?: number | null
  steps?: number | null
  targetCalories?: number | null
  timeInBedMinutes?: number | null
  totalCalories?: number | null
  deepSleepMinutes: number | null
  remSleepMinutes: number | null
  totalSleepMinutes: number | null
  bedtimeStart: string | null
  bedtimeEnd: string | null
  sourceUpdatedAt: string | null
  syncedAt: string
}

export interface TagEntryRow {
  id: string
  date: string
  tag: string
  comment: string | null
  sourceUpdatedAt: string | null
  syncedAt: string
}

export interface ImportRunRow {
  id: string
  startedAt: string
  finishedAt: string | null
  status: "running" | "success" | "error"
  startDate: string
  endDate: string
  recordsSynced: number
  errorMessage: string | null
}
