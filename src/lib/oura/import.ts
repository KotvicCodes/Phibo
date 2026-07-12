import JSZip from "jszip"
import Papa from "papaparse"
import { db } from "../db"
import type { DailyMetricRow } from "../db/types"
import { filterTombstonedTagEntries, getDeletedTagIdSet } from "../tags/store"
import {
  mapTagEntries,
  mergeDailyMetrics,
  type OuraDailyActivity,
  type OuraDailySummary,
  type OuraMetricInput,
  type OuraTag
} from "./normalizer"

type ImportKind =
  | "cardiovascularAge"
  | "dailyActivity"
  | "dailyReadiness"
  | "dailyResilience"
  | "dailySleep"
  | "dailySpo2"
  | "dailyStress"
  | "sleepSessions"
  | "smoothedCardiovascularAge"
  | "tags"
  | "vo2Max"
  | "workouts"

interface ImportFileRecord {
  kind: ImportKind
  name: string
  text: string
}

interface ParsedFileSummary {
  headers: string[]
  name: string
  rows: number
}

interface OuraImportResult {
  dailyMetrics: ReturnType<typeof mergeDailyMetrics>
  filesImported: number
  // Known Oura export files Phibo deliberately does not import
  // (raw time series, device data, recommendations, location).
  ignoredFiles: number
  skippedFiles: number
  tagEntries: ReturnType<typeof mapTagEntries>
  unsupportedFiles: number
}

interface CsvParseError {
  code?: string
  type?: string
}

export class OuraImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OuraImportError"
  }
}

export async function importOuraFiles(files: File[]) {
  if (files.length === 0) {
    throw new OuraImportError("Choose an Oura export ZIP, JSON, or CSV file.")
  }

  const startedAt = new Date().toISOString()
  const importRunId = crypto.randomUUID()

  await db.importRuns.add({
    id: importRunId,
    startedAt,
    finishedAt: null,
    status: "running",
    startDate: startedAt.slice(0, 10),
    endDate: startedAt.slice(0, 10),
    recordsSynced: 0,
    errorMessage: null,
    source: "file_import"
  })

  try {
    const expandedFiles = await expandImportFiles(files)

    if (expandedFiles.supported.length === 0) {
      throw new OuraImportError(
        "No supported Oura personal export files found. Import the export ZIP or files named dailyactivity.csv, dailyreadiness.csv, dailysleep.csv, dailyspo2.csv, dailystress.csv, dailyresilience.csv, dailycardiovascularage.csv, sleepmodel.csv, workout.csv, vo2max.csv, enhancedtag.csv, or their Oura-prefixed JSON/CSV equivalents."
      )
    }

    const metricInput: OuraMetricInput = {
      cardiovascularAge: [],
      dailyActivity: [],
      dailyReadiness: [],
      dailyResilience: [],
      dailySleep: [],
      dailySpo2: [],
      dailyStress: [],
      sleepSessions: [],
      smoothedCardiovascularAge: [],
      vo2Max: [],
      workouts: []
    }
    const tags: OuraTag[] = []
    const parsedFileSummaries: ParsedFileSummary[] = []
    const parseFailures: string[] = []

    for (const file of expandedFiles.supported) {
      const rows = tryParseImportRows(file, parseFailures)

      if (!rows) {
        continue
      }

      parsedFileSummaries.push(summarizeParsedFile(file.name, rows))

      if (file.kind === "tags") {
        tags.push(...rows)
      } else {
        metricInput[file.kind].push(...rows)
      }
    }

    const dailyMetrics = mergeDailyMetrics(metricInput)
    const tagEntries = mapTagEntries(tags)

    if (dailyMetrics.length === 0 && tagEntries.length === 0) {
      throw new OuraImportError(
        `The selected Oura files did not include usable daily metric or tag rows. ${formatParsedFileSummaries(parsedFileSummaries)}${formatParseFailures(parseFailures)}${formatUnsupportedFiles(expandedFiles.unsupported)}`
      )
    }

    const [startDate, endDate] = getImportDateRange(dailyMetrics, tagEntries)

    await db.transaction(
      "rw",
      db.dailyMetrics,
      db.tagEntries,
      db.deletedTagIds,
      db.importRuns,
      async () => {
        if (dailyMetrics.length > 0) {
          // Merge into any previously stored rows so importing a subset of
          // files (for example only workout.csv) does not null out metrics
          // that came from an earlier import.
          const storedRows = await db.dailyMetrics.bulkGet(
            dailyMetrics.map((metric) => metric.date)
          )

          await db.dailyMetrics.bulkPut(
            dailyMetrics.map((metric, index) =>
              mergeWithStoredRow(storedRows[index], metric)
            )
          )
        }

        if (tagEntries.length > 0) {
          // Skip tags the user deleted in the app so a re-import of the
          // same export does not resurrect them.
          const deletedIds = await getDeletedTagIdSet()

          await db.tagEntries.bulkPut(
            filterTombstonedTagEntries(tagEntries, deletedIds)
          )
        }

        await db.importRuns.update(importRunId, {
          endDate,
          finishedAt: new Date().toISOString(),
          recordsSynced: dailyMetrics.length + tagEntries.length,
          startDate,
          status: "success"
        })
      }
    )

    return {
      dailyMetrics,
      filesImported: parsedFileSummaries.length,
      ignoredFiles: expandedFiles.ignored,
      skippedFiles: parseFailures.length,
      tagEntries,
      unsupportedFiles: expandedFiles.unsupported
    } satisfies OuraImportResult
  } catch (error) {
    await db.importRuns.update(importRunId, {
      errorMessage:
        error instanceof Error ? error.message : "Unknown Oura import error",
      finishedAt: new Date().toISOString(),
      status: "error"
    })

    throw error
  }
}

