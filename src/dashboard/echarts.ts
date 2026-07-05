// Tree-shaken ECharts bundle: only the pieces the Explore charts use.
// Everything renders locally to canvas: no network access, no telemetry.
import { LineChart, ScatterChart } from "echarts/charts"
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent
} from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"

echarts.use([
  AriaComponent,
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LineChart,
  ScatterChart,
  TooltipComponent
])

export { echarts }
export type { EChartsCoreOption } from "echarts/core"
