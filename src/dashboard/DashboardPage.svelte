<script lang="ts">
  import { onMount } from "svelte"
  import {
    exploreMetricDefinitions,
    getAvailableTags,
    getTagNightCounts,
    withDerivedMetricFields,
    type ExploreMetricKey
  } from "../lib/analysis/correlations"
  import { db } from "../lib/db"
  import type {
    AuthTokenRow,
    DailyMetricRow,
    DeletedTagIdRow,
    TagEntryRow
  } from "../lib/db/types"
  import { OuraApiError, validateOuraToken } from "../lib/oura/client"
  import { importOuraFiles, OuraImportError } from "../lib/oura/import"
  import { syncOuraRange } from "../lib/oura/sync"
  import { daysAgo, formatInputDate, shiftDate } from "./format"
  import { exploreMetricCategories } from "./exploreCharts"
  import { renameOptimalOverrideTags } from "./optimalOverrides"
  import { sortTagsForDisplay, type TagSortMode } from "./tagLabels"
  import {
    getEffectiveTagEntries,
    getTaggedMetricDates,
    type TagTimingMode
  } from "./tagDays"
  import ImportModal from "./ImportModal.svelte"
  import ExploreView from "./ExploreView.svelte"
  import InsightsView from "./InsightsView.svelte"
  import OptimalView from "./OptimalView.svelte"
  import SettingsView from "./SettingsView.svelte"
  import TagsView from "./TagsView.svelte"
  import logoUrl from "../../assets/phibo-mark.svg"
  import "./shared.css"

  type DashboardView = "explore" | "insights" | "optimal" | "tags" | "settings"

  const activeViewSettingKey = "phibo.activeView"
  const tagSortModeSettingKey = "phibo.tagSortMode"
  const excludeUntaggedDaysSettingKey = "phibo.excludeUntaggedDays"
  const tagTimingModeSettingKey = "phibo.tagTimingMode"
  const showTagCountsSettingKey = "phibo.showTagCounts"
  const exploreFavoriteMetricsSettingKey = "phibo.exploreFavoriteMetrics"
  const exploreHiddenMetricsSettingKey = "phibo.exploreHiddenMetrics"

  let accessToken = ""
  let activeView: DashboardView = "insights"
  let tagSortMode: TagSortMode = "alpha"
  let excludeUntaggedDays = true
  let showTagCounts = false
  let dailyMetrics: DailyMetricRow[] = []
  let endDate = formatInputDate(new Date())
  let importMessage = "Import your Oura personal data export to begin."
  let isImportModalOpen = false
  let isSyncing = false
  let isImporting = false
  let isEditingToken = false
  let savedOuraToken: AuthTokenRow | null = null
  let exploreFavoriteMetrics: ExploreMetricKey[] = []
  let exploreHiddenMetrics: ExploreMetricKey[] = []
  let startDate = formatInputDate(daysAgo(30))
  let syncMessage = "Connect an Oura key or import an export to begin."
  let tagTimingMode: TagTimingMode = "morning"
  let tagEntries: TagEntryRow[] = []
  let tagsViewDate = formatInputDate(new Date())
  let tagsFilterSearch = ""
  let tagsFilterTags: string[] = []
  let deletedTagRows: DeletedTagIdRow[] = []
  // Ids of the tombstones written by the last cleanup run; enables a
  // session-level undo until the page is closed.
  let lastDedupeIds: string[] = []

  $: hasLocalData = dailyMetrics.length > 0
  $: effectiveTagEntries = getEffectiveTagEntries(tagEntries, tagTimingMode)
  $: taggedMetricDates = getTaggedMetricDates(effectiveTagEntries)
  $: analysisDailyMetrics = excludeUntaggedDays
    ? dailyMetrics.filter((day) => taggedMetricDates.has(day.date))
    : dailyMetrics
  $: excludedUntaggedDayCount = dailyMetrics.length - analysisDailyMetrics.length
  $: availableTags = sortTagsForDisplay(getAvailableTags(effectiveTagEntries))
  $: tagNightCounts = getTagNightCounts(effectiveTagEntries)
  $: isOuraConnected = Boolean(savedOuraToken?.accessToken) && !isEditingToken
  $: connectionActionLabel = isOuraConnected ? "Sync data" : "Connect & sync"
  // Explore selections are saved reactively, so restoring must finish first
  // or the initial defaults would overwrite the stored values.
  let exploreSettingsRestored = false

  function getSavedMetricList(settingKey: string): ExploreMetricKey[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(settingKey) ?? "[]")

      return Array.isArray(parsed)
        ? parsed.filter((key): key is ExploreMetricKey =>
            exploreMetricDefinitions.some(
              (definition) => definition.key === key
            )
          )
        : []
    } catch {
      return []
    }
  }

  // Each click cycles a metric through normal, favorite, and hidden.
  function cycleExploreMetricPreference(key: ExploreMetricKey) {
    if (exploreFavoriteMetrics.includes(key)) {
      exploreFavoriteMetrics = exploreFavoriteMetrics.filter(
        (metricKey) => metricKey !== key
      )
      // ExploreView deselects a hidden metric from its axes on mount.
      exploreHiddenMetrics = [...exploreHiddenMetrics, key]
    } else if (exploreHiddenMetrics.includes(key)) {
      exploreHiddenMetrics = exploreHiddenMetrics.filter(
        (metricKey) => metricKey !== key
      )
    } else {
      exploreFavoriteMetrics = [...exploreFavoriteMetrics, key]
    }
  }

  $: if (exploreSettingsRestored) {
    localStorage.setItem(
      exploreFavoriteMetricsSettingKey,
      JSON.stringify(exploreFavoriteMetrics)
    )
    localStorage.setItem(
      exploreHiddenMetricsSettingKey,
      JSON.stringify(exploreHiddenMetrics)
    )
  }

  onMount(async () => {
    activeView = getSavedActiveView()
    exploreFavoriteMetrics = getSavedMetricList(
      exploreFavoriteMetricsSettingKey
    )
    exploreHiddenMetrics = getSavedMetricList(exploreHiddenMetricsSettingKey)
    exploreSettingsRestored = true
    excludeUntaggedDays =
      localStorage.getItem(excludeUntaggedDaysSettingKey) !== "false"
    showTagCounts = localStorage.getItem(showTagCountsSettingKey) === "true"
    tagTimingMode = getSavedTagTimingMode()
    tagSortMode = getSavedTagSortMode()

    const savedToken = await db.authTokens.get("oura")
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    savedOuraToken = savedToken ?? null
    tagEntries = savedTags
    deletedTagRows = await db.deletedTagIds.toArray()

    if (savedMetrics.length > 0) {
      dailyMetrics = withDerivedMetricFields(savedMetrics)
      importMessage = `Loaded ${savedMetrics.length} saved Oura days from local storage.`
      syncMessage = `Loaded ${savedMetrics.length} saved Oura days.`
    } else if (savedToken) {
      syncMessage = "Oura key is connected. Your data stays on this device."
    }
  })

  function setTagSortMode(mode: TagSortMode) {
    tagSortMode = mode
    localStorage.setItem(tagSortModeSettingKey, mode)
  }

  function getSavedTagSortMode(): TagSortMode {
    const savedMode = localStorage.getItem(tagSortModeSettingKey)

    return savedMode === "alpha" || savedMode === "count" ? savedMode : "alpha"
  }

  function openImportModal() {
    isImportModalOpen = true
  }

  function closeImportModal() {
    isImportModalOpen = false
  }

  async function importFiles(files: File[]) {
    if (files.length === 0) {
      importMessage = "Choose an Oura export ZIP, JSON, or CSV file."
      return
    }

    isImporting = true
    importMessage = "Reading Oura export locally..."

    try {
      const result = await importOuraFiles(files)

      await loadLocalOuraData()
      const skippedParts = [
        result.skippedFiles > 0
          ? `${result.skippedFiles} unreadable files`
          : null,
        result.unsupportedFiles > 0
          ? `${result.unsupportedFiles} unrecognized files`
          : null
      ].filter((part): part is string => part !== null)
      const skippedText =
        skippedParts.length > 0 ? ` Skipped ${skippedParts.join(" and ")}.` : ""
      const ignoredText =
        result.ignoredFiles > 0
          ? ` ${result.ignoredFiles} other export files hold data Phibo does not use (raw time series, device info, or empty files).`
          : ""
      importMessage =
        result.tagEntries.length > 0
          ? `Imported ${result.dailyMetrics.length} days and ${result.tagEntries.length} tags from ${result.filesImported} Oura files.${skippedText}${ignoredText}`
          : `Imported ${result.dailyMetrics.length} days. No tags were found in this export; existing local tags remain available.${skippedText}${ignoredText}`
    } catch (error) {
      importMessage = formatOuraImportError(error)
    } finally {
      isImporting = false
    }
  }

  async function connectAndSyncData() {
    const token = accessToken.trim()

    if (!token) {
      syncMessage = "Paste an Oura access token before connecting."
      return
    }

    if (!validateDateRange()) {
      return
    }

    isSyncing = true
    syncMessage = "Checking Oura key..."

    try {
      await validateOuraToken(token)

      const now = new Date().toISOString()
      const authToken: AuthTokenRow = {
        id: "oura",
        accessToken: token,
        expiresAt: null,
        lastSyncedAt: null,
        lastValidatedAt: now,
        scopes: ["daily", "tag"],
        source: "user_token",
        tokenType: "bearer",
        updatedAt: now
      }

      await db.authTokens.put(authToken)
      savedOuraToken = authToken
      isEditingToken = false
      accessToken = ""

      await syncWithToken(token)
    } catch (error) {
      syncMessage = formatOuraConnectionError(error)
    } finally {
      isSyncing = false
    }
  }

  async function syncData() {
    const token = savedOuraToken?.accessToken

    if (!token) {
      syncMessage = "Connect an Oura key before syncing."
      isEditingToken = true
      return
    }

    if (!validateDateRange()) {
      return
    }

    isSyncing = true
    syncMessage = "Syncing Oura data..."

    try {
      await syncWithToken(token)
    } catch (error) {
      syncMessage = formatOuraConnectionError(error)
    } finally {
      isSyncing = false
    }
  }

  async function syncWithToken(token: string) {
    const result = await syncOuraRange(token, startDate, endDate)
    const lastSyncedAt = new Date().toISOString()

    await loadLocalOuraData()
    syncMessage = `Synced ${result.dailyMetrics.length} days and ${result.tagEntries.length} tags.`

    if (savedOuraToken) {
      savedOuraToken = {
        ...savedOuraToken,
        lastSyncedAt,
        updatedAt: lastSyncedAt
      }
      await db.authTokens.put(savedOuraToken)
    }
  }

  async function disconnectOura() {
    await db.authTokens.delete("oura")
    accessToken = ""
    savedOuraToken = null
    isEditingToken = true
    syncMessage = "Oura key disconnected. Imported data remains on this device."
  }

  function changeOuraToken() {
    accessToken = ""
    isEditingToken = true
    syncMessage = "Paste a new Oura key to replace the saved connection."
  }

  function cancelTokenChange() {
    accessToken = ""
    isEditingToken = false
    syncMessage = savedOuraToken
      ? "Oura key is connected. Your data stays on this device."
      : "Connect an Oura key or import an export to begin."
  }

  function updateExcludeUntaggedDays(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    excludeUntaggedDays = input.checked
    localStorage.setItem(excludeUntaggedDaysSettingKey, `${excludeUntaggedDays}`)
  }

  function updateShowTagCounts(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    showTagCounts = input.checked
    localStorage.setItem(showTagCountsSettingKey, `${showTagCounts}`)
  }

  function updateTagTimingMode(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement) || !isTagTimingMode(input.value)) {
      return
    }

    tagTimingMode = input.value
    localStorage.setItem(tagTimingModeSettingKey, tagTimingMode)
  }

  function getSavedTagTimingMode(): TagTimingMode {
    const savedMode = localStorage.getItem(tagTimingModeSettingKey)

    return isTagTimingMode(savedMode) ? savedMode : "morning"
  }

  function setActiveView(view: DashboardView) {
    activeView = view
    localStorage.setItem(activeViewSettingKey, view)
  }

  function getSavedActiveView(): DashboardView {
    const savedView = localStorage.getItem(activeViewSettingKey)

    return isDashboardView(savedView) ? savedView : "insights"
  }

  function isDashboardView(value: string | null): value is DashboardView {
    return (
      value === "explore" ||
      value === "insights" ||
      value === "optimal" ||
      value === "tags" ||
      value === "settings"
    )
  }

  function isTagTimingMode(value: string | null): value is TagTimingMode {
    return value === "morning" || value === "sameDay"
  }

  function validateDateRange() {
    if (!startDate || !endDate) {
      syncMessage = "Choose both a start and end date."
      return false
    }

    if (startDate > endDate) {
      syncMessage = "Start date must be before the end date."
      return false
    }

    const today = formatInputDate(new Date())

    if (endDate > today) {
      syncMessage = "End date cannot be in the future."
      return false
    }

    return true
  }

  function formatOuraConnectionError(error: unknown) {
    if (error instanceof OuraApiError) {
      if (error.status === 401) {
        return "Oura rejected this key. Check that it is active and pasted correctly."
      }

      if (error.status === 403) {
        return "Oura blocked this request. Check that your key has daily and tag scopes and that API access is available for your account."
      }

      if (error.status === 429) {
        return "Oura rate limit reached. Wait a few minutes before syncing again."
      }

      if (error.status >= 500) {
        return "Oura is having trouble right now. Try syncing again later."
      }

      return error.detail ?? error.title ?? "Oura could not complete the request."
    }

    return error instanceof Error
      ? "Could not reach Oura. Check your connection and try again."
      : "Sync failed."
  }

  function formatOuraImportError(error: unknown) {
    if (error instanceof OuraImportError) {
      return error.message
    }

    return error instanceof Error
      ? "Could not import that Oura export. Check the file and try again."
      : "Import failed."
  }

  function handleDataDeleted() {
    importMessage = "Import your Oura personal data export to begin."
  }

  async function loadLocalOuraData() {
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    tagEntries = savedTags
    deletedTagRows = await db.deletedTagIds.toArray()

    if (savedMetrics.length > 0) {
      dailyMetrics = withDerivedMetricFields(savedMetrics)
    }
  }