function tryParseImportRows(file: ImportFileRecord, failures: string[]) {
  try {
    return parseImportRows(file)
  } catch (error) {
    failures.push(formatParseFailure(file.name, error))

    return null
  }
}

async function expandImportFiles(files: File[]) {
  const supported: ImportFileRecord[] = []
  let ignored = 0
  let unsupported = 0

  const countSkippedFile = (name: string) => {
    if (isKnownIgnoredOuraFile(name)) {
      ignored += 1
    } else {
      unsupported += 1
    }
  }

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      try {
        const archive = await JSZip.loadAsync(await file.arrayBuffer())
        const entries = Object.values(archive.files).filter((entry) => !entry.dir)

        for (const entry of entries) {
          const kind = classifyOuraFile(entry.name)

          if (!kind) {
            countSkippedFile(entry.name)
            continue
          }

          supported.push({
            kind,
            name: entry.name,
            text: await entry.async("text")
          })
        }
      } catch {
        throw new OuraImportError("Could not read that Oura export ZIP file.")
      }

      continue
    }

    const kind = classifyOuraFile(file.name)

    if (!kind) {
      countSkippedFile(file.name)
      continue
    }

    supported.push({
      kind,
      name: file.name,
      text: await file.text()
    })
  }

  return {
    ignored,
    supported,
    unsupported
  }
}

// Oura export files Phibo deliberately does not import: raw time series,
// intraday samples, device/app data, recommendations, location, and files
// that are empty in current exports.
const knownIgnoredOuraFilePrefixes = [
  "applicationdebugstate",
  "behaviorcoaching",
  "bloodglucose",
  "dailycyclephases",
  "dailymetabolicscore",
  "daytimestress",
  "fooditem",
  "glp1settings",
  "heartrate",
  "hormonalcontraception",
  "labtestresult",
  "meal",
  "medication",
  "nonhormonalcontraception",
  "otherreproductivehormone",
  "personalinfo",
  "rawlocation",
  "restmodeperiod",
  "ringbatterylevel",
  "ringconfiguration",
  "session",
  "sleepstorysession",
  "sleeptime",
  "surveyresponse",
  "temperature",
  "userconsentsettings"
]

function isKnownIgnoredOuraFile(name: string) {
  const compactName = getCompactFileName(name)

  return knownIgnoredOuraFilePrefixes.some(
    (prefix) =>
      compactName.startsWith(prefix) || compactName.startsWith(`oura${prefix}`)
  )
}

