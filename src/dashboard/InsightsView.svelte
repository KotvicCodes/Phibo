<script lang="ts">
  import {
    calculateTagCorrelations,
    getTagDiscoveries,
    type PrimaryInsightMetric,
    type TagInsight
  } from "../lib/analysis/correlations"
  import { getAdjustedTagInsights } from "../lib/analysis/insightRanking"
  import {
    calculateInsightConfidenceMemoized,
    peekInsightConfidence,
    type InsightConfidenceModel,
    type InsightPairConfidence
  } from "../lib/analysis/insightConfidence"
  import {
    calculateTagEffectsMemoized,
    peekTagEffects,
    type TagEffectsModel
  } from "../lib/analysis/tagEffects"
  import type { DailyMetricRow, TagEntryRow } from "../lib/db/types"
  import {
    buildMetricComparison,
    insightComparisonMetrics,
    type InsightComparison
  } from "./comparisons"
  import { deferToIdle } from "./deferToIdle"
  import { impactTone } from "./exploreImpacts"
  import {
    average,
    comparisonWidth,
    confidenceBadgeLabel,
    formatComparisonAverage,
    formatDelta,
    formatInputDate,
    formatMetricDelta,
    formatNullableDelta,
    formatScoreTrend,
    metricLabel,
    metricPlainLabel
  } from "./format"
  import { scoreRangeTone, type ScoreRangeTone } from "./scoreTones"
  import { buildTagsByDate } from "./tagDays"
  import { formatTagLabel } from "./tagLabels"

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


  const scoreWeekDays = 7

  // The analysis inputs come straight from DashboardPage. This component
  // only exists while the Insights view is open, so tag edits made
  // elsewhere cost nothing here and a fresh mount picks up the latest data.
  export let analysisMetrics: DailyMetricRow[]
  export let analysisEntries: TagEntryRow[]
  // Fallback for the discovery anchor date when the analysis sample is
  // empty: the newest imported day. Manual exports lag behind today, so the
  // anchor sticks to the last day with data.
  export let dailyMetrics: DailyMetricRow[]
  // Bound to the parent so the selection survives switching views.
  export let selectedInsightKey: string

  $: correlations = calculateTagCorrelations(analysisMetrics, analysisEntries)
  // Cards rank by the model's guarded adjusted effects once BOTH deferred
  // passes land: the fits, and the observed-confidence family the sign
  // guard anchors to (the model must never flip the direction of a strong
  // significant observed effect). Until then the lists show a computing
  // state instead of rankings that would reorder a beat later.
  $: rankingReady = effectsReady && insightConfidenceModel !== null
  $: insights = rankingReady
    ? getAdjustedTagInsights(
        { sleepScore: sleepEffects, readinessScore: readinessEffects },
        correlations,
        insightConfidenceModel
      )
    : { rewarding: [], concerning: [] }
  $: allInsights = [
    ...insights.rewarding,
    ...insights.concerning
  ]
  $: selectedInsight =
    allInsights.find((insight) => insightKey(insight) === selectedInsightKey) ??
    allInsights[0]
  $: latestMetricDate =
    analysisMetrics.at(-1)?.date ??
    dailyMetrics.at(-1)?.date ??
    formatInputDate(new Date())
  $: discoveries = getTagDiscoveries(analysisEntries, latestMetricDate)
  $: selectedComparisons = selectedInsight
    ? buildSelectedComparisons(
        selectedInsight.tag,
        analysisMetrics,
        analysisEntries
      )
    : []
  // Confidence tests the WHOLE candidate pool the ranking selected from
  // and corrects across it (Benjamini-Hochberg), because the displayed
  // insights are picked for having extreme deltas and raw p-values on the
  // winners would be optimistic. Testing every tag is too heavy for a
  // synchronous reactive, so it runs deferred like the model fits.
  let insightConfidenceModel: InsightConfidenceModel | null = null
  let insightConfidenceToken = 0
  $: scheduleInsightConfidence(analysisMetrics, analysisEntries)
  $: insightConfidenceMap = insightConfidenceModel?.results ?? null
  $: insightFamilySize = insightConfidenceModel?.familySize ?? 0
  // Adjusted effects run on the full history (trimmed to the tagging span
  // inside the model), not the exclude-untagged filtered sample: untagged
  // days inside the span are what identifies each tag's own contribution.
  let sleepEffects: TagEffectsModel | null = null
  let readinessEffects: TagEffectsModel | null = null
  let effectsReady = false
  let effectsToken = 0
  $: scheduleTagEffects(dailyMetrics, analysisEntries)
  $: selectedStats = selectedInsight
    ? createInsightStats(
        selectedInsight,
        analysisMetrics,
        // Undefined while the deferred pass is still computing, null when
        // the pair was untestable.
        insightConfidenceMap === null
          ? undefined
          : (insightConfidenceMap.get(insightKey(selectedInsight)) ?? null),
        selectedInsight.metric === "sleepScore" ? sleepEffects : readinessEffects,
        effectsReady
      )
    : []

  function scheduleInsightConfidence(
    metrics: DailyMetricRow[],
    entries: TagEntryRow[]
  ) {
    insightConfidenceToken += 1
    const token = insightConfidenceToken
    const cached = peekInsightConfidence(metrics, entries)
    if (cached !== undefined) {
      insightConfidenceModel = cached
      return
    }
    insightConfidenceModel = null
    deferToIdle(() => {
      if (token !== insightConfidenceToken) return
      insightConfidenceModel = calculateInsightConfidenceMemoized(
        metrics,
        entries
      )
    })
  }

  // The two model fits are the most expensive work on this view, so they
  // must not run synchronously during mount or the whole page freezes
  // before first paint. Cached results apply immediately; otherwise each
  // metric gets its own idle callback so no single block runs long, and
  // the token discards stale runs when the inputs change mid-flight.
  function scheduleTagEffects(
    metrics: DailyMetricRow[],
    entries: TagEntryRow[]
  ) {
    effectsToken += 1
    const token = effectsToken
    const cachedSleep = peekTagEffects(metrics, entries, "sleepScore")
    const cachedReadiness = peekTagEffects(metrics, entries, "readinessScore")
    if (cachedSleep !== undefined && cachedReadiness !== undefined) {
      sleepEffects = cachedSleep
      readinessEffects = cachedReadiness
      effectsReady = true
      return
    }
    effectsReady = false
    deferToIdle(() => {
      if (token !== effectsToken) return
      sleepEffects = calculateTagEffectsMemoized(metrics, entries, "sleepScore")
      deferToIdle(() => {
        if (token !== effectsToken) return
        readinessEffects = calculateTagEffectsMemoized(
          metrics,
          entries,
          "readinessScore"
        )
        effectsReady = true
      })
    })
  }
  $: summaries = [
    createSummary("Sleep", "sleepScore", analysisMetrics),
    createSummary("Readiness", "readinessScore", analysisMetrics),
    createSummary("Activity", "activityScore", analysisMetrics)
  ]

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

  function confidenceHelper(
    confidence: InsightPairConfidence | null | undefined,
    daysWithTag: number,
    daysWithoutTag: number
  ) {
    if (confidence === undefined) {
      return "checking this gap against your other tags"
    }
    if (confidence?.qValue == null) {
      return `${daysWithTag} of ${daysWithTag + daysWithoutTag} nights tagged`
    }
    const percent = Math.round(confidence.qValue * 100)
    const family = `after checking all ${insightFamilySize} tag and score pairs`
    return percent < 1
      ? `${family}, under 1% of gaps this striking would be flukes`
      : `${family}, about ${percent}% of gaps this striking would be flukes`
  }

  function adjustedEffectStats(
    item: TagInsight,
    model: TagEffectsModel | null,
    ready: boolean
  ): InsightStat[] {
    if (!ready) {
      return [
        {
          helper: "computing adjusted effects",
          label: "Adjusted",
          unit: "",
          value: "..."
        }
      ]
    }
    if (model === null) {
      return [
        {
          helper: "not enough data for adjusted effects yet",
          label: "Adjusted",
          unit: "",
          value: "n/a"
        }
      ]
    }
    const effect = model.effects.get(item.tag)
    const stats: InsightStat[] = [
      {
        helper:
          effect?.sameDayEffect == null
            ? "needs more tagged nights inside the model"
            : `holding other tags, weekday, season, and trend constant (${confidenceBadgeLabel(effect.sameDayConfidence ?? "low").toLowerCase()} confidence)`,
        label: "Adjusted",
        unit: effect?.sameDayEffect == null ? "" : "pts",
        value:
          effect?.sameDayEffect == null
            ? "n/a"
            : formatDelta(effect.sameDayEffect)
      }
    ]
    if (effect?.nextDayEffect != null) {
      stats.push({
        helper: `carry-over on the following day (${confidenceBadgeLabel(effect.nextDayConfidence ?? "low").toLowerCase()} confidence)`,
        label: "Next day",
        unit: "pts",
        value: formatDelta(effect.nextDayEffect)
      })
    } else {
      stats.push({
        helper: "not enough next-day data",
        label: "Next day",
        unit: "",
        value: "n/a"
      })
    }
    return stats
  }

  function createInsightStats(
    item: TagInsight,
    metrics: DailyMetricRow[],
    confidence: InsightPairConfidence | null | undefined,
    effectsModel: TagEffectsModel | null,
    effectsModelReady: boolean
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
        helper: confidenceHelper(confidence, item.daysWithTag, daysWithoutTag),
        label: "Confidence",
        unit: "",
        value:
          confidence === undefined
            ? "..."
            : confidenceBadgeLabel(confidence?.level ?? "low")
      },
      {
        helper: `observed ${metricLabel(item.metric)} difference on tagged nights`,
        label: "Effect",
        unit: "pts",
        // The card's delta is the adjusted steady-state effect once models
        // land, so the observed row reads from the raw correlation instead.
        value: formatMetricDelta(correlation?.deltas[item.metric] ?? null)
      },
      ...adjustedEffectStats(item, effectsModel, effectsModelReady),
      ...metricStats
    ]
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

  // One tagged/other day split serves all three metric comparisons, so the
  // date map is built once per selection instead of once per metric.
  function buildSelectedComparisons(
    tag: string,
    metrics: DailyMetricRow[],
    entries: TagEntryRow[]
  ): InsightComparison[] {
    const currentTagsByDate = buildTagsByDate(entries)
    const taggedDays = metrics.filter((day) =>
      (currentTagsByDate[day.date] ?? []).includes(tag)
    )
    const untaggedDays = metrics.filter(
      (day) => !(currentTagsByDate[day.date] ?? []).includes(tag)
    )

    return insightComparisonMetrics.map((item) => ({
      ...item,
      comparison: buildMetricComparison(taggedDays, untaggedDays, item.metric)
    }))
  }

  function insightKey(item: TagInsight) {
    return `${item.tag}-${item.metric}`
  }

  function selectInsight(item: TagInsight) {
    selectedInsightKey = insightKey(item)
  }
