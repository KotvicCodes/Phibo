import Dexie, { type Table } from "dexie"

export class PhiboDb extends Dexie {
  metrics!: Table<Record<string, unknown>, string>
  sessions!: Table<Record<string, unknown>, string>

  constructor() {
    super("phibo_db")

    this.version(1).stores({
      metrics: "",
      sessions: ""
    })
  }
}

export const db = new PhiboDb()
