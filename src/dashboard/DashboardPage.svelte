<script lang="ts">
  import { onMount } from "svelte"
  import {
    buildExploreDays,
    calculateExploreMetricImpacts,
    calculateTagCorrelations,
    exploreMetricDefinitions,
    getAvailableTags,
    getExploreMetric,
    getRankedTagInsights,
    getTagDiscoveries,
    type ExploreDay,
    type ExploreMetricCategory,
    type ExploreMetricDefinition,
    type ExploreMetricImpact,
    type ExploreMetricKey,
    type PrimaryInsightMetric,
    type TagInsight
  } from "../lib/analysis/correlations"
  import { db } from "../lib/db"
  import type { AuthTokenRow, DailyMetricRow } from "../lib/db/types"
  import { OuraApiError, validateOuraToken } from "../lib/oura/client"
  import { importOuraFiles, OuraImportError } from "../lib/oura/import"
  import {
    sampleDailyMetrics,
    sampleTagEntries
  } from "../lib/oura/sampleData"
  import { syncOuraRange } from "../lib/oura/sync"
  import logoUrl from "../../assets/phibo-mark.svg"

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
  type DashboardView = "explore" | "insights" | "settings"
  type InsightComparisonMetric = keyof Pick<
    DailyMetricRow,
    "activityScore" | "readinessScore" | "sleepScore"
  >

  interface ChartPoint {
    day: ExploreDay
    x: number
    y: number
  }

  interface ChartTick {
    label: string
    position: number
  }

  interface ExploreImpactGroup {
    category: ExploreMetricCategory
    rows: ExploreMetricImpact[]
    strongest: ExploreMetricImpact | null
  }

  interface ExploreTagCalendarCell {
    date: string | null
    day: ExploreDay | null
    taggedTags: string[]
  }

  interface ExploreTagCalendar {
    monthLabels: string[]
    rangeLabel: string
    rows: ExploreTagCalendarWeekdayRow[]
    taggedDayCount: number
  }

  interface ExploreTagCalendarOption {
    id: string
    label: string
  }

  interface ExploreTagCalendarRange {
    firstDate: Date
    lastDate: Date
    label: string
  }

  interface ExploreTagCalendarWeekdayRow {
    cells: ExploreTagCalendarCell[]
    label: string
  }

  const chartWidth = 640
  const chartHeight = 320
  const chartModes: ChartMode[] = ["impact", "scatter", "timeline"]
  const chartPadding = 56
  const excludeUntaggedDaysSettingKey = "phibo.excludeUntaggedDays"
  const exploreImpactCategoryOrder: ExploreMetricCategory[] = [
    "Sleep",
    "Readiness",
    "Activity"
  ]
  const calendarWeekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const tagCalendarDays = 365
  const tagCalendarSquareSize = "0.72rem"
  const scoreWeekDays = 7
  const displayTagLabels = new Map([
    ["slept alone", "Sleep Solo"],
    ["sunrise exposure", "Morning Sunlight"],
    ["sunset exposure", "Evening Sunlight"]
  ])
  const insightComparisonMetrics: Array<
    Pick<InsightComparison, "label" | "metric">
  > = [
    { label: "Sleep", metric: "sleepScore" },
    { label: "Readiness", metric: "readinessScore" },
    { label: "Activity", metric: "activityScore" }
  ]

  let accessToken = ""
  let activeView: DashboardView = "insights"
  let exploreChartMode: ChartMode = "impact"
  let selectedExploreTagCalendarRange = "last365"
  let exploreTagsInitialized = false
  let excludeUntaggedDays = true
  let openExploreImpactCategories: ExploreMetricCategory[] = [
    "Sleep",
    "Readiness",
    "Activity"
  ]
  let hoveredExploreDate = ""
  let dailyMetrics = sampleDailyMetrics
  let endDate = formatInputDate(new Date())
  let importFileInput: HTMLInputElement | null = null
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
  let syncMessage = "Sample data is showing until your first sync."
  let tagEntries = sampleTagEntries

  $: hasLocalData = dailyMetrics !== sampleDailyMetrics
  $: taggedMetricDates = getTaggedMetricDates(tagEntries)
  $: analysisDailyMetrics = excludeUntaggedDays
    ? dailyMetrics.filter((day) => taggedMetricDates.has(day.date))
    : dailyMetrics
  $: excludedUntaggedDayCount = dailyMetrics.length - analysisDailyMetrics.length
  $: correlations = calculateTagCorrelations(analysisDailyMetrics, tagEntries)
  $: availableTags = sortTagsForDisplay(getAvailableTags(tagEntries))
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
    tagEntries,
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
    tagEntries,
    selectedExploreTags
  ).filter((row) => !isPrimaryScoreMetric(row.metric.key))
  $: groupedExploreImpacts = groupExploreImpacts(exploreImpacts)
  $: matchingExploreDays = exploreDays.filter((day) => day.matches)
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
  $: discoveries = getTagDiscoveries(tagEntries, latestMetricDate)
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

    const savedToken = await db.authTokens.get("oura")
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    savedOuraToken = savedToken ?? null

    if (savedMetrics.length > 0) {
      dailyMetrics = savedMetrics
      tagEntries = savedTags
      importMessage = `Loaded ${savedMetrics.length} saved Oura days from local storage.`
      syncMessage = `Loaded ${savedMetrics.length} saved Oura days.`
    } else if (savedToken) {
      syncMessage = "Oura key is connected. Your data stays on this device."
    }
  })

  async function handleOuraFileInput(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    await importFiles(Array.from(input.files ?? []))
    input.value = ""
  }

  function openImportModal() {
    isImportModalOpen = true
  }

  function closeImportModal() {
    isImportModalOpen = false
  }

  async function handleImportDrop(event: DragEvent) {
    await importFiles(Array.from(event.dataTransfer?.files ?? []))
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
      const skippedText =
        result.skippedFiles > 0 || result.unsupportedFiles > 0
          ? ` Skipped ${result.skippedFiles + result.unsupportedFiles} files Phibo could not import.`
          : ""
      importMessage =
        result.tagEntries.length > 0
          ? `Imported ${result.dailyMetrics.length} days and ${result.tagEntries.length} tags from ${result.filesImported} Oura files.${skippedText}`
          : `Imported ${result.dailyMetrics.length} days. No tags were found in this export; existing local tags remain available.${skippedText}`
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
      : "Sample data is showing until your first sync."
  }

  function updateExcludeUntaggedDays(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    excludeUntaggedDays = input.checked
    localStorage.setItem(excludeUntaggedDaysSettingKey, `${excludeUntaggedDays}`)
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

  async function loadLocalOuraData() {
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    if (savedMetrics.length > 0) {
      dailyMetrics = savedMetrics
      tagEntries = savedTags
    }
  }

  function formatConnectionDate(value: string | null | undefined) {
    if (!value) {
      return "Not yet"
    }

    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short"
    }).format(new Date(value))
  }

  function formatDelta(value: number) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`
  }

  function formatInsightDelta(item: TagInsight) {
    return `${metricLabel(item.metric)} ${formatDelta(item.delta)}`
  }

  function formatNullableDelta(value: number | null, suffix = "") {
    return value === null ? "n/a" : `${formatDelta(value)}${suffix}`
  }

  function formatComparisonAverage(value: number | null) {
    return value === null ? "n/a" : `${Math.round(value)}`
  }

  function formatDate(date: string) {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short"
    }).format(new Date(`${date}T12:00:00`))
  }

  function formatFullDate(date: string) {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(`${date}T12:00:00`))
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

  function formatScoreTrend(value: number | null) {
    if (value === null) {
      return "needs last week"
    }

    if (Math.abs(value) < 0.1) {
      return "same as last week"
    }

    return `${Math.abs(value).toFixed(1)} ${value > 0 ? "higher" : "lower"} than last week`
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
          }
        ] as const).map((stat) => ({
          helper: stat.helper,
          label: stat.label,
          unit: stat.unit,
          value: formatMetricDelta(correlation.deltas[stat.metric])
        }))
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

  function createScatterPoints(
    days: ExploreDay[],
    xMetric: ExploreMetricKey,
    yMetric: ExploreMetricKey,
    xExtent: readonly [number, number],
    yExtent: readonly [number, number]
  ): ChartPoint[] {
    return days
      .filter(
        (day) => day.metric[xMetric] != null && day.metric[yMetric] != null
      )
      .map((day) => ({
        day,
        x: scaleNumber(
          day.metric[xMetric] ?? 0,
          xExtent,
          chartPadding,
          chartWidth - chartPadding
        ),
        y: scaleNumber(
          day.metric[yMetric] ?? 0,
          yExtent,
          chartHeight - chartPadding,
          chartPadding
        )
      }))
  }

  function createTimelinePoints(
    days: ExploreDay[],
    metric: ExploreMetricKey,
    yExtent: readonly [number, number]
  ): ChartPoint[] {
    const usableDays = days.filter((day) => day.metric[metric] != null)
    const xStep =
      usableDays.length <= 1
        ? 0
        : (chartWidth - chartPadding * 2) / (usableDays.length - 1)

    return usableDays.map((day, index) => ({
      day,
      x: chartPadding + xStep * index,
      y: scaleNumber(
        day.metric[metric] ?? 0,
        yExtent,
        chartHeight - chartPadding,
        chartPadding
      )
    }))
  }

  function createMetricTicks(
    extent: readonly [number, number],
    metric: ExploreMetricDefinition,
    outputMin: number,
    outputMax: number
  ): ChartTick[] {
    const [min, max] = extent

    return [min, (min + max) / 2, max].map((value) => ({
      label: formatAxisValue(value, metric),
      position: scaleNumber(value, extent, outputMin, outputMax)
    }))
  }

  function createTimelineDateTicks(points: ChartPoint[]): ChartTick[] {
    if (points.length === 0) {
      return []
    }

    const indexes = Array.from(
      new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])
    )

    return indexes.map((index) => ({
      label: formatDate(points[index].day.date),
      position: points[index].x
    }))
  }

  function metricAxisLabel(metric: ExploreMetricDefinition) {
    return metric.unit === "pts" ? metric.label : `${metric.label} (${metric.unit})`
  }

  function formatAxisValue(value: number, metric: ExploreMetricDefinition) {
    if (Math.abs(value) >= 1000) {
      return `${Math.round(value / 100) / 10}k`
    }

    if (metric.unit === "MET" || metric.unit === "br/min") {
      return value.toFixed(1)
    }

    return `${Math.round(value)}`
  }

  function formatAverage(
    value: number | null,
    metric: ExploreMetricDefinition
  ) {
    return value === null ? "n/a" : formatMetricValue(value, metric)
  }

  function formatExploreDelta(row: ExploreMetricImpact) {
    if (row.delta === null) {
      return "n/a"
    }

    return `${formatDelta(row.delta)} ${row.metric.unit}`
  }

  function formatTagLabel(tag: string) {
    const trimmedTag = tag.trim()

    if (trimmedTag.length === 0) {
      return tag
    }

    const displayLabel = displayTagLabels.get(trimmedTag.toLocaleLowerCase())

    if (displayLabel) {
      return displayLabel
    }

    return `${trimmedTag[0].toLocaleUpperCase()}${trimmedTag.slice(1)}`
  }

  function formatTagList(tags: string[], separator = ", ") {
    return sortTagsForDisplay(tags).map(formatTagLabel).join(separator)
  }

  function sortTagsForDisplay(tags: string[]) {
    return [...tags].sort((left, right) => {
      const displayComparison = formatTagLabel(left).localeCompare(
        formatTagLabel(right),
        undefined,
        { sensitivity: "base" }
      )

      return displayComparison || left.localeCompare(right)
    })
  }

  function formatMetricDelta(value: number | null) {
    return value === null ? "n/a" : formatDelta(value)
  }

  function formatMetricValue(
    value: number | null,
    metric: ExploreMetricDefinition
  ) {
    if (value === null) {
      return "n/a"
    }

    const rounded =
      Number.isInteger(value) || Math.abs(value) >= 10
        ? `${Math.round(value)}`
        : value.toFixed(1)

    return metric.unit === "pts" ? rounded : `${rounded} ${metric.unit}`
  }

  function average(values: Array<number | null | undefined>) {
    const usableValues = values.filter((value): value is number => value != null)

    if (usableValues.length === 0) {
      return null
    }

    return (
      usableValues.reduce((total, value) => total + value, 0) /
      usableValues.length
    )
  }

  function comparisonWidth(value: number | null) {
    return `${Math.max(0, Math.min(value ?? 0, 100))}%`
  }

  function detailTags(day: ExploreDay | undefined) {
    if (!day) {
      return "No day selected"
    }

    return day.tags.length > 0 ? formatTagList(day.tags) : "No tags"
  }

  function buildExploreTagCalendar(
    days: ExploreDay[],
    selectedTags: string[],
    selectedRangeId: string
  ): ExploreTagCalendar {
    const sortedTags = sortTagsForDisplay(selectedTags)
    const sortedDays = [...days].sort((left, right) =>
      left.date.localeCompare(right.date)
    )
    const selectedRange = getExploreTagCalendarRange(
      sortedDays,
      selectedRangeId
    )

    if (!selectedRange) {
      return {
        monthLabels: [],
        rangeLabel: "Last 365 days",
        rows: calendarWeekdayLabels.map((label) => ({
          cells: [],
          label
        })),
        taggedDayCount: 0
      }
    }

    const daysByDate = new Map(sortedDays.map((day) => [day.date, day]))
    const cells: ExploreTagCalendarCell[] = []
    const date = new Date(selectedRange.firstDate)

    while (date <= selectedRange.lastDate) {
      const formattedDate = formatInputDate(date)
      const day = daysByDate.get(formattedDate) ?? null

      cells.push({
        date: formattedDate,
        day,
        taggedTags: day
          ? sortedTags.filter((tag) => day.tags.includes(tag))
          : []
      })

      date.setDate(date.getDate() + 1)
    }

    if (cells.length === 0) {
      return {
        monthLabels: [],
        rangeLabel: selectedRange.label,
        rows: calendarWeekdayLabels.map((label) => ({
          cells: [],
          label
        })),
        taggedDayCount: 0
      }
    }

    const leadingEmptyDays = calendarWeekdayIndex(cells[0].date)
    const paddedCells = [
      ...Array.from({ length: leadingEmptyDays }, (): ExploreTagCalendarCell => ({
        date: null,
        day: null,
        taggedTags: []
      })),
      ...cells
    ]
    const trailingEmptyDays =
      paddedCells.length === 0 ? 0 : (7 - (paddedCells.length % 7)) % 7

    paddedCells.push(
      ...Array.from({ length: trailingEmptyDays }, (): ExploreTagCalendarCell => ({
        date: null,
        day: null,
        taggedTags: []
      }))
    )

    const weeks = Array.from(
      { length: Math.ceil(paddedCells.length / 7) },
      (_, index) => paddedCells.slice(index * 7, index * 7 + 7)
    )

    return {
      monthLabels: weeks.map((week) => calendarWeekMonthLabel(week)),
      rangeLabel: selectedRange.label,
      rows: calendarWeekdayLabels.map((label, weekdayIndex) => ({
        cells: weeks.map((week) => week[weekdayIndex]),
        label
      })),
      taggedDayCount: cells.filter((cell) => cell.taggedTags.length > 0).length
    }
  }

  function buildExploreTagCalendarOptions(
    days: ExploreDay[]
  ): ExploreTagCalendarOption[] {
    const years = Array.from(
      new Set(days.map((day) => day.date.slice(0, 4)))
    ).sort((left, right) => Number(right) - Number(left))

    return [
      {
        id: "last365",
        label: "Last 365"
      },
      ...years.map((year) => ({
        id: `year:${year}`,
        label: year
      }))
    ]
  }

  function getExploreTagCalendarRange(
    sortedDays: ExploreDay[],
    selectedRangeId: string
  ): ExploreTagCalendarRange | null {
    const selectedYear = selectedRangeId.startsWith("year:")
      ? Number(selectedRangeId.slice(5))
      : null

    if (selectedYear && Number.isFinite(selectedYear)) {
      return {
        firstDate: calendarDateAtNoon(`${selectedYear}-01-01`),
        lastDate: calendarDateAtNoon(`${selectedYear}-12-31`),
        label: String(selectedYear)
      }
    }

    const latestDay = sortedDays[sortedDays.length - 1]

    if (!latestDay) {
      return null
    }

    const lastDate = calendarDateAtNoon(latestDay.date)
    const firstDate = new Date(lastDate)
    firstDate.setDate(lastDate.getDate() - tagCalendarDays + 1)

    return {
      firstDate,
      lastDate,
      label: "Last 365 days"
    }
  }

  function calendarDateAtNoon(date: string) {
    return new Date(`${date}T12:00:00`)
  }

  function calendarWeekdayIndex(date: string) {
    return (calendarDateAtNoon(date).getDay() + 6) % 7
  }

  function calendarWeekMonthLabel(week: ExploreTagCalendarCell[]) {
    const firstMonthDate = week.find((cell) => cell.date?.endsWith("-01"))?.date

    return firstMonthDate ? formatMonth(firstMonthDate) : ""
  }

  function formatMonth(date: string) {
    return new Intl.DateTimeFormat("en", {
      month: "short"
    }).format(new Date(`${date}T12:00:00`))
  }

  function tagCalendarCellLabel(cell: ExploreTagCalendarCell) {
    if (!cell.date) {
      return "No date"
    }

    const tagText =
      cell.taggedTags.length > 0
        ? formatTagList(cell.taggedTags)
        : "No selected tags"

    return `${formatFullDate(cell.date)} - ${tagText}`
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
    const currentTagsByDate = buildTagsByDate(tagEntries)
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

  function isPrimaryScoreMetric(metric: ExploreMetricKey) {
    return (
      metric === "activityScore" ||
      metric === "readinessScore" ||
      metric === "sleepScore"
    )
  }

  function insightKey(item: TagInsight) {
    return `${item.tag}-${item.metric}`
  }

  function impactTone(value: number | null) {
    if (value === null || Math.abs(value) <= 0.5) {
      return "neutral"
    }

    if (value >= 2) {
      return "excellent"
    }

    if (value > 0.5) {
      return "positive"
    }

    if (value <= -2) {
      return "negative"
    }

    return "warning"
  }

  function impactWidth(row: ExploreMetricImpact) {
    const maxDelta = Math.max(
      ...exploreImpacts.map((impact) => Math.abs(impact.delta ?? 0)),
      1
    )

    return `${Math.min((Math.abs(row.delta ?? 0) / maxDelta) * 100, 100)}%`
  }

  function groupExploreImpacts(rows: ExploreMetricImpact[]): ExploreImpactGroup[] {
    return exploreImpactCategoryOrder
      .map((category) => {
        const categoryRows = rows.filter((row) => row.metric.category === category)

        return {
          category,
          rows: categoryRows,
          strongest: strongestExploreImpact(categoryRows)
        }
      })
      .filter((group) => group.rows.length > 0)
  }

  function strongestExploreImpact(rows: ExploreMetricImpact[]) {
    return rows.reduce<ExploreMetricImpact | null>((strongest, row) => {
      if (row.delta === null) {
        return strongest
      }

      if (strongest === null) {
        return row
      }

      const rowImpact = Math.abs(row.toneDelta ?? row.delta)
      const strongestImpact = Math.abs(strongest.toneDelta ?? strongest.delta ?? 0)

      return rowImpact > strongestImpact ? row : strongest
    }, null)
  }

  function impactGroupTone(group: ExploreImpactGroup) {
    return impactTone(group.strongest?.toneDelta ?? null)
  }

  function impactGroupDelta(group: ExploreImpactGroup) {
    return group.strongest ? formatExploreDelta(group.strongest) : "n/a"
  }

  function impactGroupDeltaLabel(group: ExploreImpactGroup) {
    return group.strongest?.metric.label ?? "Strongest"
  }

  function impactGroupMetricCount(group: ExploreImpactGroup) {
    return `${group.rows.length} ${group.rows.length === 1 ? "metric" : "metrics"}`
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

  function metricExtent(days: ExploreDay[], metric: ExploreMetricKey) {
    const values = days
      .map((day) => day.metric[metric])
      .filter((value): value is number => value !== null)

    if (values.length === 0) {
      return [0, 1] as const
    }

    const min = Math.min(...values)
    const max = Math.max(...values)

    if (min === max) {
      return [min - 1, max + 1] as const
    }

    const padding = (max - min) * 0.08

    return [min - padding, max + padding] as const
  }

  function scaleNumber(
    value: number,
    extent: readonly [number, number],
    outputMin: number,
    outputMax: number
  ) {
    const [inputMin, inputMax] = extent

    return (
      outputMin +
      ((value - inputMin) / (inputMax - inputMin)) * (outputMax - outputMin)
    )
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

  function timelinePath(points: ChartPoint[]) {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ")
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

  function metricLabel(metric: PrimaryInsightMetric) {
    return metric === "sleepScore" ? "Sleep" : "Readiness"
  }

  function metricPlainLabel(metric: PrimaryInsightMetric) {
    return metric === "sleepScore" ? "sleep score" : "readiness"
  }

  function selectInsight(item: TagInsight) {
    selectedInsightKey = insightKey(item)
  }

  function daysAgo(days: number) {
    const date = new Date()
    date.setDate(date.getDate() - days)

    return date
  }

  function formatInputDate(date: Date) {
    return date.toISOString().slice(0, 10)
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
      class:active={activeView === "settings"}
      on:click={() => (activeView = "settings")}
    >
      Settings
    </button>
  </nav>

  {#if isImportModalOpen}
    <div
      class="modal-backdrop"
      role="presentation"
      on:click={closeImportModal}
    >
      <section
        class="import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        on:click|stopPropagation
      >
        <div class="modal-header">
          <div>
            <p class="section-kicker">{hasLocalData ? "Local data" : "Private import"}</p>
            <h2 id="import-modal-title">Import Oura data</h2>
          </div>
          <button type="button" class="modal-close" on:click={closeImportModal}>
            Close
          </button>
        </div>

        <div class="modal-grid">
          <section class="modal-instructions">
            <p>
              Download your Oura personal data export, then import it here. Files are read locally and never uploaded.
            </p>
            <ol class="import-steps">
              <li>
                Open
                <a href="https://membership.ouraring.com" target="_blank" rel="noreferrer">
                  Oura Membership Hub
                </a>
              </li>
              <li>Choose Export data, request your data, then download the export.</li>
              <li>Import the ZIP, JSON, or CSV files into Phibo.</li>
            </ol>
          </section>

          <div
            class="import-panel"
            on:dragover|preventDefault
            on:drop|preventDefault={handleImportDrop}
          >
            <input
              bind:this={importFileInput}
              class="file-input"
              type="file"
              accept=".zip,.json,.csv"
              multiple
              on:change={handleOuraFileInput}
            />
            <div>
              <strong>{isImporting ? "Importing Oura export" : "Drop Oura export here"}</strong>
              <span>Supports the Oura ZIP or CSVs like dailysleep, dailyreadiness, dailyactivity, and enhancedtag.</span>
            </div>
            <button type="button" on:click={() => importFileInput?.click()} disabled={isImporting}>
              {isImporting ? "Reading files" : "Choose files"}
            </button>
            <p>{importMessage}</p>
          </div>
        </div>

        <details class="advanced-sync" open={isOuraConnected || isEditingToken}>
          <summary>Automatic sync with Oura key</summary>
          <div class="sync-strip compact">
            <div>
              <p class="section-kicker">{isOuraConnected ? "Connected locally" : "Optional"}</p>
              <h2>{isOuraConnected ? "Oura key saved on this device" : "Connect with your Oura key"}</h2>
              <p class="privacy-note">
                Automatic sync stores your key locally. Import is the recommended path if you prefer not to grant API access.
              </p>
            </div>
            {#if isOuraConnected && savedOuraToken}
              <div class="connection-panel">
                <div class="connection-status">
                  <div>
                    <span>Saved key</span>
                    <strong aria-label="Oura key is hidden">•••• •••• ••••</strong>
                  </div>
                  <div>
                    <span>Validated</span>
                    <strong>{formatConnectionDate(savedOuraToken.lastValidatedAt)}</strong>
                  </div>
                  <div>
                    <span>Last synced</span>
                    <strong>{formatConnectionDate(savedOuraToken.lastSyncedAt)}</strong>
                  </div>
                </div>
                <form class="sync-form connected" on:submit|preventDefault={syncData}>
                  <label>
                    <span>Start</span>
                    <input bind:value={startDate} type="date" />
                  </label>
                  <label>
                    <span>End</span>
                    <input bind:value={endDate} type="date" />
                  </label>
                  <div class="connection-actions">
                    <button type="submit" disabled={isSyncing}>
                      {isSyncing ? "Syncing" : "Sync data"}
                    </button>
                    <button type="button" class="secondary" on:click={changeOuraToken}>
                      Change key
                    </button>
                    <button type="button" class="danger" on:click={disconnectOura}>
                      Disconnect
                    </button>
                  </div>
                  <p>{syncMessage}</p>
                </form>
              </div>
            {:else}
              <form class="sync-form" on:submit|preventDefault={connectAndSyncData}>
                <label>
                  <span>Oura key</span>
                  <input
                    bind:value={accessToken}
                    type="password"
                    autocomplete="off"
                    placeholder="Paste Oura personal access token"
                  />
                </label>
                <label>
                  <span>Start</span>
                  <input bind:value={startDate} type="date" />
                </label>
                <label>
                  <span>End</span>
                  <input bind:value={endDate} type="date" />
                </label>
                <div class="connection-actions">
                  <button type="submit" disabled={isSyncing}>
                    {isSyncing ? "Connecting" : "Connect & sync"}
                  </button>
                  {#if savedOuraToken}
                    <button type="button" class="secondary" on:click={cancelTokenChange}>
                      Cancel
                    </button>
                  {/if}
                  <a
                    href="https://cloud.ouraring.com/personal-access-tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Oura keys
                  </a>
                </div>
                <p class="key-help">
                  Find or create your key in
                  <a
                    href="https://cloud.ouraring.com/personal-access-tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Oura Cloud Personal Access Tokens
                  </a>
                  and enable daily and tag access.
                </p>
                <p>{syncMessage}</p>
              </form>
            {/if}
          </div>
        </details>
      </section>
    </div>
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
            <h3>Tags</h3>
            <div class="tag-picker">
              {#each availableTags as tag}
                <button
                  type="button"
                  class:active={selectedExploreTags.includes(tag)}
                  on:click={() => toggleExploreTag(tag)}
                >
                  {formatTagLabel(tag)}
                </button>
              {:else}
                <p class="empty-state">Sync or add tags to explore patterns.</p>
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
                    {#each exploreMetricDefinitions as metric}
                      <option value={metric.key}>{metric.label}</option>
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
                  {#each exploreMetricDefinitions as metric}
                    <option value={metric.key}>{metric.label}</option>
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
          <div class="svg-chart">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
              {#each scatterYTicks as tick}
                <line
                  class="tick-line"
                  x1={chartPadding}
                  x2={chartWidth - chartPadding}
                  y1={tick.position}
                  y2={tick.position}
                />
                <text class="axis-tick y" x={chartPadding - 10} y={tick.position}>
                  {tick.label}
                </text>
              {/each}
              {#each scatterXTicks as tick}
                <line
                  class="tick-line"
                  x1={tick.position}
                  x2={tick.position}
                  y1={chartPadding}
                  y2={chartHeight - chartPadding}
                />
                <text
                  class="axis-tick x"
                  x={tick.position}
                  y={chartHeight - chartPadding + 20}
                >
                  {tick.label}
                </text>
              {/each}
              <line
                class="axis-line"
                x1={chartPadding}
                x2={chartPadding}
                y1={chartPadding}
                y2={chartHeight - chartPadding}
              />
              <line
                class="axis-line"
                x1={chartPadding}
                x2={chartWidth - chartPadding}
                y1={chartHeight - chartPadding}
                y2={chartHeight - chartPadding}
              />
              {#each scatterPoints as point}
                <circle
                  class:match={point.day.matches}
                  class="scatter-point"
                  cx={point.x}
                  cy={point.y}
                  r={point.day.matches ? 8 : 5}
                  on:mouseenter={() => (hoveredExploreDate = point.day.date)}
                  on:mouseleave={() => (hoveredExploreDate = "")}
                  on:click={() => selectExploreDay(point.day)}
                />
              {/each}
              <text class="axis-title x" x={chartWidth / 2} y={chartHeight - 8}>
                {metricAxisLabel(selectedXDefinition)}
              </text>
              <text
                class="axis-title y"
                transform={`translate(14 ${chartHeight / 2}) rotate(-90)`}
              >
                {metricAxisLabel(selectedYDefinition)}
              </text>
            </svg>
          </div>
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
                  <span class="score-impact {impactGroupTone(group)}">
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
                        <strong class="score-impact {impactTone(row.toneDelta)}">
                          <b>{formatExploreDelta(row)}</b>
                        </strong>
                      </div>
                      <div class="impact-bar">
                        <span
                          class="impact-fill {impactTone(row.toneDelta)}"
                          style={`width: ${impactWidth(row)}`}
                        />
                      </div>
                    </article>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        {:else}
          <div class="svg-chart">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
              {#each timelineYTicks as tick}
                <line
                  class="tick-line"
                  x1={chartPadding}
                  x2={chartWidth - chartPadding}
                  y1={tick.position}
                  y2={tick.position}
                />
                <text class="axis-tick y" x={chartPadding - 10} y={tick.position}>
                  {tick.label}
                </text>
              {/each}
              {#each timelineDateTicks as tick}
                <line
                  class="tick-line"
                  x1={tick.position}
                  x2={tick.position}
                  y1={chartPadding}
                  y2={chartHeight - chartPadding}
                />
                <text
                  class="axis-tick x"
                  x={tick.position}
                  y={chartHeight - chartPadding + 20}
                >
                  {tick.label}
                </text>
              {/each}
              <line
                class="axis-line"
                x1={chartPadding}
                x2={chartPadding}
                y1={chartPadding}
                y2={chartHeight - chartPadding}
              />
              <line
                class="axis-line"
                x1={chartPadding}
                x2={chartWidth - chartPadding}
                y1={chartHeight - chartPadding}
                y2={chartHeight - chartPadding}
              />
              <path class="timeline-line" d={timelinePath(timelinePoints)} />
              {#each timelinePoints as point}
                <circle
                  class:match={point.day.matches}
                  class="scatter-point"
                  cx={point.x}
                  cy={point.y}
                  r={point.day.matches ? 7 : 4}
                  on:mouseenter={() => (hoveredExploreDate = point.day.date)}
                  on:mouseleave={() => (hoveredExploreDate = "")}
                  on:click={() => selectExploreDay(point.day)}
                />
              {/each}
              <text class="axis-title x" x={chartWidth / 2} y={chartHeight - 8}>
                Date
              </text>
              <text
                class="axis-title y"
                transform={`translate(14 ${chartHeight / 2}) rotate(-90)`}
              >
                {metricAxisLabel(selectedYDefinition)}
              </text>
            </svg>
          </div>
        {/if}

        <div class="tag-calendar-section">
          <div class="tag-calendar-heading">
            <div>
              <p class="section-kicker">Tag activity</p>
              <h3>
                {selectedExploreTags.length > 0
                  ? formatTagList(selectedExploreTags, " + ")
                  : "Choose tags"}
              </h3>
            </div>
            <div class="tag-calendar-range">
              <div class="tag-calendar-range-meta">
                <strong>{exploreTagCalendar.rangeLabel}</strong>
                <span>{exploreTagCalendar.taggedDayCount} tagged nights</span>
              </div>
              <div
                class="tag-calendar-range-actions"
                aria-label="Tag activity date range"
              >
                {#each exploreTagCalendarOptions as option}
                  <button
                    type="button"
                    class:active={selectedExploreTagCalendarRange === option.id}
                    aria-pressed={selectedExploreTagCalendarRange === option.id}
                    on:click={() =>
                      (selectedExploreTagCalendarRange = option.id)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            </div>
          </div>

          {#if selectedExploreTags.length === 0}
            <p class="empty-state">Select tags to see their daily activity.</p>
          {:else}
            <div class="tag-calendar" aria-label="Selected tag activity by day">
              <span aria-hidden="true" />
              <div
                class="tag-calendar-months"
                style={`grid-template-columns: repeat(${exploreTagCalendar.monthLabels.length}, ${tagCalendarSquareSize});`}
              >
                {#each exploreTagCalendar.monthLabels as month}
                  <span>{month}</span>
                {/each}
              </div>
              {#each exploreTagCalendar.rows as row}
                <span class="tag-calendar-weekday">{row.label}</span>
                <div
                  class="tag-calendar-days"
                  style={`grid-template-columns: repeat(${row.cells.length}, ${tagCalendarSquareSize});`}
                >
                  {#each row.cells as cell}
                    {#if cell.day}
                      <button
                        type="button"
                        class:tagged={cell.taggedTags.length > 0}
                        class:selected={activeExploreDay?.date === cell.day.date}
                        class="tag-calendar-day"
                        aria-label={tagCalendarCellLabel(cell)}
                        title={tagCalendarCellLabel(cell)}
                        on:mouseenter={() => (hoveredExploreDate = cell.day.date)}
                        on:mouseleave={() => (hoveredExploreDate = "")}
                        on:click={() => selectExploreDay(cell.day)}
                      />
                    {:else if cell.date}
                      <span
                        class="tag-calendar-day no-data"
                        aria-label={tagCalendarCellLabel(cell)}
                        title={tagCalendarCellLabel(cell)}
                      />
                    {:else}
                      <span class="tag-calendar-day empty" aria-hidden="true" />
                    {/if}
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </div>

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
                  <strong>{formatFullDate(day.date)}</strong>
                  <span>{detailTags(day)}</span>
                </button>
              {/each}
            </div>
          </section>
        </div>
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

        <div class="setting-summary">
          <span>Current sample</span>
          <strong>{analysisDailyMetrics.length} of {dailyMetrics.length} days</strong>
          <p>
            {excludeUntaggedDays
              ? `${excludedUntaggedDayCount} untagged days excluded.`
              : "All imported days included."}
          </p>
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
  .sync-strip,
  .explore-workspace,
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
  .section-kicker {
    margin: 0;
    color: #6f786f;
    font-size: 0.75rem;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1,
  h2,
  h3,
  h4,
  p {
    margin: 0;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3.4rem);
    line-height: 0.98;
  }

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

  h2 {
    font-size: 1.1rem;
    line-height: 1.2;
  }

  h3 {
    font-size: 1rem;
    line-height: 1.25;
  }

  h4 {
    font-size: 0.95rem;
    line-height: 1.25;
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

  .sync-strip {
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1.15fr);
    gap: 1rem;
  }

  .modal-backdrop {
    align-items: center;
    background: rgba(23, 32, 27, 0.42);
    display: grid;
    inset: 0;
    justify-items: center;
    padding: 1.2rem;
    position: fixed;
    z-index: 20;
  }

  .import-modal {
    background: #fbf7ef;
    border: 1px solid #d3d5c8;
    border-radius: 8px;
    box-shadow: 0 24px 80px rgba(23, 32, 27, 0.22);
    box-sizing: border-box;
    display: grid;
    gap: 1rem;
    max-height: calc(100vh - 2.4rem);
    max-width: 920px;
    overflow: auto;
    padding: 1rem;
    width: min(920px, 100%);
  }

  .modal-header {
    align-items: flex-start;
    border-bottom: 1px solid #d8d8cc;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding-bottom: 0.85rem;
  }

  .modal-close {
    appearance: none;
    background: #f7f1e8;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    color: #17201b;
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    min-height: 38px;
    padding: 0.5rem 0.72rem;
  }

  .modal-grid {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(230px, 0.78fr) minmax(320px, 1.22fr);
    gap: 0.85rem;
  }

  .modal-instructions {
    display: grid;
    align-content: start;
    gap: 0.55rem;
  }

  .modal-instructions > p {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .sync-strip.compact {
    border-top: 1px solid #d8d8cc;
    padding-top: 1rem;
  }

  .privacy-note {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
    margin-top: 0.45rem;
    max-width: 34rem;
  }

  .import-steps {
    color: #566157;
    display: grid;
    gap: 0.32rem;
    font-size: 0.9rem;
    line-height: 1.45;
    margin: 0.7rem 0 0;
    padding-left: 1.25rem;
  }

  .import-steps a,
  .key-help a {
    color: #263f6f;
    font-weight: 800;
  }

  .import-panel {
    align-items: center;
    border: 1px dashed #b8c1af;
    border-radius: 8px;
    background: rgba(255, 252, 246, 0.52);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    min-height: 174px;
    padding: 1rem;
  }

  .import-panel div {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .import-panel strong {
    font-size: 1.05rem;
  }

  .import-panel span,
  .import-panel p {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .import-panel p {
    grid-column: 1 / -1;
  }

  .import-panel button {
    appearance: none;
    border: 1px solid #1d2a22;
    border-radius: 8px;
    background: #1d2a22;
    color: #f8f3ea;
    cursor: pointer;
    font: inherit;
    font-weight: 800;
    min-height: 42px;
    padding: 0.58rem 0.8rem;
    white-space: nowrap;
  }

  .import-panel button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .file-input {
    display: none;
  }

  .advanced-sync {
    display: grid;
    gap: 0.8rem;
  }

  .advanced-sync summary {
    color: #4f5f53;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .connection-panel {
    display: grid;
    gap: 0.7rem;
    min-width: 0;
  }

  .connection-status {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .connection-status div {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    background: rgba(255, 252, 246, 0.52);
    min-width: 0;
    padding: 0.65rem 0.7rem;
  }

  .connection-status span,
  .connection-actions a {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .connection-status strong {
    display: block;
    font-size: 0.92rem;
    line-height: 1.25;
    margin-top: 0.2rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-form {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(130px, 0.55fr) minmax(
        130px,
        0.55fr
      );
    gap: 0.65rem;
  }

  .sync-form.connected {
    grid-template-columns: minmax(130px, 0.55fr) minmax(130px, 0.55fr) minmax(
        260px,
        1fr
      );
  }

  .sync-form label {
    display: grid;
    gap: 0.3rem;
  }

  .sync-form span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 750;
    text-transform: uppercase;
  }

  .sync-form input {
    width: 100%;
    min-width: 0;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    background: #fbf7ef;
    box-sizing: border-box;
    color: #17201b;
    font: inherit;
    padding: 0.68rem 0.75rem;
  }

  .connection-actions {
    align-items: end;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    min-width: 0;
  }

  .connection-actions button,
  .connection-actions a {
    align-items: center;
    appearance: none;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    background: #fbf7ef;
    color: #17201b;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    justify-content: center;
    min-height: 42px;
    padding: 0.58rem 0.72rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .connection-actions button[type="submit"] {
    background: #1d2a22;
    border-color: #1d2a22;
    color: #f8f3ea;
  }

  .connection-actions button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .connection-actions .secondary {
    background: #f7f1e8;
  }

  .connection-actions .danger {
    border-color: #d2b5a5;
    color: #8a3f2f;
  }

  .sync-form p {
    grid-column: 1 / -1;
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
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

  .setting-summary {
    display: grid;
    gap: 0.15rem;
    padding-top: 0.9rem;
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

  .tag-picker button.active,
  .segmented-control button.active {
    background: #1d2a22;
    border-color: #1d2a22;
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

  .svg-chart {
    border-top: 1px solid #d8d8cc;
    padding-block: 0.65rem;
  }

  .svg-chart svg {
    display: block;
    height: auto;
    width: 100%;
  }

  .axis-line {
    stroke: #cfd2c4;
    stroke-width: 2;
  }

  .tick-line {
    stroke: rgba(207, 210, 196, 0.56);
    stroke-width: 1;
  }

  .axis-tick,
  .axis-title {
    fill: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
  }

  .axis-tick.x,
  .axis-title.x {
    text-anchor: middle;
  }

  .axis-tick.y {
    dominant-baseline: middle;
    text-anchor: end;
  }

  .axis-title.y {
    text-anchor: middle;
  }

  .scatter-point {
    cursor: pointer;
    fill: #9ca69a;
    opacity: 0.82;
    stroke: #fbf7ef;
    stroke-width: 2;
  }

  .scatter-point.match {
    fill: #4f8a63;
    opacity: 1;
  }

  .timeline-line {
    fill: none;
    stroke: #6f786f;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3;
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

  .tag-calendar-section {
    border-top: 10px solid rgba(231, 233, 223, 0.9);
    display: grid;
    gap: 0.95rem;
    margin-inline: -1rem;
    padding: 1.15rem 1rem 0.15rem;
  }

  .tag-calendar-heading {
    align-items: flex-start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
  }

  .tag-calendar-heading h3 {
    font-size: 1rem;
    margin-top: 0.1rem;
  }

  .tag-calendar-range {
    color: #6f786f;
    display: grid;
    font-size: 0.72rem;
    font-weight: 800;
    gap: 0.5rem;
    justify-items: end;
    min-width: 16rem;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .tag-calendar-range-meta {
    display: grid;
    gap: 0.18rem;
    justify-items: end;
  }

  .tag-calendar-range-meta strong {
    color: #1f2520;
    font-size: 0.78rem;
  }

  .tag-calendar-range-actions {
    display: flex;
    align-items: flex-end;
    flex-direction: column;
    gap: 0.35rem;
    justify-content: flex-end;
    max-width: 23rem;
  }

  .tag-calendar-range-actions button {
    appearance: none;
    background: #f7f1e8;
    border: 1px solid #d8d8cc;
    border-radius: 999px;
    color: #6f786f;
    cursor: pointer;
    font: inherit;
    font-size: 0.68rem;
    font-weight: 800;
    min-height: 1.65rem;
    padding: 0.32rem 0.56rem;
    text-transform: uppercase;
  }

  .tag-calendar-range-actions button.active {
    background: #1e2c64;
    border-color: #1e2c64;
    color: #fbf7ef;
  }

  .tag-calendar {
    --tag-calendar-day-size: 0.72rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.26rem 0.72rem;
    margin-left: clamp(1.25rem, 3vw, 2.75rem);
    padding-top: 0.1rem;
  }

  .tag-calendar-weekday {
    color: #6f786f;
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .tag-calendar-months {
    color: #6f786f;
    display: grid;
    font-size: 0.68rem;
    font-weight: 800;
    gap: 0.24rem;
    line-height: 1;
    min-height: 1rem;
    overflow-x: auto;
    padding-bottom: 0.18rem;
    text-transform: uppercase;
  }

  .tag-calendar-months span {
    min-width: 0;
    overflow: visible;
    white-space: nowrap;
  }

  .tag-calendar-days {
    display: grid;
    gap: 0.24rem;
    overflow-x: auto;
    padding-block: 0.09rem;
  }

  .tag-calendar-day {
    appearance: none;
    background: #ebe7dd;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
    height: var(--tag-calendar-day-size);
    padding: 0;
    width: var(--tag-calendar-day-size);
  }

  .tag-calendar-day.no-data {
    cursor: default;
    display: block;
  }

  .tag-calendar-day.empty {
    background: transparent;
    cursor: default;
  }

  .tag-calendar-day.tagged {
    background: #1e2c64;
    border-color: #1e2c64;
  }

  .tag-calendar-day.selected {
    box-shadow: 0 0 0 2px #fbf7ef, 0 0 0 4px #6f786f;
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
    grid-template-columns: 84px minmax(0, 1fr);
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

  .empty-state {
    border: 1px dashed #c5cbbd;
    border-radius: 8px;
    color: #6f786f;
    font-size: 0.9rem;
    line-height: 1.4;
    min-height: 74px;
    padding: 0.75rem 0.9rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
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
    .modal-grid,
    .import-panel,
    .sync-strip,
    .workspace,
    .explore-builder,
    .sync-form,
    .sync-form.connected,
    .connection-status {
      grid-template-columns: 1fr;
    }

    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .log-row {
      grid-template-columns: 70px minmax(0, 1fr);
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

    .log-row {
      grid-template-columns: 84px minmax(0, 1fr);
      gap: 0.35rem 0.85rem;
    }

    .tag-calendar-heading {
      display: grid;
    }

    .tag-calendar-range {
      justify-items: start;
      min-width: 0;
      padding-right: 0;
      white-space: normal;
    }

    .tag-calendar-range-meta {
      justify-items: start;
    }

    .tag-calendar-range-actions {
      align-items: flex-start;
      justify-content: flex-start;
    }

    .tag-calendar {
      margin-left: 0;
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
