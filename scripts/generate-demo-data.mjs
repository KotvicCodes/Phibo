import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"

// Entirely invented data. Keep the seed, dates, and ZIP metadata fixed so
// contributors can reproduce the downloadable archive byte for byte.
const output = new URL("../docs/demo/", import.meta.url)
const archive = new JSZip()
const files = new Map()
let seed = 20250101
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const noise = (spread) => (random() - 0.5) * spread
const score = (value) => Math.round(Math.max(0, Math.min(100, value)))
const integer = (value) => Math.round(value)
const dateAt = (index) =>
  new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10)

function addRow(name, row) {
  if (!files.has(name)) files.set(name, [])
  files.get(name).push(row)
}

for (let index = 0; index < 181; index++) {
  const day = dateAt(index)
  // Independent draws give overlapping habits and comparison days. Rare
  // travel and untagged days also exercise the analysis sample gates.
  const early = random() < 0.4
  const walk = random() < 0.45
  const lateMeal = random() < 0.28
  const coffee = random() < 0.22
  const meditation = random() < 0.3
  const travel = [43, 97, 151].includes(index)
  const seasonal = 2 * Math.sin((index / 181) * Math.PI * 2)
  const sleep = score(78 + 7 * early + 3 * walk - 8 * lateMeal - 6 * coffee - 4 * travel + seasonal + noise(14))
  const readiness = score(77 + 4 * early + 4 * walk - 6 * lateMeal - 4 * coffee - 5 * travel + seasonal + noise(16))
  const activity = score(76 + 10 * walk - 4 * travel + noise(18))
  const totalMinutes = integer(420 + 28 * early - 25 * lateMeal - 18 * coffee + noise(50))
  const deepMinutes = integer(totalMinutes * (0.19 + noise(0.04)))
  const remMinutes = integer(totalMinutes * (0.23 + noise(0.04)))
  const awakeMinutes = integer(28 + 12 * coffee + noise(14))
  const timeInBed = totalMinutes + awakeMinutes
  const end = new Date(`${day}T07:00:00.000Z`)

  addRow("dailysleep.csv", {
    day, score: sleep,
    ContributorsDeepSleep: score(sleep + noise(12)),
    ContributorsEfficiency: score(sleep + noise(10)),
    ContributorsLatency: score(85 - 10 * coffee + noise(12)),
    ContributorsRemSleep: score(sleep + noise(12)),
    ContributorsRestfulness: score(sleep + noise(10)),
    ContributorsTiming: score(80 + 10 * early + noise(10)),
    ContributorsTotalSleep: score(sleep + noise(8))
  })
  addRow("dailyreadiness.csv", {
    day, score: readiness,
    ContributorsActivityBalance: score(activity + noise(10)),
    ContributorsBodyTemperature: score(95 + noise(8)),
    ContributorsHrvBalance: score(readiness + noise(10)),
    ContributorsPreviousDayActivity: score(activity + noise(10)),
    ContributorsPreviousNight: sleep,
    ContributorsRecoveryIndex: score(readiness + noise(10)),
    ContributorsRestingHeartRate: score(readiness + noise(10)),
    ContributorsSleepBalance: score(sleep + noise(10))
  })
  addRow("dailyactivity.csv", {
    day, score: activity,
    steps: integer(6500 + 3500 * walk + noise(3000)),
    active_calories: integer(350 + 180 * walk + noise(100)),
    total_calories: integer(2100 + 180 * walk + noise(160)),
    target_calories: 450,
    low_activity_time: integer(120 + noise(30)) * 60,
    medium_activity_time: integer(20 + 25 * walk + noise(10)) * 60,
    high_activity_time: integer(5 + noise(8)) * 60,
    sedentary_time: integer(480 - 40 * walk + noise(60)) * 60
  })
  addRow("sleepmodel.csv", {
    day, type: "long_sleep",
    bedtime_start: new Date(end.getTime() - timeInBed * 60000).toISOString(),
    bedtime_end: end.toISOString(),
    total_sleep_duration: totalMinutes * 60,
    time_in_bed: timeInBed * 60,
    deep_sleep_duration: deepMinutes * 60,
    rem_sleep_duration: remMinutes * 60,
    light_sleep_duration: (totalMinutes - deepMinutes - remMinutes) * 60,
    awake_time: awakeMinutes * 60,
    latency: integer(10 + 8 * coffee + noise(8)) * 60,
    efficiency: integer((totalMinutes / timeInBed) * 100),
    average_hrv: integer(48 + 8 * early - 7 * lateMeal + noise(16)),
    average_heart_rate: integer(58 - 3 * early + 4 * lateMeal + noise(6)),
    lowest_heart_rate: integer(48 - 2 * early + 3 * lateMeal + noise(4)),
    average_breath: Math.round((14 + noise(2)) * 10) / 10
  })
  addRow("dailystress.csv", {
    day,
    stress_high: integer(90 + 30 * travel + noise(40)) * 60,
    recovery_high: integer(55 + 15 * walk + noise(30)) * 60
  })

  for (const [label, present] of [
    ["Early bedtime", early], ["Evening walk", walk],
    ["Late meal", lateMeal], ["Late coffee", coffee],
    ["Meditation", meditation], ["Travel", travel]
  ]) {
    if (!present) continue
    addRow("enhancedtag.csv", {
      id: `phibo-synthetic-${day}-${label.toLowerCase().replaceAll(" ", "-")}`,
      day, custom_tag_name: `Demo: ${label}`,
      comment: "Entirely synthetic demo; not a real person's health record."
    })
  }
}

const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`
for (const [name, rows] of files) {
  const headers = Object.keys(rows[0])
  const csv = [headers, ...rows.map((row) => headers.map((key) => row[key]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n") + "\n"
  archive.file(name, csv, { date: new Date("2025-01-01T00:00:00.000Z") })
}
archive.comment = "Phibo synthetic demo: invented data, not health evidence."
await mkdir(output, { recursive: true })
await writeFile(new URL("phibo-synthetic-oura.zip", output), await archive.generateAsync({
  type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 },
  platform: "UNIX"
}))
console.log(`Generated ${fileURLToPath(output)}phibo-synthetic-oura.zip (181 days, ${files.get("enhancedtag.csv").length} tag entries).`)
