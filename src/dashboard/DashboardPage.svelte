<svelte:head>
  <title>Dashboard</title>
</svelte:head>

<main class="dashboard">
  <header class="header">
    <p class="eyebrow">Oura Analytics</p>
    <h1>Dashboard</h1>
  </header>

  <section class="card">
    <p>No data yet</p>
  </section>
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
      linear-gradient(135deg, #faf7f2 0%, #f1ece3 52%, #e8e1d4 100%);
    color: #111827;
  }

  .dashboard {
    min-height: 100vh;
    padding: 2rem;
    box-sizing: border-box;
  }

  .header {
    margin-bottom: 1.25rem;
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
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1;
  }

  .card {
    border: 1px solid rgba(17, 24, 39, 0.08);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.65);
    box-shadow: 0 18px 50px rgba(17, 24, 39, 0.08);
    min-height: 260px;
    display: grid;
    place-items: center;
    backdrop-filter: blur(16px);
  }

  .card p {
    margin: 0;
    color: #374151;
    font-size: 1.05rem;
  }
</style>