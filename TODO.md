# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

## Behavior gaps and decisions to make

1. Day note does not auto-stamp late tags. A tag added after the day's note
   was written carries `comment: null` (matches Oura's own behavior, but
   export rows for one day stay inconsistent until the note is re-saved).
   Cheap fix if wanted: when adding a tag to a day that has a note, copy the
   note onto the new entry.
2. Dedupe undo is still session-only. The backup-first dialog largely defuses
   this, but for durability persist the last cleanup's tombstone ids so Undo
   survives reloads.
3. Old backups restore without crossed chips. Backups exported before
   tombstone snapshots existed (pre-0.3.3 data) restore fine but their
   tombstones have no entry, so those deletions never display. Only matters
   if such files exist; likely ignorable.

## Tags UI

4. Move tag renaming completely out of the tag picker popup. Decided on
   2026-07-11: the Add/Rename mode toggle does not belong in an add-focused
   popup at all. The destination is still undecided; pick one before
   building (candidates worth weighing: a dedicated manage section on the
   Tags view, a small dialog of its own, or a Settings row).
5. Tags Page's list may have empty days upon deleting last tag entries.
   Hiding such days or handling them in the same manner as empty days are
   in the same space is recommended. To be also concidered: handling the empty
   days as the the ones with newly deleted tags.

## Loose ends from the extraction review (2026-07-11)

6. Review the view-switch state resets introduced by the component split:
   Explore forgets its selected day, hover, and expanded impact groups when
   leaving the view; Insights forgets the selected insight; Settings
   messages clear. Persisted settings survive. If any reset annoys in
   practice, each is one bind: to the parent to fix.
7. Discoveries anchor date falls back to the sync form's end date
   (InsightsView gets endDate as a prop just for this). Falling back to
   today's date instead would cut the odd coupling.
8. "Delete local data" wipes IndexedDB but not localStorage: Optimal
   overrides, Explore tag selections, and filter settings survive the wipe
   and silently re-apply to re-imported data. Decide whether the wipe
   should clear those too.
