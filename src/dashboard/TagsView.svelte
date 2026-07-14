<script lang="ts">
  import type {
    DailyMetricRow,
    DeletedTagIdRow,
    TagEntryRow
  } from "../lib/db/types"
  import {
    addUserTagEntry,
    deleteTagEntries,
    restoreTagEntries,
    resolveUserTagLabel,
    updateDayComment
  } from "../lib/tags/store"
  import { trapFocus } from "./focusTrap"
  import { formatDate } from "./format"
  import {
    buildAllKnownTags,
    buildAllLogDays,
    buildTagDays,
    buildTagStripDays,
    filterTagsByQuery,
    type DeletedTagChipGroup,
    type TagChipGroup
  } from "./tagDays"
  import {
    formatTagLabel,
    formatTagList,
    tagSortModes,
    type TagSortMode
  } from "./tagLabels"
  import { handleTypeToSearchKeydown } from "./typeToSearch"

  // Tag data is owned by DashboardPage (the analysis views read it too);
  // edits here flow back up through the bound props. The selected day and
  // filter state also live in the parent so they survive view switches.
  export let tagEntries: TagEntryRow[]
  export let deletedTagRows: DeletedTagIdRow[]
  export let dailyMetrics: DailyMetricRow[]
  export let availableTags: string[]
  export let tagNightCounts: Map<string, number>
  export let showTagCounts: boolean
  export let tagSortMode: TagSortMode
  export let tagsViewDate: string
  export let tagsFilterSearch: string
  export let tagsFilterTags: string[]
  export let setTagSortMode: (mode: TagSortMode) => void

  let tagsMessage = ""
  let isTagPickerOpen = false
  let tagPickerSearch = ""
  let tagPickerSearchInput: HTMLInputElement | null = null
  let tagsFilterSearchInput: HTMLInputElement | null = null

  // The Tags manager works on the raw stored dates, like import does. The
  // tag timing shift for analysis views does not apply here.
  $: tagDays = buildTagDays(tagEntries, deletedTagRows)
  $: selectedTagDay = tagDays.find((day) => day.date === tagsViewDate) ?? null
  // Oura keeps one note per day, duplicated across the day's tag rows.
  $: selectedDayComment =
    selectedTagDay?.entries.find((entry) => entry.comment)?.comment ?? ""
  // The picker offers every label ever seen, including fully deleted ones,
  // so a tag whose last instance was deleted stays one click away.
  $: allKnownTags = buildAllKnownTags(tagEntries, deletedTagRows)
  $: visibleTagPickerTags = filterTagsByQuery(allKnownTags, tagPickerSearch)
  $: tagPickerActiveKeys = new Set(
    selectedTagDay?.activeGroups.map((group) => group.key) ?? []
  )
  $: tagPickerDeletedKeys = new Set(
    selectedTagDay?.deletedGroups.map((group) => group.key) ?? []
  )
  $: tagPickerCreateLabel = (() => {
    const label = resolveUserTagLabel(tagPickerSearch, allKnownTags)

    if (!label) {
      return null
    }

    const key = label.toLocaleLowerCase()

    return allKnownTags.some((tag) => tag.toLocaleLowerCase() === key)
      ? null
      : label
  })()
  // The filter offers every known label, including fully deleted ones, since
  // day matching already counts crossed-out tags.
  $: sortedTagFilterTags =
    tagSortMode === "count"
      ? [...allKnownTags].sort(
          (left, right) =>
            (tagNightCounts.get(right) ?? 0) - (tagNightCounts.get(left) ?? 0)
        )
      : allKnownTags
  $: visibleTagFilterTags = filterTagsByQuery(
    sortedTagFilterTags,
    tagsFilterSearch
  )
  $: filteredTagDays =
    tagsFilterTags.length === 0
      ? tagDays
      : tagDays.filter((day) =>
          tagsFilterTags.every(
            (tag) =>
              day.entries.some((entry) => entry.tag === tag) ||
              day.deleted.some((row) => row.entry?.tag === tag)
          )
        )
  // With no filter active the log lists every day in the data range, so
  // untagged days can be opened and tagged straight from the list.
  $: allLogDays = buildAllLogDays(dailyMetrics, tagDays)
  // The log always renders every day and hides non-matching rows with CSS,
  // so toggling a filter flips classes instead of rebuilding ~1500 row
  // subtrees, which is what made toggles feel slow.
  $: filteredLogDates = new Set(filteredTagDays.map((day) => day.date))
  $: tagStripDays = buildTagStripDays(
    dailyMetrics,
    tagDays,
    filteredTagDays,
    tagsFilterTags.length > 0
  )
  $: if (tagsViewDate && tagStripDays.length > 0) {
    scrollTagStripToDate(tagsViewDate)
  }

  function selectTagsDay(date: string) {
    tagsViewDate = date
    tagsMessage = ""
  }

  // The strip renders only the days near the viewport. Each day occupies a
  // fixed 30px slot (26px button plus 4px spacing), so the visible index
  // range is plain arithmetic on scrollLeft, and spacer divs keep the total
  // scroll width so the scrollbar and positions stay exact.
  const stripDaySlot = 30
  const stripWindowBuffer = 15

  let tagStripElement: HTMLElement | null = null
  let tagStripWidth = 0
  let tagStripScrollLeft = 0
  let stripScrollFrame = 0

  $: stripWindowStart = Math.max(
    0,
    Math.floor(tagStripScrollLeft / stripDaySlot) - stripWindowBuffer
  )
  $: stripWindowEnd = Math.min(
    tagStripDays.length,
    Math.ceil((tagStripScrollLeft + tagStripWidth) / stripDaySlot) +
      stripWindowBuffer
  )
  $: visibleStripDays = tagStripDays.slice(stripWindowStart, stripWindowEnd)

  // Scroll events fire per frame while dragging; collapse them so the
  // window slice recomputes at most once per animation frame.
  function handleTagStripScroll() {
    if (stripScrollFrame) {
      return
    }

    stripScrollFrame = requestAnimationFrame(() => {
      stripScrollFrame = 0
      tagStripScrollLeft = tagStripElement?.scrollLeft ?? 0
    })
  }

  // The strip starts positioned on the selected day without animating past
  // every prior day; only later selections glide smoothly. Mounting fresh on
  // every visit to the Tags view resets this naturally.
  let tagStripHasPositioned = false

  function scrollTagStripToDate(date: string) {
    requestAnimationFrame(() => {
      const strip = tagStripElement
      // Off-screen days are not in the DOM, so the target position comes
      // from the day's index instead of scrollIntoView.
      const index = tagStripDays.findIndex((day) => day.date === date)

      if (!strip || index === -1) {
        return
      }

      strip.scrollTo({
        left: index * stripDaySlot - (strip.clientWidth - stripDaySlot) / 2,
        behavior: tagStripHasPositioned ? "smooth" : "auto"
      })
      tagStripHasPositioned = true
    })
  }

  // Map wheel movement onto the strip's horizontal axis at a reduced rate,
  // so days glide by instead of flying past.
  function handleTagStripWheel(event: WheelEvent) {
    const strip = event.currentTarget

    if (!(strip instanceof HTMLElement)) {
      return
    }

    const delta =
      Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX

    event.preventDefault()
    strip.scrollLeft += delta * 0.35
  }

  function toggleTagsFilterTag(tag: string) {
    tagsFilterTags = tagsFilterTags.includes(tag)
      ? tagsFilterTags.filter((item) => item !== tag)
      : [...tagsFilterTags, tag]
  }

  function openTagPicker() {
    isTagPickerOpen = true
    tagPickerSearch = ""
    requestAnimationFrame(() => tagPickerSearchInput?.focus())
  }

  function closeTagPicker() {
    isTagPickerOpen = false
  }

  function handleTagPickerBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      closeTagPicker()
    }
  }

  async function toggleTagInPicker(tag: string) {
    const key = tag.toLocaleLowerCase()
    const activeGroup = selectedTagDay?.activeGroups.find(
      (group) => group.key === key
    )

    if (activeGroup) {
      await deleteTagGroup(activeGroup)
      return
    }

    const deletedGroup = selectedTagDay?.deletedGroups.find(
      (group) => group.key === key
    )

    if (deletedGroup) {
      await restoreDeletedTagGroup(deletedGroup)
      return
    }

    try {
      // The day note lives on every tag row of the day (Oura's format has no
      // separate note store), so a late tag carries the existing note too.
      const entry = await addUserTagEntry({
        date: tagsViewDate,
        tag,
        comment: selectedDayComment || null
      })

      tagEntries = [...tagEntries, entry].sort((left, right) =>
        left.date.localeCompare(right.date)
      )
      tagsMessage = ""
    } catch {
      tagsMessage = "Could not save that tag. Try again."
    }
  }

  async function createTagFromPicker() {
    if (!tagPickerCreateLabel) {
      return
    }

    await toggleTagInPicker(tagPickerCreateLabel)
    tagPickerSearch = ""
  }

  // Chip clicks patch the in-memory state with what the store reports back
  // instead of re-reading both tables, so toggles do not re-render every
  // chip or hit IndexedDB for the full history on each click.
  async function deleteTagGroup(group: TagChipGroup) {
    try {
      const result = await deleteTagEntries(
        group.entries.map((entry) => entry.id)
      )
      const removedIds = new Set(result.deletedIds)

      tagEntries = tagEntries.filter((entry) => !removedIds.has(entry.id))
      deletedTagRows = [...deletedTagRows, ...result.tombstones]
      tagsMessage = ""
    } catch {
      tagsMessage = "Could not delete that tag. Try again."
    }
  }

  async function restoreDeletedTagGroup(group: DeletedTagChipGroup) {
    try {
      const result = await restoreTagEntries(group.rows.map((row) => row.id))
      const removedTombstoneIds = new Set(result.removedTombstoneIds)

      deletedTagRows = deletedTagRows.filter(
        (row) => !removedTombstoneIds.has(row.id)
      )

      if (result.restoredEntries.length > 0) {
        tagEntries = [...tagEntries, ...result.restoredEntries].sort(
          (left, right) => left.date.localeCompare(right.date)
        )
      }

      tagsMessage = ""
    } catch {
      tagsMessage = "Could not restore that tag. Try again."
    }
  }

  async function saveDayComment(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    const comment = input.value.replace(/\s+/g, " ").trim() || null

    try {
      await updateDayComment(tagsViewDate, comment)
      tagEntries = tagEntries.map((entry) =>
        entry.date === tagsViewDate ? { ...entry, comment } : entry
      )
      tagsMessage = ""
    } catch {
      tagsMessage = "Could not save that note. Try again."
    }
  }

  // Typing anywhere starts a tag search without clicking the search box
  // first. Only mounted while the Tags view is open, so this never fights
  // the parent's handler for the Explore view.
  // Escape closes the tag picker popup, or backs out of the tag search.
  function handleTagsKeydown(event: KeyboardEvent) {
    handleTypeToSearchKeydown(
      event,
      isTagPickerOpen ? tagPickerSearchInput : tagsFilterSearchInput,
      () => {
        if (isTagPickerOpen) {
          closeTagPicker()
          return "consumed"
        }

        tagsFilterSearch = ""
        return "clear"
      }
    )
  }
