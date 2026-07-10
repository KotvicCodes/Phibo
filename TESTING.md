# Manual test checklist

Untested scenarios to verify by hand in the loaded extension
(`build/chrome-mv3-dev`). Check items off as they pass.

## Tag deletion and resurrection protection

- [ ] Delete an imported Oura tag on the Tags view, then re-import the same
      `enhancedtag.csv` and confirm the tag stays deleted.
- [ ] If an Oura API key is connected, delete an imported tag and run a sync
      over that date range; confirm the tag stays deleted.

## Tag backup

- [ ] Export tags from Settings and confirm the downloaded
      `phibo-tags-YYYY-MM-DD.json` contains your entries and deletions.
- [ ] Export, delete all local data in Settings, restore the file, and confirm
      the counts message and that a previously deleted tag stays deleted.
- [ ] Restore the same backup a second time and confirm it reports 0 restored
      and changes nothing.
- [ ] Try restoring a non-backup JSON file and confirm the error message is
      generic (no tag names or dates in it).

## Tags view basics

- [ ] Add a tag whose name matches an imported tag but with different casing
      (for example "Sick") and confirm it merges with the existing label.
- [ ] Upgrade check: open the extension over an existing pre-0.3.0 database and
      confirm imported data still loads (Dexie v3 migration).
- [ ] With metrics deleted but tags present, confirm the Tags view still lists
      the tags.
