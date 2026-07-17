# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. Implement Oura API access. The Settings key flow and `src/lib/oura/` sync
   code exist, but testing on 2026-07-16 found API access not working end to
   end, so the API-dependent tests in TESTING.md are on hold until this
   lands.

2. Feed the v0.4.0 adjusted tag effects (ridge model in
   `src/lib/analysis/tagEffects.ts`) into the Optimal view, which still
   runs on simple averages. Optimal needs its damped/saturated estimate
   math rethought around regression coefficients. Explore landed in v0.4.9
   (FDR-corrected confidence badges plus adjusted score effects); a
   follow-up idea there is ranking each category's headline metric by
   confidence instead of raw effect size, and confidence labels for
   multi-tag adjusted sums would need coefficient covariances from
   `fitRidge`.

3. Apply the Insights deferred-paint pattern to the other analytical views
   so no page blocks first paint on heavy computation. Insights now runs its
   ridge fits in requestIdleCallback with a token guard and a synchronous
   memo peek for instant remounts (see scheduleTagEffects in
   `src/dashboard/InsightsView.svelte` and peekTagEffects in
   `src/lib/analysis/tagEffects.ts`). Optimal (calculateOptimalDay with its
   greedy selection) and Explore (buildExploreDays plus impact math) are the
   candidates; profile each first, since only work heavy enough to freeze
   the page is worth deferring.

4. Rewrite the project as a webapp instead of a browser extension. The
   extension form factor adds no value for a local-first dashboard.
