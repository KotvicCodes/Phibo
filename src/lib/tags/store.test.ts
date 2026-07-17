// fake-indexeddb must load before the db module so Dexie finds indexedDB.
import "fake-indexeddb/auto"

import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../db"
import { importOuraFiles } from "../oura/import"
import { mapTagEntries } from "../oura/normalizer"
import {
  addUserTagEntry,
  deleteTagEntries,
  filterTombstonedTagEntries,
  findDuplicateTagEntryIds,
  renameTag,
  restoreTagEntries,
  restoreTagEntriesExact,
  updateDayComment
} from "./store"

function csvFile(name: string, lines: string[]) {
  return new File([lines.join("\n")], name, { type: "text/csv" })
}

function enhancedTagCsv(
  rows: Array<{ id: string; day: string; code: string; comment?: string }>
) {
  return csvFile("enhancedtag.csv", [
    "id,day,tag_type_code,custom_tag_name,comment",
    ...rows.map(
      (row) => `${row.id},${row.day},${row.code},,${row.comment ?? ""}`
    )
  ])
}

const sampleTags = [
  { id: "oura-1", day: "2026-01-01", code: "tag_generic_alcohol" },
  { id: "oura-2", day: "2026-01-02", code: "tag_generic_alcohol" },
  { id: "oura-3", day: "2026-01-02", code: "tag_generic_caffeine" }
]

async function importSampleTags() {
  return importOuraFiles([enhancedTagCsv(sampleTags)])
}

async function storedTagLabels() {
  const entries = await db.tagEntries.toArray()
  return entries.map((entry) => `${entry.date}:${entry.tag}`).sort()
}

beforeEach(async () => {
  await Promise.all([
    db.dailyMetrics.clear(),
    db.tagEntries.clear(),
    db.deletedTagIds.clear(),
    db.importRuns.clear(),
    db.authTokens.clear()
  ])
})

describe("import and tombstone round trips", () => {
  it("imports enhanced tags with stable ids and normalized labels", async () => {
    await importSampleTags()
    const entries = await db.tagEntries.toArray()
    expect(entries.map((entry) => entry.id).sort()).toEqual([
      "oura-1",
      "oura-2",
      "oura-3"
    ])
    expect(await storedTagLabels()).toEqual([
      "2026-01-01:alcohol",
      "2026-01-02:alcohol",
      "2026-01-02:caffeine"
    ])
  })

  it("is idempotent: re-importing the same file changes nothing", async () => {
    await importSampleTags()
    const before = await storedTagLabels()
    await importSampleTags()
    expect(await storedTagLabels()).toEqual(before)
  })

  it("does not resurrect a deleted Oura tag on re-import", async () => {
    await importSampleTags()
    await deleteTagEntries(["oura-1", "oura-2"])
    expect(await storedTagLabels()).toEqual(["2026-01-02:caffeine"])

    await importSampleTags()
    // The alcohol rows share ids with the tombstones, so the re-import
    // must skip them while still importing everything else.
    expect(await storedTagLabels()).toEqual(["2026-01-02:caffeine"])
  })

  it("keeps blocking resurrection after a reload (tombstones only, no session state)", async () => {
    await importSampleTags()
    await deleteTagEntries(["oura-3"])
    // A reload keeps only the database: tombstones persist, session rows
    // do not. Reading fresh from the tables and re-importing must still
    // keep the tag out.
    const tombstones = await db.deletedTagIds.toArray()
    expect(tombstones.map((row) => row.id)).toEqual(["oura-3"])
    await importSampleTags()
    expect(await storedTagLabels()).toEqual([
      "2026-01-01:alcohol",
      "2026-01-02:alcohol"
    ])
  })

  it("still blocks resurrection after the tag was renamed", async () => {
    await importSampleTags()
    await renameTag("alcohol", "wine")
    await deleteTagEntries(["oura-1"])
    await importSampleTags()
    const labels = await storedTagLabels()
    expect(labels).not.toContain("2026-01-01:alcohol")
    expect(labels).not.toContain("2026-01-01:wine")
  })

  it("lets a restored tag come back and stay on re-import", async () => {
    await importSampleTags()
    const { sessionRows } = await deleteTagEntries(["oura-1"])
    await restoreTagEntries(sessionRows)
    expect(await db.deletedTagIds.count()).toBe(0)
    expect(await storedTagLabels()).toContain("2026-01-01:alcohol")
    await importSampleTags()
    expect(
      (await storedTagLabels()).filter((label) => label === "2026-01-01:alcohol")
    ).toHaveLength(1)
  })

  it("gives user-created tags no tombstone, so restore relies on session rows", async () => {
    const entry = await addUserTagEntry({
      date: "2026-01-05",
      tag: "sauna",
      comment: null
    })
    const { tombstones, sessionRows } = await deleteTagEntries([entry.id])
    expect(tombstones).toHaveLength(0)
    expect(await db.deletedTagIds.count()).toBe(0)
    expect(sessionRows).toHaveLength(1)
    await restoreTagEntries(sessionRows)
    expect(await storedTagLabels()).toEqual(["2026-01-05:sauna"])
  })

  it("restore drops the tombstone without duplicating an already-active tag", async () => {
    await importSampleTags()
    const { sessionRows } = await deleteTagEntries(["oura-1"])
    // The same label returns on the same day as a user tag before restore.
    await addUserTagEntry({ date: "2026-01-01", tag: "Alcohol", comment: null })
    const { restoredEntries } = await restoreTagEntries(sessionRows)
    expect(restoredEntries).toHaveLength(0)
    expect(await db.deletedTagIds.count()).toBe(0)
    expect(
      (await db.tagEntries.toArray()).filter(
        (entry) =>
          entry.date === "2026-01-01" && entry.tag.toLowerCase() === "alcohol"
      )
    ).toHaveLength(1)
  })

  it("restoreTagEntriesExact brings duplicates back verbatim for the cleanup undo", async () => {
    await importOuraFiles([
      enhancedTagCsv([
        ...sampleTags,
        { id: "oura-4", day: "2026-01-01", code: "tag_generic_alcohol" }
      ])
    ])
    const duplicateIds = findDuplicateTagEntryIds(
      await db.tagEntries.orderBy("date").toArray()
    )
    expect(duplicateIds).toEqual(["oura-4"])
    await deleteTagEntries(duplicateIds)
    expect(await db.tagEntries.count()).toBe(3)
    await restoreTagEntriesExact(duplicateIds)
    expect(await db.tagEntries.count()).toBe(4)
    expect(await db.deletedTagIds.count()).toBe(0)
  })

  it("merges metric imports instead of clobbering other files' fields", async () => {
    await importOuraFiles([
      csvFile("dailysleep.csv", ["day,score", "2026-01-01,82"])
    ])
    await importOuraFiles([enhancedTagCsv(sampleTags)])
    const day = await db.dailyMetrics.get("2026-01-01")
    expect(day?.sleepScore).toBe(82)
  })
})

