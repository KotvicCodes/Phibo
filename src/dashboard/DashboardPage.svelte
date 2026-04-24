<script lang="ts">
  import {
    calculateTagCorrelations,
    type TagMetricCorrelation
  } from "../lib/analysis/correlations"
  import type { DailyMetricRow } from "../lib/db/types"
  import {
    sampleDailyMetrics,
    sampleTagEntries
  } from "../lib/oura/sampleData"
  import logoUrl from "../../assets/phibo-mark.svg"

  interface MetricSummary {
    label: string
    value: string
    delta: string
    tone: "good" | "steady" | "watch"
  }

  const correlations = calculateTagCorrelations(
    sampleDailyMetrics,
    sampleTagEntries
  )
  const recentDays = sampleDailyMetrics.slice(-4).reverse()
  const tagsByDate = sampleTagEntries.reduce(
    (groups, tag) => {
      groups[tag.date] = [...(groups[tag.date] ?? []), tag.tag]

      return groups
    },
    {} as Record<string, string[]>
  )

  const summaries: MetricSummary[] = [
    createSummary("Sleep score", "sleepScore", "", "+ vs sample baseline"),
    createSummary("Readiness", "readinessScore", "", "+ this week"),
    createSummary("HRV", "averageHrv", " ms", "+ on tagged nights"),
    createSummary("Resting HR", "restingHeartRate", " bpm", "- after recovery")
  ]

  const trendPoints = sampleDailyMetrics
    .map((day, index) => {
      const x = (index / (sampleDailyMetrics.length - 1)) * 100
      const y = 100 - (day.sleepScore ?? 0)

      return `${x},${y}`
    })
    .join(" ")

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
      "averageHrv" | "readinessScore" | "restingHeartRate" | "sleepScore"
    >,
    unit: string,
    deltaLabel: string
  ): MetricSummary {
    const value = average(sampleDailyMetrics.map((day) => day[key]))

    return {
      label,
      value: value === null ? "n/a" : `${Math.round(value)}${unit}`,
      delta: `${label === "Resting HR" ? "-3" : "+4"} ${deltaLabel}`,
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

  function describeCorrelation(item: TagMetricCorrelation) {
    const sleepDelta = item.deltas.sleepScore ?? 0

    if (sleepDelta > 0) {
      return "Associated with stronger sleep scores in the sample window."
    }

    if (sleepDelta < 0) {
      return "Associated with lower sleep scores in the sample window."
    }

    return "No visible sleep score movement in the sample window."
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
    <button type="button" class="sync-button">Sync data</button>
  </header>

  <section class="sync-strip">
    <div>
      <p class="section-kicker">MVP preview</p>
      <h2>Local Oura analysis workspace</h2>
    </div>
    <p>
      Mock data is powering this view while the sync layer is being wired in.
      The layout is shaped around tag correlations, metric trends, and local
      storage.
    </p>
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
          <p class="section-kicker">Correlations</p>
          <h2>Tags linked to sleep score</h2>
        </div>
        <span>Last 30 days</span>
      </div>

      <div class="correlation-list">
        {#each correlations as item}
          <article class="correlation-card">
            <div class="correlation-title">
              <h3>{item.tag}</h3>
              <span>{item.daysWithTag} nights</span>
            </div>
            <div class="impact-row">
              <span>Sleep {formatNullableDelta(item.deltas.sleepScore)}</span>
              <span
                >Readiness {formatNullableDelta(item.deltas.readinessScore)}</span
              >
              <span>HRV {formatNullableDelta(item.deltas.averageHrv, " ms")}</span>
            </div>
            <p>{describeCorrelation(item)}</p>
          </article>
        {/each}
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
                <dt>HRV</dt>
                <dd>{day.averageHrv}</dd>
              </div>
              <div>
                <dt>RHR</dt>
                <dd>{day.restingHeartRate}</dd>
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

  .sync-strip {
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1.15fr);
    gap: 1rem;
    border-block: 1px solid #dbe2d7;
    padding-block: 1rem;
    margin-bottom: 1rem;
  }

  .sync-strip p:last-child {
    color: #46564c;
    line-height: 1.55;
    max-width: 680px;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

  .correlation-list {
    display: grid;
    gap: 0.7rem;
  }

  .correlation-card {
    border: 1px solid #e4e9df;
    border-radius: 8px;
    padding: 0.85rem;
  }

  .correlation-title,
  .impact-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .correlation-title span {
    color: #65736b;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .impact-row {
    flex-wrap: wrap;
    justify-content: flex-start;
    margin: 0.7rem 0;
  }

  .impact-row span {
    border: 1px solid #dbe2d7;
    border-radius: 999px;
    color: #24362b;
    font-size: 0.78rem;
    font-weight: 750;
    padding: 0.32rem 0.55rem;
  }

  .correlation-card p {
    color: #536258;
    line-height: 1.45;
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
    grid-template-columns: repeat(3, 48px);
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
    .workspace {
      grid-template-columns: 1fr;
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

    dl {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
