// Explore's saved tag selections reference imported data, so the key lives
// here where both ExploreView and the local data wipe can reach it.
export const exploreTagsSettingKey = "phibo.exploreTags"

// Reads a JSON string-list setting from localStorage, tolerating missing
// or malformed values. Used for saved tag selections and override lists.
export function getSavedTagList(settingKey: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingKey) ?? "[]")

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}
