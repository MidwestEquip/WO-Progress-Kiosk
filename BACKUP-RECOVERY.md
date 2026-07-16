# Backup & Recovery Runbook

How to back up, roll back, and recover the WO Progress Kiosk platform.
Written so that someone other than the original author can follow it.

**IMPORTANT — free-plan reality:** the Supabase project is on the FREE plan, which
includes NO built-in backups. The daily noon backup job (see "Daily Backup Job")
is the ONLY copy of the database outside Supabase. If that job stops running,
we have no data protection. Check it weekly.

---

## What lives where

| Asset | Location | Backup |
|---|---|---|
| Application code | GitHub `MidwestEquip/WO-Progress-Kiosk` + local clones | Git itself (every clone is a full copy) |
| Database (all tables) | Supabase Postgres | Daily noon `pg_dump` → local + Google Drive |
| Uploaded files (photos, attachments) | Supabase Storage buckets: `wo-files`, `message-media`, `eng-inquiry-images`, `purchasing-attachments` | Daily noon bucket sync → local + Google Drive |
| Schema definition | `schema.sql` in this repo (canonical, generated) + `*-migration.sql` history | Git — regenerate after every migration: `powershell -File C:\WO-Backups\scripts\gen-schema.ps1` |
| Secrets | Offline record (see "Secrets") | Manual — keep it current |

---

## 1. Code recovery

### Lost the local copy / lost a PC
```
git clone https://github.com/MidwestEquip/WO-Progress-Kiosk.git
```
That's the entire application — there is no build step. Point the kiosk browser
at the cloned folder (or copy it to wherever that location serves files from)
and refresh.

### Roll back to a previous version ("I messed up a revision")
Every released version is tagged (`v1.1.34`, `v1.1.35`, ...). To see versions:
```
git tag --sort=-v:refname
```
To roll the deployed folder back to a version:
```
git checkout v1.1.30
```
Refresh the browser — done. To return to latest: `git checkout main`.

To permanently revert `main` to an older version, prefer reverting the bad
commits (keeps history) over resetting:
```
git revert <bad-commit-sha>
```

**Caution:** code rollback does NOT undo database schema changes. If the bad
revision included a migration, the old code usually still works (new columns
are simply ignored — migrations here are additive by rule), but read the
migration file before assuming.

---

## 2. Daily backup job (data protection)

Runs at **12:00 PM daily** via Windows Task Scheduler (task name: **"WO Kiosk
Daily Backup"**) on the office PC `WS70`, under Josiah's Windows account.

- Script: `C:\WO-Backups\scripts\run-backup.ps1` (see `C:\WO-Backups\README.txt`)
- Local copies: `C:\WO-Backups\local\`
- Offsite copies: `G:\Shared drives\New Company Shared Drive\7 Archive\7.8 AI Archive\WO-Kiosk-Backups\`
- Credentials: DPAPI-encrypted in `C:\WO-Backups\secrets\` (re-run
  `setup-credentials.ps1` if the DB password or service key changes)
- Postgres tools: portable, bundled at `C:\WO-Backups\pgtools\bin\` (v17.5) —
  nothing was installed system-wide
- Note: the task runs only while that Windows user is logged on ("Interactive
  only" mode) — fine for a PC that stays logged in; if it starts getting locked
  out of runs, switch the task to "run whether user is logged on or not".

What it does:
1. `pg_dump` of the full Supabase Postgres database → timestamped `.dump` file.
2. Sync of the 4 storage buckets → local mirror folder.
3. CSV export of the day-to-day tables (`open_orders`, `work_orders`,
   `purchasing_orders`, `wo_requests`, `item_master`) → the Emergency Ops
   folder (Google Drive–synced) for offline operation.
4. Rotation: keeps 14 daily dumps + 8 weekly dumps, deletes older.

Backup destinations (3-2-1 rule):
- Copy 1: live data in Supabase
- Copy 2: local backup folder on the office PC
- Copy 3: Google Drive–synced folder (offsite)

**Weekly check:** confirm the newest dump file in the backup folder is dated
within the last day and is not 0 KB.

---

## 3. Restoring the database

### Scenario A — bad data change, project still alive
Restore individual tables from the most recent dump into a scratch schema and
copy rows back, or restore the whole dump into a NEW scratch Supabase project
and compare. Never restore a full dump over the live project unless the live
data is truly lost — a full restore overwrites everything since the dump.

### Scenario B — Supabase project lost entirely
1. Create a new Supabase project (note the new URL + anon key + DB password).
2. Restore the dump:
   ```
   pg_restore --clean --if-exists -d "<new-project-connection-string>" <latest>.dump
   ```
   (The dump includes schema + data + grants. If restoring schema-only from
   `schema.sql` instead, remember every table needs
   `GRANT SELECT, INSERT, UPDATE, DELETE ... TO anon, authenticated;` — the
   dump already contains these.)
3. Recreate the 4 storage buckets (same names, `message-media` is private)
   and re-upload the bucket mirror folder.
4. Update `libs/config.js` with the new Supabase URL + anon key. Commit.
5. Update the Cloudflare Worker if it references the Supabase project.
6. Refresh kiosk browsers. Verify: log in with a PIN (proves `app_pins`
   restored), open Active WOs, open an attachment (proves storage restored).

### Restore drill — quarterly
Once a quarter, do Scenario B steps 1–2 into a scratch project and open the
app against it locally. Delete the scratch project after. A backup that has
never been restored is not a backup. Log drill dates at the bottom of this file.

---

## 4. Operating during a Supabase outage

Everything lives in the Google Drive folder
`7 Archive\7.8 AI Archive\` (shared drive):

- **Manual Log sheet:** "WO Kiosk EMERGENCY OPS — Manual Log"
  https://docs.google.com/spreadsheets/d/1fSgcX9pKSX-wWZxA5-pRm-hzRlMC4pyFM6-knlXmg9k
- **Data snapshots (refreshed daily at noon):** `WO-Kiosk-Backups\emergency-ops-csv\`
  — double-click a CSV in Drive to open it as a spreadsheet:
  `open_orders.csv` = what needs to ship, `work_orders.csv` = what's on the
  floor, `purchasing_orders.csv` = what's on order, `wo_requests.csv`,
  `item_master.csv` = part lookup.

Procedure:
1. Open the snapshots; run the floor off them.
2. Record EVERY change (status moves, receipts, shipments, new orders) as one
   row in the Manual Log sheet.
3. When Supabase is back, re-enter each log row through the app normally and
   mark it "YES" in the Re-entered column. Do NOT bulk-import into the database.

---

## 5. Secrets — keep an offline record

Backups are useless if nobody can access the accounts. Keep a sealed, offline
record (password manager or printed sheet in the safe) containing:

- [ ] Supabase account login (email + password + 2FA recovery codes)
- [ ] Supabase database password (needed for pg_dump / restore)
- [ ] Supabase service-role key
- [ ] GitHub account/org access for `MidwestEquip/WO-Progress-Kiosk`
- [ ] Cloudflare account login + Worker source code + Gemini API key
- [ ] Google account used for the Drive backup folder / Emergency Ops sheet
- [ ] This runbook's location

Update the record whenever any of these change.

---

## Restore drill log

| Date | Performed by | Result / notes |
|---|---|---|
| _none yet_ | | |
