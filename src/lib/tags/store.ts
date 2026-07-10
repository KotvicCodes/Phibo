import { db } from "../db"
import type { DeletedTagIdRow, TagEntryRow } from "../db/types"
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

// Extra same-day instances of a tag, keeping the first entry of each tag per
// day. Used by the opt-in duplicate cleanup in Settings; some users log the
// same tag several times a day on purpose, so this must never run
// automatically.
export function findDuplicateTagEntryIds(entries: TagEntryRow[]) {
  const seenKeys = new Set<string>()
  const duplicateIds: string[] = []

  for (const entry of entries) {
    const key = `${entry.date}|${entry.tag.toLocaleLowerCase()}`

    if (seenKeys.has(key)) {
      duplicateIds.push(entry.id)
    } else {
      seenKeys.add(key)
    }
  }

  return duplicateIds
}

export async function deleteTagEntries(ids: string[]) {
  const tombstones: DeletedTagIdRow[] = []

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    const deletedAt = new Date().toISOString()

    for (const id of ids) {
      const entry = await db.tagEntries.get(id)

      await db.tagEntries.delete(id)

      // Tombstones exist so a re-import or resync cannot resurrect deleted
      // Oura tags. User-created tags never come back from an import, so they
      // are hard-deleted without leaving a crossed-out entry behind.
      if (entry?.source !== "user") {
        const tombstone = { id, deletedAt, entry }

        await db.deletedTagIds.put(tombstone)
        tombstones.push(tombstone)
      }
    }
  })

  return { deletedIds: ids, tombstones }
}

export async function restoreTagEntries(ids: string[]) {
  const restoredEntries: TagEntryRow[] = []

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    for (const id of ids) {
      const tombstone = await db.deletedTagIds.get(id)

      await db.deletedTagIds.delete(id)

      const entry = tombstone?.entry

      if (!entry) {
        continue
      }

      // If the same tag is already active on the day, dropping the tombstone
      // is enough; re-adding would duplicate it. This also collapses a
      // restored group of identical tags into a single active entry.
      const dayEntries = await db.tagEntries
        .where("date")
        .equals(entry.date)
        .toArray()
      const hasDuplicate = dayEntries.some(
        (dayEntry) => dayEntry.tag.toLowerCase() === entry.tag.toLowerCase()
      )

      if (!hasDuplicate) {
        await db.tagEntries.put(entry)
        restoredEntries.push(entry)
      }
    }
  })

  return { removedTombstoneIds: ids, restoredEntries }
}

// Restores rows exactly as they were, even when the same tag is already
// active on that day. Used by the duplicate cleanup undo, where every
// restored row is by definition a duplicate of a surviving entry.
export async function restoreTagEntriesExact(ids: string[]) {
  const restoredEntries: TagEntryRow[] = []

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    for (const id of ids) {
      const tombstone = await db.deletedTagIds.get(id)

      await db.deletedTagIds.delete(id)

      const entry = tombstone?.entry

      if (entry) {
        await db.tagEntries.put(entry)
        restoredEntries.push(entry)
      }
    }
  })

  return { removedTombstoneIds: ids, restoredEntries }
}
