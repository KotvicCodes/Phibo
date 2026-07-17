<script lang="ts">
  import { onMount } from "svelte"
  import {
    buildExploreDays,
    calculateExploreMetricImpacts,
    exploreMetricDefinitions,
    getExploreMetric,
    type ExploreDay,
    type ExploreMetricCategory,
    type ExploreMetricKey
  } from "../lib/analysis/correlations"
  import {
    calculateExploreConfidenceMemoized,
    peekExploreConfidence,
    type ExploreMetricConfidence
  } from "../lib/analysis/exploreConfidence"
  import type { ConfidenceLevel } from "../lib/analysis/stats"
  import type { DailyMetricRow, TagEntryRow } from "../lib/db/types"
  import {
    insightComparisonMetrics,
    type InsightComparison,
    type InsightComparisonMetric,
    type MetricComparison
  } from "./comparisons"
  import {
    buildScatterOption,
    buildTimelineOption
  } from "./exploreChartOptions"
  import {
    exploreMetricCategories,
    formatAverage,
    formatExploreDelta
  } from "./exploreCharts"
  import {
    groupExploreImpacts,
    impactGroupDelta,
    impactGroupDeltaLabel,
    impactEffectTone,
    impactGroupMetricCount,
    impactGroupTone,
    impactWidth,
    isPrimaryScoreMetric
  } from "./exploreImpacts"
  import {
    average,
    comparisonWidth,
    formatComparisonAverage,
    formatDate,
    formatNullableDelta,
    formatSleepNightDate
  } from "./format"
  import {
    buildExploreTagCalendar,
    buildExploreTagCalendarOptions
  } from "./tagCalendar"
  import {
    formatTagLabel,
    formatTagList,
    tagSortModes,
    type TagSortMode
  } from "./tagLabels"
  import { exploreTagsSettingKey, getSavedTagList } from "./storedSettings"
  import { handleTypeToSearchKeydown } from "./typeToSearch"
  import EChart from "./EChart.svelte"
  import TagCalendar from "./TagCalendarView.svelte"

  type ChartMode = "impact" | "scatter" | "timeline"

  const chartModes: ChartMode[] = ["impact", "scatter", "timeline"]
  const exploreChartModeSettingKey = "phibo.exploreChartMode"
  const exploreXMetricSettingKey = "phibo.exploreXMetric"
  const exploreYMetricSettingKey = "phibo.exploreYMetric"

  // The analysis inputs come straight from DashboardPage. This component
  // only exists while the Explore view is open, so tag edits made elsewhere
  // cost nothing here and a fresh mount picks up the latest data.
  export let analysisMetrics: DailyMetricRow[]
  export let analysisEntries: TagEntryRow[]
  export let availableTags: string[]
  export let tagNightCounts: Map<string, number>
  export let showTagCounts: boolean
  export let tagSortMode: TagSortMode
  export let setTagSortMode: (mode: TagSortMode) => void
  // Metric preferences stay parent-owned: the Settings view edits them and
  // persists them, this view only reads them.
  export let exploreFavoriteMetrics: ExploreMetricKey[]
  export let exploreHiddenMetrics: ExploreMetricKey[]

  // In-view selections bound to the parent so they survive switching views.
  export let selectedExploreDate: string
  export let hoveredExploreDate: string
  export let openExploreImpactCategories: ExploreMetricCategory[]

  let exploreChartMode: ChartMode = "impact"
  let tagSearch = ""
  let selectedExploreTags: string[] = []
  let selectedXMetric: ExploreMetricKey = "sleepScore"
  let selectedYMetric: ExploreMetricKey = "readinessScore"
  let selectedExploreTagCalendarRange = "last365"
  let tagSearchInput: HTMLInputElement | null = null
  // Selections are saved reactively, so restoring must finish first or the
  // initial defaults would overwrite the stored values.
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

  onMount(() => {
    exploreChartMode = getSavedExploreChartMode()
    selectedXMetric = getSavedExploreMetric(
      exploreXMetricSettingKey,
      "sleepScore"
    )
    selectedYMetric = getSavedExploreMetric(
      exploreYMetricSettingKey,
      "readinessScore"
    )
    selectedExploreTags = getSavedTagList(exploreTagsSettingKey)

    // A metric hidden in Settings while this view was closed cannot stay
    // selected as an axis.
    if (exploreHiddenMetrics.includes(selectedXMetric)) {
      selectedXMetric = "sleepScore"
    }

    if (exploreHiddenMetrics.includes(selectedYMetric)) {
      selectedYMetric = "readinessScore"
    }

    exploreSettingsRestored = true
  })

  $: if (exploreSettingsRestored) {
    localStorage.setItem(exploreChartModeSettingKey, exploreChartMode)
    localStorage.setItem(exploreXMetricSettingKey, selectedXMetric)
    localStorage.setItem(exploreYMetricSettingKey, selectedYMetric)
    localStorage.setItem(
      exploreTagsSettingKey,
      JSON.stringify(selectedExploreTags)
    )
  }

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
  // Skip the prune while availableTags is still empty: before the parent's
  // async data load finishes it would wipe the restored selection and the
  // persist reactive would save the emptied list.
  $: if (availableTags.length > 0) {
    const validExploreTags = selectedExploreTags.filter((tag) =>
      availableTags.includes(tag)
    )

    if (validExploreTags.length !== selectedExploreTags.length) {
      selectedExploreTags = validExploreTags
    }
  }
  $: exploreDays = buildExploreDays(
    analysisMetrics,
    analysisEntries,
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
  $: exploreImpacts = calculateExploreMetricImpacts(exploreDays).filter(
    (row) => !isPrimaryScoreMetric(row.metric.key)
  )
  $: groupedExploreImpacts = groupExploreImpacts(exploreImpacts)
  // The permutation confidence pass (68 seeded tests plus the FDR
  // adjustment) is too heavy for a synchronous reactive block, so it runs
  // deferred: bars and deltas update instantly, badges follow a beat later.
  let exploreConfidence: Map<ExploreMetricKey, ExploreMetricConfidence> =
    new Map()
  let exploreConfidenceReady = false
  let exploreConfidenceToken = 0
  $: scheduleExploreConfidence(exploreDays, selectedExploreTags)
  $: impactConfidence = exploreConfidenceReady ? exploreConfidence : null
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
    selectedYDefinition,
    selectedExploreDate
  )
  $: timelineOption = buildTimelineOption(
    exploreDays,
    selectedYDefinition,
    selectedExploreDate
  )

  function deferToIdle(run: () => void) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 500 })
    } else {
      setTimeout(run, 0)
    }
  }

  // Same pattern as the Insights model scheduler: cached results apply
  // synchronously (no badge flash on remounts or tag re-selection), fresh
  // computations run in an idle callback, and the token discards stale runs
  // when the selection changes mid-flight. The empty-selection early return
  // also covers the reactive pass that runs before localStorage restore.
  function scheduleExploreConfidence(days: ExploreDay[], tags: string[]) {
    exploreConfidenceToken += 1
    const token = exploreConfidenceToken
    if (tags.length === 0 || !days.some((day) => day.matches)) {
      exploreConfidence = new Map()
      exploreConfidenceReady = false
      return
    }
    const cached = peekExploreConfidence(analysisMetrics, analysisEntries, tags)
    if (cached !== undefined) {
      exploreConfidence = cached
      exploreConfidenceReady = true
      return
    }
    exploreConfidenceReady = false
    deferToIdle(() => {
      if (token !== exploreConfidenceToken) return
      exploreConfidence = calculateExploreConfidenceMemoized(
        analysisMetrics,
        analysisEntries,
        days,
        tags
      )
      exploreConfidenceReady = true
    })
  }

  function confidenceBadgeLabel(level: ConfidenceLevel) {
    return level === "high" ? "High" : level === "medium" ? "Medium" : "Low"
  }

  function sortExploreDaysNewestFirst(days: ExploreDay[]) {
    return [...days].sort((left, right) => right.date.localeCompare(left.date))
  }

  function detailTags(day: ExploreDay | undefined) {
    if (!day) {
      return "No day selected"
    }

    return day.tags.length > 0 ? formatTagList(day.tags) : "No tags"
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

  // Escape backs out of the tag search.
  function handleExploreKeydown(event: KeyboardEvent) {
    handleTypeToSearchKeydown(event, tagSearchInput, () => {
      tagSearch = ""
      return "clear"
    })
  }
</script>

<svelte:window on:keydown={handleExploreKeydown} />

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
                    <article
                      class="impact-metric"
                      class:low-confidence={impactConfidence?.get(row.metric.key)?.level === "low"}
                    >
                      <div class="impact-metric-heading">
                        <div>
                          <div class="impact-metric-title">
                            <strong>{row.metric.label}</strong>
                            {#if impactConfidence}
                              <span
                                class="confidence-badge {impactConfidence.get(row.metric.key)?.level ?? "low"}"
                              >
                                {confidenceBadgeLabel(
                                  impactConfidence.get(row.metric.key)?.level ?? "low"
                                )}
                              </span>
                            {/if}
                          </div>
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
          selectedDate={selectedExploreDate}
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

<style>
  .explore-workspace {
    display: grid;
    gap: 0.8rem;
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

  .impact-metric-title {
    align-items: center;
    display: flex;
    gap: 0.4rem;
    min-width: 0;
  }

  /* Undo the heading's block/ellipsis span rules for the badge. */
  .impact-metric-title .confidence-badge {
    color: #4f5f53;
    display: inline-block;
    flex: none;
    font-size: 0.68rem;
    overflow: visible;
  }

  .impact-metric.low-confidence:not(:hover) {
    opacity: 0.62;
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

  .matching-log {
    display: grid;
    gap: 0.45rem;
  }

  .explore-score-comparison {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    margin-bottom: 0;
  }

@media (max-width: 820px) {
    .header,
    .workspace,
    .explore-builder {
      grid-template-columns: 1fr;
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
    .metric-selectors {
      grid-template-columns: 1fr;
    }

    .chart-heading {
      display: grid;
    }

    .chart-counts {
      justify-content: flex-start;
    }
  }
</style>
