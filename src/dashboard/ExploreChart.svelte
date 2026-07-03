<script lang="ts">
  import { createEventDispatcher } from "svelte"
  import type { ExploreDay } from "../lib/analysis/correlations"
  import {
    chartHeight,
    chartPadding,
    chartWidth,
    timelinePath,
    type ChartPoint,
    type ChartTick
  } from "./exploreCharts"
  import { formatDate } from "./format"

  export let mode: "scatter" | "timeline"
  export let points: ChartPoint[]
  export let xTicks: ChartTick[]
  export let yTicks: ChartTick[]
  export let xTitle: string
  export let yTitle: string

  const dispatch = createEventDispatcher<{
    selectDay: ExploreDay
    hover: string
  }>()

  function pointRadius(matches: boolean) {
    if (mode === "timeline") {
      return matches ? 7 : 4
    }

    return matches ? 8 : 5
  }

  function handleKeydown(event: KeyboardEvent, day: ExploreDay) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      dispatch("selectDay", day)
    }
  }
</script>

<div class="svg-chart">
  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img">
    {#each yTicks as tick}
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
    {#each xTicks as tick}
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
    {#if mode === "timeline"}
      <path class="timeline-line" d={timelinePath(points)} />
    {/if}
    {#each points as point}
      <circle
        class:match={point.day.matches}
        class="scatter-point"
        role="button"
        tabindex="0"
        aria-label={`Select ${formatDate(point.day.date)}`}
        cx={point.x}
        cy={point.y}
        r={pointRadius(point.day.matches)}
        on:mouseenter={() => dispatch("hover", point.day.date)}
        on:mouseleave={() => dispatch("hover", "")}
        on:focus={() => dispatch("hover", point.day.date)}
        on:blur={() => dispatch("hover", "")}
        on:click={() => dispatch("selectDay", point.day)}
        on:keydown={(event) => handleKeydown(event, point.day)}
      />
    {/each}
    <text class="axis-title x" x={chartWidth / 2} y={chartHeight - 8}>
      {xTitle}
    </text>
    <text
      class="axis-title y"
      transform={`translate(14 ${chartHeight / 2}) rotate(-90)`}
    >
      {yTitle}
    </text>
  </svg>
</div>

<style>
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
</style>
