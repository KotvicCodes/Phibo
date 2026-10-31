import "fake-indexeddb/auto"

import { readFile } from "node:fs/promises"
import { afterEach, expect, it } from "vitest"
import { db } from "../db"
import { calculateTagEffects } from "../analysis/tagEffects"
import { importOuraFiles } from "./import"

afterEach(async () => {
  await Promise.all([
    db.dailyMetrics.clear(), db.tagEntries.clear(), db.importRuns.clear()
  ])
})

it("imports the downloadable demo ZIP through the real importer and supports analysis", async () => {
  const bytes = await readFile(new URL("../../../docs/demo/phibo-synthetic-oura.zip", import.meta.url))
  const result = await importOuraFiles([
    new File([new Uint8Array(bytes)], "phibo-synthetic-oura.zip", { type: "application/zip" })
  ])

  expect(result.filesImported).toBe(6)
  expect(result.skippedFiles + result.unsupportedFiles + result.ignoredFiles).toBe(0)
  expect(result.dailyMetrics).toHaveLength(181)
  expect(result.dailyMetrics[0].date).toBe("2025-01-01")
  expect(result.dailyMetrics.at(-1)?.date).toBe("2025-06-30")
  expect(new Set(result.tagEntries.map((entry) => entry.tag)).size).toBe(6)
  expect(result.tagEntries).toHaveLength(301)
  expect(result.tagEntries.every((entry) => entry.tag.startsWith("Demo: "))).toBe(true)
  expect(result.dailyMetrics.every((row) =>
    [row.sleepScore, row.readinessScore, row.activityScore].every((value) =>
      value !== null && value >= 0 && value <= 100
    )
  )).toBe(true)
  expect(result.dailyMetrics.every((row) =>
    row.totalSleepMinutes === (row.deepSleepMinutes ?? 0) +
      (row.remSleepMinutes ?? 0) + (row.lightSleepMinutes ?? 0)
  )).toBe(true)
  expect(await db.dailyMetrics.count()).toBe(181)
  expect(await db.tagEntries.count()).toBe(result.tagEntries.length)

  const effects = calculateTagEffects(result.dailyMetrics, result.tagEntries, "sleepScore")
  expect(effects?.effects.get("Demo: Early bedtime")?.sameDayEffect).toBeGreaterThan(0)
  expect(effects?.effects.get("Demo: Late meal")?.sameDayEffect).toBeLessThan(0)
  expect(effects?.effects.get("Demo: Travel")?.sameDayEffect ?? null).toBeNull()

  // Re-importing the downloadable file must not multiply demo records.
  await importOuraFiles([new File([new Uint8Array(bytes)], "phibo-synthetic-oura.zip")])
  expect(await db.dailyMetrics.count()).toBe(181)
  expect(await db.tagEntries.count()).toBe(result.tagEntries.length)
})
