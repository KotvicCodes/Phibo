# Phibo

Phibo is a local-first browser extension for understanding how your Oura tags relate to sleep, readiness, activity, and recovery. It imports your Oura export, then goes past raw tagged-versus-untagged averages: it fits a regression that holds your other habits, the weekday, the season, and long-term drift constant, corrects for testing many tags at once, and labels every finding with how much the data actually supports it.

It is built for people who track real-life context in Oura: sleeping solo, room temperature, late meals, workouts, travel, stress, alcohol, supplements, routines, experiments, and anything else that might explain why a night felt different. Phibo turns those tagged nights into honest, readable comparisons without sending health data anywhere.

## What It Does

- Imports Oura personal data exports directly in the browser, no account or upload.
- Keeps Oura scores, tags, dates, and any optional API key in local browser storage.
- Highlights rewarding and concerning tags, ranked and confidence-labelled, in the Insights view.
- Estimates each tag's adjusted effect with a ridge regression that holds your other tags, the day of week, annual seasonality, and the long-term trend constant, so a tag is not credited for something a co-occurring habit or the season caused.
- Models next-day carry-over: a tag's effect on the following day is estimated alongside its same-day effect, and the two combine into a steady-state effect for a repeated routine.
- Puts a confidence badge (low, medium, high) on every effect, derived from its standard error or p-value together with how many nights back it.
- Corrects for multiple comparisons with a Benjamini-Hochberg false-discovery-rate step, so the tag that happened to land farthest from zero is not promoted by chance.
- Suggests an Optimal day: the combination of your eligible tags that the model projects to the best score, bounded by your own best observed days.
- Lets you explore tag combinations against detailed Oura metrics, with score comparisons, a timeline, and impact bars.
- Filters untagged days from analysis by default, with a Settings toggle to include them.
- Shows matching nights with full dates so you can inspect the underlying sample.

## How The Analysis Works

Phibo runs two complementary passes over the same data.

**Observed contrasts.** For a tag, it compares the average score on tagged nights against other nights, and tests that difference with a permutation test (reshuffling the tag labels many times to see how often chance alone produces a gap that large). This is simple and assumption-light, and it drives the rewarding/concerning split.

**Adjusted effects (the model).** A ridge regression per score (sleep, readiness, activity) estimates each tag's effect while holding the other tags, weekday, seasonality, and trend constant. Ridge shrinks coefficients backed by little data instead of letting them swing wildly, the penalty strength is chosen by blocked cross-validation that respects the day-to-day autocorrelation of health data, and the fit reports a full coefficient covariance so the effect of a tag *combination* gets an honest standard error rather than a naive sum. Next-day carry-over enters as a separate lag term.

**Confidence and correction.** Every displayed effect carries a badge. Strength comes from the effect relative to its standard error (or a p-value), and is then gated on sample size: broadly, medium needs at least 5 tagged and 10 comparison nights, high needs at least 10 and 20. Across a metric's fit, the tag family runs through a Benjamini-Hochberg FDR correction before badges are assigned.

**Data gates.** The model only fits with at least 60 modeled days, a tag only earns a column with at least 5 matching nights and 8 to contrast against, and the Optimal view only considers tags with at least 10 tagged and 8 untagged days. Below a gate, Phibo falls back to the observed numbers or says the data is not there yet, rather than showing a confident-looking estimate it cannot support.

The exact thresholds live in `src/lib/analysis/` (`tagEffects.ts`, `regression.ts`, `stats.ts`, `optimal.ts`) and are covered by the test suite.

## Privacy Model

Phibo is designed as a local-first tool. The recommended import flow reads your Oura export files in the extension and stores parsed records locally with Dexie/IndexedDB.

Your Oura data is not uploaded by Phibo. Health metrics, tags, comments, dates, and tokens stay on your device. If you use the optional Oura API key sync, the key is saved locally in the browser extension storage so the extension can fetch your data from Oura. Error messages are kept privacy-safe: file names, row counts, headers, and parse reasons are fine to surface, but raw values, tag comments, tokens, and dates are not.

## Supported Oura Imports

The main workflow is:

1. Open [Oura Membership Hub](https://membership.ouraring.com).
2. Request and download your personal data export.
3. Import the export ZIP into Phibo.

Phibo supports the export ZIP or selected CSV/JSON files. The imported export files are:

- `dailyactivity.csv`
- `dailyreadiness.csv`
- `dailysleep.csv`
- `dailyspo2.csv`
- `dailystress.csv`
- `dailyresilience.csv`
- `dailycardiovascularage.csv` and `dailysmoothedcardiovascularage.csv`
- `sleepmodel.csv`
- `workout.csv`
- `vo2max.csv`
- `enhancedtag.csv`

Tags come from `enhancedtag.csv`; the other files contribute daily metrics. Oura exports can mix delimiters, and Phibo detects the delimiter per file.

Other export files (raw heart rate and temperature time series, intraday stress, device data, location, recommendations, and files that are empty in current exports) are intentionally not imported and are listed in `knownIgnoredOuraFilePrefixes` in `src/lib/oura/import.ts`. To start importing one of them later (for example `restmodeperiod.csv` or `session.csv`), it must also be removed from that ignore list, or it will keep being skipped silently.

## Main Views

**Insights** shows high-level score cards and ranks rewarding tags, concerning tags, and new or neglected tags. The detail panel for a selected tag compares its tagged nights against nights without it for sleep, readiness, and activity, and shows the adjusted same-day effect, the next-day carry-over, and the combined steady-state effect, each with its confidence badge.

**Explore** lets you select one or more tags and inspect matching nights. It includes score comparisons, an adjusted-score prediction for the selected combination (with a confidence badge on the combination itself), a timeline plot, impact bars for detailed metrics, and the matching-night table.

**Optimal** projects the best achievable day for a chosen target (sleep, readiness, activity, night, or total) from your eligible tags, letting you force-include or exclude tags and never estimating past your own best observed days.

**Tags** lists your tags with per-tag day counts and lets you manage them.

**Settings** controls the analysis sample. By default, Phibo excludes days with no tags, because an untagged day can mean either "nothing happened" or "the user forgot to tag it."

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

Run the test suite (the analysis math is heavily covered):

```sh
npm test
```

For changes that need extension reload testing, also run the dev server until it prints `Extension re-packaged`, then stop it:

```sh
npm run dev
pkill -f "plasmo dev"
```

## Project Structure

```text
src/dashboard/DashboardPage.svelte   Dashboard shell (nav, data loading, import, sync)
src/dashboard/*View.svelte           Per-view components (Insights, Explore, Optimal, Tags, Settings)
src/lib/analysis/                    Observed contrasts, ridge model, confidence, Optimal
src/lib/oura/                        Oura import, sync, and normalization
src/lib/db/                          Dexie database schema and types
src/popup/                           Extension popup
src/tabs/dashboard.svelte            Dashboard tab entry point
assets/                              Extension icons and mark
```

## Notes For Contributors

- Treat Oura data as sensitive. Do not log raw metric values, tag comments, tokens, or personal dates casually.
- Prefer the file-import flow over API-key sync.
- Keep the dashboard dense, practical, and analysis-first.
- The analysis is the differentiating feature: when you change the math, add or update tests in `src/lib/analysis/` and confirm they fail against the old behavior first.
- For user-visible extension changes, bump the version in both `package.json` and `package-lock.json`.
```