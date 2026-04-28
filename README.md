# Phibo

Phibo is a local-first browser extension for exploring how your Oura tags relate to sleep, readiness, activity, and recovery metrics.

It is built for people who track real-life context in Oura: sleeping solo, room temperature, late meals, workouts, travel, stress, alcohol, routines, experiments, and anything else that might explain why a night felt different. Phibo turns those tagged nights into readable comparisons without sending health data anywhere.

## What It Does

- Imports Oura personal data exports directly in the browser.
- Keeps Oura scores, tags, dates, and optional API keys in local browser storage.
- Highlights rewarding and concerning tags in the Insights view.
- Compares sleep, readiness, and activity scores for tagged nights versus other nights.
- Lets you explore tag combinations against detailed Oura metrics.
- Filters untagged days from analysis by default, with a Settings toggle to include them.
- Shows matching nights with full dates so you can inspect the underlying sample.

## Privacy Model

Phibo is designed as a local-first tool. The recommended import flow reads your Oura export files in the extension and stores parsed records locally with Dexie/IndexedDB.

Your Oura data is not uploaded by Phibo. Health metrics, tags, comments, dates, and tokens should stay on your device. If you use the optional Oura API key sync, the key is saved locally in the browser extension storage so the extension can fetch your Oura data from Oura.

## Supported Oura Imports

The main workflow is:

1. Open [Oura Membership Hub](https://membership.ouraring.com).
2. Request and download your personal data export.
3. Import the export ZIP into Phibo.

Phibo supports the export ZIP or selected CSV/JSON files. The important export files are:

- `dailyactivity.csv`
- `dailyreadiness.csv`
- `dailysleep.csv`
- `enhancedtag.csv`

Tags come from `enhancedtag.csv`; daily sleep, readiness, and activity metrics come from the daily metric files. Oura exports can mix delimiters, and Phibo detects the delimiter per file.

## Main Views

**Insights** shows high-level score cards, rewarding tags, concerning tags, new or neglected tags, and a detail panel for the selected tag. The detail panel compares tagged nights against nights without that tag for sleep, readiness, and activity.

**Explore** lets you select one or more tags and inspect matching nights. It includes score comparisons, a timeline plot, impact bars for detailed metrics, and the matching-night table.

**Settings** currently controls the analysis sample. By default, Phibo excludes days with no tags because an untagged day can mean either "nothing happened" or "the user forgot to tag it."

## Development

Install dependencies:

```sh
npm install
```

Start the extension dev build:

```sh
npm run dev
```

The unpacked Chrome extension output is generated under:

```text
build/chrome-mv3-dev
```

Load that folder in Chrome or another Chromium browser as an unpacked extension. After code changes, reload the unpacked extension in the browser.

Create a production build:

```sh
npm run build
```

Create a packaged extension archive:

```sh
npm run package
```

## Verification

Before shipping code changes, run:

```sh
npx tsc --noEmit --skipLibCheck
npm run build
```

For changes that need extension reload testing, also run the dev server until it prints `Extension re-packaged`, then stop it:

```sh
npm run dev
pkill -f "plasmo dev"
```

## Project Structure

```text
src/dashboard/DashboardPage.svelte   Main dashboard UI
src/lib/oura/                        Oura import, sync, and normalization
src/lib/analysis/                    Tag correlation and Explore calculations
src/lib/db/                          Dexie database schema and types
src/popup/                           Extension popup
src/tabs/dashboard.svelte            Dashboard tab entry point
assets/                              Extension icons and mark
```

## Notes For Contributors

- Treat Oura data as sensitive. Do not log raw metric values, tag comments, tokens, or personal dates casually.
- Prefer the file-import flow over API-key sync.
- Keep the dashboard dense, practical, and analysis-first.
- For user-visible extension changes, bump the version in both `package.json` and `package-lock.json`.
