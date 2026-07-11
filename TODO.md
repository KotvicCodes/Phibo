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

4. DashboardPage.svelte is 5,500+ lines. The Tags view (strip, day panel,
   filter, log, popup, dialogs) is a natural extraction into its own
   component(s) before more features pile on; the biggest maintainability
   item.
5. Strip scalability: one DOM button per day (~365/year) with damped wheel
   scroll. Revisit if importing many years (windowing or a week-level zoom).

## Tags UI

6. Rename entry point feels misplaced. The tag picker popup carries an
   Add/Rename mode toggle in its header even when opened from "+ Add tags",
   so the Rename control shows up in an add-focused flow. Reconsider where
   tag renaming lives, for example a separate entry point, or opening the
   popup in a pure add state and surfacing rename somewhere of its own.
