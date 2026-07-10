# Manual test checklist

Untested scenarios to verify by hand in the loaded extension
(`build/chrome-mv3-dev`). Check items off as they pass.

## Tag deletion and resurrection protection

- [ ] Delete an imported Oura tag on the Tags view, then re-import the same
      `enhancedtag.csv` and confirm the tag stays deleted.
- [ ] If an Oura API key is connected, delete an imported tag and run a sync
      over that date range; confirm the tag stays deleted.
- [ ] Click a tag chip to cross it out, reload the extension, and confirm it
      is still crossed out; click it again and confirm it comes back.

## Add tags popup

- [ ] Open the popup from the strip day panel and from an expanded day in the
      list; both should target the same selected day.
- [ ] Click a plain tag to add it (turns navy), a navy tag to delete it
      (turns crossed), and a crossed tag to restore it (turns navy).
- [ ] Type a name that matches nothing and use the Add button to create a new
      custom tag; type an existing tag with different casing (for example
      "Sick") and confirm it merges with the existing label instead.
- [ ] Delete the only instance of a tag anywhere, reopen the popup, and
      confirm the label is still listed and can be re-added.
- [ ] Escape and backdrop click both close the popup; typing with the popup
      open goes to its search box.

## Duplicate tag grouping

- [ ] A day where Oura logged the same tag several times shows one chip with
      a count badge instead of repeated chips.
- [ ] Clicking the grouped chip deletes all instances; clicking the crossed
      chip restores it as a single entry.

## Day strip

- [ ] The strip opens already positioned on the selected day without
      animating through the whole history.
- [ ] Clicking a bar shows that day's tags in the panel under the strip and
      keeps the same day open in the list, with no page scrolling.
- [ ] Mouse wheel scrolls the strip horizontally at a damped speed.
- [ ] With a tag filter active, non-matching days dim in the strip.
- [ ] Bars at month boundaries stay separated and month labels render under
      the first of each month.

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
- [ ] Try restoring a non-backup JSON file and confirm the error message is
      generic (no tag names or dates in it).

## Tags view basics

- [ ] Upgrade check: open the extension over an existing pre-0.3.0 database
      and confirm imported data still loads (Dexie v3 migration).
- [ ] With metrics deleted but tags present, confirm the Tags view still
      lists the tags.
