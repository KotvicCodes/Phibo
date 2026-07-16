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

// Renames every entry carrying a label, including deletion tombstone
// snapshots so crossed-out tags follow the rename. The Settings UI blocks
// renaming onto another tag's name, so this never has to merge two tags.
export async function renameTag(fromLabel: string, toLabel: string) {
  const fromKey = fromLabel.toLocaleLowerCase()
  let renamedCount = 0

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    await db.tagEntries.toCollection().modify((entry) => {
      if (entry.tag.toLocaleLowerCase() === fromKey) {
        entry.tag = toLabel
        renamedCount += 1
      }
    })

    await db.deletedTagIds.toCollection().modify((row) => {
      if (row.entry && row.entry.tag.toLocaleLowerCase() === fromKey) {
        row.entry.tag = toLabel
      }
    })
  })

  return { renamedCount }
}

// Oura keeps the app's single per-day note on the enhanced tag rows of that
// day (there is no separate day-note store), so the day note is written to
// every tag entry of the day, matching what an Oura-native export looks like.
export async function updateDayComment(date: string, comment: string | null) {
  await db.tagEntries
    .where("date")
    .equals(date)
    .modify((entry) => {
      entry.comment = comment
    })
}

export async function deleteTagEntries(ids: string[]) {
  const tombstones: DeletedTagIdRow[] = []
  const sessionRows: DeletedTagIdRow[] = []

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    const deletedAt = new Date().toISOString()

    for (const id of ids) {
      const entry = await db.tagEntries.get(id)

      await db.tagEntries.delete(id)

      if (!entry) {
        continue
      }

      // Every deletion gets a session row so the UI can show a crossed-out
      // chip until the dashboard closes, whatever the tag's source.
      sessionRows.push({ id, deletedAt, entry })

      // Tombstones exist so a re-import or resync cannot resurrect deleted
      // Oura tags. They are backend-only; nothing displays them. User-created
      // tags never come back from an import, so they get no tombstone.
      if (entry.source !== "user") {
        const tombstone = { id, deletedAt, entry }

        await db.deletedTagIds.put(tombstone)
        tombstones.push(tombstone)
      }
    }
  })

  return { deletedIds: ids, tombstones, sessionRows }
}

// Takes the session rows themselves rather than ids: user-created tags have
// no tombstone in the database, so the entry to restore only exists on the
// in-memory row.
export async function restoreTagEntries(rows: DeletedTagIdRow[]) {
  const restoredEntries: TagEntryRow[] = []
  const removedTombstoneIds = rows.map((row) => row.id)

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    for (const row of rows) {
      await db.deletedTagIds.delete(row.id)

      const entry = row.entry

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

  return { removedTombstoneIds, restoredEntries }
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
