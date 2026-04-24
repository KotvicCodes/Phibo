<script lang="ts">
  import logoUrl from "../../assets/phibo-mark.svg"

  interface MetricSummary {
    label: string
    value: string
    delta: string
    tone: "good" | "steady" | "watch"
  }

  interface TagCorrelation {
    tag: string
    days: number
    sleepScoreDelta: number
    readinessDelta: number
    hrvDelta: number
    note: string
  }

  interface SleepDay {
    date: string
    score: number
    readiness: number
    hrv: number
    restingHeartRate: number
    tags: string[]
  }

  const summaries: MetricSummary[] = [
    {
      label: "Sleep score",
      value: "88",
      delta: "+5 vs baseline",
      tone: "good"
    },
    {
      label: "Readiness",
      value: "82",
      delta: "+2 this week",
      tone: "steady"
    },
    {
      label: "HRV",
      value: "68 ms",
      delta: "+7 on tagged nights",
      tone: "good"
    },
    {
      label: "Resting HR",
      value: "49 bpm",
      delta: "-3 after earlier meals",
      tone: "good"
    }
  ]

  const correlations: TagCorrelation[] = [
    {
      tag: "dark bedroom",
      days: 18,
      sleepScoreDelta: 6.4,
      readinessDelta: 3.1,
      hrvDelta: 7.8,
      note: "Best lift across sleep score and HRV."
    },
    {
      tag: "late caffeine",
      days: 9,
      sleepScoreDelta: -7.2,
      readinessDelta: -5.4,
      hrvDelta: -6.9,
      note: "Most visible negative pattern."
    },
    {
      tag: "cool room",
      days: 14,
      sleepScoreDelta: 4.8,
      readinessDelta: 2.4,
      hrvDelta: 5.1,
      note: "Strongest when paired with dark bedroom."
    }
  ]

  const recentDays: SleepDay[] = [
    {
      date: "Apr 23",
      score: 91,
      readiness: 84,
      hrv: 72,
      restingHeartRate: 48,
      tags: ["dark bedroom", "cool room"]
    },
    {
      date: "Apr 22",
      score: 76,
      readiness: 72,
      hrv: 58,
      restingHeartRate: 53,
      tags: ["late caffeine"]
    },
    {
      date: "Apr 21",
      score: 88,
      readiness: 81,
      hrv: 69,
      restingHeartRate: 49,
      tags: ["dark bedroom"]
    },
    {
      date: "Apr 20",
      score: 83,
      readiness: 79,
      hrv: 65,
      restingHeartRate: 50,
      tags: ["early dinner"]
    }
  ]

  const trendPoints = recentDays
    .slice()
    .reverse()
    .map((day) => `${day.score},${100 - day.readiness}`)
    .join(" ")

  function formatDelta(value: number) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`
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
              <span>{item.days} nights</span>
            </div>
            <div class="impact-row">
              <span>Sleep {formatDelta(item.sleepScoreDelta)}</span>
              <span>Readiness {formatDelta(item.readinessDelta)}</span>
              <span>HRV {formatDelta(item.hrvDelta)} ms</span>
            </div>
            <p>{item.note}</p>
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
              <strong>{day.date}</strong>
              <span>{day.tags.join(", ")}</span>
            </div>
            <dl>
              <div>
                <dt>Sleep</dt>
                <dd>{day.score}</dd>
              </div>
              <div>
                <dt>HRV</dt>
                <dd>{day.hrv}</dd>
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
