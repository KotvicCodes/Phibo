# Manual test checklist

Scenarios to verify by hand in the loaded extension (`build/chrome-mv3-dev`).
Check items off as they pass.

Scope rule: only list behavior that cannot be spotted by looking at the page
after an update. Invisible backend guarantees, persistence across reloads and
re-imports, cross-view side effects, and error paths belong here; layout,
colors, and anything a normal click immediately shows do not.

Highest value first: the re-import resurrection tests and the backup
round-trip test guard against silent data loss. Run those before the rest.

## Tag deletion and resurrection protection
- [x] Delete an imported Oura tag on the Tags view, then re-import the same
      `enhancedtag.csv` and confirm the tag stays deleted.
- [x] Delete a tag, reload the extension, and confirm the crossed-out chip
      is gone: the tag stays deleted, but the marker only lasts the session.
- [x] After deleting an imported Oura tag and reloading (so its crossed chip
      is gone), re-import the same `enhancedtag.csv` and confirm the tag
      still does not come back; the tombstone works invisibly.

## Tag backup
- [ ] Export tags from Settings and confirm the downloaded
      `phibo-tags-YYYY-MM-DD.json` contains your entries and deletions.
- [ ] Export, delete all local data in Settings, restore the file, and confirm
      the counts message and that a previously deleted tag stays deleted.
      Restored deletions do not show crossed-out chips; those only mark
      deletions made during the current session.
- [ ] Restore the same backup a second time and confirm it reports 0 restored
      and changes nothing.
- [ ] With every tag entry deleted so only deletion tombstones remain,
      confirm the export button still works and the file round-trips.
- [ ] Try restoring a non-backup JSON file and confirm the error message is
      generic (no tag names or dates in it).

## Tag rename side effects
- [ ] Rename a tag that has an Optimal include or exclude override and
      confirm the override follows the new name on the Optimal view.
- [ ] Rename a tag that is selected in the daily log filter and confirm the
      stale filter selection is dropped.
- [ ] Delete a tag (so its crossed chip shows), rename that tag in Settings,
      and confirm the crossed chip carries the new name and the old name
      stays out of the picker and filter lists.
- [ ] Do a case-only rename (for example "sick" to "Sick") and confirm the
      new casing is kept verbatim, while renaming to another tag's name is
      blocked in any casing ("SICK" when "Sick" exists).

## Add tags popup rules
- [ ] Type an existing tag with different casing (for example "Sick") and
      confirm it adopts the existing label instead of creating a duplicate.
- [ ] Delete the only instance of an imported Oura tag anywhere, reopen the
      popup, and confirm the label is still listed and can be re-added;
      delete the only instance of a user-created tag and confirm its label
      is gone from the list.

## Day note
- [ ] Type a day note and confirm it survives a reload.
- [ ] Write a day note, then add another tag to that day and confirm the new
      tag's entry carries the note too (export a tag backup and check the
      new entry's comment field matches the day's other entries).

## View-switch persistence
- [ ] On Explore, select a calendar day and expand an impact group; switch
      to another view and back and confirm the selected day and expanded
      groups are still there.
- [ ] On Insights, click an insight, switch views, and confirm the same
      insight is still selected on return.
- [ ] Trigger a Settings message (for example export a backup), switch views,
      and confirm stale messages do not linger incorrectly on return.

## Delete local data scope
- [ ] Set an Optimal include or exclude override, select Explore tags, and
      set a daily log filter; delete local data in Settings and confirm all
      of those are gone too, then re-import and confirm none of them
      silently re-apply.
- [ ] Confirm a saved Oura API key still survives the wipe.

## Duplicate tag cleanup
- [ ] Choose the backup path and confirm a tag backup downloads before the
      removal; if the backup download fails, nothing is removed.
- [ ] After a removal, the Undo button restores the removed duplicates even
      though the same tag is still active on those days.
- [ ] After a removal, reload the dashboard and confirm the Undo button is
      still offered in Settings and still restores the removed duplicates.

## Tag filter
- [ ] The daily log filter offers every known label, including an Oura tag
      whose entries were all deleted; selecting it filters the days it was
      deleted from during this session, and after a reload those days no
      longer match (the crossed chips are gone).

## Insight confidence and adjusted effects (v0.4.0)
- [ ] Note a few confidence labels and adjusted effect values on Insights,
      reload the extension, and confirm they are identical with unchanged
      data (the shuffle test and model are seeded and deterministic; the
      math itself is covered by the vitest suite, this checks the real
      extension wiring). As of v0.4.9 the same check applies to Explore:
      impact row badges and the adjusted score rows for a fixed tag
      selection must match across reloads.

## Data edge states
- [x] Upgrade check: open the extension over an existing pre-0.3.0 database
      and confirm imported data still loads (Dexie v3 migration).
- [ ] With metrics deleted but tags present, confirm the Tags view still
      lists the tags.
