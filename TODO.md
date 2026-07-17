# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. Implement Oura API access. The Settings key flow and `src/lib/oura/` sync
   code exist, but testing on 2026-07-16 found API access not working end to
   end, so the API-dependent tests in TESTING.md are on hold until this
   lands.

2. Adjusted-effects follow-up ideas, now that all three views run on the
   ridge model (Insights v0.4.0, Explore v0.4.9, Optimal v0.4.12): rank each
   Explore category's headline metric by confidence instead of raw effect
   size; confidence labels for multi-tag adjusted sums and for Optimal's
   combined estimate would need coefficient covariances from `fitRidge`;
   consider letting Optimal's selection weigh confidence, not just point
   estimates.

3. Rewrite the project as a webapp instead of a browser extension. The
   extension form factor adds no value for a local-first dashboard.
