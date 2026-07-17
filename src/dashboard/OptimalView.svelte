<script lang="ts">
  import {
    calculateOptimalDay,
    OPTIMAL_MIN_TAGGED_DAYS,
    optimalTargets,
    scoreCategories,
    type OptimalTarget,
    type ScoreCategory
  } from "../lib/analysis/optimal"
  import type { ConfidenceLevel } from "../lib/analysis/stats"
  import {
    calculateTagEffectsMemoized,
    peekTagEffects,
    type TagEffectsModel
  } from "../lib/analysis/tagEffects"
  import type { DailyMetricRow, TagEntryRow } from "../lib/db/types"
  import { deferToIdle } from "./deferToIdle"
  import { impactTone } from "./exploreImpacts"
  import {
    confidenceBadgeLabel,
    formatDelta,
    formatNullableDelta
  } from "./format"
  import {
    loadOptimalOverrides,
    saveOptimalOverrides
  } from "./optimalOverrides"
  import { scoreRangeTone } from "./scoreTones"
  import { formatTagLabel } from "./tagLabels"

  const optimalTargetSettingKey = "phibo.optimalTarget"

  // The analysis inputs come straight from DashboardPage. This component
  // only exists while the Optimal view is open, so tag edits made elsewhere
  // cost nothing here and a fresh mount picks up the latest data.
  export let analysisMetrics: DailyMetricRow[]
  export let analysisEntries: TagEntryRow[]
  // The full metric history bounds the estimate (best days ceiling) and
  // decides whether any data is imported at all.
  export let dailyMetrics: DailyMetricRow[]

  function getSavedOptimalTarget(): OptimalTarget {
    const savedTarget = localStorage.getItem(optimalTargetSettingKey)
    const match = optimalTargets.find((option) => option.id === savedTarget)

    return match?.id ?? "total"
  }

  // localStorage reads are synchronous, so the saved target and overrides
  // are restored during init and the first estimate is already correct.
  let optimalTarget: OptimalTarget = getSavedOptimalTarget()

  const savedOverrides = loadOptimalOverrides()

  let optimalExcludedTags = savedOverrides.excludedTags
  let optimalIncludedTags = savedOverrides.includedTags

  $: hasLocalData = dailyMetrics.length > 0
  // Ridge models per category, fit deferred so the view paints first.
  // Shared with Insights and Explore through the tagEffects memo, so most
  // visits apply cached fits synchronously. Null means still computing.
  let adjustedModels: Partial<
    Record<ScoreCategory, TagEffectsModel | null>
  > | null = null
  let modelsToken = 0
  $: scheduleOptimalModels(dailyMetrics, analysisEntries)
  $: modelsReady = adjustedModels !== null
  $: optimalHasOverrides =
    optimalExcludedTags.length > 0 || optimalIncludedTags.length > 0
  $: optimalDay = calculateOptimalDay(analysisMetrics, analysisEntries, {
    target: optimalTarget,
    excludedTags: optimalExcludedTags,
    includedTags: optimalIncludedTags,
    boundsMetrics: dailyMetrics,
    adjustedModels: adjustedModels ?? {}
  })
  // The no-overrides reference only exists for the "vs optimal" diffs, so
  // without overrides it reuses the main result instead of recomputing.
  // Both calculations receive the same models, otherwise the diff would
  // compare adjusted numbers against naive ones.
  $: optimalDayFull = optimalHasOverrides
    ? calculateOptimalDay(analysisMetrics, analysisEntries, {
        target: optimalTarget,
        boundsMetrics: dailyMetrics,
        adjustedModels: adjustedModels ?? {}
      })
    : optimalDay
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
  // Shared bar scale across both optimal lists: every bar is sized against
  // the largest absolute impact anywhere, so green and red bar lengths stay
  // comparable and no bar can overflow its track (forced includes can make
  // every contribution negative).
  $: optimalImpactBarMax = Math.max(
    0,
    ...optimalDay.contributions.map((row) => Math.abs(row.targetImpact)),
    ...optimalDay.otherEligibleTags.map((row) => Math.abs(row.targetImpact))
  )
  $: optimalTargetCategories =
    optimalTargets.find((option) => option.id === optimalTarget)?.categories ??
    []
  // Target categories still running on observed averages because their
  // model is below its data gates; drives the honesty note above the list.
  $: fallbackCategories = modelsReady
    ? optimalTargetCategories.filter(
        (key) => !optimalDay.adjustedCategories.includes(key)
      )
    : []
  $: fallbackCategoryLabels = scoreCategories
    .filter((category) => fallbackCategories.includes(category.key))
    .map((category) => category.label)
    .join(", ")

  const modelMetrics: ScoreCategory[] = [
    "sleepScore",
    "readinessScore",
    "activityScore"
  ]

  // Applies cached fits synchronously and defers only the missing ones,
  // one per idle callback; the models land all at once so the estimates
  // never mix half-adjusted numbers. The token discards stale runs.
  function scheduleOptimalModels(
    metrics: DailyMetricRow[],
    entries: TagEntryRow[]
  ) {
    modelsToken += 1
    const token = modelsToken
    const resolved: Partial<Record<ScoreCategory, TagEffectsModel | null>> = {}
    const missing: ScoreCategory[] = []
    for (const metric of modelMetrics) {
      const cached = peekTagEffects(metrics, entries, metric)
      if (cached === undefined) {
        missing.push(metric)
      } else {
        resolved[metric] = cached
      }
    }
    if (missing.length === 0) {
      adjustedModels = resolved
      return
    }
    adjustedModels = null
    const fitNext = (index: number) => {
      if (token !== modelsToken) return
      if (index >= missing.length) {
        adjustedModels = resolved
        return
      }
      resolved[missing[index]] = calculateTagEffectsMemoized(
        metrics,
        entries,
        missing[index]
      )
      deferToIdle(() => fitNext(index + 1))
    }
    deferToIdle(() => fitNext(0))
  }

  const confidenceRank: Record<ConfidenceLevel, number> = {
    low: 0,
    medium: 1,
    high: 2
  }

  // Row badge: the single target category's confidence, or for combined
  // targets the weakest confidence among categories the tag actually moves.
  function contributionConfidence(contribution: {
    confidences: Record<ScoreCategory, ConfidenceLevel | null>
    weightedDeltas: Record<ScoreCategory, number>
  }): ConfidenceLevel | null {
    const levels: ConfidenceLevel[] = []
    for (const key of optimalTargetCategories) {
      const level = contribution.confidences[key]
      if (level === null) continue
      if (
        optimalTargetCategories.length > 1 &&
        contribution.weightedDeltas[key] === 0
      ) {
        continue
      }
      levels.push(level)
    }
    if (levels.length === 0) return null
    return levels.reduce((weakest, level) =>
      confidenceRank[level] < confidenceRank[weakest] ? level : weakest
    )
  }

  function formatOptimalScore(value: number | null) {
    return value === null ? "n/a" : `${Math.round(value)}`
  }

  function setOptimalTarget(target: OptimalTarget) {
    optimalTarget = target
    localStorage.setItem(optimalTargetSettingKey, target)
  }

  function persistOptimalOverrides() {
    saveOptimalOverrides(optimalExcludedTags, optimalIncludedTags)
  }

  function removeOptimalTag(tag: string) {
    if (optimalIncludedTags.includes(tag)) {
      optimalIncludedTags = optimalIncludedTags.filter((item) => item !== tag)
    } else if (!optimalExcludedTags.includes(tag)) {
      optimalExcludedTags = [...optimalExcludedTags, tag]
    }

    persistOptimalOverrides()
  }

  function addOptimalTag(tag: string) {
    if (optimalExcludedTags.includes(tag)) {
      optimalExcludedTags = optimalExcludedTags.filter((item) => item !== tag)
    } else if (!optimalIncludedTags.includes(tag)) {
      optimalIncludedTags = [...optimalIncludedTags, tag]
    }

    persistOptimalOverrides()
  }

  function resetOptimalTags() {
    optimalExcludedTags = []
    optimalIncludedTags = []
    persistOptimalOverrides()
  }

  function optimalTagBarWidth(value: number, maxValue: number) {
    if (maxValue <= 0 || value <= 0) {
      return "0%"
    }

    return `${Math.max(6, Math.round((value / maxValue) * 100))}%`
  }
