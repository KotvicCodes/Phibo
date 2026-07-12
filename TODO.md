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

## Production hardening

4. Strip scalability: one DOM button per day (~365/year) with damped wheel
   scroll. Revisit if importing many years (windowing or a week-level zoom).

## Tags UI

5. Move tag renaming completely out of the tag picker popup. Decided on
   2026-07-11: the Add/Rename mode toggle does not belong in an add-focused
   popup at all. The destination is still undecided; pick one before
   building (candidates worth weighing: a dedicated manage section on the
   Tags view, a small dialog of its own, or a Settings row).
6. Tags Page's list may have empty days upon deleting last tag entries.
   Hiding such days or handling them in the same manner as empty days are
   in the same space is recommended. To be also concidered: handling the empty
   days as the the ones with newly deleted tags.

## Loose ends from the extraction review (2026-07-11)

7. ImportModal has no focus trap. The a11y pass covered the tag picker and
   the dedupe dialog; apply the trapFocus action from
   src/dashboard/focusTrap.ts to ImportModal.svelte as well.
8. Review the view-switch state resets introduced by the component split:
   Explore forgets its selected day, hover, and expanded impact groups when
   leaving the view; Insights forgets the selected insight; Settings
   messages clear. Persisted settings survive. If any reset annoys in
   practice, each is one bind: to the parent to fix.
9. Discoveries anchor date falls back to the sync form's end date
   (InsightsView gets endDate as a prop just for this). Falling back to
   today's date instead would cut the odd coupling.
10. "Delete local data" wipes IndexedDB but not localStorage: Optimal
   overrides, Explore tag selections, and filter settings survive the wipe
   and silently re-apply to re-imported data. Decide whether the wipe
   should clear those too.

## Bugs from the full repo scan (2026-07-11)

11. API sync can null out imported metrics. src/lib/oura/sync.ts bulkPuts
    whole rows while import.ts merges with stored rows via
    mergeWithStoredRow. A sync only fetches sleep, readiness, activity,
    sessions, and tags, so syncing over a previously imported range wipes
    the file-only fields (SpO2, stress, resilience, cardiovascular age,
    VO2 max, workouts). Apply the same merge in sync.
12. Saved Explore tag selections are likely wiped when the dashboard opens
    directly on the Explore view. The prune reactive in ExploreView filters
    selectedExploreTags against availableTags, which is still empty before
    the parent's async data load; the pruned empty list then gets persisted.
    Reproduce first: select tags on Explore, reload while on Explore.
    Likely fix: skip the prune while availableTags is empty.
13. "Today" is computed in UTC. formatInputDate uses toISOString, so
    between local midnight and the UTC offset (00:00 to 02:00 CEST) the
    default Tags day, the strip's right edge, the backup filename, and the
    sync end-date validation are all one day behind. Compute local dates
    instead.
14. Tag labels are injected unescaped into ECharts tooltip HTML
    (tooltipTagsHtml in exploreChartOptions.ts). MV3 CSP blocks scripts, so
    it is markup injection rather than XSS, but labels come from import
    files; escape them.
15. mapTagEntries edge cases in normalizer.ts: the fallback id
    (date-label-StartTime) collides for duplicate same-day tags in CSVs
    lacking both id and StartTime, silently collapsing them via bulkPut;
    and "text" serves as both a label fallback and a comment fallback, so a
    row whose label came from text repeats the label as its comment.
