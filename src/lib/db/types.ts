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
  scopes: OuraScope[]
  tokenType: "bearer"
  updatedAt: string
}

export interface DailyMetricRow {
  date: string
  sleepScore: number | null
  readinessScore: number | null
  activityScore: number | null
  hrvBalance: number | null
  averageHrv: number | null
  restingHeartRate: number | null
  sleepEfficiency: number | null
  sleepLatencyMinutes: number | null
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