function getCompactFileName(name: string) {
  const fileName = name.split(/[\\/]/).pop() ?? name
  const baseName = fileName.toLowerCase().replace(/\.(csv|json)$/i, "")

  return baseName.replace(/[^a-z0-9]/g, "")
}

function classifyOuraFile(name: string): ImportKind | null {
  const compactName = getCompactFileName(name)

  if (
    compactName === "dailysleep" ||
    compactName.startsWith("ouradailysleep")
  ) {
    return "dailySleep"
  }

  if (
    compactName === "dailyreadiness" ||
    compactName.startsWith("ouradailyreadiness")
  ) {
    return "dailyReadiness"
  }

  if (
    compactName === "dailyactivity" ||
    compactName.startsWith("ouradailyactivity")
  ) {
    return "dailyActivity"
  }

  if (
    compactName === "sleepmodel" ||
    compactName.startsWith("ourasleepmodel")
  ) {
    return "sleepSessions"
  }

  if (
    compactName === "vo2max" ||
    compactName.startsWith("ouravo2max")
  ) {
    return "vo2Max"
  }

  if (
    compactName === "workout" ||
    compactName === "workouts" ||
    compactName.startsWith("ouraworkout")
  ) {
    return "workouts"
  }

  if (
    compactName === "dailyspo2" ||
    compactName.startsWith("ouradailyspo2")
  ) {
    return "dailySpo2"
  }

  if (
    compactName === "dailystress" ||
    compactName.startsWith("ouradailystress")
  ) {
    return "dailyStress"
  }

  if (
    compactName === "dailyresilience" ||
    compactName.startsWith("ouradailyresilience")
  ) {
    return "dailyResilience"
  }

  if (
    compactName === "dailysmoothedcardiovascularage" ||
    compactName.startsWith("ouradailysmoothedcardiovascularage")
  ) {
    return "smoothedCardiovascularAge"
  }

  if (
    compactName === "dailycardiovascularage" ||
    compactName.startsWith("ouradailycardiovascularage")
  ) {
    return "cardiovascularAge"
  }

  if (
    compactName === "enhancedtag" ||
    compactName === "tags" ||
    compactName.startsWith("ouraenhancedtag")
  ) {
    return "tags"
  }

  return null
}

function parseImportRows(file: ImportFileRecord) {
  const extension = file.name.toLowerCase().split(".").pop()

  if (extension === "csv") {
    return parseCsvRows(file)
  }

  if (extension === "json") {
    return parseJsonRows(file)
  }

  throw new OuraImportError(
    `${file.name} is not a supported Oura JSON or CSV file.`
  )
}

function parseCsvRows(file: ImportFileRecord) {
  const csvText = prepareCsvText(file.text)
  const delimiter = detectCsvDelimiter(csvText)
  const result = Papa.parse<Record<string, unknown>>(csvText, {
    delimiter,
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, "")
  })
  const fatalErrors = result.errors.filter(isFatalCsvError)

  if (fatalErrors.length > 0) {
    throw new OuraImportError(
      `Could not read ${file.name} as CSV (${formatCsvErrors(fatalErrors)}).`
    )
  }

  return result.data.map(removePapaExtraFields).filter(isImportRow)
}

function formatCsvErrors(errors: CsvParseError[]) {
  return errors
    .slice(0, 3)
    .map((error) => error.code ?? error.type ?? "parse error")
    .join(", ")
}

function detectCsvDelimiter(text: string) {
  const firstDataLine =
    text
      .split(/\r?\n/)
      .find((line) => line.trim() !== "") ?? ""
  const delimiterCounts = [
    { delimiter: ";", count: countOccurrences(firstDataLine, ";") },
    { delimiter: "\t", count: countOccurrences(firstDataLine, "\t") },
    { delimiter: ",", count: countOccurrences(firstDataLine, ",") }
  ].sort((left, right) => right.count - left.count)

  return delimiterCounts[0].count > 0 ? delimiterCounts[0].delimiter : ""
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1
}