</script>

<svelte:window on:keydown={handleTagsKeydown} />

    <section class="settings-workspace" aria-label="Tag manager">
      <div class="settings-panel">
        <div class="tag-daily-log" aria-label="Days">
          <div class="log-heading">
            <div>
              <p class="section-kicker">Daily log</p>
              <h3>
                {tagsFilterTags.length > 0
                  ? formatTagList(tagsFilterTags, " + ")
                  : "All days"}
              </h3>
            </div>
            <span>
              {tagsFilterTags.length > 0
                ? `${filteredTagDays.length} of ${allLogDays.length} days`
                : `${allLogDays.length} days`}
            </span>
          </div>

          {#if tagStripDays.length > 0}
            <div
              class="tag-day-strip"
              aria-label="Day timeline"
              bind:this={tagStripElement}
              bind:clientWidth={tagStripWidth}
              on:scroll={handleTagStripScroll}
              on:wheel|nonpassive={handleTagStripWheel}
            >
              <div
                class="strip-spacer"
                style={`width: ${stripWindowStart * stripDaySlot}px`}
              ></div>
              {#each visibleStripDays as day (day.date)}
                <button
                  type="button"
                  class="strip-day"
                  class:selected={tagsViewDate === day.date}
                  class:dimmed={day.dimmed}
                  title={day.title}
                  on:click={() => selectTagsDay(day.date)}
                >
                  <span class="strip-bar-area">
                    <span
                      class="strip-bar {day.tone}"
                      class:empty={day.tagCount === 0}
                      style={day.tagCount === 0
                        ? ""
                        : `height: ${day.barHeight}%`}
                    ></span>
                  </span>
                  <small
                    class="strip-label"
                    class:year={day.labelKind === "year"}
                    class:day-hint={day.labelKind === "day"}
                  >
                    {day.label ?? ""}
                  </small>
                </button>
              {/each}
              <div
                class="strip-spacer"
                style={`width: ${(tagStripDays.length - stripWindowEnd) * stripDaySlot}px`}
              ></div>
            </div>
          {/if}

          {#if tagsViewDate}
            <div class="strip-day-panel" aria-label="Selected day tags">
              <div class="log-date">
                <strong>{formatDate(tagsViewDate)}</strong>
                <small>{tagsViewDate}</small>
              </div>
              <div class="tag-chip-list">
                {#if selectedTagDay}
                  {#each selectedTagDay.activeGroups as group (group.key)}
                    <button
                      type="button"
                      class="tag-chip"
                      title={group.title}
                      on:click={() => deleteTagGroup(group)}
                    >
                      {formatTagLabel(group.label)}
                      {#if group.entries.length > 1}
                        <span class="tag-count">{group.entries.length}</span>
                      {/if}
                    </button>
                  {/each}
                  {#each selectedTagDay.deletedGroups as group (group.key)}
                    <button
                      type="button"
                      class="tag-chip crossed"
                      title={group.title}
                      on:click={() => restoreDeletedTagGroup(group)}
                    >
                      {formatTagLabel(group.label)}
                      {#if group.rows.length > 1}
                        <span class="tag-count">{group.rows.length}</span>
                      {/if}
                    </button>
                  {/each}
                {/if}
                <button
                  type="button"
                  class="tag-chip add"
                  on:click={openTagPicker}
                >
                  + Add tags
                </button>
              </div>
              {#if selectedTagDay && selectedTagDay.activeGroups.length > 0}
                <details class="tag-comment-editor" open={Boolean(selectedDayComment)}>
                  <summary>Day note</summary>
                  <div class="tag-comment-rows">
                    <input
                      type="text"
                      aria-label="Day note"
                      placeholder="Add a note for this day"
                      value={selectedDayComment}
                      on:change={saveDayComment}
                    />
                  </div>
                </details>
              {/if}
            </div>
          {/if}

          {#if tagsMessage}
            <p class="tags-message" role="status">{tagsMessage}</p>
          {/if}

          <div class="tag-filter-control">
            <div class="tag-control-heading">
              <h3>Filter</h3>
              <div class="tag-sort" role="group" aria-label="Sort tags">
                {#each tagSortModes as mode}
                  <button
                    type="button"
                    class:active={tagSortMode === mode.id}
                    aria-pressed={tagSortMode === mode.id}
                    on:click={() => setTagSortMode(mode.id)}
                  >
                    {mode.label}
                  </button>
                {/each}
              </div>
            </div>
            {#if availableTags.length > 0}
              <input
                class="tag-search"
                type="search"
                placeholder="Search tags"
                aria-label="Search tags"
                bind:value={tagsFilterSearch}
                bind:this={tagsFilterSearchInput}
              />
            {/if}
            <div class="tag-picker">
              {#each visibleTagFilterTags as tag}
                <button
                  type="button"
                  class:active={tagsFilterTags.includes(tag)}
                  on:click={() => toggleTagsFilterTag(tag)}
                >
                  {formatTagLabel(tag)}
                  {#if showTagCounts}
                    <span class="tag-count">{tagNightCounts.get(tag) ?? 0}</span>
                  {/if}
                </button>
              {:else}
                <p class="empty-state">
                  {availableTags.length === 0
                    ? "Import Oura data or add tags to filter days."
                    : "No tags match your search."}
                </p>
              {/each}
            </div>
          </div>

          {#if allLogDays.length === 0}
            <p class="tag-empty">
              Import Oura data or add your first tag above.
            </p>
          {:else}
            {#if tagsFilterTags.length > 0 && filteredTagDays.length === 0}
              <p class="tag-empty">No tagged days match these filters.</p>
            {/if}
            <div
              class="log-table"
              class:no-matches={tagsFilterTags.length > 0 &&
                filteredTagDays.length === 0}
            >
              <div class="log-row header">
                <span>Date</span>
                <span>Tags</span>
              </div>
              {#each allLogDays as day (day.date)}
                {#if tagsViewDate === day.date}
                  <div
                    class="log-row tag-log-row selected"
                    class:filtered-out={tagsFilterTags.length > 0 &&
                      !filteredLogDates.has(day.date)}
                    data-date={day.date}
                  >
                    <div class="log-date">
                      <strong>{formatDate(day.date)}</strong>
                      <small>{day.date}</small>
                    </div>
                    <div class="tag-chip-list">
                      {#each day.activeGroups as group (group.key)}
                        <button
                          type="button"
                          class="tag-chip"
                          title={group.title}
                          on:click={() => deleteTagGroup(group)}
                        >
                          {formatTagLabel(group.label)}
                          {#if group.entries.length > 1}
                            <span class="tag-count">{group.entries.length}</span>
                          {/if}
                        </button>
                      {/each}
                      {#each day.deletedGroups as group (group.key)}
                        <button
                          type="button"
                          class="tag-chip crossed"
                          title={group.title}
                          on:click={() => restoreDeletedTagGroup(group)}
                        >
                          {formatTagLabel(group.label)}
                          {#if group.rows.length > 1}
                            <span class="tag-count">{group.rows.length}</span>
                          {/if}
                        </button>
                      {/each}
                      <button
                        type="button"
                        class="tag-chip add"
                        on:click={openTagPicker}
                      >
                        + Add tags
                      </button>
                    </div>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="log-row"
                    class:filtered-out={tagsFilterTags.length > 0 &&
                      !filteredLogDates.has(day.date)}
                    data-date={day.date}
                    on:click={() => selectTagsDay(day.date)}
                  >
                    <div class="log-date">
                      <strong>{formatDate(day.date)}</strong>
                      <small>{day.date}</small>
                    </div>
                    <span>
                      {formatTagList(day.activeGroups.map((group) => group.label))}
                    </span>
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if isTagPickerOpen}
        <div
          class="tag-picker-backdrop"
          role="presentation"
          on:click={handleTagPickerBackdropClick}
        >
          <section
            class="tag-picker-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add tags"
            use:trapFocus
          >
            <div class="tag-picker-modal-header">
              <div>
                <p class="section-kicker">Tags for</p>
                <h2>{formatDate(tagsViewDate)}</h2>
              </div>
              <button
                type="button"
                class="tag-picker-close"
                on:click={closeTagPicker}
              >
                Close
              </button>
            </div>
            <input
              class="tag-search"
              type="search"
              placeholder="Search or type a new tag"
              aria-label="Search tags"
              bind:value={tagPickerSearch}
              bind:this={tagPickerSearchInput}
            />
            <div class="tag-picker">
              {#each visibleTagPickerTags as tag (tag)}
                {@const key = tag.toLocaleLowerCase()}
                <button
                  type="button"
                  class:active={tagPickerActiveKeys.has(key)}
                  class:crossed={tagPickerDeletedKeys.has(key)}
                  on:click={() => toggleTagInPicker(tag)}
                >
                  {formatTagLabel(tag)}
                </button>
              {/each}
              {#if tagPickerCreateLabel}
                <button
                  type="button"
                  class="create"
                  on:click={createTagFromPicker}
                >
                  Add "{formatTagLabel(tagPickerCreateLabel)}"
                </button>
              {:else if visibleTagPickerTags.length === 0}
                <p class="empty-state">No tags match your search.</p>
              {/if}
            </div>

          </section>
        </div>
      {/if}
    </section>

<style>
  /* Off-screen rows skip layout and paint; the intrinsic size stands in
     for the usual row height so the page scrollbar stays stable. */
  .log-table .log-row {
    content-visibility: auto;
    contain-intrinsic-size: auto 53px;
  }

  /* Filtering hides rows instead of removing them, so toggling a filter
     tag flips classes rather than rebuilding the whole day list. */
  .log-table .log-row.filtered-out {
    display: none;
  }

  .log-table.no-matches {
    display: none;
  }

  .tag-log-row {
    align-items: start;
  }

  .tag-log-row.selected {
    background: rgba(30, 44, 100, 0.09);
    box-shadow: inset 4px 0 0 #1e2c64;
  }

  .tag-log-row.selected .log-date strong {
    color: #1e2c64;
  }

  .tag-chip-list {
    align-content: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding-block: 0.15rem;
  }

  .tag-chip {
    appearance: none;
    align-items: center;
    background: #f7f1e8;
    border: 1px solid #d8d8cc;
    border-radius: 999px;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 750;
    padding: 0.32rem 0.62rem;
  }

  .tag-chip:hover {
    border-color: #8a3f2f;
    color: #8a3f2f;
    text-decoration: line-through;
  }

  .tag-chip.crossed {
    background: transparent;
    border-style: dashed;
    color: #6f786f;
    text-decoration: line-through;
  }

  .tag-chip.crossed:hover {
    border-color: #1e2c64;
    color: #1e2c64;
  }

  .tags-message {
    color: #8a3f2f;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .tag-empty {
    color: #6f786f;
    font-size: 0.9rem;
    padding-block: 0.6rem;
  }

  .tag-daily-log {
    display: grid;
    gap: 0.45rem;
  }

  .tag-day-strip {
    align-items: flex-end;
    display: flex;
    margin-bottom: 0.4rem;
    overflow-x: auto;
    padding: 0.4rem 0.1rem 0.2rem;
    scrollbar-width: thin;
  }

  /* Stands in for the off-screen days on each side of the rendered window
     so the scrollbar length and day positions stay exact. */
  .strip-spacer {
    flex: 0 0 auto;
  }

  .strip-day {
    appearance: none;
    background: transparent;
    border: 0;
    border-radius: 5px;
    cursor: pointer;
    display: grid;
    flex: 0 0 auto;
    gap: 0.2rem;
    /* The 4px spacing lives on the button instead of a flex gap on the
       strip so each day occupies a fixed 30px slot next to the spacers. */
    margin-right: 4px;
    /* Keeps wide month labels from stretching their column, which made the
       month-start bar merge with its neighbor. */
    min-width: 0;
    padding: 2px 2px 0;
    width: 26px;
  }

  .strip-day:hover {
    background: rgba(31, 37, 32, 0.08);
  }

  .strip-day.selected {
    background: rgba(30, 44, 100, 0.14);
  }

  .strip-day.dimmed {
    opacity: 0.25;
  }

  .strip-bar-area {
    align-items: flex-end;
    display: flex;
    height: 96px;
  }

  .strip-bar {
    border-radius: 5px 5px 0 0;
    min-height: 9px;
    width: 100%;
  }

  .strip-bar.empty {
    height: 9px;
    opacity: 0.45;
  }

  .strip-bar.score-excellent {
    background: #1e2c64;
  }

  .strip-bar.score-good {
    background: #4f8a63;
  }

  .strip-bar.score-poor {
    background: #a8423e;
  }

  .strip-bar.score-neutral {
    background: #9ca69a;
  }

  .strip-label {
    color: #6f786f;
    font-size: 0.58rem;
    font-weight: 800;
    height: 0.8rem;
    overflow: visible;
    text-align: center;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .strip-label.year {
    color: #17201b;
  }

  .strip-label.day-hint {
    color: #9ca69a;
    font-weight: 700;
  }

  .strip-day-panel {
    align-items: center;
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    display: grid;
    gap: 0.85rem;
    grid-template-columns: auto minmax(0, 1fr);
    margin-bottom: 0.4rem;
    padding: 0.55rem 0.7rem;
  }

  .tag-comment-editor {
    grid-column: 1 / -1;
  }

  .tag-comment-editor summary {
    color: #6f786f;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .tag-comment-rows {
    display: grid;
    gap: 0.45rem;
    padding-top: 0.55rem;
  }

  .tag-comment-rows input {
    background: #fbf7ef;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    font: inherit;
    font-size: 0.85rem;
    min-width: 0;
    padding: 0.4rem 0.6rem;
    width: 100%;
  }

  .tag-chip.add {
    background: transparent;
    border-style: dashed;
    color: #6f786f;
  }

  .tag-chip.add:hover {
    border-color: #1e2c64;
    color: #1e2c64;
    text-decoration: none;
  }

  .tag-picker-modal {
    background: #fbf7ef;
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(23, 32, 27, 0.28);
    display: grid;
    gap: 0.7rem;
    max-height: min(80vh, 640px);
    max-width: 640px;
    overflow-y: auto;
    padding: 1rem;
    width: 100%;
  }

  .tag-picker-modal-header {
    align-items: flex-start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .tag-picker-modal-header h2 {
    font-size: 1.15rem;
  }

  .tag-picker-close {
    appearance: none;
    background: #f7f1e8;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    color: #17201b;
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    padding: 0.45rem 0.7rem;
  }

  /* Day state chips inside the picker: navy for tags already on the day,
     crossed out for deleted ones, matching the settings metric chips. */
  .tag-picker-modal .tag-picker button.active {
    background: #1e2c64;
    border-color: #1e2c64;
    color: #fbf7ef;
  }

  .tag-picker-modal .tag-picker button.crossed {
    background: transparent;
    border-style: dashed;
    color: #6f786f;
    text-decoration: line-through;
  }

  .tag-picker-modal .tag-picker button.create {
    background: transparent;
    border-style: dashed;
    color: #1e2c64;
  }

  .tag-filter-control {
    display: grid;
    gap: 0.55rem;
    margin-bottom: 0.4rem;
  }

  .tag-filter-control h3 {
    font-size: 0.95rem;
  }
</style>
