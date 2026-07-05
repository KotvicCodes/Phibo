<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from "svelte"
  import { echarts, type EChartsCoreOption } from "./echarts"

  export let option: EChartsCoreOption
  export let height = 340

  const dispatch = createEventDispatcher<{
    selectDay: string
    hover: string
  }>()

  let container: HTMLDivElement
  let chart: ReturnType<typeof echarts.init> | null = null
  let resizeObserver: ResizeObserver | null = null

  // Each datum carries its ISO date in `name` so events map back to the day.
  function datumDate(params: { name?: string }) {
    return typeof params.name === "string" ? params.name : ""
  }

  onMount(() => {
    chart = echarts.init(container)
    chart.setOption(option)
    chart.on("click", (params) => {
      const date = datumDate(params)

      if (date) {
        dispatch("selectDay", date)
      }
    })
    chart.on("mouseover", (params) => {
      const date = datumDate(params)

      if (date) {
        dispatch("hover", date)
      }
    })
    chart.on("mouseout", () => dispatch("hover", ""))
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(container)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    chart?.dispose()
    chart = null
  })

  $: if (chart && option) {
    chart.setOption(option, { notMerge: true })
  }
</script>

<div
  class="echart"
  bind:this={container}
  style={`height: ${height}px`}
  role="img"
/>

<style>
  .echart {
    border-top: 1px solid #d8d8cc;
    padding-block: 0.65rem;
    width: 100%;
  }
</style>
