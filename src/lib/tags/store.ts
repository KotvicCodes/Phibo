import { db } from "../db"
import type { TagEntryRow } from "../db/types"
import { normalizeTagLabel } from "../oura/normalizer"

export async function getDeletedTagIdSet() {
  const ids = await db.deletedTagIds.toCollection().primaryKeys()

  return new Set(ids)
}

export function filterTombstonedTagEntries(
  entries: TagEntryRow[],
  deletedIds: Set<string>
) {
  if (deletedIds.size === 0) {
    return entries
  }

  return entries.filter((entry) => !deletedIds.has(entry.id))
}

export function resolveUserTagLabel(input: string, existingTags: string[]) {
  const trimmed = input.replace(/\s+/g, " ").trim()

  if (!trimmed) {
    return null
  }

  const existingMatch = existingTags.find(
    (tag) => tag.toLowerCase() === trimmed.toLowerCase()
  )

  if (existingMatch) {
    return existingMatch
  }

  return normalizeTagLabel(trimmed.toLowerCase())
}

export async function addUserTagEntry(input: {
  date: string
  tag: string
  comment: string | null
}) {
  const entry: TagEntryRow = {
    id: `user-${crypto.randomUUID()}`,
    date: input.date,
    tag: input.tag,
    comment: input.comment || null,
    source: "user",
    sourceUpdatedAt: null,
    syncedAt: new Date().toISOString()
  }

  await db.tagEntries.put(entry)

  return entry
}

export async function deleteTagEntry(id: string) {
  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    await db.tagEntries.delete(id)
    await db.deletedTagIds.put({ id, deletedAt: new Date().toISOString() })
  })
}
