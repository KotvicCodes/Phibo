# Manual test checklist

Scenarios to verify by hand in the loaded extension (`build/chrome-mv3-dev`).
Check items off as they pass.

Scope rule: only list behavior that cannot be spotted by looking at the page
after an update. Invisible backend guarantees, persistence across reloads and
re-imports, cross-view side effects, and error paths belong here; layout,
colors, and anything a normal click immediately shows do not.

Highest value first: the backup round-trip and delete-local-data tests
guard against silent data loss. Run those before the rest.

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

## Analysis confidence and adjusted effects
- [ ] Note a few confidence labels and adjusted effect values on Insights,
      reload the extension, and confirm they are identical with unchanged
      data (the shuffle test and model are seeded and deterministic; the
      math itself is covered by the vitest suite, this checks the real
      extension wiring). The same reload check applies to Explore's impact
      row badges and adjusted score rows for a fixed tag selection, and to
      Optimal's estimates, tag order, and row badges for a fixed target.
- [ ] Toggle "exclude untagged days" in Settings, then reopen Insights: a
      tag's observed delta changes but its adjusted effect does not, since
      the model always fits on your full history regardless of the setting.
      The same holds for Explore's adjusted score rows.
- [ ] Re-import your data or rename a tag, then reopen Insights and confirm
      the adjusted effects reflect the change rather than the pre-change
      values. The model cache is keyed on the loaded data, so it must refit
      instead of serving stale numbers.
- [ ] On Insights with fewer than 60 days of tagged history, confirm a tag's
      Adjusted and Next day rows read "n/a" while its observed delta and
      confidence label still render, and that Explore's badges fall back to
      Low rather than disappearing.
- [ ] On Optimal with fewer than 60 days of data (or a category with mostly
      null scores, like activity without wear), confirm the observed-averages
      note names the affected categories and the estimates still render from
      the naive fallback rather than showing n/a.
- [ ] Set an Optimal include or exclude override and pick a non-default
      target, reload the extension, and confirm both survive and the
      "vs optimal" line still reflects the override.

## Data edge states
- [ ] With metrics deleted but tags present, confirm the Tags view still
      lists the tags.
