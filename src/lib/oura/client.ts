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
      throw new Error(`Oura request failed with ${response.status}`)
    }

    const payload = (await response.json()) as OuraCollectionResponse<T>
    records.push(...payload.data)
    nextToken = payload.next_token
  } while (nextToken)

  return records
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
