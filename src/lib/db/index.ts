import Dexie, { type Table } from "dexie"
import type { MetricRow, SessionRow } from "./types"

export class PhiboDb extends Dexie {
  metrics!: Table<MetricRow, string>
  sessions!: Table<SessionRow, string>

  constructor() {
    super("phibo_db")

    this.version(1).stores({
      metrics: "",
      sessions: ""
    })
  }
}

export const db = new PhiboDb()
