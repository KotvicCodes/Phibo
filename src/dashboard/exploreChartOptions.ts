import type {
  ExploreDay,
  ExploreMetricDefinition
} from "../lib/analysis/correlations"
import type { EChartsCoreOption } from "./echarts"
import { formatAxisValue, formatMetricValue, metricAxisLabel } from "./exploreCharts"
import { formatTagLabel, sortTagsForDisplay } from "./tagLabels"

const textColor = "#6f786f"
const gridColor = "rgba(207, 210, 196, 0.56)"
const axisColor = "#cfd2c4"
const matchColor = "#4f8a63"
const otherColor = "#9ca69a"
const trendColor = "#1e2c64"
// A regression through a handful of points is noise, not signal.
const minTrendPoints = 10
const fontFamily =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const dayMs = 86_400_000

// Days can carry many tags; wrap only the tag block so the date and metric
// lines stay on single lines. Line breaks happen between tags, never inside
// a tag name.
// Tag labels come from import files, so escape them before injecting
// them into the tooltip markup.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function tooltipTagsHtml(tags: string[]) {
  const label =
    tags.length > 0
      ? sortTagsForDisplay(tags)
          .map(
            (tag) =>
              `<span style="white-space: nowrap;">${escapeHtml(formatTagLabel(tag))}</span>`
          )
          .join(", ")
      : "no tags"

  return `<div style="max-width: 260px; white-space: normal; line-height: 1.45;">${label}</div>`
}

interface NiceAxisBounds {
  min: number
  max: number
  interval: number
}

function dateMs(date: string) {
  return new Date(`${date}T12:00:00`).getTime()
}

function formatTooltipDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`))
}

function metricValues(days: ExploreDay[], metric: ExploreMetricDefinition) {
  return days
    .map((day) => day.metric[metric.key])
    .filter((value): value is number => value != null)
}

// Zoom-to-data bounds rounded outward to a nice step, clamped so the axis
// never extends past the metric's hard bounds (scores stop at exactly 100,
// counts never dip below 0). The clamp points 0 and 100 are step multiples
// for every step this produces, so tick labels stay round after clamping.
function niceAxisBounds(
  values: number[],
  metric: ExploreMetricDefinition,
  targetTicks = 5
): NiceAxisBounds {
  // Hours-displayed durations need ticks that are round in hours, not in
  // stored minutes: compute in hours, then scale back to minute units.
  if (metric.displayAsHours) {
    const hourBounds = niceAxisBounds(
      values.map((value) => value / 60),
      { ...metric, displayAsHours: false },
      targetTicks
    )

    return {
      min: hourBounds.min * 60,
      max: hourBounds.max * 60,
      interval: hourBounds.interval * 60
    }
  }

  let min: number
  let max: number

  if (values.length === 0) {
    min = metric.domainMin ?? 0
    max = metric.domainMax ?? 1
  } else {
    min = Math.min(...values)
    max = Math.max(...values)
  }

  if (min === max) {
    const span = Math.max(Math.abs(min) * 0.1, 1)
    min -= span
    max += span
  }

  const pad = (max - min) * 0.05
  min = Math.max(min - pad, metric.domainMin ?? -Infinity)
  max = Math.min(max + pad, metric.domainMax ?? Infinity)

  const rawStep = (max - min) / (targetTicks - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const base = rawStep / magnitude
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10
  const step = niceBase * magnitude

  const niceMin = Math.max(
    Math.floor(min / step) * step,
    metric.domainMin ?? -Infinity
  )
  const niceMax = Math.min(
    Math.ceil(max / step) * step,
    metric.domainMax ?? Infinity
  )

  return { min: niceMin, max: niceMax, interval: step }
}

function valueAxis(metric: ExploreMetricDefinition, bounds: NiceAxisBounds) {
  return {
    type: "value" as const,
    name: metricAxisLabel(metric),
    nameLocation: "middle" as const,
    nameGap: 38,
    nameTextStyle: { color: textColor, fontWeight: 700 },
    min: bounds.min,
    max: bounds.max,
    interval: bounds.interval,
    axisLine: { show: true, lineStyle: { color: axisColor, width: 2 } },
    axisLabel: {
      color: textColor,
      formatter: (value: number) => formatAxisValue(value, metric)
    },
    splitLine: { lineStyle: { color: gridColor } }
  }
}

function baseOption(): EChartsCoreOption {
  return {
    aria: { enabled: true },
    animationDuration: 220,
    textStyle: { fontFamily },
    backgroundColor: "transparent"
  }
}

interface TimelineDatum {
  name: string
  value: [number, number | null]
}

function linearFit(points: Array<readonly [number, number]>) {
  const n = points.length
  const sumX = points.reduce((total, [x]) => total + x, 0)
  const sumY = points.reduce((total, [, y]) => total + y, 0)
  const meanX = sumX / n
  const meanY = sumY / n
  let covariance = 0
  let varianceX = 0
  let varianceY = 0

  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY)
    varianceX += (x - meanX) ** 2
    varianceY += (y - meanY) ** 2
  }

  if (varianceX === 0 || varianceY === 0) {
    return null
  }

  return {
    slope: covariance / varianceX,
    intercept: meanY - (covariance / varianceX) * meanX,
    r: covariance / Math.sqrt(varianceX * varianceY)
  }
}

// Centered rolling mean over a calendar window, gap-aware: days with too
// little surrounding data yield null so the trend breaks instead of
// bridging holes in the dataset.
function rollingAverageSeries(
  usable: ExploreDay[],
  metric: ExploreMetricDefinition,
  windowDays = 30,
  minWindowValues = 3
) {
  const halfWindow = windowDays / 2
  const epochs = usable.map((day) => dateMs(day.date) / dayMs)
  const values = usable.map((day) => day.metric[metric.key] as number)
  let start = 0
  let end = 0

  return usable.map((day, index) => {
    while (epochs[start] < epochs[index] - halfWindow) {
      start += 1
    }

    while (end < usable.length && epochs[end] <= epochs[index] + halfWindow) {
      end += 1
    }

    const windowValues = values.slice(start, end)
    const average =
      windowValues.length >= minWindowValues
        ? windowValues.reduce((total, value) => total + value, 0) /
          windowValues.length
        : null

    return { value: [dateMs(day.date), average] }
  })
}

// Break the line where the calendar gap between points is unusually large:
// daily metrics split across multi-week holes, while sparse metrics (whose
// normal cadence is already weeks) stay connected.
function timelineSeriesData(days: ExploreDay[], metric: ExploreMetricDefinition) {
  const usable = days.filter((day) => day.metric[metric.key] != null)
  const gaps = usable
    .slice(1)
    .map((day, index) => (dateMs(day.date) - dateMs(usable[index].date)) / dayMs)
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] ?? 1
  const joinThreshold = Math.max(3, medianGap * 2)

  const data: TimelineDatum[] = []
  usable.forEach((day, index) => {
    if (index > 0 && gaps[index - 1] > joinThreshold) {
      data.push({
        name: "",
        value: [(dateMs(day.date) + dateMs(usable[index - 1].date)) / 2, null]
      })
    }

    data.push({
      name: day.date,
      value: [dateMs(day.date), day.metric[metric.key] as number]
    })
  })

  return { data, usable }
}

export function buildTimelineOption(
  days: ExploreDay[],
  metric: ExploreMetricDefinition
): EChartsCoreOption {
  const { data, usable } = timelineSeriesData(days, metric)
  const bounds = niceAxisBounds(metricValues(days, metric), metric)
  const dayByDate = new Map(usable.map((day) => [day.date, day]))
  const matchedData = usable
    .filter((day) => day.matches)
    .map((day) => ({
      name: day.date,
      value: [dateMs(day.date), day.metric[metric.key] as number]
    }))

  return {
    ...baseOption(),
    grid: { left: 64, right: 24, top: 20, bottom: 64 },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: Array<{ name: string }>) => {
        const date = params.find((item) => item.name)?.name

        if (!date) {
          return ""
        }

        const day = dayByDate.get(date)
        const value = formatMetricValue(
          day?.metric[metric.key] ?? null,
          metric
        )
        return `<strong>${formatTooltipDate(date)}</strong><br/>${metric.label}: <strong>${value}</strong>${tooltipTagsHtml(day?.tags ?? [])}`
      }
    },
    xAxis: {
      type: "time",
      axisLine: { show: true, lineStyle: { color: axisColor, width: 2 } },
      axisLabel: { color: textColor },
      splitLine: { show: false }
    },
    yAxis: valueAxis(metric, bounds),
    dataZoom: [
      { type: "inside" },
      {
        type: "slider",
        height: 18,
        bottom: 10,
        borderColor: axisColor,
        fillerColor: "rgba(156, 166, 154, 0.2)",
        handleStyle: { color: otherColor }
      }
    ],
    series: [
      {
        type: "line",
        name: metric.label,
        data,
        connectNulls: false,
        showSymbol: true,
        symbolSize: 6,
        itemStyle: { color: otherColor },
        lineStyle: { color: textColor, width: 2, opacity: 0.55 },
        emphasis: { scale: 1.6 }
      },
      {
        type: "line",
        name: "30-day average",
        data: rollingAverageSeries(usable, metric),
        connectNulls: false,
        showSymbol: false,
        silent: true,
        smooth: 0.25,
        lineStyle: { color: trendColor, width: 2.5 },
        itemStyle: { color: trendColor },
        z: 2
      },
      {
        type: "scatter",
        name: "Tagged days",
        data: matchedData,
        symbolSize: 11,
        itemStyle: {
          color: matchColor,
          borderColor: "#fbf7ef",
          borderWidth: 2
        },
        z: 3
      }
    ]
  }
}

export function buildScatterOption(
  days: ExploreDay[],
  xMetric: ExploreMetricDefinition,
  yMetric: ExploreMetricDefinition
): EChartsCoreOption {
  const usable = days.filter(
    (day) => day.metric[xMetric.key] != null && day.metric[yMetric.key] != null
  )
  const xBounds = niceAxisBounds(metricValues(usable, xMetric), xMetric)
  const yBounds = niceAxisBounds(metricValues(usable, yMetric), yMetric)
  const dayByDate = new Map(usable.map((day) => [day.date, day]))
  // With tags selected, fit tagged and other days separately: diverging
  // slopes show the tag changing the relationship itself, not just the
  // averages. Without a selection there is one overall trend.
  const hasMatches = usable.some((day) => day.matches)
  const trendGroups = (
    hasMatches
      ? [
          {
            label: "tagged",
            days: usable.filter((day) => day.matches),
            color: matchColor
          },
          {
            label: "other",
            days: usable.filter((day) => !day.matches),
            color: textColor
          }
        ]
      : [{ label: "", days: usable, color: textColor }]
  )
    .map((group) => {
      const points = group.days.map(
        (day) =>
          [
            day.metric[xMetric.key] as number,
            day.metric[yMetric.key] as number
          ] as const
      )
      const fit = points.length >= minTrendPoints ? linearFit(points) : null
      const xs = points.map(([x]) => x)

      return {
        ...group,
        count: points.length,
        fit,
        trendData: fit
          ? [Math.min(...xs), Math.max(...xs)].map((x) => [
              x,
              fit.intercept + fit.slope * x
            ])
          : []
      }
    })
    .filter((group) => group.fit !== null)

  const toDatum = (day: ExploreDay) => ({
    name: day.date,
    value: [
      day.metric[xMetric.key] as number,
      day.metric[yMetric.key] as number
    ]
  })

  return {
    ...baseOption(),
    // Leave headroom above the plot for the stacked trend labels so they
    // never overlap data points.
    grid: {
      left: 64,
      right: 24,
      top: trendGroups.length > 0 ? 12 + trendGroups.length * 17 + 10 : 20,
      bottom: 52
    },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: { name: string }) => {
        const day = dayByDate.get(params.name)

        if (!day) {
          return ""
        }

        const xValue = formatMetricValue(day.metric[xMetric.key] ?? null, xMetric)
        const yValue = formatMetricValue(day.metric[yMetric.key] ?? null, yMetric)
        return `<strong>${formatTooltipDate(day.date)}</strong><br/>${xMetric.label}: <strong>${xValue}</strong><br/>${yMetric.label}: <strong>${yValue}</strong>${tooltipTagsHtml(day.tags)}`
      }
    },
    xAxis: { ...valueAxis(xMetric, xBounds), nameGap: 30 },
    yAxis: valueAxis(yMetric, yBounds),
    graphic: trendGroups.map((group, index) => ({
      type: "text",
      right: 30,
      top: 6 + index * 17,
      silent: true,
      style: {
        text: `${group.label ? `${group.label}: ` : ""}r = ${group.fit!.r.toFixed(2)} · n = ${group.count}`,
        fill: group.color,
        fontFamily,
        fontSize: 12,
        fontWeight: 700
      }
    })),
    series: [
      ...trendGroups.map((group) => ({
        type: "line" as const,
        name: group.label ? `${group.label} trend` : "Trend",
        data: group.trendData,
        showSymbol: false,
        silent: true,
        lineStyle: {
          color: group.color,
          width: 2,
          type: "dashed" as const,
          opacity: 0.8
        },
        z: 1
      })),
      {
        type: "scatter",
        name: "Other days",
        data: usable.filter((day) => !day.matches).map(toDatum),
        symbolSize: 9,
        itemStyle: {
          color: otherColor,
          opacity: 0.82,
          borderColor: "#fbf7ef",
          borderWidth: 1.5
        }
      },
      {
        type: "scatter",
        name: "Tagged days",
        data: usable.filter((day) => day.matches).map(toDatum),
        symbolSize: 13,
        itemStyle: {
          color: matchColor,
          borderColor: "#fbf7ef",
          borderWidth: 2
        },
        z: 3
      }
    ]
  }
}
