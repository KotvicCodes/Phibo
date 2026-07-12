import { db } from "../db"
import type { DeletedTagIdRow, TagEntryRow } from "../db/types"

interface PhiboTagBackup {
  schema: "phibo-tag-backup"
  version: 1
  exportedAt: string
  tagEntries: TagEntryRow[]
  deletedTagIds: DeletedTagIdRow[]
}

interface TagRestoreResult {
  added: number
  skipped: number
  deleted: number
  invalidRows: number
}

// Restore errors stay privacy-safe: file shape and counts only, never tag
// labels, comments, or dates.
export class TagBackupError extends Error {}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export function buildTagBackup(
  tagEntries: TagEntryRow[],
  deletedTagIds: DeletedTagIdRow[]
): PhiboTagBackup {
  return {
    schema: "phibo-tag-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    tagEntries,
    deletedTagIds
  }
}

export function parseTagBackup(text: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw new TagBackupError("Could not read that file as JSON.")
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).schema !== "phibo-tag-backup"
  ) {
    throw new TagBackupError("This file is not a Phibo tag backup.")
  }

  const backup = parsed as Record<string, unknown>

  if (backup.version !== 1) {
    throw new TagBackupError("This backup was made by a newer Phibo version.")
  }

  if (!Array.isArray(backup.tagEntries) || !Array.isArray(backup.deletedTagIds)) {
    throw new TagBackupError("This tag backup file is incomplete.")
  }

  let invalidRows = 0
  const tagEntries: TagEntryRow[] = []

  for (const row of backup.tagEntries) {
    const entry = parseTagEntryRow(row)

    if (entry) {
      tagEntries.push(entry)
    } else {
      invalidRows += 1
    }
  }

  const deletedTagIds: DeletedTagIdRow[] = []

  for (const row of backup.deletedTagIds) {
    const tombstone = parseDeletedTagIdRow(row)

    if (tombstone) {
      deletedTagIds.push(tombstone)
    } else {
      invalidRows += 1
    }
  }

  return {
    backup: buildTagBackup(tagEntries, deletedTagIds),
    invalidRows
  }
}

function parseTagEntryRow(row: unknown): TagEntryRow | null {
  if (typeof row !== "object" || row === null) {
    return null
  }

  const record = row as Record<string, unknown>

  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.date !== "string" ||
    !datePattern.test(record.date) ||
    typeof record.tag !== "string" ||
    record.tag.trim().length === 0
  ) {
    return null
  }

  return {
    id: record.id,
    date: record.date,
    tag: record.tag,
    comment: typeof record.comment === "string" ? record.comment : null,
    source: record.source === "user" ? "user" : "oura",
    sourceUpdatedAt:
      typeof record.sourceUpdatedAt === "string" ? record.sourceUpdatedAt : null,
    syncedAt:
      typeof record.syncedAt === "string"
        ? record.syncedAt
        : new Date().toISOString()
  }
}

function parseDeletedTagIdRow(row: unknown): DeletedTagIdRow | null {
  if (typeof row !== "object" || row === null) {
    return null
  }

  const record = row as Record<string, unknown>

  if (typeof record.id !== "string" || record.id.length === 0) {
    return null
  }

  const entry = parseTagEntryRow(record.entry)

  return {
    id: record.id,
    deletedAt:
      typeof record.deletedAt === "string"
        ? record.deletedAt
        : new Date().toISOString(),
    ...(entry ? { entry } : {})
  }
}

export async function restoreTagBackup(
  backup: PhiboTagBackup
): Promise<Omit<TagRestoreResult, "invalidRows">> {
  let added = 0
  let skipped = 0
  let deleted = 0

  await db.transaction("rw", db.tagEntries, db.deletedTagIds, async () => {
    // Tombstones merge as a union so a restore reproduces past deletions.
    // Local tombstones win on id collisions, like entries below, so a
    // pre-rename backup cannot revert renamed snapshots and drag the old
    // label back into crossed-out chips and the label lists.
    const localTombstoneIds = new Set(
      await db.deletedTagIds.toCollection().primaryKeys()
    )
    const tombstonesToAdd = backup.deletedTagIds.filter(
      (tombstone) => !localTombstoneIds.has(tombstone.id)
    )

    if (tombstonesToAdd.length > 0) {
      await db.deletedTagIds.bulkPut(tombstonesToAdd)
    }

    const incomingDeletedIds = new Set(
      backup.deletedTagIds.map((tombstone) => tombstone.id)
    )

    if (incomingDeletedIds.size > 0) {
      const localIds = await db.tagEntries.toCollection().primaryKeys()
      const idsToDelete = localIds.filter((id) => incomingDeletedIds.has(id))

      if (idsToDelete.length > 0) {
        await db.tagEntries.bulkDelete(idsToDelete)
        deleted = idsToDelete.length
      }
    }

    const allDeletedIds = new Set(
      await db.deletedTagIds.toCollection().primaryKeys()
    )
    const existingIds = new Set(await db.tagEntries.toCollection().primaryKeys())
    const entriesToAdd = backup.tagEntries.filter(
      (entry) => !allDeletedIds.has(entry.id) && !existingIds.has(entry.id)
    )

    // Local rows win on id collisions, so restoring is non-destructive and
    // running the same restore twice changes nothing.
    skipped = backup.tagEntries.length - entriesToAdd.length
    added = entriesToAdd.length

    if (entriesToAdd.length > 0) {
      await db.tagEntries.bulkPut(entriesToAdd)
    }
  })

  return { added, skipped, deleted }
}
