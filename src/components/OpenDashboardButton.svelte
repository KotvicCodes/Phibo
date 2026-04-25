<script lang="ts">
  export let href = ""

  function openDashboard(event: MouseEvent) {
    if (!href) {
      return
    }

    event.preventDefault()

    if (globalThis.chrome?.tabs?.create) {
      globalThis.chrome.tabs.create({ url: href })
      return
    }

    window.open(href, "_blank", "noopener")
  }
</script>

<a class="button" href={href} target="_blank" rel="noreferrer" on:click={openDashboard}>
  Open Dashboard
</a>

<style>
  .button {
    display: inline-block;
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #111827;
    color: #f9fafb;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    padding: 0.9rem 1.2rem;
    text-decoration: none;
    transition:
      transform 120ms ease,
      opacity 120ms ease,
      background-color 120ms ease;
  }

  .button:hover {
    background: #0f172a;
    transform: translateY(-1px);
  }

  .button:active {
    transform: translateY(0);
    opacity: 0.92;
  }
</style>
