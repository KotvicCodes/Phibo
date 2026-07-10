import Dexie, { type Table } from "dexie"
import type {
  AuthTokenRow,
  DailyMetricRow,
  DeletedTagIdRow,
  ImportRunRow,
  TagEntryRow
} from "./types"

export class PhiboDb extends Dexie {
  authTokens!: Table<AuthTokenRow, string>
  dailyMetrics!: Table<DailyMetricRow, string>
  deletedTagIds!: Table<DeletedTagIdRow, string>
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

    this.version(3)
      .stores({
        authTokens: "id",
        dailyMetrics: "date",
        deletedTagIds: "id",
        importRuns: "id, startedAt, finishedAt, status",
        tagEntries: "id, date, tag"
      })
      .upgrade(async (tx) => {
        await tx
          .table<TagEntryRow>("tagEntries")
          .toCollection()
          .modify((entry) => {
            if (!entry.source) {
              entry.source = "oura"
            }
          })
      })
  }
}

export const db = new PhiboDb()
