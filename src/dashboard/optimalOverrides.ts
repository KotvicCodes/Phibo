// The Optimal view's include and exclude overrides live in localStorage.
// This module is the single owner of those keys: OptimalView loads and
// saves the lists while it is open, and a tag rename (which happens on the
// Tags view, while OptimalView is not mounted) rewrites them in place.

const optimalExcludedTagsSettingKey = "phibo.optimalExcludedTags"
const optimalIncludedTagsSettingKey = "phibo.optimalIncludedTags"

function getSavedTagList(settingKey: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingKey) ?? "[]")

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

export function loadOptimalOverrides() {
  return {
    excludedTags: getSavedTagList(optimalExcludedTagsSettingKey),
    includedTags: getSavedTagList(optimalIncludedTagsSettingKey)
  }
}

export function saveOptimalOverrides(
  excludedTags: string[],
  includedTags: string[]
) {
  localStorage.setItem(
    optimalExcludedTagsSettingKey,
    JSON.stringify(excludedTags)
  )
  localStorage.setItem(
    optimalIncludedTagsSettingKey,
    JSON.stringify(includedTags)
  )
}

// The overrides store plain labels, so a rename must rewrite them or they
// silently stop matching anything. When the rename merges into a tag that
// already has its own override, that override wins and the old label is
// dropped.
export function renameOptimalOverrideTags(fromLabel: string, toLabel: string) {
  const { excludedTags, includedTags } = loadOptimalOverrides()
  const fromKey = fromLabel.toLocaleLowerCase()
  const toKey = toLabel.toLocaleLowerCase()
  const targetHasOverride =
    fromKey !== toKey &&
    [...excludedTags, ...includedTags].some(
      (tag) => tag.toLocaleLowerCase() === toKey
    )

  const rewrite = (tags: string[]) => {
    const rewritten = targetHasOverride
      ? tags.filter((tag) => tag.toLocaleLowerCase() !== fromKey)
      : tags.map((tag) =>
          tag.toLocaleLowerCase() === fromKey ? toLabel : tag
        )

    return rewritten.filter(
      (tag, index) =>
        rewritten.findIndex(
          (other) => other.toLocaleLowerCase() === tag.toLocaleLowerCase()
        ) === index
    )
  }

  saveOptimalOverrides(rewrite(excludedTags), rewrite(includedTags))
}
