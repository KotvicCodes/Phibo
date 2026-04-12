<script lang="ts">
  import OpenDashboardButton from "../components/OpenDashboardButton.svelte"

  const dashboardUrl = chrome.runtime.getURL("tabs/dashboard.html")
</script>

<svelte:head>
  <title>Oura Analytics</title>
</svelte:head>

<main class="popup">
  <p class="eyebrow">Extension</p>
  <h1>Oura Analytics</h1>
  <p class="description">A clean shell for the popup and dashboard.</p>

  <OpenDashboardButton href={dashboardUrl} />
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    background:
      radial-gradient(circle at top, #f7f0e8 0%, #f4efe7 30%, #ebe4d8 100%);
    color: #111827;
  }

  .popup {
    min-width: 280px;
    padding: 1rem;
  }

  .eyebrow {
    margin: 0 0 0.4rem;
    color: #6b7280;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.1;
  }

  .description {
    margin: 0.6rem 0 1rem;
    color: #4b5563;
    font-size: 0.95rem;
    line-height: 1.5;
  }
</style>