<script lang="ts">
  import OpenDashboardButton from "../components/OpenDashboardButton.svelte"
  import logoUrl from "../../assets/phibo-mark.svg"

  const dashboardUrl = chrome.runtime.getURL("tabs/dashboard.html")
</script>

<svelte:head>
  <title>Phibo</title>
</svelte:head>

<main class="popup">
  <div class="brand">
    <img class="logo" src={logoUrl} alt="" />
    <p class="eyebrow">Phibo</p>
  </div>
  <h1>Phibo</h1>
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

  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-bottom: 0.4rem;
  }

  .logo {
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    background: #111827;
    padding: 0.4rem;
    box-sizing: border-box;
    flex: 0 0 auto;
  }

  .eyebrow {
    margin: 0;
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