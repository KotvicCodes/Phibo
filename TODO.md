# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. Unify the adjusted-effect semantics and export the ridge covariance (do
   these together, the covariance work naturally rewrites the shared
   helper). `combinedAdjustedEffect` in `src/lib/analysis/tagEffects.ts`
   (used by Explore's adjusted score rows) sums same-day coefficients only
   and nulls out when any selected tag lacks one, while Insights ranking
   and Optimal use the steady-state rule (same-day plus next-day, null only
   when both are missing), so the same tag can show different adjusted
   numbers across views. Exporting the coefficient covariance from
   `fitRidge` (already computed inside the sandwich step, then discarded)
   then unlocks: honest confidence for Optimal's steady-state sums,
   replacing the deliberately harsh weakest-link rule that suppresses High
   badges there; badges on Explore's multi-tag sums; and a model-side badge
   for Insights cards that matches the displayed adjusted number instead of
   testing the observed contrast. Update Explore's caveat copy to mention
   carry-over when unifying.

2. Small ranking cleanup in `src/lib/analysis/insightRanking.ts`: naive
   fallback candidates keep the old metricWeight heuristic (sleep x1.2) in
   their ranking weight while adjusted candidates use plain points, so
   mixed-mode ordering (one model present, one below its gates) mixes
   scales. Strip the metric weight from fallback candidates' ranking.

3. Remaining winner's-curse gap on the model side: the adjusted ranking
   picks top coefficients without multiplicity correction on the SE-based
   confidences shown in the detail rows (the Benjamini-Hochberg family only
   covers the observed-contrast badges). A BH pass over coefficient
   z-scores would mirror the rest of the system.

4. Convert the Insights Discoveries section, the last naive corner: it
   shows per-tag deltas with no badges or adjustment. Low stakes (it is
   about novelty, not effect claims) but inconsistent with the rest.

5. Rewrite README.md, which predates the whole v0.4 analysis arc: no
   mention of the ridge model, confidence badges, FDR correction, next-day
   carry-over, or the data gates. It is the public face of the repo and
   undersells the most differentiating feature.

6. Implement Oura API access. The Settings key flow and `src/lib/oura/`
   sync code exist, but testing on 2026-07-16 found API access not working
   end to end, so the API-dependent tests in TESTING.md are on hold until
   this lands.

7. Adjusted-effects follow-up ideas: rank each Explore category's headline
   metric by confidence instead of raw effect size; consider letting
   Optimal's selection weigh confidence, not just point estimates.

8. Housekeeping: enable unused-code linting (tsc noUnusedLocals or eslint),
   since a manual sweep caught an unused import that tooling would catch
   for free; run the unchecked manual TESTING.md backlog once against the
   real extension, especially the backup round-trip and delete-local-data
   items that automated tests cannot reach.

9. Rewrite the project as a webapp instead of a browser extension. The
   extension form factor adds no value for a local-first dashboard.
