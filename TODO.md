# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

## Loose ends from the extraction review (2026-07-11)

1. "Delete local data" wipes IndexedDB but not localStorage: Optimal
   overrides, Explore tag selections, and filter settings survive the wipe
   and silently re-apply to re-imported data. Decide whether the wipe
   should clear those too.
