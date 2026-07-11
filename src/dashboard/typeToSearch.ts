// Shared type-to-search keyboard behavior for the Tags and Explore views:
// typing anywhere starts a tag search without clicking the search box
// first, and Escape backs out of it. Each view wires this to its own
// svelte:window keydown while mounted, so handlers never fight.
//
// onEscape decides what Escape means for the view: return "consumed" when
// something else took it (like closing a popup), or "clear" after
// resetting the search, which also blurs the box when it had focus.
export function handleTypeToSearchKeydown(
  event: KeyboardEvent,
  searchInput: HTMLInputElement | null,
  onEscape: () => "consumed" | "clear"
) {
  if (!searchInput) {
    return
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  const target = event.target instanceof HTMLElement ? event.target : null

  if (event.key === "Escape") {
    if (onEscape() === "consumed") {
      return
    }

    if (target === searchInput) {
      searchInput.blur()
    }

    return
  }

  // Only printable characters; keeps shortcuts, Tab, and arrows working.
  if (event.key.length !== 1) {
    return
  }

  if (
    target &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable)
  ) {
    return
  }

  // Space on a focused button should still activate that button.
  if (event.key === " " && target instanceof HTMLButtonElement) {
    return
  }

  searchInput.focus()
}
