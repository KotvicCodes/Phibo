<script lang="ts">
  import { onMount } from "svelte"
  import {
    calculateTagCorrelations,
    exploreMetricDefinitions,
    getAvailableTags,
    getTagNightCounts,
    getRankedTagInsights,
    getTagDiscoveries,
    withDerivedMetricFields,
    type ExploreMetricKey,
    type PrimaryInsightMetric,
    type TagInsight
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
  import {
    average,
    comparisonWidth,
    daysAgo,
    formatComparisonAverage,
    formatDate,
    formatDelta,
    formatInputDate,
    formatMetricDelta,
    formatNullableDelta,
    formatScoreTrend,
    metricLabel,
    metricPlainLabel,
    shiftDate
  } from "./format"
  import { exploreMetricCategories } from "./exploreCharts"
  import { impactTone } from "./exploreImpacts"
  import { renameOptimalOverrideTags } from "./optimalOverrides"
  import {
    insightComparisonMetrics,
    type InsightComparison,
    type InsightComparisonMetric,
    type MetricComparison
  } from "./comparisons"
  import {
    formatTagLabel,
    formatTagList,
    sortTagsForDisplay,
    tagSortModes,
    type TagSortMode
  } from "./tagLabels"
  import { scoreRangeTone, type ScoreRangeTone } from "./scoreTones"
  import { buildTagsByDate, getTaggedMetricDates } from "./tagDays"
  import ImportModal from "./ImportModal.svelte"
  import ExploreView from "./ExploreView.svelte"
  import OptimalView from "./OptimalView.svelte"
  import SettingsView from "./SettingsView.svelte"
  import TagsView from "./TagsView.svelte"
  import logoUrl from "../../assets/phibo-mark.svg"
  import "./shared.css"

  interface MetricSummary {
    detail: string
    label: string
    delta: string
    tone: ScoreRangeTone
    value: string
  }

  interface InsightStat {
    helper: string
    label: string
    unit: string
    value: string
  }

  type DashboardView = "explore" | "insights" | "optimal" | "tags" | "settings"
  type TagTimingMode = "morning" | "sameDay"

  const activeViewSettingKey = "phibo.activeView"
  const tagSortModeSettingKey = "phibo.tagSortMode"
  const excludeUntaggedDaysSettingKey = "phibo.excludeUntaggedDays"
  const tagTimingModeSettingKey = "phibo.tagTimingMode"
  const showTagCountsSettingKey = "phibo.showTagCounts"
  const exploreFavoriteMetricsSettingKey = "phibo.exploreFavoriteMetrics"
  const exploreHiddenMetricsSettingKey = "phibo.exploreHiddenMetrics"
  const scoreWeekDays = 7

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
  let selectedInsightKey = ""
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
  // The Insights view works from a frozen snapshot of the analysis
  // inputs. The snapshot only refreshes while the view is open, so tag
  // edits on the Tags view do not trigger correlation recalculations on
  // every chip click; the view catches up the moment it is opened. Explore
  // and Optimal need no snapshot: they live in their own components, which
  // only compute while mounted.
  let insightsMetrics: typeof dailyMetrics = []
  let insightsEntries: typeof tagEntries = []
  $: if (activeView === "insights") {
    if (insightsMetrics !== analysisDailyMetrics) {
      insightsMetrics = analysisDailyMetrics
    }
    if (insightsEntries !== effectiveTagEntries) {
      insightsEntries = effectiveTagEntries
    }
  }
  $: correlations = calculateTagCorrelations(insightsMetrics, insightsEntries)
  $: availableTags = sortTagsForDisplay(getAvailableTags(effectiveTagEntries))
  $: tagNightCounts = getTagNightCounts(effectiveTagEntries)
  $: insights = getRankedTagInsights(correlations)
  $: allInsights = [
    ...insights.rewarding,
    ...insights.concerning
  ]
  $: selectedInsight =
    allInsights.find((insight) => insightKey(insight) === selectedInsightKey) ??
    allInsights[0]
  $: latestMetricDate =
    insightsMetrics.at(-1)?.date ?? dailyMetrics.at(-1)?.date ?? endDate
  $: discoveries = getTagDiscoveries(insightsEntries, latestMetricDate)
  $: selectedComparisons = selectedInsight
    ? insightComparisonMetrics.map(
        (item): InsightComparison => ({
          ...item,
          comparison: getMetricComparison(
            selectedInsight.tag,
            item.metric,
            insightsMetrics,
            insightsEntries
          )
        })
      )
    : []
  $: selectedStats = selectedInsight
    ? createInsightStats(selectedInsight, insightsMetrics)
    : []
  $: isOuraConnected = Boolean(savedOuraToken?.accessToken) && !isEditingToken
  $: connectionActionLabel = isOuraConnected ? "Sync data" : "Connect & sync"
  $: summaries = [
    createSummary("Sleep", "sleepScore", insightsMetrics),
    createSummary("Readiness", "readinessScore", insightsMetrics),
    createSummary("Activity", "activityScore", insightsMetrics)
  ]
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

  function createSummary(
    label: string,
    key: keyof Pick<
      DailyMetricRow,
      "activityScore" | "readinessScore" | "sleepScore"
    >,
    metrics: DailyMetricRow[]
  ): MetricSummary {
    const summaryMetrics = metrics.slice(-scoreWeekDays)
    const value = average(summaryMetrics.map((day) => day[key]))
    const trend = calculateScoreTrend(key, metrics)
    const daysWithValue = summaryMetrics.filter((day) => day[key] != null).length

    return {
      detail:
        daysWithValue === 0
          ? "0-100 scale"
          : "current week",
      label,
      value: value === null ? "n/a" : `${Math.round(value)}`,
      delta: formatScoreTrend(trend),
      tone: scoreRangeTone(value)
    }
  }

  function calculateScoreTrend(
    key: keyof Pick<
      DailyMetricRow,
      "activityScore" | "readinessScore" | "sleepScore"
    >,
    metrics: DailyMetricRow[]
  ) {
    const currentDays = metrics.slice(-scoreWeekDays)
    const previousDays = metrics.slice(
      -scoreWeekDays * 2,
      -scoreWeekDays
    )
    const currentAverage = average(currentDays.map((day) => day[key]))
    const previousAverage = average(previousDays.map((day) => day[key]))

    if (currentAverage === null || previousAverage === null) {
      return null
    }

    return Math.round((currentAverage - previousAverage) * 10) / 10
  }

  function createInsightStats(
    item: TagInsight,
    metrics: DailyMetricRow[]
  ): InsightStat[] {
    const correlation = correlations.find((correlation) => correlation.tag === item.tag)
    const daysWithoutTag =
      correlation?.daysWithoutTag ??
      Math.max(metrics.length - item.daysWithTag, 0)
    const metricStats = correlation
      ? ([
          {
            helper: "average HRV difference",
            label: "HRV",
            metric: "averageHrv",
            unit: "ms"
          },
          {
            helper: "resting heart rate difference",
            label: "RHR",
            metric: "restingHeartRate",
            unit: "bpm"
          },
          {
            helper: "high stress time difference",
            label: "Stress",
            metric: "stressHighMinutes",
            unit: "min"
          },
          {
            helper: "high recovery time difference",
            label: "Recovery",
            metric: "recoveryHighMinutes",
            unit: "min"
          }
        ] as const)
          .map((stat) => ({
            helper: stat.helper,
            label: stat.label,
            unit: stat.unit,
            value: formatMetricDelta(correlation.deltas[stat.metric])
          }))
          .filter((stat) => stat.value !== "n/a")
      : []

    return [
      {
        helper: `nights with ${formatTagLabel(item.tag)}`,
        label: "Tagged",
        unit: item.daysWithTag === 1 ? "night" : "nights",
        value: `${item.daysWithTag}`
      },
      {
        helper: `nights without ${formatTagLabel(item.tag)}`,
        label: "Other",
        unit: daysWithoutTag === 1 ? "night" : "nights",
        value: `${daysWithoutTag}`
      },
      {
        helper: `${item.daysWithTag} of ${item.daysWithTag + daysWithoutTag} nights tagged`,
        label: "Confidence",
        unit: "",
        value: insightConfidenceLabel(item.daysWithTag, daysWithoutTag)
      },
      {
        helper: `${metricLabel(item.metric)} difference on tagged nights`,
        label: "Effect",
        unit: "pts",
        value: formatDelta(item.delta)
      },
      ...metricStats
    ]
  }

  function insightConfidenceLabel(daysWithTag: number, daysWithoutTag: number) {
    const totalDays = daysWithTag + daysWithoutTag
    const coverage = totalDays === 0 ? 0 : daysWithTag / totalDays

    if (daysWithTag >= 10 && daysWithoutTag >= 20 && coverage >= 0.05) {
      return "High"
    }

    if (daysWithTag >= 5 && daysWithoutTag >= 10 && coverage >= 0.02) {
      return "Medium"
    }

    return "Low"
  }

  function getEffectiveTagEntries(
    entries: typeof tagEntries,
    timingMode: TagTimingMode
  ) {
    return entries.map((entry) => ({
      ...entry,
      date:
        timingMode === "sameDay"
          ? shiftDate(entry.date, 1)
          : entry.date
    }))
  }

  function discoveryImpact(tag: string) {
    const correlation = correlations.find((item) => item.tag === tag)

    if (!correlation) {
      return null
    }

    const impacts = (["sleepScore", "readinessScore"] as const)
      .map((metric) => ({
        delta: correlation.deltas[metric],
        metric
      }))
      .filter(
        (impact): impact is { delta: number; metric: PrimaryInsightMetric } =>
          impact.delta !== null
      )

    return impacts.sort(
      (left, right) => Math.abs(right.delta) - Math.abs(left.delta)
    )[0]
  }

  function discoveryAction(tag: string, reason: "new" | "neglected") {
    const impact = discoveryImpact(tag)

    if (!impact) {
      return reason === "new" ? "Track a few more nights" : "Try again soon"
    }

    if (impact.delta > 0) {
      return `May improve ${metricPlainLabel(impact.metric).toLowerCase()}`
    }

    if (impact.delta < 0) {
      return `May reduce ${metricPlainLabel(impact.metric).toLowerCase()}`
    }

    return "Keep observing"
  }

  function getMetricComparison(
    tag: string,
    metric: InsightComparisonMetric,
    metrics: DailyMetricRow[],
    entries: typeof tagEntries
  ): MetricComparison {
    const currentTagsByDate = buildTagsByDate(entries)
    const taggedDays = metrics.filter((day) =>
      (currentTagsByDate[day.date] ?? []).includes(tag)
    )
    const untaggedDays = metrics.filter(
      (day) => !(currentTagsByDate[day.date] ?? []).includes(tag)
    )
    const taggedAverage = average(taggedDays.map((day) => day[metric]))
    const baselineAverage = average(untaggedDays.map((day) => day[metric]))

    return {
      baselineAverage,
      delta:
        taggedAverage === null || baselineAverage === null
          ? null
          : Math.round((taggedAverage - baselineAverage) * 10) / 10,
      taggedAverage
    }
  }

  function insightKey(item: TagInsight) {
    return `${item.tag}-${item.metric}`
  }


  function selectInsight(item: TagInsight) {
    selectedInsightKey = insightKey(item)
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
  <section class="metric-grid" aria-label="Metric summary">
    {#each summaries as summary}
      <article class="metric-card {summary.tone}">
        <p>{summary.label}</p>
        <strong>{summary.value}</strong>
        <small>{summary.detail}</small>
        <span>{summary.delta}</span>
      </article>
    {/each}
  </section>

  <section class="workspace">
    <div class="analysis-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Most Impactful</p>
          <h2>What deserves attention</h2>
        </div>
      </div>

      <div class="insight-layout">
        <section class="insight-column">
          <h3>Rewarding</h3>
          <div class="insight-stack">
            {#each insights.rewarding as item}
              <button
                type="button"
                class:selected={selectedInsight && insightKey(item) === insightKey(selectedInsight)}
                class="correlation-card rewarding"
                on:click={() => selectInsight(item)}
              >
                <div class="correlation-title">
                  <h4>{formatTagLabel(item.tag)}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong class="score-impact {impactTone(item.delta)}">
                  <span>{metricLabel(item.metric)}</span>
                  <b>{formatDelta(item.delta)}</b>
                </strong>
              </button>
            {:else}
              <p class="empty-state">No supported positive pattern yet.</p>
            {/each}
          </div>
        </section>

        <section class="insight-column">
          <h3>Concerning</h3>
          <div class="insight-stack">
            {#each insights.concerning as item}
              <button
                type="button"
                class:selected={selectedInsight && insightKey(item) === insightKey(selectedInsight)}
                class="correlation-card concerning"
                on:click={() => selectInsight(item)}
              >
                <div class="correlation-title">
                  <h4>{formatTagLabel(item.tag)}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong class="score-impact {impactTone(item.delta)}">
                  <span>{metricLabel(item.metric)}</span>
                  <b>{formatDelta(item.delta)}</b>
                </strong>
              </button>
            {:else}
              <p class="empty-state">No supported concerning pattern yet.</p>
            {/each}
          </div>
        </section>
      </div>

      <div class="discoveries">
        <div class="panel-heading compact">
          <div>
            <p class="section-kicker">Discoveries</p>
            <h2>New or neglected tags</h2>
          </div>
        </div>
        <div class="discovery-list">
          {#each discoveries as item}
            <article>
              <div class="discovery-main">
                <span class="discovery-badge {item.reason}">
                  {item.reason === "new" ? "New" : "Neglected"}
                </span>
                <div>
                  <strong>{formatTagLabel(item.tag)}</strong>
                  <span>{discoveryAction(item.tag, item.reason)}</span>
                </div>
              </div>
              <div class="discovery-meta">
                {#if discoveryImpact(item.tag)}
                  <strong
                    class="score-impact {impactTone(
                      discoveryImpact(item.tag)?.delta ?? null
                    )}"
                  >
                    <span>{metricLabel(discoveryImpact(item.tag)?.metric ?? "sleepScore")}</span>
                    <b>{formatDelta(discoveryImpact(item.tag)?.delta ?? 0)}</b>
                  </strong>
                {:else}
                  <strong class="score-impact neutral">
                    <span>Impact</span>
                    <b>n/a</b>
                  </strong>
                {/if}
                <span>{item.daysWithTag} {item.daysWithTag === 1 ? "night" : "nights"}</span>
              </div>
            </article>
          {:else}
            <article>
              <div class="discovery-main">
                <span class="discovery-badge neglected">Pending</span>
                <div>
                  <strong>No new tags yet</strong>
                  <span>Tag a behavior for a few nights</span>
                </div>
              </div>
              <div class="discovery-meta">
                <strong>n/a</strong>
              </div>
            </article>
          {/each}
        </div>
      </div>
    </div>

    <div class="trend-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Insight detail</p>
          <h2>{selectedInsight ? formatTagLabel(selectedInsight.tag) : "Select an insight"}</h2>
        </div>
        {#if selectedInsight}
          <span class="score-impact {impactTone(selectedInsight.delta)}">
            <span>{metricLabel(selectedInsight.metric)}</span>
            <b>{formatDelta(selectedInsight.delta)}</b>
          </span>
        {/if}
      </div>

      {#if selectedInsight && selectedComparisons.length > 0}
        <div class="comparison-chart" aria-label="Selected insight comparison">
          {#each selectedComparisons as item}
            <article>
              <div class="comparison-heading">
                <strong>{item.label}</strong>
                <span>{formatNullableDelta(item.comparison.delta)}</span>
              </div>
              <div class="bar-row">
                <span>Tagged</span>
                <div class="bar-track">
                  <span
                    class="bar-fill tagged"
                    style={`width: ${comparisonWidth(
                      item.comparison.taggedAverage
                    )}`}
                  />
                </div>
                <strong>{formatComparisonAverage(item.comparison.taggedAverage)}</strong>
              </div>
              <div class="bar-row">
                <span>Other</span>
                <div class="bar-track">
                  <span
                    class="bar-fill baseline"
                    style={`width: ${comparisonWidth(
                      item.comparison.baselineAverage
                    )}`}
                  />
                </div>
                <strong>{formatComparisonAverage(item.comparison.baselineAverage)}</strong>
              </div>
            </article>
          {/each}
        </div>
      {:else}
        <p class="empty-state">Select an insight to compare tagged nights.</p>
      {/if}

      <div class="detail-stats" aria-label="Selected insight stats">
        {#each selectedStats as stat}
          <div>
            <span>{stat.label}</span>
            <p>{stat.helper}</p>
            <strong>
              {stat.value}
              {#if stat.unit}
                <small>{stat.unit}</small>
              {/if}
            </strong>
          </div>
        {/each}
      </div>
    </div>
  </section>
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

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
    gap: 0.8rem;
  }

  .insight-layout {
    display: grid;
    gap: 0.9rem;
  }

  .insight-column {
    display: grid;
    gap: 0.5rem;
  }

  .insight-column > h3 {
    color: #4f5f53;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .insight-stack {
    display: grid;
    gap: 0.5rem;
  }

  .discoveries {
    border-top: 1px solid #d8d8cc;
    margin-top: 1rem;
    padding-top: 1rem;
  }

  .correlation-card {
    appearance: none;
    background: transparent;
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    color: inherit;
    cursor: pointer;
    display: grid;
    font: inherit;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: center;
    min-height: 68px;
    padding: 0.85rem 1rem;
    box-sizing: border-box;
    text-align: left;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      transform 120ms ease;
  }

  .correlation-card:hover,
  .correlation-card.selected {
    background: rgba(255, 252, 246, 0.62);
    border-color: #bdc5b4;
  }

  .correlation-card:hover {
    transform: translateY(-1px);
  }

  .correlation-card.rewarding {
    border-left: 4px solid #4f8a63;
  }

  .correlation-card.concerning {
    border-left: 4px solid #a96745;
  }

  .correlation-title {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.6rem;
    min-width: 0;
  }

  .correlation-title h4 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .correlation-title span {
    color: #6f786f;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .correlation-card > strong {
    line-height: 1;
    white-space: nowrap;
  }

  .discovery-list {
    display: grid;
    gap: 0.5rem;
  }

  .discovery-list article {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 70px;
    padding: 0.75rem 0.9rem;
  }

  .discovery-main {
    display: grid;
    gap: 0.38rem;
    justify-items: start;
    min-width: 0;
  }

  .discovery-main strong,
  .discovery-main span:not(.discovery-badge) {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .discovery-main strong {
    font-size: 1rem;
  }

  .discovery-main span:not(.discovery-badge) {
    color: #6f786f;
    font-size: 0.9rem;
    margin-top: 0.2rem;
  }

  .discovery-badge {
    border: 1px solid #cbd3c3;
    border-radius: 999px;
    color: #4f5f53;
    font-size: 0.72rem;
    font-weight: 800;
    padding: 0.24rem 0.48rem;
    text-transform: uppercase;
  }

  .discovery-badge.new {
    background: #e9efe2;
  }

  .discovery-badge.neglected {
    background: #f3eadf;
  }

  .discovery-meta {
    color: #6f786f;
    display: grid;
    gap: 0.18rem;
    font-size: 0.82rem;
    font-weight: 700;
    justify-items: end;
    white-space: nowrap;
  }

  .detail-stats {
    display: grid;
    gap: 0;
    border-top: 1px solid #d8d8cc;
  }

  .detail-stats div {
    align-items: center;
    border-bottom: 1px solid #d8d8cc;
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr) auto;
    gap: 0.7rem;
    min-height: 52px;
    padding: 0.6rem 0;
    box-sizing: border-box;
  }

  .detail-stats span,
  .detail-stats p {
    color: #6f786f;
  }

  .detail-stats span {
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .detail-stats strong {
    font-size: 1.15rem;
    line-height: 1;
    text-align: right;
    white-space: nowrap;
  }

  .detail-stats small {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
  }

  .detail-stats p {
    font-size: 0.82rem;
    line-height: 1.35;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

@media (max-width: 820px) {
    .dashboard {
      padding: 1rem;
    }

    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
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

    .detail-stats {
      border-top: 0;
    }

    .detail-stats div {
      grid-template-columns: 1fr auto;
      padding: 0.65rem 0;
    }

    .detail-stats p {
      grid-column: 1 / -1;
      grid-row: 2;
      white-space: normal;
    }

    .discovery-list article {
      grid-template-columns: 1fr;
      gap: 0.45rem;
    }

    .discovery-meta {
      justify-items: start;
    }
  }
</style>