</script>

    <section class="metric-grid" aria-label="Optimal day estimates">
      {#each scoreCategories as category}
        <article
          class="metric-card {scoreRangeTone(
            optimalDay.estimates[category.key]
          )}"
          class:dimmed={!optimalTargetCategories.includes(category.key)}
        >
          <p>{category.label} estimate</p>
          <strong>
            {modelsReady
              ? formatOptimalScore(optimalDay.estimates[category.key])
              : "..."}
          </strong>
          <small>
            baseline {formatOptimalScore(optimalDay.baselines[category.key])} ·
            best days {formatOptimalScore(
              optimalDay.bestDayAverages[category.key]
            )}
          </small>
          <span>
            {modelsReady
              ? formatNullableDelta(optimalDay.estimateDeltas[category.key])
              : "..."}
          </span>
          {#if modelsReady && optimalHasOverrides && optimalEstimateDiffs[category.key] !== null && optimalEstimateDiffs[category.key] !== 0}
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
              With enough history, each tag's impact comes from a model that
              looks at all your tags, the weekday, and your long-term trend
              at once, so a tag is credited only with what your other habits
              cannot explain. It also counts the tag's carry-over onto the
              next day, because an optimal day is a routine you could repeat.
              Only tags with at least {OPTIMAL_MIN_TAGGED_DAYS} tagged nights
              count, so one-off outliers do not skew the estimate.
            </li>
            <li>
              A tag you already log on most days adds little: the baseline
              already includes it, so only the missing days leave room for
              improvement.
            </li>
            <li>
              Model impacts for the selected target (Night = sleep +
              readiness) add up plainly, since the model has already
              separated overlapping tags. When a category has too little
              data for the model, its numbers fall back to observed averages
              combined with diminishing returns, and a note above the list
              says so. The optimal set is then tuned so that no single tag
              added or removed would improve the target estimate.
            </li>
            <li>
              Each tag's badge shows how sure the model is about its effect;
              faded rows mean low confidence, not no effect. Two tags that
              always appear together cannot be told apart: the model splits
              their shared effect between them, so each shows about half.
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

        {#if modelsReady && hasLocalData && fallbackCategories.length > 0}
          <p class="optimal-mode-note">
            {fallbackCategoryLabels} estimates use observed averages until the
            model has 60 days of history with at least 8 untagged nights.
          </p>
        {/if}

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

        {#if !modelsReady && hasLocalData}
          <p class="empty-state">Computing adjusted effects...</p>
        {:else if optimalDay.contributions.length > 0}
          <div class="optimal-tag-list">
            {#each optimalDay.contributions as contribution}
              {@const confidence = contributionConfidence(contribution)}
              <div
                class="optimal-tag-row"
                class:low-confidence={confidence === "low"}
              >
                <div class="optimal-tag-name">
                  <div class="optimal-tag-title">
                    <strong>{formatTagLabel(contribution.tag)}</strong>
                    {#if confidence}
                      <span class="confidence-badge {confidence}">
                        {confidenceBadgeLabel(confidence)}
                      </span>
                    {/if}
                  </div>
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

        {#if modelsReady && optimalDay.otherEligibleTags.length > 0}
          <details class="optimal-method optimal-others">
            <summary>
              Not in your optimal day ({optimalDay.otherEligibleTags.length})
            </summary>
            <div class="optimal-tag-list">
              {#each optimalDay.otherEligibleTags as candidate}
                {@const confidence = contributionConfidence(candidate)}
                <div
                  class="optimal-tag-row"
                  class:low-confidence={confidence === "low"}
                >
                  <div class="optimal-tag-name">
                    <div class="optimal-tag-title">
                      <strong>{formatTagLabel(candidate.tag)}</strong>
                      {#if confidence}
                        <span class="confidence-badge {confidence}">
                          {confidenceBadgeLabel(confidence)}
                        </span>
                      {/if}
                    </div>
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

<style>
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

  .optimal-tag-title {
    align-items: center;
    display: flex;
    gap: 0.4rem;
    min-width: 0;
  }

  .optimal-tag-title strong {
    min-width: 0;
  }

  /* Undo the tag-name span rules for the badge. */
  .optimal-tag-title .confidence-badge {
    color: #4f5f53;
    display: inline-block;
    flex: none;
    font-size: 0.68rem;
    font-weight: 800;
    margin-top: 0;
    white-space: nowrap;
  }

  .optimal-tag-row.low-confidence:not(:hover) {
    opacity: 0.62;
  }

  .optimal-mode-note {
    color: #6f786f;
    font-size: 0.8rem;
    line-height: 1.4;
    margin-bottom: 0.55rem;
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

@media (max-width: 560px) {
    .optimal-tag-row {
      grid-template-columns: minmax(0, 1fr) 52px 1.7rem;
    }
  }
</style>
