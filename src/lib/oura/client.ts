const OURA_API_BASE_URL = "https://api.ouraring.com/v2/usercollection"

export interface OuraCollectionResponse<T> {
  data: T[]
  next_token?: string
}

export interface OuraCollectionParams {
  end_date: string
  start_date: string
  next_token?: string
}

interface OuraErrorPayload {
  detail?: string
  error?: string
  error_description?: string
  status?: number
  title?: string
}

export class OuraApiError extends Error {
  detail?: string
  endpoint: string
  oauthError?: string
  status: number
  title?: string

  constructor(input: {
    detail?: string
    endpoint: string
    oauthError?: string
    status: number
    title?: string
  }) {
    super(formatOuraErrorMessage(input))
    this.name = "OuraApiError"
    this.detail = input.detail
    this.endpoint = input.endpoint
    this.oauthError = input.oauthError
    this.status = input.status
    this.title = input.title
  }
}

export async function fetchOuraCollection<T>(
  accessToken: string,
  path: string,
  params: OuraCollectionParams
) {
  const records: T[] = []
  let nextToken: string | undefined = params.next_token

  do {
    const url = buildUrl(path, {
      ...params,
      next_token: nextToken
    })
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      throw await createOuraApiError(response, path)
    }

    const payload = (await response.json()) as Partial<OuraCollectionResponse<T>>

    if (!Array.isArray(payload.data)) {
      throw new OuraApiError({
        endpoint: path,
        status: response.status,
        title: "Unexpected Oura response",
        detail: "Oura returned a response Phibo could not read."
      })
    }

    records.push(...payload.data)
    nextToken = payload.next_token
  } while (nextToken)

  return records
}

export async function validateOuraToken(accessToken: string) {
  const day = new Date().toISOString().slice(0, 10)

  await Promise.all([
    fetchOuraCollection(accessToken, "daily_sleep", {
      start_date: day,
      end_date: day
    }),
    fetchOuraCollection(accessToken, "tag", {
      start_date: day,
      end_date: day
    })
  ])
}

function buildUrl(path: string, params: OuraCollectionParams) {
  const url = new URL(`${OURA_API_BASE_URL}/${path}`)

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value)
    }
  })

  return url
}

async function createOuraApiError(response: Response, endpoint: string) {
  const payload = await readOuraErrorPayload(response)

  return new OuraApiError({
    detail: payload.detail ?? payload.error_description,
    endpoint,
    oauthError: payload.error,
    status: response.status,
    title: payload.title
  })
}

async function readOuraErrorPayload(response: Response): Promise<OuraErrorPayload> {
  try {
    return (await response.json()) as OuraErrorPayload
  } catch {
    return {}
  }
}

function formatOuraErrorMessage(input: {
  detail?: string
  oauthError?: string
  status: number
  title?: string
}) {
  const label = input.title ?? input.oauthError ?? "Oura request failed"
  const detail = input.detail ? `: ${input.detail}` : ""

  return `${label} (${input.status})${detail}`
}
