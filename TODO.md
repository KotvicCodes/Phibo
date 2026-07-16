# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

1. Implement Oura API access. The Settings key flow and `src/lib/oura/` sync
   code exist, but testing on 2026-07-16 found API access not working end to
   end, so the API-dependent tests in TESTING.md are on hold until this
   lands.

2. Upgrade the data analysis from simple averages to a smarter model
   (discussed 2026-07-16: candidates range from regularized regression to a
   small neural network; must stay local-first and explainable).

3. Rewrite the project as a webapp instead of a browser extension. The
   extension form factor adds no value for a local-first dashboard.
