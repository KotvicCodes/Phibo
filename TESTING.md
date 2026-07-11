# Manual test checklist

Untested scenarios to verify by hand in the loaded extension
(`build/chrome-mv3-dev`). Check items off as they pass.

Highest value first: the re-import resurrection tests and the backup
round-trip test guard against silent data loss. Run those before the rest.

## Tag deletion and resurrection protection

- [ ] Delete an imported Oura tag on the Tags view, then re-import the same
      `enhancedtag.csv` and confirm the tag stays deleted.
- [ ] If an Oura API key is connected, delete an imported tag and run a sync
      over that date range; confirm the tag stays deleted.
- [ ] Click an imported Oura tag chip to cross it out, reload the extension,
      and confirm it is still crossed out; click it again and confirm it
      comes back.
- [ ] Click a user-created tag chip to delete it and confirm it disappears
      entirely, with no crossed-out chip left behind. Only imported Oura
      tags keep deletion tombstones; user-created tags are hard-deleted.

## Add tags popup

- [ ] Open the popup from the strip day panel and from an expanded day in the
      list; both should target the same selected day.
- [ ] Click a plain tag to add it (turns navy) and a navy tag to delete it.
      A deleted Oura tag turns crossed and clicking it again restores it; a
      deleted user-created tag simply leaves the day.
- [ ] Type a name that matches nothing and use the Add button to create a new
      custom tag; type an existing tag with different casing (for example
      "Sick") and confirm it merges with the existing label instead.
- [ ] Delete the only instance of an imported Oura tag anywhere, reopen the
      popup, and confirm the label is still listed and can be re-added.
- [ ] Delete the only instance of a user-created tag anywhere, reopen the
      popup, and confirm the label is gone from the list.
- [ ] Escape and backdrop click both close the popup; typing with the popup
      open goes to its search box.
- [ ] Tab and Shift+Tab cycle only through the popup's controls while it is
      open, and closing it returns focus to the button that opened it; the
      same holds for the duplicate removal dialog in Settings.
- [ ] Tabbing through chips and buttons shows a visible focus ring; clicking
      with the mouse does not.

## Popup rename mode

- [ ] Switch the popup to Rename, pick a tag, and rename it; confirm the new
      name shows everywhere, including crossed-out entries and Explore.
- [ ] Rename a tag onto an existing tag's name and confirm the two merge,
      with the result message reporting the entry count.
- [ ] Do a case-only rename (for example "sick" to "Sick") and confirm the
      new casing is kept verbatim.
- [ ] Rename a tag that is selected in the daily log filter and confirm the
      stale filter selection is dropped.
- [ ] On a day that has both tags, rename one onto the other and confirm the
      day ends up with a single chip, no duplicate or count badge, and the
      message reports the collapsed same-day duplicates.
- [ ] Merge an Oura tag away on a shared day, then re-import the same
      `enhancedtag.csv` and confirm the merged-away entry does not come back.

## Day note

- [ ] Open the Day note section under the selected day's chips, type a note,
      and confirm it saves on change and survives a reload.
- [ ] Select a day that already has a note (for example an imported Oura
      comment) and confirm the Day note section opens automatically with it.
- [ ] Confirm the Day note section only appears when the day has active tags,
      and that one note covers the whole day rather than one per tag.

## Duplicate tag grouping and cleanup

- [ ] A day where Oura logged the same tag several times shows one chip with
      a count badge instead of repeated chips.
- [ ] Clicking the grouped chip deletes all instances; clicking the crossed
      chip restores it as a single entry.
- [ ] Remove duplicate tags in Settings: the dialog reports the duplicate
      count and offers three buttons (back up then remove, remove without a
      backup, never mind); never mind, Escape, and backdrop click all close
      it without removing anything.
- [ ] Choose the backup path and confirm a tag backup downloads before the
      removal; if the backup download fails, nothing is removed.
- [ ] After a removal, the Undo button restores the removed duplicates even
      though the same tag is still active on those days; the Undo offer goes
      away once the dashboard is closed or reloaded.

## Day strip

- [ ] The strip opens already positioned on the selected day without
      animating through the whole history.
- [ ] Clicking a bar shows that day's tags in the panel under the strip and
      keeps the same day open in the list, with no page scrolling.
- [ ] Mouse wheel scrolls the strip horizontally at a damped speed.
- [ ] With a tag filter active, non-matching days dim in the strip.
- [ ] Bars at month boundaries stay separated and month labels render under
      the first of each month.
- [ ] Crossed-out (deleted) entries do not count toward strip bar heights.

## Tag filter

- [ ] The daily log filter offers every known label, including a tag whose
      entries were all deleted, and selecting it still filters the days
      where it appears crossed out.

## Colors

- [ ] Scores show only three colors everywhere (Insights and Optimal cards,
      strip bars): blue for 85+, green for 70 to 84, red below 70, gray when
      there is no score.

## Tag backup

- [ ] Export tags from Settings and confirm the downloaded
      `phibo-tags-YYYY-MM-DD.json` contains your entries and deletions.
- [ ] Export, delete all local data in Settings, restore the file, and confirm
      the counts message, that a previously deleted tag stays deleted, and
      that crossed-out chips are back.
- [ ] Restore the same backup a second time and confirm it reports 0 restored
      and changes nothing.
- [ ] With every tag entry deleted so only deletion tombstones remain,
      confirm the export button still works and the file round-trips.
- [ ] Try restoring a non-backup JSON file and confirm the error message is
      generic (no tag names or dates in it).
- [ ] Export a backup, rename a tag that has crossed-out entries, restore
      that backup, and confirm the crossed-out chips keep the new name and
      the old name stays out of the picker and filter lists.

## Tags view basics

- [ ] Upgrade check: open the extension over an existing pre-0.3.0 database
      and confirm imported data still loads (Dexie v3 migration).
- [ ] With metrics deleted but tags present, confirm the Tags view still
      lists the tags.
