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
