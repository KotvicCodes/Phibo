<script lang="ts">
  import { db } from "../lib/db"
  import type {
    DailyMetricRow,
    DeletedTagIdRow,
    TagEntryRow
  } from "../lib/db/types"
  import {
    buildTagBackup,
    parseTagBackup,
    restoreTagBackup,
    TagBackupError
  } from "../lib/tags/backup"
  import {
    deleteTagEntries,
    findDuplicateTagEntryIds,
    renameTag,
    resolveUserTagLabel,
    restoreTagEntriesExact
  } from "../lib/tags/store"
  import type { ExploreMetricKey } from "../lib/analysis/correlations"
  import { exploreMetricCategories } from "./exploreCharts"
  import { trapFocus } from "./focusTrap"
  import { formatInputDate } from "./format"
  import {
    buildAllKnownTags,
    filterTagsByQuery,
    type TagTimingMode
  } from "./tagDays"
  import { formatTagLabel, sortTagsForDisplay } from "./tagLabels"

  // The data tables are bound so backup restores, duplicate cleanups, and
  // the local data wipe update the whole dashboard in place.
  export let dailyMetrics: DailyMetricRow[]
  export let tagEntries: TagEntryRow[]
  export let deletedTagRows: DeletedTagIdRow[]
  // Bound to the parent, which persists it so the duplicate cleanup undo
  // survives switching views and reloading the dashboard.
  export let lastDedupeIds: string[]

  // Analysis-shaping settings stay parent-owned: the parent restores and
  // persists them, and the analysis views consume them. This view only
  // renders the controls and reports interactions back.
  export let excludeUntaggedDays: boolean
  export let showTagCounts: boolean
  export let tagTimingMode: TagTimingMode
  export let exploreFavoriteMetrics: ExploreMetricKey[]
  export let exploreHiddenMetrics: ExploreMetricKey[]
  export let analysisDayCount: number
  export let excludedUntaggedDayCount: number
  export let updateExcludeUntaggedDays: (event: Event) => void
  export let updateShowTagCounts: (event: Event) => void
  export let updateTagTimingMode: (event: Event) => void
  export let cycleExploreMetricPreference: (key: ExploreMetricKey) => void
  // Lets the parent reset its import messaging after a local data wipe.
  export let onDataDeleted: () => void
  // Lets the parent rewrite settings that store tag labels, like the
  // Optimal overrides and the Tags view filter selections.
  export let onTagRenamed: (fromLabel: string, toLabel: string) => void

  let tagBackupMessage = ""
  let isRestoringTagBackup = false
  let renameTargetTag = ""
  let renameInput = ""
  let renameMessage = ""
  let isRenamingTag = false
  let isRenameModalOpen = false
  let renameSearch = ""
  let isDedupeConfirmOpen = false
  let isDeduping = false
  let dedupeMessage = ""
  let deleteDataArmed = false
  let isDeletingData = false
  let deleteDataMessage = ""

  $: hasLocalData = dailyMetrics.length > 0
  $: duplicateTagIds = findDuplicateTagEntryIds(tagEntries)
  // Every label ever seen, including fully deleted ones, so a tag whose last
  // instance is crossed out can still be renamed.
  $: allKnownTags = sortTagsForDisplay(
    buildAllKnownTags(tagEntries, deletedTagRows)
  )
  $: filteredRenameTags = filterTagsByQuery(allKnownTags, renameSearch)

  async function reloadTagEntries() {
    tagEntries = await db.tagEntries.orderBy("date").toArray()
    deletedTagRows = await db.deletedTagIds.toArray()
  }

  async function downloadTagBackup() {
    const allTagEntries = await db.tagEntries.orderBy("date").toArray()
    const allDeletedTagIds = await db.deletedTagIds.toArray()
    const backup = buildTagBackup(allTagEntries, allDeletedTagIds)
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = `phibo-tags-${formatInputDate(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)

    return allTagEntries.length
  }

  async function exportTagBackup() {
    try {
      const count = await downloadTagBackup()

      tagBackupMessage = `Exported ${count} tag entries.`
    } catch {
      tagBackupMessage = "Could not export the tag backup. Try again."
    }
  }

  async function restoreTagBackupFile(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    const file = input.files?.[0]

    // Allow picking the same file again after a failed attempt.
    input.value = ""

    if (!file) {
      return
    }

    isRestoringTagBackup = true

    try {
      const { backup, invalidRows } = parseTagBackup(await file.text())
      const result = await restoreTagBackup(backup)

      await reloadTagEntries()

      const parts = [
        `Restored ${result.added} tags`,
        `skipped ${result.skipped} already present`,
        `applied ${result.deleted} deletions`
      ]

      if (invalidRows > 0) {
        parts.push(`ignored ${invalidRows} invalid rows`)
      }

      tagBackupMessage = `${parts.join(", ")}.`
    } catch (error) {
      tagBackupMessage =
        error instanceof TagBackupError
          ? error.message
          : "Could not restore that backup file."
    } finally {
      isRestoringTagBackup = false
    }
  }

  function openRenameModal() {
    isRenameModalOpen = true
    renameSearch = ""
    renameTargetTag = ""
    renameInput = ""
    renameMessage = ""
  }

  function closeRenameModal() {
    if (isRenamingTag) {
      return
    }

    isRenameModalOpen = false
  }

  function handleRenameBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeRenameModal()
    }
  }

  // Clicking a chip toggles it off if it is already the target, otherwise
  // picks it and pre-fills the input with its current label.
  function selectRenameChip(tag: string) {
    if (renameTargetTag === tag) {
      renameTargetTag = ""
      renameInput = ""
    } else {
      renameTargetTag = tag
      renameInput = tag
    }

    renameMessage = ""
  }

  async function applyTagRename() {
    if (!renameTargetTag) {
      return
    }

    const trimmed = renameInput.replace(/\s+/g, " ").trim()

    if (!trimmed) {
      renameMessage = "Type a new tag name first."
      return
    }

    // A case-only change keeps the typed casing; anything else adopts an
    // existing label's casing or canonicalizes like the tag picker does.
    const label =
      trimmed.toLocaleLowerCase() === renameTargetTag.toLocaleLowerCase()
        ? trimmed
        : resolveUserTagLabel(trimmed, allKnownTags)

    if (!label) {
      renameMessage = "Type a new tag name first."
      return
    }

    if (label === renameTargetTag) {
      renameMessage = "That is already the tag's name."
      return
    }

    // Renaming onto another tag's name would merge the two, which collapses
    // same-day duplicates by deleting entries and cannot be undone by
    // renaming back. Block it instead of merging silently.
    const takenBy = allKnownTags.find(
      (tag) =>
        tag.toLocaleLowerCase() === label.toLocaleLowerCase() &&
        tag.toLocaleLowerCase() !== renameTargetTag.toLocaleLowerCase()
    )

    if (takenBy) {
      renameMessage = `Another tag is already named ${formatTagLabel(takenBy)}.`
      return
    }

    isRenamingTag = true

    try {
      const { renamedCount } = await renameTag(renameTargetTag, label)

      onTagRenamed(renameTargetTag, label)
      await reloadTagEntries()
      renameMessage = `Renamed ${renamedCount} entries to ${formatTagLabel(label)}.`
      renameTargetTag = ""
      renameInput = ""
    } catch {
      renameMessage = "Could not rename that tag. Try again."
    } finally {
      isRenamingTag = false
    }
  }

  function openDedupeConfirm() {
    isDedupeConfirmOpen = true
    dedupeMessage = ""
  }

  function closeDedupeConfirm() {
    isDedupeConfirmOpen = false
  }

  function handleDedupeBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget && !isDeduping) {
      closeDedupeConfirm()
    }
  }

  function handleSettingsKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isDedupeConfirmOpen && !isDeduping) {
      closeDedupeConfirm()
    }

    if (event.key === "Escape" && isRenameModalOpen && !isRenamingTag) {
      closeRenameModal()
    }
  }

  async function confirmRemoveDuplicates(withBackup: boolean) {
    isDeduping = true

    try {
      // Back up before touching anything. If the download fails, stop so the
      // user is never left without the safety net they asked for.
      if (withBackup) {
        try {
          await downloadTagBackup()
        } catch {
          dedupeMessage = "Could not save the backup, so nothing was removed."
          return
        }
      }

      const result = await deleteTagEntries(duplicateTagIds)
      const removedIds = new Set(result.deletedIds)

      tagEntries = tagEntries.filter((entry) => !removedIds.has(entry.id))
      deletedTagRows = [...deletedTagRows, ...result.tombstones]
      lastDedupeIds = result.tombstones.map((tombstone) => tombstone.id)
      dedupeMessage = withBackup
        ? `Backed up, then removed ${result.deletedIds.length} duplicate tag entries.`
        : `Removed ${result.deletedIds.length} duplicate tag entries. Undo works until the next cleanup.`
    } catch {
      dedupeMessage = "Could not remove duplicates. Try again."
    } finally {
      isDeduping = false
      isDedupeConfirmOpen = false
    }
  }

  async function undoRemoveDuplicates() {
    if (lastDedupeIds.length === 0) {
      return
    }

    isDeduping = true

    try {
      const result = await restoreTagEntriesExact(lastDedupeIds)
      const removedTombstoneIds = new Set(result.removedTombstoneIds)

      deletedTagRows = deletedTagRows.filter(
        (row) => !removedTombstoneIds.has(row.id)
      )
      tagEntries = [...tagEntries, ...result.restoredEntries].sort(
        (left, right) => left.date.localeCompare(right.date)
      )
      lastDedupeIds = []
      dedupeMessage = `Restored ${result.restoredEntries.length} duplicate tag entries.`
    } catch {
      dedupeMessage = "Could not undo the removal. Try again."
    } finally {
      isDeduping = false
    }
  }

  async function deleteAllLocalData() {
    if (!deleteDataArmed) {
      deleteDataArmed = true
      deleteDataMessage =
        "This permanently deletes all imported days, tags, and import history from this device. Click Confirm delete to continue."
      return
    }

    isDeletingData = true

    try {
      await db.transaction(
        "rw",
        db.dailyMetrics,
        db.tagEntries,
        db.deletedTagIds,
        db.importRuns,
        async () => {
          await db.dailyMetrics.clear()
          await db.tagEntries.clear()
          await db.deletedTagIds.clear()
          await db.importRuns.clear()
        }
      )

      dailyMetrics = []
      tagEntries = []
      deletedTagRows = []
      // The wiped tombstones took the undo's restore data with them.
      lastDedupeIds = []
      onDataDeleted()
      deleteDataMessage = "All imported Oura data was deleted from this device."
    } catch {
      deleteDataMessage = "Could not delete local data. Try again."
    } finally {
      deleteDataArmed = false
      isDeletingData = false
    }
  }

  function cancelDeleteData() {
    deleteDataArmed = false
    deleteDataMessage = ""
  }
</script>

<svelte:window on:keydown={handleSettingsKeydown} />

    <section class="settings-workspace">
      <div class="settings-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Settings</p>
            <h2>Analysis sample</h2>
          </div>
        </div>

        <label class="setting-row">
          <div>
            <strong>Ignore days without tags</strong>
            <p>
              Exclude days that have no Oura tags from Insights and Explore comparisons.
            </p>
          </div>
          <input
            type="checkbox"
            checked={excludeUntaggedDays}
            on:change={updateExcludeUntaggedDays}
          />
        </label>

        <label class="setting-row">
          <div>
            <strong>Show tag night counts</strong>
            <p>
              Display how many tagged nights each tag has next to it in the Explore tag list.
            </p>
          </div>
          <input
            type="checkbox"
            checked={showTagCounts}
            on:change={updateShowTagCounts}
          />
        </label>

        <div class="setting-row metric-preferences-setting">
          <div>
            <strong>Explore metrics</strong>
            <p>
              Click a metric to cycle its place in the Explore metric pickers:
              normal, favorite (pinned in a Favorites group on top), or hidden
              (left out of the pickers entirely).
            </p>
            <div class="metric-preferences">
              {#each exploreMetricCategories as group}
                <div class="metric-preference-group">
                  <h4>{group.category}</h4>
                  <div class="metric-preference-chips">
                    {#each group.metrics as metric}
                      {@const isFavorite = exploreFavoriteMetrics.includes(
                        metric.key
                      )}
                      {@const isHidden = exploreHiddenMetrics.includes(
                        metric.key
                      )}
                      <button
                        type="button"
                        class:favorite={isFavorite}
                        class:hidden-metric={isHidden}
                        aria-label={`${metric.label}: ${isFavorite ? "favorite" : isHidden ? "hidden" : "normal"}`}
                        title={`${metric.label}: ${isFavorite ? "favorite" : isHidden ? "hidden" : "normal"}`}
                        on:click={() => cycleExploreMetricPreference(metric.key)}
                      >
                        {#if isFavorite}★{/if}
                        {metric.label}
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <div class="setting-row tag-timing-setting">
          <div>
            <strong>Tag timing</strong>
            <p>
              Oura sleep dates usually refer to the morning the night ended. If
              you tag the next morning, keep Morning tagging. If you tag during
              the day before sleep, choose Same-day tagging.
            </p>
          </div>
          <div class="setting-options" role="radiogroup" aria-label="Tag timing">
            <label class="setting-option">
              <input
                type="radio"
                name="tagTimingMode"
                value="morning"
                checked={tagTimingMode === "morning"}
                on:change={updateTagTimingMode}
              />
              <span>
                <strong>Morning tagging</strong>
                <small>I add tags the next morning. Tags stay on the same Oura date.</small>
              </span>
            </label>
            <label class="setting-option">
              <input
                type="radio"
                name="tagTimingMode"
                value="sameDay"
                checked={tagTimingMode === "sameDay"}
                on:change={updateTagTimingMode}
              />
              <span>
                <strong>Same-day tagging</strong>
                <small>I add tags during the day. Tags apply to the following Oura sleep date.</small>
              </span>
            </label>
          </div>
        </div>

        <div class="setting-row tag-backup-setting">
          <div>
            <strong>Tag backup</strong>
            <p>
              Save all tags and tag deletions to a JSON file on this device, or
              restore a previous backup. Restoring never overwrites tags you
              already have.
            </p>
            {#if tagBackupMessage}
              <p class="tag-backup-message" role="status">{tagBackupMessage}</p>
            {/if}
          </div>
          <div class="tag-backup-actions">
            <button
              type="button"
              class="tag-backup-button"
              disabled={tagEntries.length === 0 && deletedTagRows.length === 0}
              on:click={exportTagBackup}
            >
              {tagEntries.length === 0 && deletedTagRows.length === 0
                ? "No tags yet"
                : "Export tags"}
            </button>
            <label class="tag-backup-button" class:disabled={isRestoringTagBackup}>
              {isRestoringTagBackup ? "Restoring" : "Restore tags"}
              <input
                type="file"
                accept=".json,application/json"
                disabled={isRestoringTagBackup}
                on:change={restoreTagBackupFile}
              />
            </label>
          </div>
        </div>

        <div class="setting-row rename-tag-setting">
          <div>
            <strong>Rename tags</strong>
            <p>
              Renames a tag everywhere, including crossed-out entries. Names
              already used by another tag are not allowed.
            </p>
          </div>
          <div class="delete-data-actions">
            <button
              type="button"
              class="delete-data-button"
              disabled={allKnownTags.length === 0}
              on:click={openRenameModal}
            >
              {allKnownTags.length === 0 ? "No tags" : "Rename tags"}
            </button>
          </div>
        </div>

        <div class="setting-row dedupe-setting">
          <div>
            <strong>Remove duplicate tags</strong>
            <p>
              Delete extra copies when the same tag appears several times on
              one day, keeping one of each. Leave duplicates alone if you log
              the same tag repeatedly on purpose, for example to track times.
              Removed copies stay removed after a re-import.
            </p>
            {#if dedupeMessage}
              <p class="delete-data-message" role="status">{dedupeMessage}</p>
            {/if}
          </div>
          <div class="delete-data-actions">
            <button
              type="button"
              class="delete-data-button"
              disabled={isDeduping || duplicateTagIds.length === 0}
              on:click={openDedupeConfirm}
            >
              {isDeduping
                ? "Removing"
                : duplicateTagIds.length === 0
                  ? "No duplicates"
                  : `Remove ${duplicateTagIds.length} duplicates`}
            </button>
            {#if lastDedupeIds.length > 0 && !isDeduping}
              <button
                type="button"
                class="delete-data-cancel"
                on:click={undoRemoveDuplicates}
              >
                Undo
              </button>
            {/if}
          </div>
        </div>

        <div class="setting-summary">
          <span>Current sample</span>
          <strong>{analysisDayCount} of {dailyMetrics.length} days</strong>
          <p>
            {excludeUntaggedDays
              ? `${excludedUntaggedDayCount} untagged days excluded.`
              : "All imported days included."}
          </p>
        </div>

        <div class="setting-row delete-data-setting">
          <div>
            <strong>Delete local data</strong>
            <p>
              Permanently remove all imported days, tags, and import history
              from this device, along with tag-based settings like Optimal
              overrides and saved tag selections. A saved Oura key is not
              affected. Use this to start fresh before re-importing an export.
            </p>
            {#if deleteDataMessage}
              <p class="delete-data-message" role="status">{deleteDataMessage}</p>
            {/if}
          </div>
          <div class="delete-data-actions">
            <button
              type="button"
              class="delete-data-button"
              class:armed={deleteDataArmed}
              disabled={isDeletingData || !hasLocalData}
              on:click={deleteAllLocalData}
            >
              {isDeletingData
                ? "Deleting"
                : deleteDataArmed
                  ? "Confirm delete"
                  : hasLocalData
                    ? "Delete local data"
                    : "No local data"}
            </button>
            {#if deleteDataArmed && !isDeletingData}
              <button
                type="button"
                class="delete-data-cancel"
                on:click={cancelDeleteData}
              >
                Cancel
              </button>
            {/if}
          </div>
        </div>
      </div>

      {#if isDedupeConfirmOpen}
        <div
          class="tag-picker-backdrop"
          role="presentation"
          on:click={handleDedupeBackdropClick}
        >
          <section
            class="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Remove duplicate tags"
            use:trapFocus
          >
            <h2>Remove {duplicateTagIds.length} duplicate tag entries?</h2>
            <p>
              This keeps one of each tag per day. It cannot be reliably undone
              once you close the dashboard, so save a backup first. A backup is
              a small file you can restore later if you change your mind.
            </p>
            <div class="confirm-modal-actions">
              <button
                type="button"
                class="confirm-button primary"
                disabled={isDeduping}
                on:click={() => confirmRemoveDuplicates(true)}
              >
                {isDeduping ? "Working" : "Back up, then remove"}
              </button>
              <button
                type="button"
                class="confirm-button danger"
                disabled={isDeduping}
                on:click={() => confirmRemoveDuplicates(false)}
              >
                Remove without a backup
              </button>
              <button
                type="button"
                class="confirm-button ghost"
                disabled={isDeduping}
                on:click={closeDedupeConfirm}
              >
                Never mind
              </button>
            </div>
          </section>
        </div>
      {/if}

      {#if isRenameModalOpen}
        <div
          class="tag-picker-backdrop"
          role="presentation"
          on:click={handleRenameBackdropClick}
        >
          <section
            class="rename-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Rename tags"
            use:trapFocus
          >
            <div class="rename-modal-head">
              <h2>Rename tags</h2>
              <button
                type="button"
                class="rename-modal-close"
                aria-label="Close"
                on:click={closeRenameModal}
              >
                ×
              </button>
            </div>
            <p class="rename-modal-hint">
              Pick a tag, then type its new name. Names already used by
              another tag are not allowed.
            </p>
            <input
              class="tag-search"
              type="search"
              placeholder="Search tags"
              aria-label="Search tags"
              bind:value={renameSearch}
            />
            <div class="rename-modal-tags tag-picker">
              {#each filteredRenameTags as tag (tag)}
                <button
                  type="button"
                  class:active={renameTargetTag === tag}
                  on:click={() => selectRenameChip(tag)}
                >
                  {formatTagLabel(tag)}
                </button>
              {:else}
                <p class="empty-state">No tags match your search.</p>
              {/each}
            </div>
            {#if renameMessage}
              <p class="tag-backup-message" role="status">{renameMessage}</p>
            {/if}
            {#if renameTargetTag}
              <form
                class="rename-modal-form"
                on:submit|preventDefault={applyTagRename}
              >
                <input
                  type="text"
                  aria-label="New tag name"
                  placeholder="New name"
                  bind:value={renameInput}
                />
                <button type="submit" disabled={isRenamingTag}>
                  {isRenamingTag ? "Renaming" : "Rename"}
                </button>
              </form>
            {/if}
          </section>
        </div>
      {/if}
    </section>

<style>
  .setting-row {
    align-items: center;
    border-block: 1px solid #d8d8cc;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    padding-block: 0.9rem;
  }

  .setting-row.tag-timing-setting {
    align-items: start;
  }

  .setting-row strong {
    display: block;
    font-size: 1rem;
  }

  .setting-row p,
  .setting-summary p {
    color: #6f786f;
    font-size: 0.9rem;
    line-height: 1.4;
    margin-top: 0.25rem;
  }

  .setting-row input {
    accent-color: #1d2a22;
    height: 1.25rem;
    width: 1.25rem;
  }

  .setting-options {
    display: grid;
    gap: 0.55rem;
    min-width: min(22rem, 100%);
  }

  .setting-option {
    align-items: flex-start;
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    cursor: pointer;
    display: grid;
    gap: 0.55rem;
    grid-template-columns: auto minmax(0, 1fr);
    padding: 0.7rem;
  }

  .setting-option span {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .setting-option small {
    color: #6f786f;
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .setting-summary {
    display: grid;
    gap: 0.15rem;
    padding-top: 0.9rem;
  }

  .setting-row.delete-data-setting {
    align-items: start;
    border-top: 1px solid #d8d8cc;
    margin-top: 0.4rem;
  }

  .setting-row.dedupe-setting {
    align-items: start;
    border-top: 0;
  }

  .confirm-modal {
    background: #fbf7ef;
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(23, 32, 27, 0.28);
    display: grid;
    gap: 0.7rem;
    max-width: 460px;
    padding: 1rem;
    width: 100%;
  }

  .confirm-modal h2 {
    font-size: 1.15rem;
  }

  .confirm-modal p {
    color: #6f786f;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .confirm-modal-actions {
    display: grid;
    gap: 0.5rem;
    justify-items: center;
    margin-top: 0.2rem;
  }

  .confirm-button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 800;
    max-width: 20rem;
    min-height: 44px;
    padding: 0.6rem 1rem;
    width: 100%;
  }

  .confirm-button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* Green pushes the safe path; the no-backup option wears the danger red so
     it reads as the risky choice. */
  .confirm-button.primary {
    background: #4f8a63;
    border-color: #4f8a63;
    color: #f8f3ea;
  }

  .confirm-button.danger {
    background: transparent;
    border-color: #d2b5a5;
    color: #8a3f2f;
    font-size: 0.82rem;
    font-weight: 700;
    min-height: 38px;
  }

  .confirm-button.ghost {
    background: transparent;
    border-color: transparent;
    color: #6f786f;
    font-size: 0.82rem;
    min-height: 34px;
  }

  .delete-data-message {
    color: #8a3f2f;
    font-weight: 700;
  }

  .delete-data-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .delete-data-button,
  .delete-data-cancel {
    appearance: none;
    border: 1px solid #d2b5a5;
    border-radius: 8px;
    background: #fbf7ef;
    color: #8a3f2f;
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    min-height: 42px;
    padding: 0.58rem 0.72rem;
    white-space: nowrap;
  }

  .delete-data-button.armed {
    background: #8a3f2f;
    border-color: #8a3f2f;
    color: #f8f3ea;
  }

  .delete-data-button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .delete-data-cancel {
    border-color: #c5cbbd;
    color: #17201b;
  }

  .setting-row.tag-backup-setting {
    align-items: start;
  }

  .setting-row.rename-tag-setting {
    align-items: start;
    border-top: 0;
  }

  .rename-modal {
    background: #fbf7ef;
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(23, 32, 27, 0.28);
    display: grid;
    gap: 0.7rem;
    max-height: min(80vh, 40rem);
    max-width: 520px;
    padding: 1rem;
    width: 100%;
  }

  .rename-modal-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  .rename-modal-head h2 {
    font-size: 1.15rem;
  }

  .rename-modal-close {
    appearance: none;
    background: transparent;
    border: 0;
    color: #6f786f;
    cursor: pointer;
    font-size: 1.4rem;
    line-height: 1;
    padding: 0.1rem 0.4rem;
  }

  .rename-modal-hint {
    color: #6f786f;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  /* Scrolls on its own so a large tag set never pushes the rename input off
     the modal. */
  .rename-modal-tags {
    max-height: 40vh;
    overflow-y: auto;
    padding: 0.1rem;
  }

  .rename-modal-form {
    display: grid;
    gap: 0.55rem;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .rename-modal-form input {
    background: #fbf7ef;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    font: inherit;
    min-width: 0;
    padding: 0.5rem 0.65rem;
  }

  .rename-modal-form button {
    appearance: none;
    background: #1d2a22;
    border: 1px solid #1d2a22;
    border-radius: 8px;
    color: #f8f3ea;
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    padding: 0.5rem 0.9rem;
    white-space: nowrap;
  }

  .rename-modal-form button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .tag-backup-message {
    color: #17201b;
    font-weight: 700;
  }

  .tag-backup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-backup-button {
    appearance: none;
    background: #fbf7ef;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    color: #17201b;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    min-height: 42px;
    padding: 0.58rem 0.72rem;
    white-space: nowrap;
  }

  .tag-backup-button:disabled,
  .tag-backup-button.disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .tag-backup-button input {
    display: none;
  }

  .setting-summary span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .metric-preferences {
    display: grid;
    gap: 0.8rem;
    margin-top: 0.7rem;
  }

  .metric-preference-group h4 {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    margin: 0 0 0.35rem;
    text-transform: uppercase;
  }

  .metric-preference-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .metric-preference-chips button {
    appearance: none;
    background: #f7f1e8;
    border: 1px solid #d8d8cc;
    border-radius: 999px;
    color: #1f2520;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.28rem 0.62rem;
  }

  .metric-preference-chips button.favorite {
    background: #1e2c64;
    border-color: #1e2c64;
    color: #fbf7ef;
  }

  .metric-preference-chips button.hidden-metric {
    background: transparent;
    color: #9ca69a;
    text-decoration: line-through;
  }

@media (max-width: 560px) {
    .setting-row,
    .setting-row.tag-timing-setting {
      grid-template-columns: 1fr;
    }
  }
</style>