function prepareCsvText(text: string) {
  const normalizedText = text.replace(/^\uFEFF/, "")

  return normalizedText.replace(/^sep=.\r?\n/i, "")
}

function isFatalCsvError(error: CsvParseError) {
  return !(
    error.type === "FieldMismatch" ||
    error.code === "TooFewFields" ||
    error.code === "TooManyFields"
  )
}

function removePapaExtraFields(row: Record<string, unknown>) {
  const { __parsed_extra: _extraFields, ...cleanRow } = row

  return cleanRow
}

function summarizeParsedFile(
  name: string,
  rows: Record<string, unknown>[]
): ParsedFileSummary {
  return {
    headers: getRowHeaders(rows),
    name,
    rows: rows.length
  }
}

function getRowHeaders(rows: Record<string, unknown>[]) {
  const headers = new Set<string>()

  rows.slice(0, 3).forEach((row) => {
    Object.keys(row)
      .filter((key) => key.trim() !== "")
      .forEach((key) => headers.add(key))
  })

  return Array.from(headers).slice(0, 10)
}

function formatParsedFileSummaries(summaries: ParsedFileSummary[]) {
  if (summaries.length === 0) {
    return "No supported files were parsed."
  }

  const formattedSummaries = summaries.slice(0, 6).map((summary) => {
    const headers =
      summary.headers.length > 0 ? summary.headers.join(", ") : "none"

    return `${summary.name}: ${summary.rows} rows; headers: ${headers}`
  })

  const remainingCount = summaries.length - formattedSummaries.length
  const remainingText =
    remainingCount > 0 ? `; plus ${remainingCount} more supported files` : ""

  return `Parsed ${summaries.length} supported files (${formattedSummaries.join(" | ")}${remainingText}).`
}

function formatParseFailure(name: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown parse error"

  return `${name}: ${message}`
}

function formatParseFailures(failures: string[]) {
  if (failures.length === 0) {
    return ""
  }

  const formattedFailures = failures.slice(0, 4).join(" | ")
  const remainingCount = failures.length - Math.min(failures.length, 4)
  const remainingText =
    remainingCount > 0 ? `; plus ${remainingCount} more parse failures` : ""

  return ` Skipped unreadable supported files (${formattedFailures}${remainingText}).`
}

function formatUnsupportedFiles(count: number) {
  return count > 0 ? ` Ignored ${count} unrecognized files.` : ""
}

function parseJsonRows(file: ImportFileRecord) {
  try {
    return extractJsonRows(JSON.parse(file.text), file.kind).filter(isImportRow)
  } catch {
    throw new OuraImportError(`Could not read ${file.name} as JSON.`)
  }
}

function extractJsonRows(value: unknown, kind: ImportKind): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!isPlainRecord(value)) {
    return []
  }

  const byKind = value[kind]

  if (Array.isArray(byKind)) {
    return byKind
  }

  const data = value.data ?? value.Data

  if (Array.isArray(data)) {
    return data
  }

  const firstArray = Object.values(value).find(Array.isArray)

  if (Array.isArray(firstArray)) {
    return firstArray
  }

  return [value]
}

function isImportRow(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function getImportDateRange(
  dailyMetrics: OuraImportResult["dailyMetrics"],
  tagEntries: OuraImportResult["tagEntries"]
) {
  const dates = [
    ...dailyMetrics.map((metric) => metric.date),
    ...tagEntries.map((entry) => entry.date)
  ].sort()

  return [dates[0], dates.at(-1) ?? dates[0]] as const
}

function mergeWithStoredRow(
  storedRow: DailyMetricRow | undefined,
  incomingRow: DailyMetricRow
): DailyMetricRow {
  if (!storedRow) {
    return incomingRow
  }

  const mergedRow: Record<string, unknown> = { ...storedRow }

  for (const [key, value] of Object.entries(incomingRow)) {
    if (value !== null && value !== undefined) {
      mergedRow[key] = value
    }
  }

  return mergedRow as unknown as DailyMetricRow
}
