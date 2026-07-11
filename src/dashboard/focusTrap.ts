// Keeps Tab cycling inside an open dialog and returns focus to the
// element that opened it when the dialog closes. Used as a Svelte action.
export function trapFocus(node: HTMLElement) {
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  const getFocusable = () =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (element) =>
        !element.hasAttribute("disabled") && element.offsetParent !== null
    )

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") {
      return
    }

    const focusable = getFocusable()

    if (focusable.length === 0) {
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || !node.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !node.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  node.addEventListener("keydown", handleKeydown)

  // Focus the dialog's first control unless something inside already
  // grabbed focus, like the picker search box.
  requestAnimationFrame(() => {
    if (!node.contains(document.activeElement)) {
      getFocusable()[0]?.focus()
    }
  })

  return {
    destroy() {
      node.removeEventListener("keydown", handleKeydown)
      previous?.focus()
    }
  }
}