</script>

<svelte:head>
  <title>Phibo Dashboard</title>
</svelte:head>

<main class="dashboard">
  <header class="header">
    <div>
      <div class="brand">
        <img class="logo" src={logoUrl} alt="" />
        <p class="eyebrow">Phibo</p>
      </div>
      <h1><span class="oura-o">O</span>ura Patterns</h1>
    </div>
    <button
      type="button"
      class="sync-button"
      on:click={openImportModal}
    >
      {isImporting ? "Importing" : "Import data"}
    </button>
  </header>

  <nav class="view-tabs" aria-label="Dashboard views">
    <button
      type="button"
      class:active={activeView === "insights"}
      on:click={() => setActiveView("insights")}
    >
      Insights
    </button>
    <button
      type="button"
      class:active={activeView === "explore"}
      on:click={() => setActiveView("explore")}
    >
      Explore
    </button>
    <button
      type="button"
      class:active={activeView === "optimal"}
      on:click={() => setActiveView("optimal")}
    >
      Optimal
    </button>
    <button
      type="button"
      class:active={activeView === "tags"}
      on:click={() => setActiveView("tags")}
    >
      Tags
    </button>
    <button
      type="button"
      class:active={activeView === "settings"}
      on:click={() => setActiveView("settings")}
    >
      Settings
    </button>
  </nav>

  {#if isImportModalOpen}
    <ImportModal
      {hasLocalData}
      {isImporting}
      {importMessage}
      {isOuraConnected}
      {isEditingToken}
      {savedOuraToken}
      {isSyncing}
      {syncMessage}
      bind:accessToken
      bind:startDate
      bind:endDate
      on:close={closeImportModal}
      on:importFiles={(event) => importFiles(event.detail)}
      on:connect={connectAndSyncData}
      on:sync={syncData}
      on:disconnect={disconnectOura}
      on:changeKey={changeOuraToken}
      on:cancelKeyChange={cancelTokenChange}
    />
  {/if}

  {#if activeView === "insights"}
    <InsightsView
      analysisMetrics={analysisDailyMetrics}
      analysisEntries={effectiveTagEntries}
      {dailyMetrics}
      {endDate}
    />
  {:else if activeView === "explore"}
    <ExploreView
      analysisMetrics={analysisDailyMetrics}
      analysisEntries={effectiveTagEntries}
      {availableTags}
      {tagNightCounts}
      {showTagCounts}
      {tagSortMode}
      {setTagSortMode}
      {exploreFavoriteMetrics}
      {exploreHiddenMetrics}
    />
  {:else if activeView === "optimal"}
    <OptimalView
      analysisMetrics={analysisDailyMetrics}
      analysisEntries={effectiveTagEntries}
      {dailyMetrics}
    />
  {:else if activeView === "tags"}
    <TagsView
      bind:tagEntries
      bind:deletedTagRows
      bind:tagsViewDate
      bind:tagsFilterSearch
      bind:tagsFilterTags
      {dailyMetrics}
      {availableTags}
      {tagNightCounts}
      {showTagCounts}
      {tagSortMode}
      {setTagSortMode}
      onTagRenamed={renameOptimalOverrideTags}
    />
  {:else}
    <SettingsView
      bind:dailyMetrics
      bind:tagEntries
      bind:deletedTagRows
      bind:lastDedupeIds
      {excludeUntaggedDays}
      {showTagCounts}
      {tagTimingMode}
      {exploreFavoriteMetrics}
      {exploreHiddenMetrics}
      analysisDayCount={analysisDailyMetrics.length}
      {excludedUntaggedDayCount}
      {updateExcludeUntaggedDays}
      {updateShowTagCounts}
      {updateTagTimingMode}
      {cycleExploreMetricPreference}
      onDataDeleted={handleDataDeleted}
    />
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    background:
      radial-gradient(circle at top left, #f6efe6 0%, #f1eadf 34%, transparent 58%),
      linear-gradient(135deg, #ebe5d9 0%, #e7e9df 58%, #dde4d8 100%);
    color: #17201b;
  }

  .dashboard {
    min-height: 100vh;
    padding: 1.5rem;
    box-sizing: border-box;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 0.5rem;
  }

  .logo {
    width: 1.55rem;
    height: 1.55rem;
    border-radius: 999px;
    background: #1d2a22;
    padding: 0.28rem;
    box-sizing: border-box;
    flex: 0 0 auto;
  }

  .eyebrow,
  .oura-o {
    display: inline-block;
    position: relative;
  }

  .oura-o::before {
    content: "";
    position: absolute;
    top: 0.01em;
    left: 0.082em;
    width: 0.58em;
    border-top: 0.11em solid currentColor;
    border-radius: 999px;
  }

  .sync-button {
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #1d2a22;
    color: #f8f3ea;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.8rem 1.05rem;
    transition:
      transform 120ms ease,
      background-color 120ms ease;
  }

  .sync-button:hover {
    background: #304235;
    transform: translateY(-1px);
  }

  .sync-button:disabled {
    cursor: wait;
    opacity: 0.72;
    transform: none;
  }

  .view-tabs {
    border-bottom: 1px solid #d3d5c8;
    display: flex;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .view-tabs button {
    background: transparent;
    border-radius: 8px 8px 0 0;
    color: #6f786f;
    font-size: 0.9rem;
    font-weight: 800;
    padding: 0.7rem 0.9rem;
  }

  .view-tabs button.active {
    background: rgba(251, 247, 239, 0.78);
    border-color: #d3d5c8;
    border-bottom-color: rgba(251, 247, 239, 0.78);
    color: #17201b;
    transform: translateY(1px);
  }

@media (max-width: 820px) {
    .dashboard {
      padding: 1rem;
    }
  }

@media (max-width: 560px) {
    .header {
      align-items: stretch;
      flex-direction: column;
    }

    .sync-button {
      width: 100%;
    }
  }
</style>
