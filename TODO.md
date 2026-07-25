# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. The next-day confidence gate passes `lagCount` (days whose PREVIOUS day
   carried the tag) as the tagged count into `confidenceFromCounts`, whose
   thresholds are written for tag-day counts. A reasonable proxy for the lag
   coefficient's support, but not the quantity the thresholds assume.
   (Reviewed 2026-07-25: `lagCount` is arguably the honest support for the
   lag coefficient, the count of treated next-day observations, so this may
   be correct as written. Left open pending a decision on the intended
   quantity rather than a silent change.)

2. Implement Oura API access. The Settings key flow and `src/lib/oura/`
   sync code exist, but testing on 2026-07-16 found API access not working
   end to end, so the API-dependent tests in TESTING.md are on hold until
   this lands.

3. Adjusted-effects follow-up ideas: Explore category headlines now rank by
   standardized effect size (v0.4.27); a further step would rank them by
   confidence instead. Also consider letting Optimal's selection weigh
   confidence, not just point estimates.

4. Run the unchecked manual TESTING.md backlog once against the real
   extension, especially the backup round-trip and delete-local-data items
   that automated tests cannot reach.

5. Rewrite the project as a webapp instead of a browser extension. The
   extension form factor adds no value for a local-first dashboard.
