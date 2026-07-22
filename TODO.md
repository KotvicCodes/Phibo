# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. Robustness of the group contrasts. Every observed delta, the
   permutation null, and Optimal's observed baselines are plain arithmetic
   means (`calculateMetricDeltas`, `buildMetricComparison`,
   `permutationTestDelta`, `optimal.ts` observed deltas). One extreme night
   can swing a tag's delta far enough to flip its rewarding/concerning
   classification. Consider a trimmed or winsorized estimator, keeping in
   mind the permutation test's null has to move with it.

2. Ridge residual variance uses `rss / max(1, n - featureCount)`, treating
   every column as a full degree of freedom when ridge's effective degrees
   of freedom (trace of the hat matrix) are fewer, and the RSS itself comes
   from penalized coefficients that do not minimize it. The net direction is
   conservative, and lambda is also chosen by cross-validation on the same
   data with no post-selection adjustment. Every model-side confidence
   inherits the approximation.

3. The next-day confidence gate passes `lagCount` (days whose PREVIOUS day
   carried the tag) as the tagged count into `confidenceFromCounts`, whose
   thresholds are written for tag-day counts. A reasonable proxy for the lag
   coefficient's support, but not the quantity the thresholds assume.

4. `confidenceFromEffectSe` returns "low" when the standard error is zero or
   negative, so a perfectly estimated large effect is downgraded rather than
   promoted. Unreachable with real ridge standard errors, but asymmetric
   with the p-value path next to it.

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
