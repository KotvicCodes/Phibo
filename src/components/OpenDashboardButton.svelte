<script lang="ts">
  export let href = ""

  function openDashboard() {
    chrome.tabs.create({ url: href })
  }
</script>

<button type="button" class="button" on:click={openDashboard}>
  Open Dashboard
</button>

<style>
  .button {
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #111827;
    color: #f9fafb;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    padding: 0.9rem 1.2rem;
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