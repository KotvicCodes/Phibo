<script lang="ts">
  import { onMount } from "svelte"
  import {
    buildExploreDays,
    calculateExploreMetricImpacts,
    calculateTagCorrelations,
    exploreMetricDefinitions,
    getAvailableTags,
    getTagNightCounts,
    getExploreMetric,
    getRankedTagInsights,
    getTagDiscoveries,
    withDerivedMetricFields,
    type ExploreDay,
    type ExploreMetricCategory,
    type ExploreMetricKey,
    type PrimaryInsightMetric,
    type TagInsight
  } from "../lib/analysis/correlations"
  import {
    calculateOptimalDay,
    OPTIMAL_MIN_TAGGED_DAYS,
    optimalTargets,
    scoreCategories,
    type OptimalTarget,
    type ScoreCategory
  } from "../lib/analysis/optimal"
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
    addUserTagEntry,
    deleteTagEntries,
    findDuplicateTagEntryIds,
    renameTag,
    restoreTagEntries,
    restoreTagEntriesExact,
    resolveUserTagLabel,
    updateDayComment
  } from "../lib/tags/store"
  import {
    buildTagBackup,
    parseTagBackup,
    restoreTagBackup,
    TagBackupError
  } from "../lib/tags/backup"
  import {
    average,
    comparisonWidth,
    daysAgo,
    formatComparisonAverage,
    formatDate,
    formatDelta,
    formatInputDate,
    formatMonth,
    formatMetricDelta,
    formatNullableDelta,
    formatScoreTrend,
    formatSleepNightDate,
    metricLabel,
    metricPlainLabel,
    shiftDate
  } from "./format"
  import { formatAverage, formatExploreDelta } from "./exploreCharts"
  import {
    buildScatterOption,
    buildTimelineOption
  } from "./exploreChartOptions"
  import {
    formatTagLabel,
    formatTagList,
    sortTagsForDisplay
  } from "./tagLabels"
  import {
    buildExploreTagCalendar,
    buildExploreTagCalendarOptions
  } from "./tagCalendar"
  import {
    groupExploreImpacts,
    impactGroupDelta,
    impactGroupDeltaLabel,
    impactEffectTone,
    impactGroupMetricCount,
    impactGroupTone,
    impactTone,
    impactWidth,
    isPrimaryScoreMetric,
    type ExploreImpactGroup
  } from "./exploreImpacts"
  import EChart from "./EChart.svelte"
  import TagCalendar from "./TagCalendarView.svelte"
  import ImportModal from "./ImportModal.svelte"
  import logoUrl from "../../assets/phibo-mark.svg"
  import "./shared.css"

  interface MetricSummary {
    detail: string
    label: string
    delta: string
    tone: ScoreRangeTone
    value: string
  }

  type ScoreRangeTone =
    | "score-excellent"
    | "score-good"
    | "score-neutral"
    | "score-poor"

  interface MetricComparison {
    baselineAverage: number | null
    delta: number | null
    taggedAverage: number | null
  }

  interface InsightComparison {
    comparison: MetricComparison
    label: string
    metric: InsightComparisonMetric
  }

  interface InsightStat {
    helper: string
    label: string
    unit: string
    value: string
  }

  type ChartMode = "impact" | "scatter" | "timeline"
  type DashboardView = "explore" | "insights" | "optimal" | "tags" | "settings"
  type InsightComparisonMetric = keyof Pick<
    DailyMetricRow,
    "activityScore" | "readinessScore" | "sleepScore"
  >
  type TagTimingMode = "morning" | "sameDay"
  type TagSortMode = "alpha" | "count"

  const chartModes: ChartMode[] = ["impact", "scatter", "timeline"]
  const tagSortModes: { id: TagSortMode; label: string }[] = [
    { id: "alpha", label: "A–Z" },
    { id: "count", label: "Most tagged" }
  ]
  const activeViewSettingKey = "phibo.activeView"
  const tagSortModeSettingKey = "phibo.tagSortMode"
  const optimalTargetSettingKey = "phibo.optimalTarget"
  const optimalExcludedTagsSettingKey = "phibo.optimalExcludedTags"
  const optimalIncludedTagsSettingKey = "phibo.optimalIncludedTags"
  const excludeUntaggedDaysSettingKey = "phibo.excludeUntaggedDays"
  const tagTimingModeSettingKey = "phibo.tagTimingMode"
  const showTagCountsSettingKey = "phibo.showTagCounts"
  const exploreChartModeSettingKey = "phibo.exploreChartMode"
  const exploreXMetricSettingKey = "phibo.exploreXMetric"
  const exploreYMetricSettingKey = "phibo.exploreYMetric"
  const exploreTagsSettingKey = "phibo.exploreTags"
  const exploreFavoriteMetricsSettingKey = "phibo.exploreFavoriteMetrics"
  const exploreHiddenMetricsSettingKey = "phibo.exploreHiddenMetrics"
  const scoreWeekDays = 7
  const insightComparisonMetrics: Array<
    Pick<InsightComparison, "label" | "metric">
  > = [
    { label: "Sleep", metric: "sleepScore" },
    { label: "Readiness", metric: "readinessScore" },
    { label: "Activity", metric: "activityScore" }
  ]
  const exploreMetricCategories = (
    ["Sleep", "Readiness", "Activity", "Health"] as ExploreMetricCategory[]
  )
    .map((category) => ({
      category,
      metrics: exploreMetricDefinitions.filter(
        (metric) => metric.category === category
      )
    }))
    .filter((group) => group.metrics.length > 0)

  let accessToken = ""
  let activeView: DashboardView = "insights"
  let exploreChartMode: ChartMode = "impact"
  let tagSearch = ""
  let tagSortMode: TagSortMode = "alpha"
  let optimalTarget: OptimalTarget = "total"
  let optimalExcludedTags: string[] = []
  let optimalIncludedTags: string[] = []
  let selectedExploreTagCalendarRange = "last365"
  let deleteDataArmed = false
  let isDeletingData = false
  let deleteDataMessage = ""
  let excludeUntaggedDays = true
  let showTagCounts = false
  let openExploreImpactCategories: ExploreMetricCategory[] = []
  let hoveredExploreDate = ""
  let dailyMetrics: DailyMetricRow[] = []
  let endDate = formatInputDate(new Date())
  let importMessage = "Import your Oura personal data export to begin."
  let isImportModalOpen = false
  let isSyncing = false
  let isImporting = false
  let isEditingToken = false
  let savedOuraToken: AuthTokenRow | null = null
  let selectedInsightKey = ""
  let selectedExploreDate = ""
  let selectedExploreTags: string[] = []
  let selectedXMetric: ExploreMetricKey = "sleepScore"
  let selectedYMetric: ExploreMetricKey = "readinessScore"
  let exploreFavoriteMetrics: ExploreMetricKey[] = []
  let exploreHiddenMetrics: ExploreMetricKey[] = []
  let startDate = formatInputDate(daysAgo(30))
  let syncMessage = "Connect an Oura key or import an export to begin."
  let tagTimingMode: TagTimingMode = "morning"
  let tagEntries: TagEntryRow[] = []
  let tagsViewDate = formatInputDate(new Date())
  let tagsMessage = ""
  let tagsFilterSearch = ""
  let tagsFilterTags: string[] = []
  let isTagPickerOpen = false
  let tagPickerSearch = ""
  let tagPickerMode: "add" | "rename" = "add"
  let renameTargetTag = ""
  let renameInput = ""
  let renameMessage = ""
  let isRenamingTag = false
  let deletedTagRows: DeletedTagIdRow[] = []
  let tagBackupMessage = ""
  let isRestoringTagBackup = false
  let isDedupeConfirmOpen = false
  let isDeduping = false
  let dedupeMessage = ""
  // Ids of the tombstones written by the last cleanup run; enables a
  // session-level undo until the page is closed.
  let lastDedupeIds: string[] = []

  // Selector groups honor the user's metric preferences: favorites are
  // pinned in their own group on top, hidden metrics are left out entirely.
  $: exploreMetricGroups = [
    {
      label: "Favorites",
      metrics: exploreFavoriteMetrics.map((key) => getExploreMetric(key))
    },
    ...exploreMetricCategories.map((group) => ({
      label: group.category as string,
      metrics: group.metrics.filter(
        (metric) =>
          !exploreHiddenMetrics.includes(metric.key) &&
          !exploreFavoriteMetrics.includes(metric.key)
      )
    }))
  ].filter((group) => group.metrics.length > 0)

  $: hasLocalData = dailyMetrics.length > 0
  $: effectiveTagEntries = getEffectiveTagEntries(tagEntries, tagTimingMode)
  $: taggedMetricDates = getTaggedMetricDates(effectiveTagEntries)
  $: analysisDailyMetrics = excludeUntaggedDays
    ? dailyMetrics.filter((day) => taggedMetricDates.has(day.date))
    : dailyMetrics
  $: excludedUntaggedDayCount = dailyMetrics.length - analysisDailyMetrics.length
  $: correlations = calculateTagCorrelations(
    analysisDailyMetrics,
    effectiveTagEntries
  )
  $: optimalDayFull = calculateOptimalDay(
    analysisDailyMetrics,
    effectiveTagEntries,
    { target: optimalTarget, boundsMetrics: dailyMetrics }
  )
  $: optimalDay = calculateOptimalDay(analysisDailyMetrics, effectiveTagEntries, {
    target: optimalTarget,
    excludedTags: optimalExcludedTags,
    includedTags: optimalIncludedTags,
    boundsMetrics: dailyMetrics
  })
  $: optimalHasOverrides =
    optimalExcludedTags.length > 0 || optimalIncludedTags.length > 0
  $: optimalEstimateDiffs = scoreCategories.reduce(
    (diffs, category) => {
      const adjusted = optimalDay.estimates[category.key]
      const full = optimalDayFull.estimates[category.key]

      diffs[category.key] =
        adjusted === null || full === null
          ? null
          : Math.round((adjusted - full) * 10) / 10

      return diffs
    },
    {} as Record<ScoreCategory, number | null>
  )
  // Shared bar scale across both optimal lists: the strongest positive
  // impact and the most harmful negative impact compete for full width, so
  // green and red bar lengths stay comparable.
  $: optimalImpactBarMax = Math.max(
    optimalDay.contributions[0]?.targetImpact ?? 0,
    Math.abs(optimalDay.otherEligibleTags.at(-1)?.targetImpact ?? 0)
  )
  $: optimalTargetCategories =
    optimalTargets.find((option) => option.id === optimalTarget)?.categories ??
    []
  $: availableTags = sortTagsForDisplay(getAvailableTags(effectiveTagEntries))
  $: tagNightCounts = getTagNightCounts(effectiveTagEntries)
  // The Tags manager works on the raw stored dates, like import does. The
  // tag timing shift in effectiveTagEntries only applies to analysis views.
  $: tagDays = buildTagDays(tagEntries, deletedTagRows)
  $: selectedTagDay = tagDays.find((day) => day.date === tagsViewDate) ?? null
  // Oura keeps one note per day, duplicated across the day's tag rows.
  $: selectedDayComment =
    selectedTagDay?.entries.find((entry) => entry.comment)?.comment ?? ""
  $: duplicateTagIds = findDuplicateTagEntryIds(tagEntries)
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
  $: tagStripDays = buildTagStripDays(
    dailyMetrics,
    tagDays,
    filteredTagDays,
    tagsFilterTags.length > 0
  )
  $: if (activeView === "tags" && tagsViewDate && tagStripDays.length > 0) {
    scrollTagStripToDate(tagsViewDate)
  }
  $: sortedExploreTags =
    tagSortMode === "count"
      ? [...availableTags].sort(
          (left, right) =>
            (tagNightCounts.get(right) ?? 0) - (tagNightCounts.get(left) ?? 0)
        )
      : availableTags
  $: visibleExploreTags = (() => {
    const query = tagSearch.trim().toLocaleLowerCase()

    if (query.length === 0) {
      return sortedExploreTags
    }

    return sortedExploreTags.filter(
      (tag) =>
        formatTagLabel(tag).toLocaleLowerCase().includes(query) ||
        tag.toLocaleLowerCase().includes(query)
    )
  })()
  $: {
    const validExploreTags = selectedExploreTags.filter((tag) =>
      availableTags.includes(tag)
    )

    if (validExploreTags.length !== selectedExploreTags.length) {
      selectedExploreTags = validExploreTags
    }
  }
  $: exploreDays = buildExploreDays(
    analysisDailyMetrics,
    effectiveTagEntries,
    selectedExploreTags
  )
  $: exploreTagCalendarOptions = buildExploreTagCalendarOptions(exploreDays)
  $: {
    const selectedRangeExists = exploreTagCalendarOptions.some(
      (option) => option.id === selectedExploreTagCalendarRange
    )

    if (!selectedRangeExists) {
      selectedExploreTagCalendarRange = "last365"
    }
  }
  $: exploreTagCalendar = buildExploreTagCalendar(
    exploreDays,
    selectedExploreTags,
    selectedExploreTagCalendarRange
  )
  $: exploreImpacts = calculateExploreMetricImpacts(
    analysisDailyMetrics,
    effectiveTagEntries,
    selectedExploreTags
  ).filter((row) => !isPrimaryScoreMetric(row.metric.key))
  $: groupedExploreImpacts = groupExploreImpacts(exploreImpacts)
  $: matchingExploreDays = sortExploreDaysNewestFirst(
    exploreDays.filter((day) => day.matches)
  )
  $: otherExploreDays = exploreDays.filter((day) => !day.matches)
  $: exploreScoreComparisons =
    selectedExploreTags.length > 0 && matchingExploreDays.length > 0
      ? insightComparisonMetrics.map(
          (item): InsightComparison => ({
            ...item,
            comparison: getExploreMetricComparison(item.metric)
          })
        )
      : []
  $: selectedXDefinition = getExploreMetric(selectedXMetric)
  $: selectedYDefinition = getExploreMetric(selectedYMetric)
  $: scatterOption = buildScatterOption(
    exploreDays,
    selectedXDefinition,
    selectedYDefinition
  )
  $: timelineOption = buildTimelineOption(exploreDays, selectedYDefinition)
  $: activeExploreDay =
    exploreDays.find((day) => day.date === (hoveredExploreDate || selectedExploreDate)) ??
    matchingExploreDays[0] ??
    exploreDays[0]
  $: insights = getRankedTagInsights(correlations)
  $: allInsights = [
    ...insights.rewarding,
    ...insights.concerning
  ]
  $: selectedInsight =
    allInsights.find((insight) => insightKey(insight) === selectedInsightKey) ??
    allInsights[0]
  $: latestMetricDate =
    analysisDailyMetrics.at(-1)?.date ?? dailyMetrics.at(-1)?.date ?? endDate
  $: discoveries = getTagDiscoveries(effectiveTagEntries, latestMetricDate)
  $: selectedComparisons = selectedInsight
    ? insightComparisonMetrics.map(
        (item): InsightComparison => ({
          ...item,
          comparison: getMetricComparison(
            selectedInsight.tag,
            item.metric,
            analysisDailyMetrics
          )
        })
      )
    : []
  $: selectedStats = selectedInsight
    ? createInsightStats(selectedInsight, analysisDailyMetrics)
    : []
  $: isOuraConnected = Boolean(savedOuraToken?.accessToken) && !isEditingToken
  $: connectionActionLabel = isOuraConnected ? "Sync data" : "Connect & sync"
  $: summaries = [
    createSummary("Sleep", "sleepScore", analysisDailyMetrics),
    createSummary("Readiness", "readinessScore", analysisDailyMetrics),
    createSummary("Activity", "activityScore", analysisDailyMetrics)
  ]
  // Explore selections are saved reactively, so restoring must finish first
  // or the initial defaults would overwrite the stored values.
  let exploreSettingsRestored = false

  function getSavedExploreChartMode(): ChartMode {
    const savedMode = localStorage.getItem(exploreChartModeSettingKey)

    return chartModes.includes(savedMode as ChartMode)
      ? (savedMode as ChartMode)
      : "impact"
  }

  function getSavedExploreMetric(
    settingKey: string,
    fallback: ExploreMetricKey
  ): ExploreMetricKey {
    const savedMetric = localStorage.getItem(settingKey)

    return savedMetric &&
      exploreMetricDefinitions.some(
        (definition) => definition.key === savedMetric
      )
      ? (savedMetric as ExploreMetricKey)
      : fallback
  }

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
      exploreHiddenMetrics = [...exploreHiddenMetrics, key]

      if (selectedXMetric === key) {
        selectedXMetric = "sleepScore"
      }

      if (selectedYMetric === key) {
        selectedYMetric = "readinessScore"
      }
    } else if (exploreHiddenMetrics.includes(key)) {
      exploreHiddenMetrics = exploreHiddenMetrics.filter(
        (metricKey) => metricKey !== key
      )
    } else {
      exploreFavoriteMetrics = [...exploreFavoriteMetrics, key]
    }
  }

  $: if (exploreSettingsRestored) {
    localStorage.setItem(exploreChartModeSettingKey, exploreChartMode)
    localStorage.setItem(exploreXMetricSettingKey, selectedXMetric)
    localStorage.setItem(exploreYMetricSettingKey, selectedYMetric)
    localStorage.setItem(
      exploreTagsSettingKey,
      JSON.stringify(selectedExploreTags)
    )
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
    exploreChartMode = getSavedExploreChartMode()
    selectedXMetric = getSavedExploreMetric(
      exploreXMetricSettingKey,
      "sleepScore"
    )
    selectedYMetric = getSavedExploreMetric(
      exploreYMetricSettingKey,
      "readinessScore"
    )
    selectedExploreTags = getSavedOptimalTagList(exploreTagsSettingKey)
    exploreFavoriteMetrics = getSavedMetricList(
      exploreFavoriteMetricsSettingKey
    )
    exploreHiddenMetrics = getSavedMetricList(exploreHiddenMetricsSettingKey)

    if (exploreHiddenMetrics.includes(selectedXMetric)) {
      selectedXMetric = "sleepScore"
    }

    if (exploreHiddenMetrics.includes(selectedYMetric)) {
      selectedYMetric = "readinessScore"
    }

    exploreSettingsRestored = true
    excludeUntaggedDays =
      localStorage.getItem(excludeUntaggedDaysSettingKey) !== "false"
    showTagCounts = localStorage.getItem(showTagCountsSettingKey) === "true"
    tagTimingMode = getSavedTagTimingMode()
    tagSortMode = getSavedTagSortMode()
    optimalTarget = getSavedOptimalTarget()
    optimalExcludedTags = getSavedOptimalTagList(optimalExcludedTagsSettingKey)
    optimalIncludedTags = getSavedOptimalTagList(optimalIncludedTagsSettingKey)

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

  function formatOptimalScore(value: number | null) {
    return value === null ? "n/a" : `${Math.round(value)}`
  }

  function removeOptimalTag(tag: string) {
    if (optimalIncludedTags.includes(tag)) {
      optimalIncludedTags = optimalIncludedTags.filter((item) => item !== tag)
    } else if (!optimalExcludedTags.includes(tag)) {
      optimalExcludedTags = [...optimalExcludedTags, tag]
    }

    saveOptimalOverrides()
  }

  function addOptimalTag(tag: string) {
    if (optimalExcludedTags.includes(tag)) {
      optimalExcludedTags = optimalExcludedTags.filter((item) => item !== tag)
    } else if (!optimalIncludedTags.includes(tag)) {
      optimalIncludedTags = [...optimalIncludedTags, tag]
    }

    saveOptimalOverrides()
  }

  function resetOptimalTags() {
    optimalExcludedTags = []
    optimalIncludedTags = []
    saveOptimalOverrides()
  }

  function setTagSortMode(mode: TagSortMode) {
    tagSortMode = mode
    localStorage.setItem(tagSortModeSettingKey, mode)
  }

  function getSavedTagSortMode(): TagSortMode {
    const savedMode = localStorage.getItem(tagSortModeSettingKey)

    return savedMode === "alpha" || savedMode === "count" ? savedMode : "alpha"
  }

  function setOptimalTarget(target: OptimalTarget) {
    optimalTarget = target
    localStorage.setItem(optimalTargetSettingKey, target)
  }

  function saveOptimalOverrides() {
    localStorage.setItem(
      optimalExcludedTagsSettingKey,
      JSON.stringify(optimalExcludedTags)
    )
    localStorage.setItem(
      optimalIncludedTagsSettingKey,
      JSON.stringify(optimalIncludedTags)
    )
  }

  function getSavedOptimalTarget(): OptimalTarget {
    const savedTarget = localStorage.getItem(optimalTargetSettingKey)
    const match = optimalTargets.find((option) => option.id === savedTarget)

    return match?.id ?? "total"
  }

  function getSavedOptimalTagList(settingKey: string): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(settingKey) ?? "[]")

      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : []
    } catch {
      return []
    }
  }

  function optimalTagBarWidth(value: number, maxValue: number) {
    if (maxValue <= 0 || value <= 0) {
      return "0%"
    }

    return `${Math.max(6, Math.round((value / maxValue) * 100))}%`
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
    selectedExploreDate = ""
    hoveredExploreDate = ""
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
      importMessage = "Import your Oura personal data export to begin."
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

  // Tone thresholds compare the same rounded value the card displays, so a
  // shown 85 is always blue even when the raw estimate is 84.6.
  function scoreRangeTone(value: number | null): ScoreRangeTone {
    if (value === null) {
      return "score-neutral"
    }

    const displayedScore = Math.round(value)

    if (displayedScore >= 85) {
      return "score-excellent"
    }

    if (displayedScore >= 70) {
      return "score-good"
    }

    return "score-poor"
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

  function detailTags(day: ExploreDay | undefined) {
    if (!day) {
      return "No day selected"
    }

    return day.tags.length > 0 ? formatTagList(day.tags) : "No tags"
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

  function sortExploreDaysNewestFirst(days: ExploreDay[]) {
    return [...days].sort((left, right) => right.date.localeCompare(left.date))
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
    metrics: DailyMetricRow[]
  ): MetricComparison {
    const currentTagsByDate = buildTagsByDate(effectiveTagEntries)
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

  function getExploreMetricComparison(
    metric: InsightComparisonMetric
  ): MetricComparison {
    const taggedAverage = average(
      matchingExploreDays.map((day) => day.metric[metric])
    )
    const baselineAverage = average(
      otherExploreDays.map((day) => day.metric[metric])
    )

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

  function isExploreImpactGroupOpen(category: ExploreMetricCategory) {
    return openExploreImpactCategories.includes(category)
  }

  function updateExploreImpactGroup(
    category: ExploreMetricCategory,
    event: Event
  ) {
    const details = event.currentTarget

    if (!(details instanceof HTMLDetailsElement)) {
      return
    }

    openExploreImpactCategories = details.open
      ? Array.from(new Set([...openExploreImpactCategories, category]))
      : openExploreImpactCategories.filter((item) => item !== category)
  }

  function selectExploreDay(day: ExploreDay) {
    selectedExploreDate = day.date
  }

  function selectExploreDate(date: string) {
    selectedExploreDate = date
    // Bring the matching night into view in the log below the chart. Days
    // without the selected tags have no log row, so this is best-effort.
    requestAnimationFrame(() => {
      document
        .querySelector(`.matching-log .log-row[data-date="${date}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  function toggleExploreTag(tag: string) {
    selectedExploreDate = ""
    selectedExploreTags = selectedExploreTags.includes(tag)
      ? selectedExploreTags.filter((selectedTag) => selectedTag !== tag)
      : [...selectedExploreTags, tag]
  }

  function buildTagsByDate(entries: typeof tagEntries) {
    return entries.reduce(
      (groups, tag) => {
        groups[tag.date] = [...(groups[tag.date] ?? []), tag.tag]

        return groups
      },
      {} as Record<string, string[]>
    )
  }

  function getTaggedMetricDates(entries: typeof tagEntries) {
    return new Set(entries.map((tag) => tag.date))
  }

  interface TagChipGroup {
    key: string
    label: string
    entries: TagEntryRow[]
    title: string
  }

  interface DeletedTagChipGroup {
    key: string
    label: string
    rows: DeletedTagIdRow[]
    title: string
  }

  interface TagDay {
    date: string
    entries: TagEntryRow[]
    deleted: DeletedTagIdRow[]
    activeGroups: TagChipGroup[]
    deletedGroups: DeletedTagChipGroup[]
  }

  // The Oura export can log the same tag several times on one day. Chips are
  // grouped by label so each tag shows once; acting on a chip covers every
  // entry in its group.
  function buildDayChipGroups(day: TagDay) {
    const active = new Map<string, TagChipGroup>()

    for (const entry of day.entries) {
      const key = entry.tag.toLocaleLowerCase()
      const group = active.get(key)

      if (group) {
        group.entries.push(entry)
      } else {
        active.set(key, { key, label: entry.tag, entries: [entry], title: "" })
      }
    }

    const deleted = new Map<string, DeletedTagChipGroup>()

    for (const row of day.deleted) {
      const label = row.entry?.tag ?? ""
      const key = label.toLocaleLowerCase()

      // Labels that still have an active entry show as a normal chip; their
      // tombstones surface as one crossed chip only once all are deleted.
      if (active.has(key)) {
        continue
      }

      const group = deleted.get(key)

      if (group) {
        group.rows.push(row)
      } else {
        deleted.set(key, { key, label, rows: [row], title: "" })
      }
    }

    for (const group of active.values()) {
      group.title = group.entries
        .map((entry) => entry.comment)
        .filter((comment): comment is string => Boolean(comment))
        .join("; ")
    }

    for (const group of deleted.values()) {
      group.title = group.rows
        .map((row) => row.entry?.comment)
        .filter((comment): comment is string => Boolean(comment))
        .join("; ")
    }

    day.activeGroups = Array.from(active.values())
    day.deletedGroups = Array.from(deleted.values())
  }

  function buildTagDays(
    entries: TagEntryRow[],
    deletedRows: DeletedTagIdRow[]
  ) {
    const days = new Map<string, TagDay>()
    const getDay = (date: string) => {
      let day = days.get(date)

      if (!day) {
        day = { date, entries: [], deleted: [], activeGroups: [], deletedGroups: [] }
        days.set(date, day)
      }

      return day
    }

    for (const entry of entries) {
      getDay(entry.date).entries.push(entry)
    }

    for (const row of deletedRows) {
      if (row.entry) {
        getDay(row.entry.date).deleted.push(row)
      }
    }

    for (const day of days.values()) {
      buildDayChipGroups(day)
    }

    return Array.from(days.values()).sort((left, right) =>
      right.date.localeCompare(left.date)
    )
  }

  async function reloadTagEntries() {
    tagEntries = await db.tagEntries.orderBy("date").toArray()
    deletedTagRows = await db.deletedTagIds.toArray()
  }

  function selectTagsDay(date: string) {
    tagsViewDate = date
    tagsMessage = ""
  }

  interface TagStripDay {
    date: string
    monthLabel: string | null
    tagCount: number
    barHeight: number
    tone: ScoreRangeTone
    dimmed: boolean
    title: string
  }

  function buildTagStripDays(
    metrics: DailyMetricRow[],
    days: TagDay[],
    filteredDays: TagDay[],
    filterActive: boolean
  ): TagStripDay[] {
    const today = formatInputDate(new Date())
    const startCandidates = [metrics[0]?.date, days.at(-1)?.date]
      .filter((date): date is string => Boolean(date))
      .sort()
    const start = startCandidates[0]

    if (!start || start > today) {
      return []
    }

    const dayByDate = new Map(days.map((day) => [day.date, day]))
    const filteredDates = new Set(filteredDays.map((day) => day.date))
    const sleepScoreByDate = new Map(
      metrics.map((metric) => [metric.date, metric.sleepScore])
    )
    // Bars reflect only active tags; deletion tombstones must not inflate
    // column heights.
    const maxCount = Math.max(
      1,
      ...days.map((day) => day.activeGroups.length)
    )
    const stripDays: TagStripDay[] = []

    for (let date = start; date <= today; date = shiftDate(date, 1)) {
      const day = dayByDate.get(date)
      const count = day ? day.activeGroups.length : 0

      stripDays.push({
        date,
        monthLabel: date.endsWith("-01") ? formatMonth(date) : null,
        tagCount: count,
        barHeight:
          count === 0 ? 0 : Math.max(18, Math.round((count / maxCount) * 100)),
        tone: scoreRangeTone(sleepScoreByDate.get(date) ?? null),
        dimmed: filterActive && !filteredDates.has(date),
        title: `${formatDate(date)} · ${count} ${count === 1 ? "tag" : "tags"}`
      })
    }

    return stripDays
  }

  // The strip starts positioned on the selected day without animating past
  // every prior day; only later selections glide smoothly.
  let tagStripHasPositioned = false

  $: if (activeView !== "tags") {
    tagStripHasPositioned = false
  }

  function scrollTagStripToDate(date: string) {
    requestAnimationFrame(() => {
      const target = document.querySelector(
        `.tag-day-strip [data-strip-date="${date}"]`
      )

      if (!target) {
        return
      }

      target.scrollIntoView({
        behavior: tagStripHasPositioned ? "smooth" : "auto",
        inline: "center",
        block: "nearest"
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

  function filterTagsByQuery(tags: string[], search: string) {
    const query = search.trim().toLocaleLowerCase()

    if (query.length === 0) {
      return tags
    }

    return tags.filter(
      (tag) =>
        formatTagLabel(tag).toLocaleLowerCase().includes(query) ||
        tag.toLocaleLowerCase().includes(query)
    )
  }

  function toggleTagsFilterTag(tag: string) {
    tagsFilterTags = tagsFilterTags.includes(tag)
      ? tagsFilterTags.filter((item) => item !== tag)
      : [...tagsFilterTags, tag]
  }

  function buildAllKnownTags(
    entries: TagEntryRow[],
    deletedRows: DeletedTagIdRow[]
  ) {
    const labelsByKey = new Map<string, string>()

    for (const entry of entries) {
      const key = entry.tag.toLocaleLowerCase()

      if (!labelsByKey.has(key)) {
        labelsByKey.set(key, entry.tag)
      }
    }

    for (const row of deletedRows) {
      const label = row.entry?.tag

      if (!label) {
        continue
      }

      const key = label.toLocaleLowerCase()

      if (!labelsByKey.has(key)) {
        labelsByKey.set(key, label)
      }
    }

    return sortTagsForDisplay(Array.from(labelsByKey.values()))
  }

  let tagPickerSearchInput: HTMLInputElement | null = null

  function openTagPicker() {
    isTagPickerOpen = true
    tagPickerSearch = ""
    setTagPickerMode("add")
    requestAnimationFrame(() => tagPickerSearchInput?.focus())
  }

  function setTagPickerMode(mode: "add" | "rename") {
    tagPickerMode = mode
    renameTargetTag = ""
    renameInput = ""
    renameMessage = ""
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
      const entry = await addUserTagEntry({
        date: tagsViewDate,
        tag,
        comment: null
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

  function selectRenameTarget(tag: string) {
    renameTargetTag = renameTargetTag === tag ? "" : tag
    renameInput = renameTargetTag
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
    // existing label's casing or canonicalizes like the popup does.
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

    const isMerge = allKnownTags.some(
      (tag) =>
        tag.toLocaleLowerCase() === label.toLocaleLowerCase() &&
        tag.toLocaleLowerCase() !== renameTargetTag.toLocaleLowerCase()
    )

    isRenamingTag = true

    try {
      const renamedCount = await renameTag(renameTargetTag, label)

      // Drop stale filter selections that still carry the old label.
      tagsFilterTags = tagsFilterTags.filter(
        (tag) =>
          tag.toLocaleLowerCase() !== renameTargetTag.toLocaleLowerCase()
      )
      await reloadTagEntries()
      renameMessage = isMerge
        ? `Renamed ${renamedCount} entries and merged into ${formatTagLabel(label)}.`
        : `Renamed ${renamedCount} entries to ${formatTagLabel(label)}.`
      renameTargetTag = ""
      renameInput = ""
    } catch {
      renameMessage = "Could not rename that tag. Try again."
    } finally {
      isRenamingTag = false
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
        : `Removed ${result.deletedIds.length} duplicate tag entries. Undo works until you close or reload the dashboard.`
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

  function selectInsight(item: TagInsight) {
    selectedInsightKey = insightKey(item)
  }

  let tagSearchInput: HTMLInputElement | null = null
  let tagsFilterSearchInput: HTMLInputElement | null = null

  // On the Explore and Tags views, typing anywhere starts a tag search
  // without having to click the search box first.
  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isDedupeConfirmOpen) {
      if (!isDeduping) {
        closeDedupeConfirm()
      }

      return
    }

    const searchInput =
      activeView === "explore"
        ? tagSearchInput
        : activeView === "tags"
          ? isTagPickerOpen
            ? tagPickerSearchInput
            : tagsFilterSearchInput
          : null

    if (!searchInput) {
      return
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const target = event.target instanceof HTMLElement ? event.target : null

    // Escape closes the tag picker popup, or backs out of the tag search.
    if (event.key === "Escape") {
      if (activeView === "explore") {
        tagSearch = ""
      } else if (isTagPickerOpen) {
        closeTagPicker()
        return
      } else {
        tagsFilterSearch = ""
      }

      if (target === searchInput) {
        searchInput.blur()
      }

      return
    }

    // Only printable characters; keeps shortcuts, Tab, and arrows working.
    if (event.key.length !== 1) {
      return
    }

    if (
      target &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable)
    ) {
      return
    }

    // Space on a focused button should still activate that button.
    if (event.key === " " && target instanceof HTMLButtonElement) {
      return
    }

    searchInput.focus()
  }

</script>

<svelte:window on:keydown={handleGlobalKeydown} />

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
    <section class="explore-workspace">
      <div class="explore-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Explore</p>
            <h2>Build your own Oura comparison</h2>
          </div>
          <span>{matchingExploreDays.length} matching nights</span>
        </div>

        <div class="explore-builder">
          <section class="explore-control">
            <div class="tag-control-heading">
              <h3>Tags</h3>
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
                bind:value={tagSearch}
                bind:this={tagSearchInput}
              />
            {/if}
            <div class="tag-picker">
              {#each visibleExploreTags as tag}
                <button
                  type="button"
                  class:active={selectedExploreTags.includes(tag)}
                  on:click={() => toggleExploreTag(tag)}
                >
                  {formatTagLabel(tag)}
                  {#if showTagCounts}
                    <span class="tag-count">{tagNightCounts.get(tag) ?? 0}</span>
                  {/if}
                </button>
              {:else}
                <p class="empty-state">
                  {availableTags.length === 0
                    ? "Sync or add tags to explore patterns."
                    : "No tags match your search."}
                </p>
              {/each}
            </div>
          </section>

          <section class="explore-control">
            <h3>View</h3>
            <div class="segmented-control" aria-label="Explore chart mode">
              {#each chartModes as mode}
                <button
                  type="button"
                  class:active={exploreChartMode === mode}
                  on:click={() => (exploreChartMode = mode)}
                >
                  {mode}
                </button>
              {/each}
            </div>
          </section>

          <section
            aria-hidden={exploreChartMode === "impact"}
            class:hidden={exploreChartMode === "impact"}
            class="explore-control"
          >
            <h3>Metrics</h3>
            <div
              class:single={exploreChartMode !== "scatter"}
              class="metric-selectors"
            >
              {#if exploreChartMode === "scatter"}
                <label>
                  <span>X axis</span>
                  <select bind:value={selectedXMetric}>
                    {#each exploreMetricGroups as group}
                      <optgroup label={group.label}>
                        {#each group.metrics as metric}
                          <option value={metric.key}>{metric.label}</option>
                        {/each}
                      </optgroup>
                    {/each}
                  </select>
                </label>
              {/if}
              <label>
                <span>{exploreChartMode === "timeline" ? "Metric" : "Y axis"}</span>
                <select
                  bind:value={selectedYMetric}
                  disabled={exploreChartMode === "impact"}
                  tabindex={exploreChartMode === "impact" ? -1 : 0}
                >
                  {#each exploreMetricGroups as group}
                    <optgroup label={group.label}>
                      {#each group.metrics as metric}
                        <option value={metric.key}>{metric.label}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
              </label>
            </div>
          </section>
        </div>
      </div>

      {#if exploreChartMode === "impact"}
        <div class="explore-panel score-comparison-panel">
          <div class="panel-heading compact">
            <div>
              <p class="section-kicker">
                {selectedExploreTags.length === 1 ? "Tag Effects" : "Tags Effects"}
              </p>
              <h2>
                {selectedExploreTags.length > 0
                  ? formatTagList(selectedExploreTags, " + ")
                  : "Choose a tag combination"}
              </h2>
            </div>
          </div>

          {#if exploreScoreComparisons.length > 0}
            <div
              class="comparison-chart explore-score-comparison"
              aria-label="Explore score comparison"
            >
              {#each exploreScoreComparisons as item}
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
            <p class="empty-state">Select tags with matching nights to compare scores.</p>
          {/if}
        </div>
      {/if}

      <div class="explore-panel chart-panel">
        <div class="chart-heading">
          <div>
            <p class="section-kicker">Health metrics</p>
            <h2>
              {selectedExploreTags.length > 0
                ? formatTagList(selectedExploreTags, " + ")
                : "Choose a tag combination"}
            </h2>
          </div>
          <div class="chart-counts">
            <span>{matchingExploreDays.length} tagged</span>
            <span>{otherExploreDays.length} other</span>
          </div>
        </div>

        {#if exploreChartMode === "scatter"}
          <EChart
            option={scatterOption}
            on:selectDay={(event) => selectExploreDate(event.detail)}
            on:hover={(event) => (hoveredExploreDate = event.detail)}
          />
        {:else if exploreChartMode === "impact" && selectedExploreTags.length === 0}
          <p class="empty-state">Select at least one tag to compare metric impacts.</p>
        {:else if exploreChartMode === "impact" && matchingExploreDays.length === 0}
          <p class="empty-state">No nights match every selected tag yet.</p>
        {:else if exploreChartMode === "impact"}
          <div class="impact-list">
            {#each groupedExploreImpacts as group}
              <details
                class="impact-group"
                open={isExploreImpactGroupOpen(group.category)}
                on:toggle={(event) => updateExploreImpactGroup(group.category, event)}
              >
                <summary
                  class="impact-group-heading"
                  aria-label={`${group.category} impact metrics`}
                >
                  <span class="impact-group-title">
                    <strong>{group.category}</strong>
                    <span>{impactGroupMetricCount(group)}</span>
                  </span>
                  <span
                    class="score-impact {impactGroupTone(
                      group,
                      exploreImpacts
                    )}"
                  >
                    <span>{impactGroupDeltaLabel(group)}</span>
                    <b>{impactGroupDelta(group)}</b>
                  </span>
                  <span class="impact-group-toggle" aria-hidden="true" />
                </summary>

                <div class="impact-grid">
                  {#each group.rows as row}
                    <article class="impact-metric">
                      <div class="impact-metric-heading">
                        <div>
                          <strong>{row.metric.label}</strong>
                          <span>
                            {formatAverage(row.taggedAverage, row.metric)} tagged vs
                            {formatAverage(row.otherAverage, row.metric)} other
                          </span>
                        </div>
                        <strong
                          class="score-impact {impactEffectTone(
                            row.effectSize,
                            exploreImpacts
                          )}"
                        >
                          <b>{formatExploreDelta(row)}</b>
                        </strong>
                      </div>
                      <div class="impact-bar">
                        <span
                          class="impact-fill {impactEffectTone(
                            row.effectSize,
                            exploreImpacts
                          )}"
                          style={`width: ${impactWidth(row, exploreImpacts)}`}
                        />
                      </div>
                    </article>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        {:else}
          <EChart
            option={timelineOption}
            on:selectDay={(event) => selectExploreDate(event.detail)}
            on:hover={(event) => (hoveredExploreDate = event.detail)}
          />
        {/if}

        <TagCalendar
          selectedTags={selectedExploreTags}
          calendar={exploreTagCalendar}
          options={exploreTagCalendarOptions}
          selectedRange={selectedExploreTagCalendarRange}
          on:hover={(event) => (hoveredExploreDate = event.detail)}
          on:selectDay={(event) => selectExploreDate(event.detail)}
          on:selectRange={(event) =>
            (selectedExploreTagCalendarRange = event.detail)}
        />

        <div class="explore-log">
          <section class="matching-log" aria-label="Matching explore nights">
            <div class="log-heading">
              <div>
                <p class="section-kicker">Matching nights</p>
                <h3>{formatTagList(selectedExploreTags, " + ")}</h3>
              </div>
              <span>{matchingExploreDays.length} nights</span>
            </div>

            <div class="log-table">
              <div class="log-row header">
                <span>Date</span>
                <span>Tags</span>
              </div>
              {#each matchingExploreDays as day}
                <button
                  type="button"
                  class:selected={selectedExploreDate === day.date}
                  class:hovered={hoveredExploreDate === day.date}
                  class="log-row"
                  data-date={day.date}
                  on:mouseenter={() => (hoveredExploreDate = day.date)}
                  on:mouseleave={() => (hoveredExploreDate = "")}
                  on:click={() => selectExploreDay(day)}
                >
                  <div class="log-date">
                    <strong>Night of {formatSleepNightDate(day.date)}</strong>
                    <small>Oura date {formatDate(day.date)}</small>
                  </div>
                  <span>{detailTags(day)}</span>
                </button>
              {/each}
            </div>
          </section>
        </div>
      </div>
    </section>
  {:else if activeView === "optimal"}
    <section class="metric-grid" aria-label="Optimal day estimates">
      {#each scoreCategories as category}
        <article
          class="metric-card {scoreRangeTone(
            optimalDay.estimates[category.key]
          )}"
          class:dimmed={!optimalTargetCategories.includes(category.key)}
        >
          <p>{category.label} estimate</p>
          <strong>{formatOptimalScore(optimalDay.estimates[category.key])}</strong>
          <small>
            baseline {formatOptimalScore(optimalDay.baselines[category.key])} ·
            best days {formatOptimalScore(
              optimalDay.bestDayAverages[category.key]
            )}
          </small>
          <span>{formatNullableDelta(optimalDay.estimateDeltas[category.key])}</span>
          {#if optimalHasOverrides && optimalEstimateDiffs[category.key] !== null && optimalEstimateDiffs[category.key] !== 0}
            <span
              class="optimal-vs {(optimalEstimateDiffs[category.key] ?? 0) < 0
                ? 'down'
                : 'up'}"
            >
              {formatDelta(optimalEstimateDiffs[category.key] ?? 0)} vs optimal
            </span>
          {/if}
        </article>
      {/each}
    </section>

    <section class="optimal-workspace">
      <div class="analysis-panel optimal-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Optimal Day</p>
            <h2>Your best-day tag set</h2>
          </div>
          <div class="segmented-control" aria-label="Optimization target">
            {#each optimalTargets as targetOption}
              <button
                type="button"
                class:active={optimalTarget === targetOption.id}
                on:click={() => setOptimalTarget(targetOption.id)}
              >
                {targetOption.label}
              </button>
            {/each}
          </div>
        </div>

        <details class="optimal-method">
          <summary>How the estimate works</summary>
          <ul>
            <li>Baseline is your average score across all imported days.</li>
            <li>
              Best days is the average score of your top 10% of all imported
              days in that category, tagged or not, even when untagged days
              are excluded from the analysis. If you have 900 days of data,
              it is the average of your 90 highest sleep, readiness, or
              activity scores. It acts as a realistic ceiling for the
              estimate, because your optimal day cannot be better than the
              best days you have actually recorded.
            </li>
            <li>
              Each tag's impact compares its tagged days with your typical
              day. Only tags with at least {OPTIMAL_MIN_TAGGED_DAYS} tagged
              nights count, so one-off outliers do not skew the estimate.
            </li>
            <li>
              Tags that lift the selected target (Night = sleep + readiness)
              are combined with diminishing returns, because they often
              overlap on the same good days. The optimal set is then tuned so
              that no single tag added or removed would improve the target
              estimate.
            </li>
            <li>
              Remove tags you cannot realistically use, or add other tags from
              the list below. The cards then show how far your adjusted day
              sits from the most optimal one.
            </li>
            <li>
              Each tag's bar and number show what toggling it would do to the
              target estimate right now: for included tags the points lost by
              removing them, for the others the effect of adding them. A tag
              that looks good on its own can still show a negative number,
              when it mostly repeats what stronger tags already cover.
            </li>
            <li>
              The estimate starts at your baseline and flattens out as it
              approaches your best days average, which it can never cross.
            </li>
          </ul>
        </details>

        <div class="optimal-list-heading">
          <h3>In your optimal day ({optimalDay.contributions.length})</h3>
          {#if optimalHasOverrides}
            <button
              type="button"
              class="optimal-reset"
              on:click={resetOptimalTags}
            >
              Reset to optimal
            </button>
          {/if}
        </div>

        {#if optimalDay.contributions.length > 0}
          <div class="optimal-tag-list">
            {#each optimalDay.contributions as contribution}
              <div class="optimal-tag-row">
                <div class="optimal-tag-name">
                  <strong>{formatTagLabel(contribution.tag)}</strong>
                  <span>
                    {contribution.daysWithTag} nights{#each scoreCategories as category}
                      &nbsp;· {category.label}
                      {formatDelta(contribution.weightedDeltas[category.key])}{/each}
                  </span>
                </div>
                <div class="bar-track">
                  <span
                    class="bar-fill {contribution.targetImpact < 0
                      ? 'harmful'
                      : 'tagged'}"
                    style={`width: ${optimalTagBarWidth(
                      Math.abs(contribution.targetImpact),
                      optimalImpactBarMax
                    )}`}
                  />
                </div>
                <strong
                  class="optimal-tag-value {impactTone(
                    contribution.targetImpact
                  )}"
                >
                  {formatDelta(contribution.targetImpact)}
                </strong>
                <button
                  type="button"
                  class="optimal-tag-action"
                  title="Remove from optimal day"
                  aria-label={`Remove ${formatTagLabel(contribution.tag)} from your optimal day`}
                  on:click={() => removeOptimalTag(contribution.tag)}
                >
                  ×
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-state">
            {hasLocalData
              ? optimalHasOverrides
                ? "You removed every contributing tag. Add tags back below or reset to optimal."
                : `No tag with ${OPTIMAL_MIN_TAGGED_DAYS}+ tagged nights lifts this target yet. Keep tagging to unlock your optimal day.`
              : "Import your Oura data to see your optimal day."}
          </p>
        {/if}

        {#if optimalDay.otherEligibleTags.length > 0}
          <details class="optimal-method optimal-others">
            <summary>
              Not in your optimal day ({optimalDay.otherEligibleTags.length})
            </summary>
            <div class="optimal-tag-list">
              {#each optimalDay.otherEligibleTags as candidate}
                <div class="optimal-tag-row">
                  <div class="optimal-tag-name">
                    <strong>{formatTagLabel(candidate.tag)}</strong>
                    <span>
                      {candidate.daysWithTag} nights{#each scoreCategories as category}
                        &nbsp;· {category.label}
                        {formatDelta(candidate.weightedDeltas[category.key])}{/each}
                    </span>
                  </div>
                  <div class="bar-track">
                    <span
                      class="bar-fill {candidate.targetImpact < 0
                        ? 'harmful'
                        : 'tagged'}"
                      style={`width: ${optimalTagBarWidth(
                        Math.abs(candidate.targetImpact),
                        optimalImpactBarMax
                      )}`}
                    />
                  </div>
                  <strong
                    class="optimal-tag-value {impactTone(
                      candidate.targetImpact
                    )}"
                  >
                    {formatDelta(candidate.targetImpact)}
                  </strong>
                  <button
                    type="button"
                    class="optimal-tag-action"
                    title="Add to optimal day"
                    aria-label={`Add ${formatTagLabel(candidate.tag)} to your optimal day`}
                    on:click={() => addOptimalTag(candidate.tag)}
                  >
                    +
                  </button>
                </div>
              {/each}
            </div>
          </details>
        {/if}
      </div>
    </section>
  {:else if activeView === "tags"}
    <section class="settings-workspace" aria-label="Tag manager">
      <div class="settings-panel">
        <div class="tag-daily-log" aria-label="Tagged days">
          <div class="log-heading">
            <div>
              <p class="section-kicker">Daily log</p>
              <h3>
                {tagsFilterTags.length > 0
                  ? formatTagList(tagsFilterTags, " + ")
                  : "All tagged days"}
              </h3>
            </div>
            <span>
              {tagsFilterTags.length > 0
                ? `${filteredTagDays.length} of ${tagDays.length} days`
                : `${tagDays.length} days`}
            </span>
          </div>

          {#if tagStripDays.length > 0}
            <div
              class="tag-day-strip"
              aria-label="Day timeline"
              on:wheel|nonpassive={handleTagStripWheel}
            >
              {#each tagStripDays as day (day.date)}
                <button
                  type="button"
                  class="strip-day"
                  class:selected={tagsViewDate === day.date}
                  class:dimmed={day.dimmed}
                  data-strip-date={day.date}
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
                  <small class="strip-label">{day.monthLabel ?? ""}</small>
                </button>
              {/each}
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

          {#if tagDays.length === 0}
            <p class="tag-empty">
              Import Oura data or add your first tag above.
            </p>
          {:else if filteredTagDays.length === 0}
            <p class="tag-empty">No tagged days match these filters.</p>
          {:else}
            <div class="log-table">
              <div class="log-row header">
                <span>Date</span>
                <span>Tags</span>
              </div>
              {#each filteredTagDays as day (day.date)}
                {#if tagsViewDate === day.date}
                  <div class="log-row tag-log-row selected" data-date={day.date}>
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
          >
            <div class="tag-picker-modal-header">
              <div>
                <p class="section-kicker">
                  {tagPickerMode === "add" ? "Tags for" : "Manage"}
                </p>
                <h2>
                  {tagPickerMode === "add"
                    ? formatDate(tagsViewDate)
                    : "Rename tags"}
                </h2>
              </div>
              <div class="tag-sort" role="group" aria-label="Picker mode">
                <button
                  type="button"
                  class:active={tagPickerMode === "add"}
                  aria-pressed={tagPickerMode === "add"}
                  on:click={() => setTagPickerMode("add")}
                >
                  Add
                </button>
                <button
                  type="button"
                  class:active={tagPickerMode === "rename"}
                  aria-pressed={tagPickerMode === "rename"}
                  on:click={() => setTagPickerMode("rename")}
                >
                  Rename
                </button>
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
              placeholder={tagPickerMode === "add"
                ? "Search or type a new tag"
                : "Search tags"}
              aria-label="Search tags"
              bind:value={tagPickerSearch}
              bind:this={tagPickerSearchInput}
            />
            <div class="tag-picker">
              {#each visibleTagPickerTags as tag (tag)}
                {@const key = tag.toLocaleLowerCase()}
                <button
                  type="button"
                  class:active={tagPickerMode === "add"
                    ? tagPickerActiveKeys.has(key)
                    : renameTargetTag === tag}
                  class:crossed={tagPickerMode === "add" &&
                    tagPickerDeletedKeys.has(key)}
                  on:click={() =>
                    tagPickerMode === "add"
                      ? toggleTagInPicker(tag)
                      : selectRenameTarget(tag)}
                >
                  {formatTagLabel(tag)}
                </button>
              {/each}
              {#if tagPickerMode === "add" && tagPickerCreateLabel}
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

            {#if tagPickerMode === "rename" && renameTargetTag}
              <form
                class="tag-rename-form"
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
                <button
                  type="button"
                  class="secondary"
                  on:click={() => selectRenameTarget(renameTargetTag)}
                >
                  Cancel
                </button>
              </form>
              <p class="tag-rename-note">
                Renames {formatTagLabel(renameTargetTag)} everywhere, including
                crossed-out entries. Renaming to an existing tag merges them.
              </p>
            {/if}

            {#if renameMessage}
              <p class="tag-rename-message" role="status">{renameMessage}</p>
            {/if}
          </section>
        </div>
      {/if}
    </section>
  {:else}
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
          <strong>{analysisDailyMetrics.length} of {dailyMetrics.length} days</strong>
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
              from this device. A saved Oura key is not affected. Use this to
              start fresh before re-importing an export.
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
    </section>
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

  .header,
  .view-tabs,
  .explore-workspace,
  .optimal-workspace,
  .settings-workspace,
  .workspace,
  .metric-grid {
    width: min(1180px, 100%);
    margin-inline: auto;
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

  .view-tabs button,
  .segmented-control button,
  .tag-picker button {
    appearance: none;
    border: 1px solid transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
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

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
    margin-bottom: 0.8rem;
  }

  .metric-card,
  .analysis-panel,
  .explore-panel,
  .settings-panel,
  .trend-panel {
    border: 1px solid #d3d5c8;
    border-radius: 8px;
    background: rgba(251, 247, 239, 0.88);
    box-shadow: 0 10px 30px rgba(55, 64, 54, 0.045);
  }

  .metric-card {
    padding: 1rem;
    min-height: 128px;
    box-sizing: border-box;
  }

  .metric-card p {
    color: #6f786f;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .metric-card strong {
    display: block;
    margin: 0.9rem 0 0.35rem;
    font-size: 2rem;
    line-height: 1;
  }

  .metric-card small {
    color: #6f786f;
    display: block;
    font-size: 0.76rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .metric-card span {
    color: #5d685e;
    display: block;
    font-size: 0.9rem;
    margin-top: 0.45rem;
  }

  .metric-card.score-excellent {
    border-top: 4px solid #1e2c64;
  }

  .metric-card.score-good {
    border-top: 4px solid #4f8a63;
  }

  .metric-card.score-poor {
    border-top: 4px solid #a8423e;
  }

  .metric-card.score-neutral {
    border-top: 4px solid #9ca69a;
  }

  .metric-card.dimmed {
    opacity: 0.55;
  }

  .optimal-method {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    margin: 0.7rem 0 1rem;
  }

  .optimal-method summary {
    color: #4f5f53;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 800;
    list-style: none;
    padding: 0.55rem 0.9rem;
  }

  .optimal-method summary::marker {
    content: "";
  }

  .optimal-method summary::-webkit-details-marker {
    display: none;
  }

  .optimal-method summary::after {
    color: #6f786f;
    content: "+";
    float: right;
    font-weight: 900;
  }

  .optimal-method[open] summary::after {
    content: "–";
  }

  .optimal-method ul {
    color: #5d685e;
    display: grid;
    font-size: 0.85rem;
    gap: 0.35rem;
    margin: 0;
    padding: 0 0.9rem 0.75rem 2rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(340px, 0.95fr);
    gap: 0.8rem;
  }

  .analysis-panel,
  .explore-panel,
  .settings-panel,
  .trend-panel {
    padding: 1rem;
  }

  .explore-workspace {
    display: grid;
    gap: 0.8rem;
  }

  .settings-workspace {
    display: grid;
    gap: 0.8rem;
  }

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
    gap: 4px;
    margin-bottom: 0.4rem;
    overflow-x: auto;
    padding: 0.4rem 0.1rem 0.2rem;
    scrollbar-width: thin;
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
    text-align: left;
    text-transform: uppercase;
    white-space: nowrap;
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

  .strip-day-panel .tag-empty {
    padding-block: 0;
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

  .tag-picker-backdrop {
    align-items: center;
    background: rgba(23, 32, 27, 0.45);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 1rem;
    position: fixed;
    z-index: 20;
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

  .tag-rename-form {
    display: grid;
    gap: 0.55rem;
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .tag-rename-form input {
    background: #fbf7ef;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    font: inherit;
    min-width: 0;
    padding: 0.5rem 0.65rem;
  }

  .tag-rename-form button {
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

  .tag-rename-form button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .tag-rename-form button.secondary {
    background: #f7f1e8;
    border-color: #c5cbbd;
    color: #17201b;
  }

  .tag-rename-note {
    color: #6f786f;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .tag-rename-message {
    color: #17201b;
    font-weight: 700;
  }

  @media (max-width: 720px) {
    .tag-rename-form {
      grid-template-columns: 1fr;
    }
  }

  .tag-filter-control h3 {
    font-size: 0.95rem;
  }

  .explore-builder {
    align-items: start;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.8fr);
    gap: 0.9rem;
  }

  .explore-control {
    align-content: start;
    display: grid;
    gap: 0.55rem;
    min-width: 0;
  }

  .explore-control.hidden {
    pointer-events: none;
    visibility: hidden;
  }

  .explore-control h3 {
    color: #4f5f53;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .explore-control:first-child {
    border-bottom: 1px solid #d8d8cc;
    grid-column: 1 / -1;
    padding-bottom: 0.9rem;
  }

  .tag-control-heading {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .tag-sort {
    display: flex;
    gap: 0.3rem;
  }

  .tag-sort button {
    background: #f7f1e8;
    border: 1px solid #d8d8cc;
    border-radius: 999px;
    color: #6f786f;
    cursor: pointer;
    font: inherit;
    font-size: 0.68rem;
    font-weight: 800;
    padding: 0.28rem 0.6rem;
    text-transform: uppercase;
  }

  .tag-sort button.active {
    background: #1e2c64;
    border-color: #1e2c64;
    color: #fbf7ef;
  }

  .tag-search {
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    background: #fbf7ef;
    color: #17201b;
    font: inherit;
    padding: 0.55rem 0.7rem;
    width: 100%;
  }

  .tag-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .tag-picker button,
  .segmented-control button {
    background: #f7f1e8;
    border-color: #d8d8cc;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 750;
    padding: 0.5rem 0.72rem;
  }

  .tag-picker button {
    align-items: center;
    display: inline-flex;
    gap: 0.4rem;
  }

  .tag-count {
    background: rgba(31, 37, 32, 0.08);
    border-radius: 999px;
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    min-width: 1.1rem;
    padding: 0.02rem 0.36rem;
    text-align: center;
  }

  .tag-picker button.active,
  .segmented-control button.active {
    background: #1d2a22;
    border-color: #1d2a22;
    color: #f8f3ea;
  }

  .tag-picker button.active .tag-count {
    background: rgba(248, 243, 234, 0.22);
    color: #f8f3ea;
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

  .metric-selectors {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .metric-selectors.single {
    grid-template-columns: minmax(0, 1fr);
  }

  .metric-selectors label {
    display: grid;
    gap: 0.3rem;
  }

  .metric-selectors span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .metric-selectors select {
    appearance: none;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    /* Custom sage chevron replaces the native dropdown arrow. */
    background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%236f786f' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
      no-repeat right 0.7rem center / 0.72rem,
      #fbf7ef;
    color: #17201b;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    min-width: 0;
    padding: 0.65rem 2rem 0.65rem 0.7rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .metric-selectors select:hover {
    border-color: #9ca69a;
  }

  .metric-selectors select:focus-visible {
    border-color: #1e2c64;
    outline: 2px solid rgba(30, 44, 100, 0.25);
    outline-offset: 1px;
  }

  .segmented-control {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.45rem;
    max-width: 22rem;
  }

  .segmented-control button {
    min-height: 3rem;
    min-width: 0;
    padding-block: 0.78rem;
    text-align: center;
  }

  .chart-panel {
    display: grid;
    gap: 0.85rem;
  }

  .chart-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .chart-counts {
    color: #6f786f;
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    font-size: 0.85rem;
    font-weight: 800;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .impact-list {
    display: grid;
    gap: 0.85rem;
    align-items: start;
  }

  .impact-group {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    overflow: hidden;
  }

  .impact-group-heading {
    align-items: center;
    background: #f4efe5;
    box-sizing: border-box;
    color: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 2.25rem;
    gap: 0.8rem;
    list-style: none;
    min-height: 60px;
    padding: 0.7rem 0.85rem;
    text-align: left;
    width: 100%;
  }

  .impact-group-heading::marker {
    content: "";
    display: none;
  }

  .impact-group-heading::-webkit-details-marker {
    display: none;
  }

  .impact-group-title {
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .impact-group-title strong,
  .impact-metric-heading strong,
  .impact-metric-heading span {
    display: block;
    min-width: 0;
  }

  .impact-group-title strong {
    font-size: 1rem;
  }

  .impact-group-title span,
  .impact-metric-heading span {
    color: #6f786f;
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .impact-group-heading .score-impact {
    justify-content: end;
  }

  .impact-group-heading .score-impact b,
  .impact-metric .score-impact b {
    font-size: 1rem;
  }

  .impact-group-toggle {
    align-items: center;
    border: 1px solid #cbd3c3;
    border-radius: 999px;
    box-sizing: border-box;
    color: #4f5f53;
    display: flex;
    flex: 0 0 2.25rem;
    font-size: 1rem;
    font-weight: 900;
    height: 2.25rem;
    justify-content: center;
    justify-self: center;
    line-height: 1;
    min-width: 2.25rem;
    width: 2.25rem;
  }

  .impact-group-toggle::before {
    content: "+";
  }

  .impact-group[open] .impact-group-toggle::before {
    content: "-";
  }

  .impact-grid {
    background: #fbf7ef;
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    padding: 0.75rem;
  }

  .impact-metric {
    background: #fffcf5;
    border: 1px solid #e1ded2;
    border-radius: 8px;
    display: grid;
    gap: 0.65rem;
    min-height: 96px;
    padding: 0.75rem;
  }

  .impact-metric-heading {
    align-items: start;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
  }

  .impact-metric-heading > div {
    min-width: 0;
  }

  .impact-metric .score-impact {
    justify-content: end;
  }

  .impact-bar {
    background: #ebe7dd;
    border-radius: 999px;
    height: 0.55rem;
    overflow: hidden;
    width: 100%;
  }

  .impact-fill {
    display: block;
    height: 100%;
  }

  .impact-fill.excellent {
    background: #1e2c64;
  }

  .impact-fill.positive {
    background: #4f8a63;
  }

  .impact-fill.neutral {
    background: #17201b;
  }

  .impact-fill.warning {
    background: #a8423e;
  }

  .impact-fill.negative {
    background: #a8423e;
  }

  .explore-log {
    border-top: 10px solid rgba(231, 233, 223, 0.9);
    display: grid;
    margin-inline: -1rem;
    padding: 1rem 1rem 0;
  }

  .log-row.header span,
  .log-heading > span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .matching-log {
    display: grid;
    gap: 0.45rem;
  }

  .log-heading {
    align-items: flex-start;
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .log-heading h3 {
    font-size: 1rem;
    margin-top: 0.1rem;
  }

  .log-heading > span {
    white-space: nowrap;
  }

  .log-table {
    border-top: 1px solid #d8d8cc;
    display: grid;
  }

  .log-row {
    appearance: none;
    background: transparent;
    border: 0;
    border-bottom: 1px solid #d8d8cc;
    color: inherit;
    display: grid;
    font: inherit;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 0.85rem;
    min-height: 52px;
    /* Left padding keeps text clear of the selected row's accent bar. */
    padding: 0.65rem 0 0.65rem 0.75rem;
    text-align: left;
  }

  button.log-row {
    cursor: pointer;
  }

  button.log-row:hover,
  button.log-row.hovered {
    background: rgba(255, 252, 246, 0.58);
  }

  button.log-row.selected {
    background: rgba(30, 44, 100, 0.09);
    box-shadow: inset 4px 0 0 #1e2c64;
  }

  button.log-row.selected .log-date strong {
    color: #1e2c64;
  }

  /* Every night shows its full tag list; rows grow as tall as they need. */
  button.log-row > span {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }

  .log-row strong,
  .log-row span {
    align-self: center;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-date {
    align-self: center;
    display: grid;
    gap: 0.12rem;
    min-width: 0;
  }

  .log-date strong,
  .log-date small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-date small {
    color: #6f786f;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .panel-heading > span {
    color: #6f786f;
    font-size: 0.85rem;
    font-weight: 700;
    white-space: nowrap;
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

  .score-impact {
    align-items: baseline;
    display: inline-flex;
    gap: 0.38rem;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .score-impact span {
    color: #6f786f;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .score-impact b {
    font-size: 1.9rem;
    line-height: 1;
    paint-order: stroke fill;
  }

  .score-impact.excellent b {
    color: #1e2c64;
  }

  .score-impact.positive b {
    color: #4f8a63;
  }

  .score-impact.neutral b {
    color: #17201b;
  }

  .score-impact.warning b {
    color: #a8423e;
  }

  .score-impact.negative b {
    color: #a8423e;
  }

  .optimal-tag-list {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    overflow: hidden;
  }

  .optimal-tag-row {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(120px, 1fr) 58px 1.7rem;
    gap: 0.9rem;
    align-items: center;
    padding: 0.55rem 0.9rem;
  }

  .optimal-tag-row + .optimal-tag-row {
    border-top: 1px solid #e6e2d6;
  }

  .optimal-tag-row:hover {
    background: rgba(255, 252, 246, 0.62);
  }

  .optimal-tag-name {
    min-width: 0;
  }

  .optimal-tag-name strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .optimal-tag-name span {
    color: #6f786f;
    display: block;
    font-size: 0.74rem;
    font-weight: 600;
    margin-top: 0.15rem;
  }

  .optimal-tag-value {
    font-size: 1.05rem;
    text-align: right;
    white-space: nowrap;
  }

  .optimal-tag-value.excellent {
    color: #1e2c64;
  }

  .optimal-tag-value.positive {
    color: #4f8a63;
  }

  .optimal-tag-value.neutral {
    color: #17201b;
  }

  .optimal-tag-value.warning {
    color: #a8423e;
  }

  .optimal-tag-value.negative {
    color: #a8423e;
  }

  .optimal-tag-action {
    appearance: none;
    align-items: center;
    background: transparent;
    border: 1px solid #cbd3c3;
    border-radius: 999px;
    box-sizing: border-box;
    color: #4f5f53;
    cursor: pointer;
    display: flex;
    font: inherit;
    font-size: 1rem;
    font-weight: 900;
    height: 1.7rem;
    justify-content: center;
    line-height: 1;
    padding: 0;
    width: 1.7rem;
  }

  .optimal-tag-action:hover {
    background: #fffcf6;
    border-color: #8b957f;
  }

  .optimal-list-heading {
    align-items: center;
    display: flex;
    gap: 0.8rem;
    justify-content: space-between;
    margin-bottom: 0.55rem;
  }

  .optimal-list-heading h3 {
    font-size: 0.95rem;
    margin: 0;
  }

  .optimal-reset {
    appearance: none;
    background: transparent;
    border: 1px solid #cbd3c3;
    border-radius: 999px;
    color: #4f5f53;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    padding: 0.3rem 0.8rem;
  }

  .optimal-reset:hover {
    background: rgba(255, 252, 246, 0.62);
    border-color: #8b957f;
  }

  .optimal-others {
    margin: 0.9rem 0 0;
  }

  .optimal-others .optimal-tag-list {
    border: none;
    border-radius: 0;
    border-top: 1px solid #e6e2d6;
  }

  .metric-card .optimal-vs {
    color: #4f8a63;
    display: block;
    font-size: 0.78rem;
    font-weight: 800;
    margin-top: 0.35rem;
  }

  .metric-card .optimal-vs.down {
    color: #a8423e;
  }

  .panel-heading.compact {
    margin-bottom: 0.7rem;
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

  .discovery-meta .score-impact b {
    font-size: 1.15rem;
  }

  .discovery-meta .score-impact span {
    font-size: 0.68rem;
  }

  .comparison-chart {
    display: grid;
    gap: 0.7rem;
    margin-bottom: 0.8rem;
  }

  .comparison-chart article {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    background-color: #fbf7ef;
    display: grid;
    gap: 0.55rem;
    padding: 0.8rem;
  }

  .explore-score-comparison {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin-bottom: 0;
  }

  .comparison-heading,
  .bar-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) 42px;
    gap: 0.6rem;
    align-items: center;
  }

  .comparison-heading {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .comparison-heading span {
    color: #4f5f53;
    font-weight: 800;
    white-space: nowrap;
  }

  .bar-row > span {
    color: #6f786f;
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .bar-row > strong {
    text-align: right;
  }

  .bar-track {
    background: #ebe7dd;
    border-radius: 999px;
    height: 0.6rem;
    overflow: hidden;
  }

  .bar-fill {
    display: block;
    height: 100%;
  }

  .bar-fill.tagged {
    background: #4f8a63;
  }

  .bar-fill.baseline {
    background: #9ca69a;
  }

  .bar-fill.harmful {
    background: #a8423e;
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

    .header,
    .workspace,
    .explore-builder {
      grid-template-columns: 1fr;
    }

    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .log-row {
      grid-template-columns: 136px minmax(0, 1fr);
      overflow-x: auto;
    }

    .impact-metric-heading {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .impact-group-heading {
      grid-template-columns: minmax(0, 1fr) 2.25rem;
    }

    .impact-group-heading .score-impact {
      grid-column: 1;
      justify-content: start;
    }

    .impact-group-toggle {
      grid-column: 2;
      grid-row: 1 / span 2;
    }

    .impact-grid {
      grid-template-columns: 1fr;
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

    .metric-grid {
      grid-template-columns: 1fr;
    }

    .metric-selectors {
      grid-template-columns: 1fr;
    }

    .optimal-tag-row {
      grid-template-columns: minmax(0, 1fr) 52px 1.7rem;
    }

    .optimal-tag-row .bar-track {
      display: none;
    }

    .log-row {
      grid-template-columns: 124px minmax(0, 1fr);
      gap: 0.35rem 0.85rem;
    }

    .setting-row,
    .setting-row.tag-timing-setting {
      grid-template-columns: 1fr;
    }

    .log-row.header {
      display: none;
    }

    .chart-heading {
      display: grid;
    }

    .chart-counts {
      justify-content: flex-start;
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
