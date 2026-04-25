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
    type ExploreMetricDefinition,
    type ExploreMetricImpact,
    type ExploreMetricKey,
    type PrimaryInsightMetric,
    type TagInsight
  } from "../lib/analysis/correlations"
  import { db } from "../lib/db"
  import type { DailyMetricRow } from "../lib/db/types"
  import {
    sampleDailyMetrics,
    sampleTagEntries
  } from "../lib/oura/sampleData"
  import { syncOuraRange } from "../lib/oura/sync"
  import logoUrl from "../../assets/phibo-mark.svg"

  interface MetricSummary {
    label: string
    value: string
    delta: string
    tone: "good" | "steady" | "watch"
  }

  interface MetricComparison {
    baselineAverage: number | null
    delta: number | null
    taggedAverage: number | null
  }

  interface InsightStat {
    helper: string
    label: string
    unit: string
    value: string
  }

  type ChartMode = "impact" | "scatter" | "timeline"
  type DashboardView = "explore" | "insights"

  interface ChartPoint {
    day: ExploreDay
    x: number
    y: number
  }

  interface ChartTick {
    label: string
    position: number
  }

  const chartWidth = 640
  const chartHeight = 320
  const chartModes: ChartMode[] = ["impact", "scatter", "timeline"]
  const chartPadding = 56

  let accessToken = ""
  let activeView: DashboardView = "insights"
  let exploreChartMode: ChartMode = "impact"
  let exploreTagsInitialized = false
  let hoveredExploreDate = ""
  let dailyMetrics = sampleDailyMetrics
  let endDate = formatInputDate(new Date())
  let isSyncing = false
  let selectedInsightKey = ""
  let selectedExploreDate = ""
  let selectedExploreTags: string[] = []
  let selectedXMetric: ExploreMetricKey = "sleepScore"
  let selectedYMetric: ExploreMetricKey = "readinessScore"
  let startDate = formatInputDate(daysAgo(30))
  let syncMessage = "Sample data is showing until your first sync."
  let tagEntries = sampleTagEntries

  $: hasLocalData = dailyMetrics !== sampleDailyMetrics
  $: correlations = calculateTagCorrelations(dailyMetrics, tagEntries)
  $: availableTags = getAvailableTags(tagEntries)
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
    dailyMetrics,
    tagEntries,
    selectedExploreTags
  )
  $: exploreImpacts = calculateExploreMetricImpacts(
    dailyMetrics,
    tagEntries,
    selectedExploreTags
  )
  $: matchingExploreDays = exploreDays.filter((day) => day.matches)
  $: otherExploreDays = exploreDays.filter((day) => !day.matches)
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
    ...insights.concerning,
    ...insights.notable
  ]
  $: selectedInsight =
    allInsights.find((insight) => insightKey(insight) === selectedInsightKey) ??
    allInsights[0]
  $: latestMetricDate = dailyMetrics.at(-1)?.date ?? endDate
  $: discoveries = getTagDiscoveries(tagEntries, latestMetricDate)
  $: selectedComparison = selectedInsight
    ? {
        readinessScore: getMetricComparison(
          selectedInsight.tag,
          "readinessScore"
        ),
        sleepScore: getMetricComparison(selectedInsight.tag, "sleepScore")
      }
    : null
  $: selectedStats = selectedInsight ? createInsightStats(selectedInsight) : []
  $: summaries = [
    createSummary("Sleep", "sleepScore", "vs sample baseline"),
    createSummary("Readiness", "readinessScore", "this week"),
    createSummary("Activity", "activityScore", "this week")
  ]
  onMount(async () => {
    const savedToken = await db.authTokens.get("oura")
    const savedMetrics = await db.dailyMetrics.orderBy("date").toArray()
    const savedTags = await db.tagEntries.orderBy("date").toArray()

    accessToken = savedToken?.accessToken ?? ""

    if (savedMetrics.length > 0) {
      dailyMetrics = savedMetrics
      tagEntries = savedTags
      syncMessage = `Loaded ${savedMetrics.length} saved Oura days.`
    }
  })

  async function syncData() {
    if (!accessToken.trim()) {
      syncMessage = "Paste an Oura access token before syncing."
      return
    }

    isSyncing = true
    syncMessage = "Syncing Oura data..."

    try {
      await db.authTokens.put({
        id: "oura",
        accessToken: accessToken.trim(),
        expiresAt: null,
        scopes: ["daily", "tag"],
        tokenType: "bearer",
        updatedAt: new Date().toISOString()
      })

      const result = await syncOuraRange(accessToken.trim(), startDate, endDate)

      dailyMetrics = result.dailyMetrics
      tagEntries = result.tagEntries
      syncMessage = `Synced ${result.dailyMetrics.length} days and ${result.tagEntries.length} tags.`
    } catch (error) {
      syncMessage = error instanceof Error ? error.message : "Sync failed."
    } finally {
      isSyncing = false
    }
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

  function formatDate(date: string) {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short"
    }).format(new Date(`${date}T12:00:00`))
  }

  function createSummary(
    label: string,
    key: keyof Pick<
      DailyMetricRow,
      "activityScore" | "readinessScore" | "sleepScore"
    >,
    deltaLabel: string
  ): MetricSummary {
    const value = average(dailyMetrics.map((day) => day[key]))

    return {
      label,
      value: value === null ? "n/a" : `${Math.round(value)}`,
      delta: `${label === "Sleep" ? "+4" : "+2"} ${deltaLabel}`,
      tone: label === "Readiness" ? "steady" : "good"
    }
  }

  function createInsightStats(item: TagInsight): InsightStat[] {
    const correlation = correlations.find((correlation) => correlation.tag === item.tag)
    const daysWithoutTag =
      correlation?.daysWithoutTag ?? Math.max(dailyMetrics.length - item.daysWithTag, 0)
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
        helper: `nights with ${item.tag}`,
        label: "Tagged",
        unit: item.daysWithTag === 1 ? "night" : "nights",
        value: `${item.daysWithTag}`
      },
      {
        helper: `nights without ${item.tag}`,
        label: "Other",
        unit: daysWithoutTag === 1 ? "night" : "nights",
        value: `${daysWithoutTag}`
      },
      {
        helper: "sample confidence",
        label: "Support",
        unit: "%",
        value: `${Math.round(item.supportScore * 100)}`
      },
      {
        helper: "effect after support weighting",
        label: "Signal",
        unit: "pts",
        value: item.weightedImpact.toFixed(1)
      },
      ...metricStats
    ]
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

    return day.tags.length > 0 ? day.tags.join(", ") : "No tags"
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
    metric: PrimaryInsightMetric
  ): MetricComparison {
    const currentTagsByDate = buildTagsByDate(tagEntries)
    const taggedDays = dailyMetrics.filter((day) =>
      (currentTagsByDate[day.date] ?? []).includes(tag)
    )
    const untaggedDays = dailyMetrics.filter(
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
    <button type="button" class="sync-button" on:click={syncData} disabled={isSyncing}>
      {isSyncing ? "Syncing" : "Sync data"}
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
  </nav>

  {#if activeView === "insights"}
  <section class="sync-strip">
    <div>
      <p class="section-kicker">{hasLocalData ? "Local data" : "MVP preview"}</p>
      <h2>Local Oura analysis workspace</h2>
    </div>
    <form class="sync-form" on:submit|preventDefault={syncData}>
      <label>
        <span>Access token</span>
        <input
          bind:value={accessToken}
          type="password"
          autocomplete="off"
          placeholder="Paste temporary Oura token"
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
      <p>{syncMessage}</p>
    </form>
  </section>

  <section class="metric-grid" aria-label="Metric summary">
    {#each summaries as summary}
      <article class="metric-card {summary.tone}">
        <p>{summary.label}</p>
        <strong>{summary.value}</strong>
        <span>{summary.delta}</span>
      </article>
    {/each}
  </section>

  <section class="workspace">
    <div class="analysis-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Insights</p>
          <h2>What deserves attention</h2>
        </div>
        <span>Last 30 days</span>
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
                  <h4>{item.tag}</h4>
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
                  <h4>{item.tag}</h4>
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

        <section class="insight-column">
          <h3>Notable</h3>
          <div class="insight-stack">
            {#each insights.notable as item}
              <button
                type="button"
                class:selected={selectedInsight && insightKey(item) === insightKey(selectedInsight)}
                class="correlation-card notable"
                on:click={() => selectInsight(item)}
              >
                <div class="correlation-title">
                  <h4>{item.tag}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong class="score-impact {impactTone(item.delta)}">
                  <span>{metricLabel(item.metric)}</span>
                  <b>{formatDelta(item.delta)}</b>
                </strong>
              </button>
            {:else}
              <p class="empty-state">No extra notable sleep pattern yet.</p>
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
                  <strong>{item.tag}</strong>
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
          <h2>{selectedInsight ? selectedInsight.tag : "Select an insight"}</h2>
        </div>
        {#if selectedInsight}
          <span class="score-impact {impactTone(selectedInsight.delta)}">
            <span>{metricLabel(selectedInsight.metric)}</span>
            <b>{formatDelta(selectedInsight.delta)}</b>
          </span>
        {/if}
      </div>

      {#if selectedInsight && selectedComparison}
        <div class="comparison-chart" aria-label="Selected insight comparison">
          <article>
            <div class="comparison-heading">
              <strong>Sleep score</strong>
              <span
                >{formatNullableDelta(selectedComparison.sleepScore.delta)}</span
              >
            </div>
            <div class="bar-row">
              <span>Tagged</span>
              <div class="bar-track">
                <span
                  class="bar-fill tagged"
                  style={`width: ${comparisonWidth(
                    selectedComparison.sleepScore.taggedAverage
                  )}`}
                />
              </div>
              <strong>{Math.round(selectedComparison.sleepScore.taggedAverage ?? 0)}</strong>
            </div>
            <div class="bar-row">
              <span>Other</span>
              <div class="bar-track">
                <span
                  class="bar-fill baseline"
                  style={`width: ${comparisonWidth(
                    selectedComparison.sleepScore.baselineAverage
                  )}`}
                />
              </div>
              <strong>{Math.round(selectedComparison.sleepScore.baselineAverage ?? 0)}</strong>
            </div>
          </article>

          <article>
            <div class="comparison-heading">
              <strong>Readiness</strong>
              <span
                >{formatNullableDelta(
                  selectedComparison.readinessScore.delta
                )}</span
              >
            </div>
            <div class="bar-row">
              <span>Tagged</span>
              <div class="bar-track">
                <span
                  class="bar-fill tagged"
                  style={`width: ${comparisonWidth(
                    selectedComparison.readinessScore.taggedAverage
                  )}`}
                />
              </div>
              <strong>{Math.round(selectedComparison.readinessScore.taggedAverage ?? 0)}</strong>
            </div>
            <div class="bar-row">
              <span>Other</span>
              <div class="bar-track">
                <span
                  class="bar-fill baseline"
                  style={`width: ${comparisonWidth(
                    selectedComparison.readinessScore.baselineAverage
                  )}`}
                />
              </div>
              <strong>{Math.round(selectedComparison.readinessScore.baselineAverage ?? 0)}</strong>
            </div>
          </article>
        </div>
      {:else}
        <p class="empty-state">Select an insight to compare tagged nights.</p>
      {/if}

      <div class="detail-stats" aria-label="Selected insight stats">
        {#each selectedStats as stat}
          <div>
            <span>{stat.label}</span>
            <p>{stat.helper}</p>
            <strong>{stat.value} <small>{stat.unit}</small></strong>
          </div>
        {/each}
      </div>
    </div>
  </section>
  {:else}
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
                  {tag}
                </button>
              {:else}
                <p class="empty-state">Sync or add tags to explore patterns.</p>
              {/each}
            </div>
          </section>

          <section class="explore-control">
            <h3>Outcomes</h3>
            <div class="metric-selectors">
              <label>
                <span>X axis</span>
                <select bind:value={selectedXMetric}>
                  {#each exploreMetricDefinitions as metric}
                    <option value={metric.key}>{metric.label}</option>
                  {/each}
                </select>
              </label>
              <label>
                <span>Y axis</span>
                <select bind:value={selectedYMetric}>
                  {#each exploreMetricDefinitions as metric}
                    <option value={metric.key}>{metric.label}</option>
                  {/each}
                </select>
              </label>
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
        </div>
      </div>

      <div class="explore-panel chart-panel">
        <div class="chart-heading">
          <div>
            <p class="section-kicker">
              {selectedExploreTags.length > 0 ? "All selected tags" : "No tag selected"}
            </p>
            <h2>
              {selectedExploreTags.length > 0
                ? selectedExploreTags.join(" + ")
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
            {#each exploreImpacts as row}
              <article>
                <div>
                  <strong>{row.metric.label}</strong>
                  <span>
                    {formatAverage(row.taggedAverage, row.metric)} tagged vs
                    {formatAverage(row.otherAverage, row.metric)} other
                  </span>
                </div>
                <div class="impact-bar">
                  <span
                    class="impact-fill {impactTone(row.toneDelta)}"
                    style={`width: ${impactWidth(row)}`}
                  />
                </div>
                <strong class="score-impact {impactTone(row.toneDelta)}">
                  <b>{formatExploreDelta(row)}</b>
                </strong>
              </article>
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

        <div class="explore-detail">
          <div>
            <span>Date</span>
            <strong>{activeExploreDay ? formatDate(activeExploreDay.date) : "n/a"}</strong>
          </div>
          <div>
            <span>{selectedXDefinition.label}</span>
            <strong>
              {formatMetricValue(
                activeExploreDay?.metric[selectedXMetric] ?? null,
                selectedXDefinition
              )}
            </strong>
          </div>
          <div>
            <span>{selectedYDefinition.label}</span>
            <strong>
              {formatMetricValue(
                activeExploreDay?.metric[selectedYMetric] ?? null,
                selectedYDefinition
              )}
            </strong>
          </div>
          <div>
            <span>Tags</span>
            <strong>{detailTags(activeExploreDay)}</strong>
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
    border-block: 1px solid #d3d5c8;
    padding-block: 1rem;
    margin-bottom: 1rem;
  }

  .sync-form {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(130px, 0.55fr) minmax(
        130px,
        0.55fr
      );
    gap: 0.65rem;
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

  .metric-card span {
    color: #5d685e;
    font-size: 0.9rem;
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
  .trend-panel {
    padding: 1rem;
  }

  .explore-workspace {
    display: grid;
    gap: 0.8rem;
  }

  .explore-builder {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(260px, 0.9fr) minmax(
        220px,
        0.7fr
      );
    gap: 0.9rem;
  }

  .explore-control {
    display: grid;
    gap: 0.55rem;
    min-width: 0;
  }

  .explore-control h3 {
    color: #4f5f53;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
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
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
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
    border-block: 1px solid #d8d8cc;
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
    gap: 0;
    border-top: 1px solid #d8d8cc;
  }

  .impact-list article {
    align-items: center;
    border-bottom: 1px solid #d8d8cc;
    display: grid;
    grid-template-columns: minmax(190px, 0.95fr) minmax(140px, 1fr) auto;
    gap: 0.8rem;
    min-height: 58px;
    padding-block: 0.65rem;
  }

  .impact-list article > div:first-child {
    min-width: 0;
  }

  .impact-list strong,
  .impact-list span {
    display: block;
  }

  .impact-list article > div:first-child span {
    color: #6f786f;
    font-size: 0.82rem;
    margin-top: 0.15rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .impact-list .score-impact b {
    font-size: 1rem;
  }

  .impact-bar {
    background: #ebe7dd;
    border-radius: 999px;
    height: 0.55rem;
    overflow: hidden;
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

  .explore-detail {
    border-top: 1px solid #d8d8cc;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
  }

  .explore-detail div {
    border-right: 1px solid #d8d8cc;
    display: grid;
    gap: 0.25rem;
    min-height: 58px;
    padding: 0.65rem 0.75rem 0 0;
  }

  .explore-detail div:last-child {
    border-right: 0;
  }

  .explore-detail span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .explore-detail strong {
    font-size: 0.95rem;
    line-height: 1.25;
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

  .correlation-card.notable {
    border-left: 4px solid #587a96;
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
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
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
    flex: 0 0 auto;
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
    .sync-strip,
    .workspace,
    .explore-builder,
    .sync-form {
      grid-template-columns: 1fr;
    }

    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .explore-detail {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .explore-detail div {
      border-right: 0;
      border-bottom: 1px solid #d8d8cc;
    }

    .impact-list article {
      grid-template-columns: minmax(0, 1fr);
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

    .metric-selectors,
    .explore-detail {
      grid-template-columns: 1fr;
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
