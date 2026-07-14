# Todo

Open items from the review that have not been fixed yet. Delete an item once
it is done rather than checking it off.

## Tags UI

1. Move tag renaming completely out of the tag picker popup. Decided on
   2026-07-11: the Add/Rename mode toggle does not belong in an add-focused
   popup at all. The destination is still undecided; pick one before
   building (candidates worth weighing: a dedicated manage section on the
   Tags view, a small dialog of its own, or a Settings row).
2. Tags Page's list may have empty days upon deleting last tag entries.
   Hiding such days or handling them in the same manner as empty days are
   in the same space is recommended. To be also concidered: handling the empty
   days as the the ones with newly deleted tags.
3. Add more time labels to the Tags day strip. It only prints a month
   label on the first of each month (buildTagStripDays in tagDays.ts). At
   multi-year scale that leaves long unlabeled runs and no way to tell
   which year a bar sits in. Add year markers (for example at Jan 1 or a
   year boundary) and some finer date or weekday hints so a bar is
   locatable in time. Decide density so labels do not crowd the 30px slots.

## Loose ends from the extraction review (2026-07-11)

4. Review the view-switch state resets introduced by the component split:
   Explore forgets its selected day, hover, and expanded impact groups when
   leaving the view; Insights forgets the selected insight; Settings
   messages clear. Persisted settings survive. If any reset annoys in
   practice, each is one bind: to the parent to fix.
5. Discoveries anchor date falls back to the sync form's end date
   (InsightsView gets endDate as a prop just for this). Falling back to
   today's date instead would cut the odd coupling.
6. "Delete local data" wipes IndexedDB but not localStorage: Optimal
   overrides, Explore tag selections, and filter settings survive the wipe
   and silently re-apply to re-imported data. Decide whether the wipe
   should clear those too.
