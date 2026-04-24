import Dexie, { type Table } from "dexie"
import type {
  AuthTokenRow,
  DailyMetricRow,
  ImportRunRow,
  TagEntryRow
} from "./types"

export class PhiboDb extends Dexie {
  authTokens!: Table<AuthTokenRow, string>
  dailyMetrics!: Table<DailyMetricRow, string>
  importRuns!: Table<ImportRunRow, string>
  tagEntries!: Table<TagEntryRow, string>

  constructor() {
    super("phibo_db")

    this.version(1).stores({
      metrics: "",
      sessions: ""
    })

    this.version(2).stores({
      authTokens: "id",
      dailyMetrics: "date",
      importRuns: "id, startedAt, finishedAt, status",
      tagEntries: "id, date, tag",
      metrics: null,
      sessions: null
    })
  }
}

export const db = new PhiboDb()
