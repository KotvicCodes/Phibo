import JSZip from "jszip"
import Papa from "papaparse"
import { db } from "../db"
import {
  mapTagEntries,
  mergeDailyMetrics,
  type OuraDailyActivity,
  type OuraDailySummary,
  type OuraMetricInput,
  type OuraSleepSession,
  type OuraTag
} from "./normalizer"

type ImportKind =
  | "dailyActivity"
  | "dailyReadiness"
  | "dailySleep"
  | "sleepSessions"
  | "tags"

interface ImportFileRecord {
  kind: ImportKind
  name: string
  text: string
}

export interface OuraImportResult {
  dailyMetrics: ReturnType<typeof mergeDailyMetrics>
  filesImported: number
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
        "No supported Oura personal export files found. Import the export ZIP or files named dailyactivity.csv, dailyreadiness.csv, dailysleep.csv, sleep.csv, enhancedtag.csv, or their Oura-prefixed JSON/CSV equivalents."
      )
    }

    const metricInput: OuraMetricInput = {
      dailyActivity: [],
      dailyReadiness: [],
      dailySleep: [],
      sleepSessions: []
    }
    const tags: OuraTag[] = []

    for (const file of expandedFiles.supported) {
      const rows = parseImportRows(file)

      if (file.kind === "tags") {
        tags.push(...rows)
      } else {
        metricInput[file.kind].push(...rows)
      }
    }

    const dailyMetrics = mergeDailyMetrics(metricInput)
    const tagEntries = mapTagEntries(tags)

    if (dailyMetrics.length === 0) {
      throw new OuraImportError(
        "The selected Oura files did not include usable daily metric rows."
      )
    }

    const [startDate, endDate] = getMetricDateRange(dailyMetrics)

    await db.transaction("rw", db.dailyMetrics, db.tagEntries, db.importRuns, async () => {
      await db.dailyMetrics.bulkPut(dailyMetrics)

      if (tagEntries.length > 0) {
        await db.tagEntries.bulkPut(tagEntries)
      }

      await db.importRuns.update(importRunId, {
        endDate,
        finishedAt: new Date().toISOString(),
        recordsSynced: dailyMetrics.length + tagEntries.length,
        startDate,
        status: "success"
      })
    })

    return {
      dailyMetrics,
      filesImported: expandedFiles.supported.length,
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

async function expandImportFiles(files: File[]) {
  const supported: ImportFileRecord[] = []
  let unsupported = 0

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      try {
        const archive = await JSZip.loadAsync(await file.arrayBuffer())
        const entries = Object.values(archive.files).filter((entry) => !entry.dir)

        for (const entry of entries) {
          const kind = classifyOuraFile(entry.name)

          if (!kind) {
            unsupported += 1
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
      unsupported += 1
      continue
    }

    supported.push({
      kind,
      name: file.name,
      text: await file.text()
    })
  }

  return {
    supported,
    unsupported
  }
}

function classifyOuraFile(name: string): ImportKind | null {
  const fileName = name.split(/[\\/]/).pop() ?? name
  const normalizedName = fileName.toLowerCase()
  const baseName = normalizedName.replace(/\.(csv|json)$/i, "")
  const compactName = baseName.replace(/[^a-z0-9]/g, "")

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
    compactName === "sleep" ||
    compactName.startsWith("ourasleep")
  ) {
    return "sleepSessions"
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
  const result = Papa.parse<Record<string, unknown>>(prepareCsvText(file.text), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().replace(/^\uFEFF/, "")
  })
  const fatalErrors = result.errors.filter(isFatalCsvError)

  if (fatalErrors.length > 0) {
    throw new OuraImportError(`Could not read ${file.name} as CSV.`)
  }

  return result.data.map(removePapaExtraFields).filter(isImportRow)
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

function getMetricDateRange(dailyMetrics: OuraImportResult["dailyMetrics"]) {
  const dates = dailyMetrics.map((metric) => metric.date).sort()

  return [dates[0], dates.at(-1) ?? dates[0]] as const
}