</script>

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
            {#if !rankingReady}
              <p class="empty-state">Computing adjusted effects...</p>
            {/if}
            {#each insights.rewarding as item}
              <button
                type="button"
                class:selected={selectedInsight && insightKey(item) === insightKey(selectedInsight)}
                class:low-confidence={insightConfidenceMap?.get(insightKey(item))?.level === "low"}
                class="correlation-card rewarding"
                on:click={() => selectInsight(item)}
              >
                <div class="correlation-title">
                  <h4>{formatTagLabel(item.tag)}</h4>
                  <span>{item.daysWithTag} nights</span>
                  {#if insightConfidenceMap}
                    <span class="confidence-badge {insightConfidenceMap.get(insightKey(item))?.level ?? "low"}">
                      {confidenceBadgeLabel(insightConfidenceMap.get(insightKey(item))?.level ?? "low")}
                    </span>
                  {/if}
                </div>
                <strong class="score-impact {impactTone(item.delta)}">
                  <span>{metricLabel(item.metric)}</span>
                  <b>{formatDelta(item.delta)}</b>
                </strong>
              </button>
            {:else}
              {#if rankingReady}
                <p class="empty-state">No supported positive pattern yet.</p>
              {/if}
            {/each}
          </div>
        </section>

        <section class="insight-column">
          <h3>Concerning</h3>
          <div class="insight-stack">
            {#if !rankingReady}
              <p class="empty-state">Computing adjusted effects...</p>
            {/if}
            {#each insights.concerning as item}
              <button
                type="button"
                class:selected={selectedInsight && insightKey(item) === insightKey(selectedInsight)}
                class:low-confidence={insightConfidenceMap?.get(insightKey(item))?.level === "low"}
                class="correlation-card concerning"
                on:click={() => selectInsight(item)}
              >
                <div class="correlation-title">
                  <h4>{formatTagLabel(item.tag)}</h4>
                  <span>{item.daysWithTag} nights</span>
                  {#if insightConfidenceMap}
                    <span class="confidence-badge {insightConfidenceMap.get(insightKey(item))?.level ?? "low"}">
                      {confidenceBadgeLabel(insightConfidenceMap.get(insightKey(item))?.level ?? "low")}
                    </span>
                  {/if}
                </div>
                <strong class="score-impact {impactTone(item.delta)}">
                  <span>{metricLabel(item.metric)}</span>
                  <b>{formatDelta(item.delta)}</b>
                </strong>
              </button>
            {:else}
              {#if rankingReady}
                <p class="empty-state">No supported concerning pattern yet.</p>
              {/if}
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

      {#if selectedInsight?.evidence === "observed-conflict"}
        <p class="evidence-note">
          The model disagrees with the observed direction for this tag, so
          the card shows the observed effect instead. More nights may
          untangle the tag from the context it travels with.
        </p>
      {:else if selectedInsight?.evidence === "observed"}
        <p class="evidence-note">
          The model cannot estimate this tag confidently yet, so the card
          shows the observed effect.
        </p>
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

      <details class="methodology">
        <summary>How these numbers work</summary>
        <p>
          <strong>Observed</strong> is the plain average difference between
          tagged and untagged nights in your current analysis sample. It can
          blame a tag for something a co-occurring tag did.
        </p>
        <p>
          <strong>Adjusted</strong> comes from a model that looks at all your
          tags, the weekday, the season, and the long-term trend at once, so
          each tag is
          credited only with what the others cannot explain.
          <strong>Next day</strong> is the same model's estimate of the tag's
          carry-over onto the following day. The rewarding and concerning
          cards rank tags by the model's total effect, today plus the
          next-day carry-over, counting only the parts the model is at
          least medium-confident about. The observed effect stays the
          anchor: when the model cannot speak confidently, or points in the
          opposite direction from a significant observed effect, the card
          shows the observed effect instead and says so. A tag always
          carries the context it travels with, and the model is never
          allowed to argue away what your nights actually looked like.
        </p>
        <p>
          <strong>Confidence</strong> reflects a shuffle test: how often
          chance alone would produce a gap at least this large. Because
          these cards show your most extreme tags, the test is corrected
          for every tag and score pair that was searched; picking winners
          means chance alone always produces a few big gaps, so the bar
          rises with the number of tags you track. High means a gap that
          survives that correction, low means chance could explain it or
          there are too few nights to tell.
        </p>
        <p>
          The adjusted model uses every night in your tagging period,
          including untagged ones, even when the untagged-days setting
          excludes them from the observed averages. Nights from before your
          first tag are ignored, since an untracked night is not the same as
          a night where nothing happened.
        </p>
        <p>
          A tag logged on back-to-back nights makes its same-day and next-day
          effects hard to separate; the model then splits the effect between
          them, so both can look smaller than the observed difference. That
          is caution, not a bug.
        </p>
      </details>
    </div>
  </section>

<style>
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

  /* Badge base styles live in shared.css; this only adjusts the color
     inside correlation card titles. */
  .correlation-title .confidence-badge {
    color: #4f5f53;
  }

  .correlation-card.low-confidence:not(.selected):not(:hover) {
    opacity: 0.62;
  }

  .evidence-note {
    color: #6f786f;
    font-size: 0.85rem;
    line-height: 1.45;
    margin-top: 0.6rem;
  }

  .methodology {
    border-top: 1px solid #d8d8cc;
    margin-top: 0.8rem;
    padding-top: 0.7rem;
  }

  .methodology summary {
    color: #4f5f53;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .methodology p {
    color: #6f786f;
    font-size: 0.85rem;
    line-height: 1.45;
    margin-top: 0.55rem;
  }

  .methodology p strong {
    color: #4f5f53;
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
    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }

@media (max-width: 560px) {
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
