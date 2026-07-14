# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

## Loose ends from the extraction review (2026-07-11)

1. Review the view-switch state resets introduced by the component split:
   Explore forgets its selected day, hover, and expanded impact groups when
   leaving the view; Insights forgets the selected insight; Settings
   messages clear. Persisted settings survive. If any reset annoys in
   practice, each is one bind: to the parent to fix.
2. Discoveries anchor date falls back to the sync form's end date
   (InsightsView gets endDate as a prop just for this). Falling back to
   today's date instead would cut the odd coupling.
3. "Delete local data" wipes IndexedDB but not localStorage: Optimal
   overrides, Explore tag selections, and filter settings survive the wipe
   and silently re-apply to re-imported data. Decide whether the wipe
   should clear those too.
