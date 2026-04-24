<script lang="ts">
  import { onMount } from "svelte"
  import {
    calculateTagCorrelations,
    getRankedTagInsights,
    getTagDiscoveries,
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

  let accessToken = ""
  let dailyMetrics = sampleDailyMetrics
  let endDate = formatInputDate(new Date())
  let isSyncing = false
  let startDate = formatInputDate(daysAgo(30))
  let syncMessage = "Sample data is showing until your first sync."
  let tagEntries = sampleTagEntries

  $: hasLocalData = dailyMetrics !== sampleDailyMetrics
  $: correlations = calculateTagCorrelations(dailyMetrics, tagEntries)
  $: insights = getRankedTagInsights(correlations)
  $: latestMetricDate = dailyMetrics.at(-1)?.date ?? endDate
  $: discoveries = getTagDiscoveries(tagEntries, latestMetricDate)
  $: recentDays = dailyMetrics.slice(-4).reverse()
  $: tagsByDate = tagEntries.reduce(
    (groups, tag) => {
      groups[tag.date] = [...(groups[tag.date] ?? []), tag.tag]

      return groups
    },
    {} as Record<string, string[]>
  )
  $: summaries = [
    createSummary("Sleep", "sleepScore", "vs sample baseline"),
    createSummary("Readiness", "readinessScore", "this week"),
    createSummary("Activity", "activityScore", "this week")
  ]
  $: trendPoints = dailyMetrics
    .map((day, index) => {
      const x = (index / Math.max(dailyMetrics.length - 1, 1)) * 100
      const y = 100 - (day.sleepScore ?? 0)

      return `${x},${y}`
    })
    .join(" ")

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

  function average(values: Array<number | null>) {
    const usableValues = values.filter((value): value is number => value !== null)

    if (usableValues.length === 0) {
      return null
    }

    return (
      usableValues.reduce((total, value) => total + value, 0) /
      usableValues.length
    )
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
      <h1>Oura Patterns</h1>
    </div>
    <button type="button" class="sync-button" on:click={syncData} disabled={isSyncing}>
      {isSyncing ? "Syncing" : "Sync data"}
    </button>
  </header>

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
              <article class="correlation-card rewarding">
                <div class="correlation-title">
                  <h4>{item.tag}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong>{formatDelta(item.delta)}</strong>
              </article>
            {:else}
              <p class="empty-state">No supported positive pattern yet.</p>
            {/each}
          </div>
        </section>

        <section class="insight-column">
          <h3>Concerning</h3>
          <div class="insight-stack">
            {#each insights.concerning as item}
              <article class="correlation-card concerning">
                <div class="correlation-title">
                  <h4>{item.tag}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong>{formatDelta(item.delta)}</strong>
              </article>
            {:else}
              <p class="empty-state">No supported concerning pattern yet.</p>
            {/each}
          </div>
        </section>

        <section class="insight-column">
          <h3>Notable</h3>
          <div class="insight-stack">
            {#each insights.notable as item}
              <article class="correlation-card notable">
                <div class="correlation-title">
                  <h4>{item.tag}</h4>
                  <span>{item.daysWithTag} nights</span>
                </div>
                <strong>{formatDelta(item.delta)}</strong>
              </article>
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
              <div>
                <strong>{item.tag}</strong>
                <span>{item.reason === "new" ? "Newly appearing" : "Not tried lately"}</span>
              </div>
              <p>{item.daysWithTag} nights, last seen {formatDate(item.lastSeenDate)}</p>
            </article>
          {:else}
            <article>
              <div>
                <strong>No new tags yet</strong>
                <span>Try a behavior and tag it for a few nights</span>
              </div>
              <p>Waiting for fresh data</p>
            </article>
          {/each}
        </div>
      </div>
    </div>

    <div class="trend-panel">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Trend</p>
          <h2>Sleep vs readiness</h2>
        </div>
      </div>
      <svg viewBox="0 0 100 100" role="img" aria-label="Sleep score trend">
        <polyline points={trendPoints} />
      </svg>
      <div class="recent-table">
        {#each recentDays as day}
          <article>
            <div>
              <strong>{formatDate(day.date)}</strong>
              <span>{(tagsByDate[day.date] ?? ["No tags"]).join(", ")}</span>
            </div>
            <dl>
              <div>
                <dt>Sleep</dt>
                <dd>{day.sleepScore}</dd>
              </div>
              <div>
                <dt>Readiness</dt>
                <dd>{day.readinessScore}</dd>
              </div>
            </dl>
          </article>
        {/each}
      </div>
    </div>
  </section>
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
    background: #f7f8f4;
    color: #17201b;
  }

  .dashboard {
    min-height: 100vh;
    padding: 1.5rem;
    box-sizing: border-box;
  }

  .header,
  .sync-strip,
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
    background: #17201b;
    padding: 0.28rem;
    box-sizing: border-box;
    flex: 0 0 auto;
  }

  .eyebrow,
  .section-kicker {
    margin: 0;
    color: #65736b;
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
    background: #17201b;
    color: #fbfdf9;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.8rem 1.05rem;
    transition:
      transform 120ms ease,
      background-color 120ms ease;
  }

  .sync-button:hover {
    background: #24362b;
    transform: translateY(-1px);
  }

  .sync-button:disabled {
    cursor: wait;
    opacity: 0.72;
    transform: none;
  }

  .sync-strip {
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1.15fr);
    gap: 1rem;
    border-block: 1px solid #dbe2d7;
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
    color: #65736b;
    font-size: 0.72rem;
    font-weight: 750;
    text-transform: uppercase;
  }

  .sync-form input {
    width: 100%;
    min-width: 0;
    border: 1px solid #cfd8ca;
    border-radius: 8px;
    background: #fffffb;
    box-sizing: border-box;
    color: #17201b;
    font: inherit;
    padding: 0.68rem 0.75rem;
  }

  .sync-form p {
    grid-column: 1 / -1;
    color: #46564c;
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
  .trend-panel {
    border: 1px solid #dbe2d7;
    border-radius: 8px;
    background: #fffffb;
  }

  .metric-card {
    padding: 1rem;
    min-height: 128px;
    box-sizing: border-box;
  }

  .metric-card p {
    color: #65736b;
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
    color: #536258;
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
  .trend-panel {
    padding: 1rem;
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .panel-heading > span {
    color: #65736b;
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
    color: #46564c;
    font-size: 0.8rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .insight-stack {
    display: grid;
    gap: 0.5rem;
  }

  .empty-state {
    border: 1px dashed #cfd8ca;
    border-radius: 8px;
    color: #65736b;
    font-size: 0.9rem;
    line-height: 1.4;
    min-height: 74px;
    padding: 0.75rem 0.9rem;
    box-sizing: border-box;
    display: flex;
    align-items: center;
  }

  .discoveries {
    border-top: 1px solid #e4e9df;
    margin-top: 1rem;
    padding-top: 1rem;
  }

  .correlation-card {
    border: 1px solid #e4e9df;
    border-radius: 8px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: center;
    min-height: 68px;
    padding: 0.85rem 1rem;
    box-sizing: border-box;
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
    color: #65736b;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .correlation-card > strong {
    font-size: 1.9rem;
    line-height: 1;
    white-space: nowrap;
  }

  .panel-heading.compact {
    margin-bottom: 0.7rem;
  }

  .discovery-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .discovery-list article {
    border: 1px solid #e4e9df;
    border-radius: 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.75rem;
  }

  .discovery-list span,
  .discovery-list p {
    color: #65736b;
    font-size: 0.82rem;
  }

  .discovery-list span {
    display: block;
    margin-top: 0.15rem;
  }

  .discovery-list p {
    text-align: right;
  }

  svg {
    width: 100%;
    height: 180px;
    border: 1px solid #e4e9df;
    border-radius: 8px;
    background:
      linear-gradient(#eef3ea 1px, transparent 1px),
      linear-gradient(90deg, #eef3ea 1px, transparent 1px);
    background-size: 25% 25%;
    margin-bottom: 0.8rem;
  }

  polyline {
    fill: none;
    stroke: #4f8a63;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 3;
    vector-effect: non-scaling-stroke;
  }

  .recent-table {
    display: grid;
    gap: 0.55rem;
  }

  .recent-table article {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.8rem;
    border-bottom: 1px solid #e4e9df;
    padding-bottom: 0.55rem;
  }

  .recent-table article:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .recent-table span {
    display: block;
    color: #65736b;
    font-size: 0.82rem;
    margin-top: 0.15rem;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, 58px);
    gap: 0.45rem;
    margin: 0;
  }

  dt {
    color: #65736b;
    font-size: 0.68rem;
    font-weight: 750;
    text-transform: uppercase;
  }

  dd {
    margin: 0.1rem 0 0;
    font-weight: 800;
  }

  @media (max-width: 820px) {
    .dashboard {
      padding: 1rem;
    }

    .header,
    .sync-strip,
    .workspace,
    .sync-form {
      grid-template-columns: 1fr;
    }

    .correlation-card {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .metric-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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

    .recent-table article {
      grid-template-columns: 1fr;
    }

    .discovery-list {
      grid-template-columns: 1fr;
    }

    .discovery-list article {
      display: grid;
    }

    .discovery-list p {
      text-align: left;
    }

    dl {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
