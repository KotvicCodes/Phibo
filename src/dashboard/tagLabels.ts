export type TagSortMode = "alpha" | "count"

export const tagSortModes: { id: TagSortMode; label: string }[] = [
  { id: "alpha", label: "A–Z" },
  { id: "count", label: "Most tagged" }
]

const displayTagLabels = new Map([
  ["slept alone", "Sleep Solo"],
  ["sunrise exposure", "Morning Sunlight"],
  ["sunset exposure", "Evening Sunlight"]
])

export function formatTagLabel(tag: string) {
  const trimmedTag = tag.trim()

  if (trimmedTag.length === 0) {
    return tag
  }

  const displayLabel = displayTagLabels.get(trimmedTag.toLocaleLowerCase())

  if (displayLabel) {
    return displayLabel
  }

  return `${trimmedTag[0].toLocaleUpperCase()}${trimmedTag.slice(1)}`
}

export function sortTagsForDisplay(tags: string[]) {
  return [...tags].sort((left, right) => {
    const displayComparison = formatTagLabel(left).localeCompare(
      formatTagLabel(right),
      undefined,
      { sensitivity: "base" }
    )

    return displayComparison || left.localeCompare(right)
  })
}

export function formatTagList(tags: string[], separator = ", ") {
  return sortTagsForDisplay(tags).map(formatTagLabel).join(separator)
}