describe("store helpers", () => {
  it("filterTombstonedTagEntries returns the same array when nothing is deleted", () => {
    const entries = [
      { id: "a" } as never,
      { id: "b" } as never
    ]
    expect(filterTombstonedTagEntries(entries, new Set())).toBe(entries)
    expect(
      filterTombstonedTagEntries(entries, new Set(["a"])).map(
        (entry: { id: string }) => entry.id
      )
    ).toEqual(["b"])
  })

  it("renameTag rewrites tombstone snapshots too", async () => {
    await importSampleTags()
    await deleteTagEntries(["oura-1"])
    await renameTag("alcohol", "wine")
    const tombstone = await db.deletedTagIds.get("oura-1")
    expect(tombstone?.entry?.tag).toBe("wine")
    const active = await db.tagEntries.get("oura-2")
    expect(active?.tag).toBe("wine")
  })

  it("updateDayComment writes the note onto every entry of the day", async () => {
    await importSampleTags()
    await updateDayComment("2026-01-02", "rough night")
    const dayEntries = await db.tagEntries
      .where("date")
      .equals("2026-01-02")
      .toArray()
    expect(dayEntries).toHaveLength(2)
    expect(dayEntries.every((entry) => entry.comment === "rough night")).toBe(
      true
    )
    const otherDay = await db.tagEntries.get("oura-1")
    expect(otherDay?.comment).toBeNull()
  })

  it("mapTagEntries keeps fallback ids stable so tombstones still match", () => {
    const rows = [
      { day: "2026-01-01", tag_type_code: "tag_generic_alcohol" },
      { day: "2026-01-01", tag_type_code: "tag_generic_alcohol" }
    ]
    const first = mapTagEntries(rows)
    const second = mapTagEntries(rows)
    expect(first.map((entry) => entry.id)).toEqual(
      second.map((entry) => entry.id)
    )
    // The first occurrence keeps the unsuffixed id; the duplicate gets a
    // suffix instead of colliding in bulkPut.
    expect(first[0].id).not.toBe(first[1].id)
    expect(first[1].id.startsWith(first[0].id)).toBe(true)
  })
})
