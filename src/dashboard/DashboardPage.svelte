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
    type OptimalTarget
  } from "../lib/analysis/optimal"
  import { db } from "../lib/db"
  import type { AuthTokenRow, DailyMetricRow, TagEntryRow } from "../lib/db/types"
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
    formatSleepNightDate,
    metricExtent,
    metricLabel,
    metricPlainLabel,
    shiftDate
  } from "./format"
  import {
    chartHeight,
    chartPadding,
    chartWidth,
    createMetricTicks,
    createScatterPoints,
    createTimelineDateTicks,
    createTimelinePoints,
    formatAverage,
    formatAxisValue,
    formatExploreDelta,
    formatMetricValue,
    metricAxisLabel
  } from "./exploreCharts"
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
  import ExploreChart from "./ExploreChart.svelte"
  import TagCalendar from "./TagCalendarView.svelte"
  import ImportModal from "./ImportModal.svelte"
  import logoUrl from "../../assets/phibo-mark.svg"
  import "./shared.css"

  interface MetricSummary {
    detail: string
    label: string
    delta: string
    tone: "good" | "steady" | "watch"
    value: string
  }

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
  type DashboardView = "explore" | "insights" | "optimal" | "settings"
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
  const excludeUntaggedDaysSettingKey = "phibo.excludeUntaggedDays"
  const tagTimingModeSettingKey = "phibo.tagTimingMode"
  const showTagCountsSettingKey = "phibo.showTagCounts"
  const scoreWeekDays = 7
  const insightComparisonMetrics: Array<
    Pick<InsightComparison, "label" | "metric">
  > = [
    { label: "Sleep", metric: "sleepScore" },
    { label: "Readiness", metric: "readinessScore" },
    { label: "Activity", metric: "activityScore" }
  ]
  const exploreMetricGroups = (
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
  let selectedExploreTagCalendarRange = "last365"
  let exploreTagsInitialized = false
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
  let startDate = formatInputDate(daysAgo(30))
  let syncMessage = "Connect an Oura key or import an export to begin."
  let tagTimingMode: TagTimingMode = "morning"
  let tagEntries: TagEntryRow[] = []

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
  $: optimalDay = calculateOptimalDay(analysisDailyMetrics, effectiveTagEntries, {
    target: optimalTarget
  })
  $: optimalTargetCategories =
    optimalTargets.find((option) => option.id === optimalTarget)?.categories ??
    []
  $: availableTags = sortTagsForDisplay(getAvailableTags(effectiveTagEntries))
  $: tagNightCounts = getTagNightCounts(effectiveTagEntries)
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
  $: if (!exploreTagsInitialized && availableTags.length > 0) {
    const preferredTags = ["dark bedroom", "cool room"].filter((tag) =>
      availableTags.includes(tag)
    )
    selectedExploreTags =
      preferredTags.length > 0 ? preferredTags : availableTags.slice(0, 1)
    exploreTagsInitialized = true
  }
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
  $: scatterXExtent = metricExtent(exploreDays, selectedXMetric)
  $: scatterYExtent = metricExtent(exploreDays, selectedYMetric)
  $: timelineYExtent = metricExtent(exploreDays, selectedYMetric)
  $: scatterXTicks = createMetricTicks(
    scatterXExtent,
    selectedXDefinition,
    chartPadding,
    chartWidth - chartPadding
  )
  $: scatterYTicks = createMetricTicks(
    scatterYExtent,
    selectedYDefinition,
    chartHeight - chartPadding,
    chartPadding
  )
  $: timelineYTicks = createMetricTicks(
    timelineYExtent,
    selectedYDefinition,
    chartHeight - chartPadding,
    chartPadding
  )
  $: scatterPoints = createScatterPoints(
    exploreDays,
    selectedXMetric,
    selectedYMetric,
    scatterXExtent,
    scatterYExtent
  )
  $: timelinePoints = createTimelinePoints(
    exploreDays,
    selectedYMetric,
    timelineYExtent
  )
  $: timelineDateTicks = createTimelineDateTicks(timelinePoints)
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
  onMount(async () => {
    excludeUntaggedDays =
      localStorage.getItem(excludeUntaggedDaysSettingKey) !== "false"
    showTagCounts = localStorage.getItem(showTagCountsSettingKey) === "true"
    tagTimingMode = getSavedTagTimingMode()

    const savedToken = await db.authTokens.get("oura")
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    savedOuraToken = savedToken ?? null

    if (savedMetrics.length > 0) {
      dailyMetrics = withDerivedMetricFields(savedMetrics)
      tagEntries = savedTags
      importMessage = `Loaded ${savedMetrics.length} saved Oura days from local storage.`
      syncMessage = `Loaded ${savedMetrics.length} saved Oura days.`
    } else if (savedToken) {
      syncMessage = "Oura key is connected. Your data stays on this device."
    }
  })

  function scoreRangeTone(value: number | null) {
    if (value === null) {
      return "score-neutral"
    }

    if (value >= 85) {
      return "score-excellent"
    }

    if (value >= 78) {
      return "score-good"
    }

    if (value >= 70) {
      return "score-fair"
    }

    return "score-poor"
  }

  function formatOptimalScore(value: number | null) {
    return value === null ? "n/a" : `${Math.round(value)}`
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
      exploreTagsInitialized = false
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
    exploreTagsInitialized = false
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
        db.importRuns,
        async () => {
          await db.dailyMetrics.clear()
          await db.tagEntries.clear()
          await db.importRuns.clear()
        }
      )

      dailyMetrics = []
      tagEntries = []
      exploreTagsInitialized = false
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

    if (savedMetrics.length > 0) {
      dailyMetrics = withDerivedMetricFields(savedMetrics)
      tagEntries = savedTags
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
      tone: trendTone(trend)
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

  function trendTone(value: number | null): MetricSummary["tone"] {
    if (value === null || Math.abs(value) < 1) {
      return "steady"
    }

    return value > 0 ? "good" : "watch"
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
      on:click={() => (activeView = "insights")}
    >
      Insights
    </button>
    <button
      type="button"
      class:active={activeView === "explore"}
      on:click={() => (activeView = "explore")}
    >
      Explore
    </button>
    <button
      type="button"
      class:active={activeView === "optimal"}
      on:click={() => (activeView = "optimal")}
    >
      Optimal
    </button>
    <button
      type="button"
      class:active={activeView === "settings"}
      on:click={() => (activeView = "settings")}
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
                    on:click={() => (tagSortMode = mode.id)}
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
            <h3>Outcomes</h3>
            <div
              class:single={exploreChartMode !== "scatter"}
              class="metric-selectors"
            >
              {#if exploreChartMode === "scatter"}
                <label>
                  <span>X axis</span>
                  <select bind:value={selectedXMetric}>
                    {#each exploreMetricGroups as group}
                      <optgroup label={group.category}>
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
                    <optgroup label={group.category}>
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

        {#if selectedExploreTags.length === 0}
          <p class="empty-state">Select at least one tag to build an Explore view.</p>
        {:else if matchingExploreDays.length === 0}
          <p class="empty-state">No nights match every selected tag yet.</p>
        {:else if exploreChartMode === "scatter"}
          <ExploreChart
            mode="scatter"
            points={scatterPoints}
            xTicks={scatterXTicks}
            yTicks={scatterYTicks}
            xTitle={metricAxisLabel(selectedXDefinition)}
            yTitle={metricAxisLabel(selectedYDefinition)}
            on:selectDay={(event) => selectExploreDay(event.detail)}
            on:hover={(event) => (hoveredExploreDate = event.detail)}
          />
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
          <ExploreChart
            mode="timeline"
            points={timelinePoints}
            xTicks={timelineDateTicks}
            yTicks={timelineYTicks}
            xTitle="Date"
            yTitle={metricAxisLabel(selectedYDefinition)}
            on:selectDay={(event) => selectExploreDay(event.detail)}
            on:hover={(event) => (hoveredExploreDate = event.detail)}
          />
        {/if}

        <TagCalendar
          selectedTags={selectedExploreTags}
          calendar={exploreTagCalendar}
          options={exploreTagCalendarOptions}
          selectedRange={selectedExploreTagCalendarRange}
          on:hover={(event) => (hoveredExploreDate = event.detail)}
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
                  class:selected={activeExploreDay?.date === day.date}
                  class="log-row"
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
                on:click={() => (optimalTarget = targetOption.id)}
              >
                {targetOption.label}
              </button>
            {/each}
          </div>
        </div>

        <details class="optimal-method">
          <summary>How the estimate works</summary>
          <ul>
            <li>
              Baseline is your average score across all days; best days is the
              average of your top 10% of days.
            </li>
            <li>
              Each tag's impact compares its tagged days with your typical
              day. Only tags with at least {OPTIMAL_MIN_TAGGED_DAYS} tagged
              nights count, so one-off outliers do not skew the estimate.
            </li>
            <li>
              Tags that lift the selected target (Night = sleep + readiness)
              are combined with diminishing returns, because they often
              overlap on the same good days.
            </li>
            <li>
              The estimate flattens out as it approaches your best days — no
              tag combination can beat your actual best data.
            </li>
          </ul>
        </details>

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
                    class="bar-fill tagged"
                    style={`width: ${optimalTagBarWidth(
                      contribution.targetContribution,
                      optimalDay.contributions[0]?.targetContribution ?? 0
                    )}`}
                  />
                </div>
                <strong
                  class="optimal-tag-value {impactTone(
                    contribution.targetContribution
                  )}"
                >
                  {formatDelta(contribution.targetContribution)}
                </strong>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-state">
            {hasLocalData
              ? `No tag with ${OPTIMAL_MIN_TAGGED_DAYS}+ tagged nights lifts this target yet. Keep tagging to unlock your optimal day.`
              : "Import your Oura data to see your optimal day."}
          </p>
        {/if}
      </div>
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

  .metric-card.good {
    border-top: 4px solid #4f8a63;
  }

  .metric-card.steady {
    border-top: 4px solid #587a96;
  }

  .metric-card.watch {
    border-top: 4px solid #a96745;
  }

  .metric-card.dimmed {
    opacity: 0.55;
  }

  .metric-card.score-excellent {
    border-top: 4px solid #1e2c64;
  }

  .metric-card.score-excellent strong {
    color: #1e2c64;
  }

  .metric-card.score-good {
    border-top: 4px solid #4f8a63;
  }

  .metric-card.score-good strong {
    color: #3f7b54;
  }

  .metric-card.score-fair {
    border-top: 4px solid #b46b3f;
  }

  .metric-card.score-fair strong {
    color: #b46b3f;
  }

  .metric-card.score-poor {
    border-top: 4px solid #a8423e;
  }

  .metric-card.score-poor strong {
    color: #a8423e;
  }

  .metric-card.score-neutral {
    border-top: 4px solid #587a96;
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

  .setting-summary span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
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
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    background: #fbf7ef;
    color: #17201b;
    font: inherit;
    min-width: 0;
    padding: 0.65rem 0.7rem;
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
    background: #3f7b54;
  }

  .impact-fill.neutral {
    background: #17201b;
  }

  .impact-fill.warning {
    background: #b46b3f;
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
    min-height: 44px;
    padding: 0.5rem 0;
    text-align: left;
  }

  button.log-row {
    cursor: pointer;
  }

  button.log-row:hover,
  button.log-row.selected {
    background: rgba(255, 252, 246, 0.58);
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
    color: #3f7b54;
  }

  .score-impact.neutral b {
    color: #17201b;
  }

  .score-impact.warning b {
    color: #b46b3f;
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
    grid-template-columns: minmax(0, 1.25fr) minmax(120px, 1fr) 58px;
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
    color: #3f7b54;
  }

  .optimal-tag-value.neutral {
    color: #17201b;
  }

  .optimal-tag-value.warning {
    color: #b46b3f;
  }

  .optimal-tag-value.negative {
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
      grid-template-columns: minmax(0, 1fr) 52px;
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
