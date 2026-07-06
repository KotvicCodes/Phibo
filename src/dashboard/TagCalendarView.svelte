<script lang="ts">
  import { createEventDispatcher } from "svelte"
  import { formatTagList } from "./tagLabels"
  import {
    tagCalendarCellLabel,
    type ExploreTagCalendar,
    type ExploreTagCalendarOption
  } from "./tagCalendar"

  export let selectedTags: string[]
  export let calendar: ExploreTagCalendar
  export let options: ExploreTagCalendarOption[]
  export let selectedRange: string
  export let selectedDate = ""

  const tagCalendarSquareSize = "0.78rem"

  const dispatch = createEventDispatcher<{
    hover: string
    selectDay: string
    selectRange: string
  }>()
</script>

<div class="tag-calendar-section">
  <div class="tag-calendar-heading">
    <div>
      <p class="section-kicker">Tag activity</p>
      <h3>
        {selectedTags.length > 0
          ? formatTagList(selectedTags, " + ")
          : "Choose tags"}
      </h3>
    </div>
    <div class="tag-calendar-range">
      <div class="tag-calendar-range-meta">
        <strong>{calendar.rangeLabel}</strong>
        <span>{calendar.taggedDayCount} tagged nights</span>
      </div>
    </div>
  </div>

  {#if selectedTags.length === 0}
    <p class="empty-state">Select tags to see their daily activity.</p>
  {:else}
    <div class="tag-calendar-layout">
      <div class="tag-calendar" aria-label="Selected tag activity by day">
        <span aria-hidden="true" />
        <div
          class="tag-calendar-months"
          style={`grid-template-columns: repeat(${calendar.monthLabels.length}, minmax(0, ${tagCalendarSquareSize}));`}
        >
          {#each calendar.monthLabels as month}
            <span>{month}</span>
          {/each}
        </div>
        {#each calendar.rows as row}
          <span class="tag-calendar-weekday">{row.label}</span>
          <div
            class="tag-calendar-days"
            style={`grid-template-columns: repeat(${row.cells.length}, minmax(0, ${tagCalendarSquareSize}));`}
          >
            {#each row.cells as cell}
              {#if cell.day}
                {@const day = cell.day}
                <button
                  type="button"
                  class:tagged={cell.taggedTags.length > 0}
                  class:selected={selectedDate !== "" && day.date === selectedDate}
                  class="tag-calendar-day"
                  aria-label={tagCalendarCellLabel(cell)}
                  title={tagCalendarCellLabel(cell)}
                  on:mouseenter={() => dispatch("hover", day.date)}
                  on:mouseleave={() => dispatch("hover", "")}
                  on:click={() => dispatch("selectDay", day.date)}
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
      <div
        class="tag-calendar-range-actions"
        aria-label="Tag activity date range"
      >
        {#each options as option}
          <button
            type="button"
            class:active={selectedRange === option.id}
            aria-pressed={selectedRange === option.id}
            on:click={() => dispatch("selectRange", option.id)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
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
    justify-items: end;
    min-width: 10rem;
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
    align-items: stretch;
    flex-direction: column;
    gap: 0.35rem;
    justify-content: flex-end;
    min-width: 5.8rem;
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
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.3rem 0.78rem;
    padding-top: 0.1rem;
    min-width: 0;
  }

  .tag-calendar-layout {
    align-items: flex-end;
    display: flex;
    gap: 1.15rem;
    justify-content: center;
    padding-right: 0.35rem;
    width: 100%;
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
    gap: 0.26rem;
    line-height: 1;
    min-height: 1rem;
    min-width: 0;
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
    gap: 0.26rem;
    min-width: 0;
    padding-block: 0.09rem;
  }

  .tag-calendar-day {
    aspect-ratio: 1;
    background: #ebe7dd;
    border: 1px solid transparent;
    border-radius: 2px;
    box-sizing: border-box;
    display: block;
    line-height: 0;
    min-width: 0;
    padding: 0;
    width: 100%;
  }

  .tag-calendar-day.empty {
    background: transparent;
  }

  button.tag-calendar-day {
    appearance: none;
    cursor: pointer;
    font: inherit;
  }

  .tag-calendar-day.selected {
    outline: 2px solid #4f8a63;
    outline-offset: 1px;
  }

  .tag-calendar-day.tagged {
    background: #1e2c64;
    border-color: #1e2c64;
  }

  @media (max-width: 560px) {
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

    .tag-calendar-layout {
      align-items: flex-start;
      flex-direction: column;
      justify-content: flex-start;
    }
  }
</style>
