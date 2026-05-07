# CLAUDE.md
Permanent instructions for Claude. Read this entire file before every task.

---

## What This Project Is

A shop floor kiosk for tracking work order progress across departments
(Fab, Weld, TV Assy, TC Assy, Office, CS, Manager).

- Frontend: Vanilla HTML + Vue 3 loaded from CDN. No build step. No npm. No bundler.
- Backend: Supabase (Postgres database + instant API). No server to manage.
- Deployment: Static files served directly. Refresh the browser to get new code.
- Primary table: work_orders in Supabase.

Because there is no build step, every file the browser loads IS the source code.
Errors ship instantly. This is why small, careful patches matter.
---

## The Dependency Tree

Think of this like an org chart. Information flows DOWN only.
Lower levels never import from higher levels.
No circular dependencies. No surprise breakage.

    config.js      <- ROOT. No imports. Supabase client + constants live here.
    utils.js       <- No imports. Pure functions only (math, text, detection logic).
         |
    store.js       <- Imports from config + utils only. All reactive state lives here.
    db.js          <- Imports from config + utils only. All Supabase queries live here.
         |
    pages/*.js     <- Imports from store + db + utils. All business logic lives here.
         |
    main.js        <- Imports everything. Wires it to Vue. Zero logic lives here.
         |
    index.html     <- Template only. No logic. All behavior bound via main.js.

Rules that enforce the tree:

- config.js: zero imports allowed (except the Supabase CDN library)
- utils.js: zero imports allowed. Every function must be pure (input in, output out, no side effects)
- store.js: only ref() and computed(). No fetch calls. No DB access. Import from config + utils only.
- db.js: all Supabase calls go here and ONLY here. No business logic. Import from config + utils only.
- pages/*.js: business logic and UI handlers. May import from store, db, utils. Never from other page files.
- main.js: wiring only. Imports everything, exposes it to Vue. No logic.
- index.html: template only. Never add script logic blocks. All behavior via Vue directives.

If you feel the urge to break this tree, stop and propose an alternative. Never break it.
---

## File Purpose Reference

| File                       | Single Responsibility                          | Never Add                       |
|----------------------------|------------------------------------------------|---------------------------------|
| libs/config.js             | Supabase client, PINs, operator lists          | Business logic, fetch calls     |
| libs/utils.js              | Pure helpers (formatting, detection, math)     | State, imports, side effects    |
| libs/store.js              | All reactive Vue state (ref, computed)         | Fetch calls, DB access          |
| libs/db.js                 | All Supabase queries, inserts, updates         | UI logic, state mutations       |
| pages/dashboard-view.js    | TC/TV/Fab/Weld workflow actions                | Cross-dept changes in TC patch  |
| pages/splash-view.js       | Dept selection, PIN entry                      | Workflow logic                  |
| pages/wo-status-view.js    | Office receive and closeout                    | Other dept logic                |
| pages/manager-view.js      | Manager KPIs, alerts, priorities               | Operator workflow               |
| pages/cs-view.js           | Customer service lookup                        | Other dept logic                |
| main.js                    | Vue setup(), expose state + functions          | Business logic, DB calls        |
| index.html                 | HTML template, Vue directives only             | Script logic blocks             |
---

## Scale Safety: Database

These rules protect you as the number of work orders grows into the thousands.

1. Never query without a filter.
   Avoid SELECT * on large tables without filtering by dept, status, or date.
   Unbounded queries get slower as data grows.

2. Every new column needs a reason.
   Before adding a column ask: can I derive this from existing data instead?
   If yes, derive it in code. Only store things that truly cannot be derived.

3. Schema changes: safe migrations only.
   GOOD:  ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS my_col TEXT;
   BAD:   DROP TABLE, DROP COLUMN, TRUNCATE -- never on live tables.

4. Never store logic in the database.
   Classification rules, mode detection, routing rules all live in utils.js.
   The DB stores only the result (e.g. tc_job_mode = unit), never the rule.

5. New columns: old rows will be NULL.
   Always handle null gracefully in code. Never assume a new column is populated.

6. Reuse before adding.
   Before adding a new db.js function, check if an existing one can be reused.
   Duplicate DB functions are a maintenance trap.
---

## Scale Safety: Frontend

These rules protect you as the number of orders, operators, and departments grows.

1. Computed properties must run fast. No nested loops inside computed().
   Use smarter data structures if you need to cross-reference two lists.

2. Never bind functions that return new objects or arrays directly in templates.
   This causes Vue to re-render on every single keystroke.
   Use computed() in store.js instead.

3. All new reactive state goes in store.js.
   Not in main.js setup(). Not inline. One source of truth, one place to look.

4. New modals follow the existing pattern:
   - One ref(false) open/close flag in store.js
   - One form ref({}) in store.js
   - One errors ref({}) in store.js
   - Open/close logic in the relevant pages/*.js file
   - Template block at the bottom of index.html with the other modals

5. index.html is a template, not a logic file.
   If a template expression is longer than one line or has more than one ternary,
   move it to a computed() in store.js or a named function in pages/*.js.
---

## TC Assy: Specific Rules

### Mode Detection
- detectTcMode(partNumber) lives in libs/utils.js only. This is the ONLY place.
- Detection order: TCTC then TCC then TCP then TC then null (case-insensitive, trim first).
- Returns unit or stock or null.
- Never duplicate this logic anywhere else.
- Only the result is stored in work_orders.tc_job_mode. Never store the rule itself.
- tc_job_mode is the source of truth once set. User overrides write back to it.

### Isolation
- TC Assy logic is isolated to specific functions in dashboard-view.js.
- TC modals are isolated sections in index.html.
- Never modify TV Assy, Fab, Weld, Office, CS, or Manager when patching TC.

### Completion Rules
- Unit fields (unit_serial_number, engine, engine_serial_number, num_blades)
  are only required when tc_job_mode = unit.
- Subassy completions never require these fields.
- Apply this rule only to whole-WO completion, not individual stages.
---

## Patch Process: Non-Negotiable

Every change to this codebase follows this process:

1. Propose a patch plan first. Break work into the smallest testable units possible.
2. Wait for PASS before implementing the next patch.
3. One patch at a time. Never implement future patches early.
4. Every patch must include:
   - List of files touched
   - Unified diff (what changed and why)
   - Manual test checklist
   - End with: Reply PASS to proceed to Patch N
5. Minimal diff only. Do not refactor unrelated code during a feature patch.
6. Schema changes get their own patch when possible.
   Never combine a large schema change with a large UI rewrite in one patch.
---

## What Claude Must Never Do

- DROP TABLE, TRUNCATE, or any destructive SQL on live data
- Break the dependency tree (importing up the tree)
- Add business logic to main.js or index.html
- Add DB calls directly in store.js or pages/*.js (must go through db.js)
- Add reactive state outside of store.js
- Duplicate the detectTcMode logic anywhere
- Touch TV/Fab/Weld/Office/CS/Manager code in a TC-only patch
- Combine multiple large unrelated changes in one commit
- Store classification or routing logic in the database
- Skip the patch proposal step and start coding immediately
---

## Code Quality Standards

- Every new exported function gets a short comment: what it does, inputs, output.
- Always validate and sanitize inputs in pages/*.js before calling db.js.
- Every try/catch block must call store.showToast() so the user sees the error.
- Any action that changes work_orders status must save a snapshot
  to store.lastUndoAction before writing.
- Always .trim() and .toUpperCase() part numbers before storing or comparing.
- No magic strings used more than twice: put them in a constant in config.js.

---

## Tech Stack

| Layer        | Technology         | Notes                             |
|--------------|--------------------|-----------------------------------|
| UI Framework | Vue 3 CDN ESM      | No Vue CLI, no Vite, no webpack   |
| Styling      | Tailwind CSS CDN   | Utility classes only              |
| Database     | Supabase Postgres  | Primary table: work_orders        |
| Auth         | PIN-based          | PINs in config.js for now         |
| Deployment   | Static files       | No server, no build step          |
| Repo         | GitHub             | project873/WO-Progress-Kiosk      |
---

## File Length Rule: 500-Line Hard Cap

No file in this project may exceed 500 lines — with one exception: main.js is a pure
wiring manifest (no logic) and will grow linearly as features are added. Keep it under
600 lines; if it approaches that, look for inline arrays or functions to move to config.js
or page files respectively.

Before implementing any patch:
1. Count the current line length of every file you plan to touch.
2. Estimate the line count after your changes.
3. If any file would exceed 500 lines after the patch (or main.js would exceed 600),
   STOP and propose a split plan first.
4. The split plan must follow the dependency tree and partials convention.
5. Never combine a feature patch with a split in the same commit.

Files currently over 500 lines were split on 2026-04-13 into sub-files. The sub-file pattern:
- `libs/db-*.js` sub-files all import `withRetry` from `libs/db-shared.js`
- `libs/store-*.js` sub-files are re-exported by `libs/store.js` (no circular deps)
- `pages/dashboard-tv.js` and `pages/dashboard-tc.js` are split from `dashboard-view.js`
- Manager partials are split by sub-view: `view-manager-home`, `view-manager-kpi`, etc.

Known exceptions that cannot be split further without introducing components:
- `main.js` (~540 lines): pure wiring manifest, no logic, cap is 600 lines
- `partials/view-open-orders.html` (~705 lines): single continuous row template with 19
  columns; there is no v-if boundary to split at. Keep under 800 lines.

---

## Checklist Before Any New Feature

- Does new state belong in store.js (or the appropriate store-*.js sub-file)?
- Does new DB logic belong in db.js (or the appropriate db-*.js sub-file)?
- Does new detection or calculation logic belong in utils.js?
- Does main.js need to expose anything new to the template?
- Does the new feature break the dependency tree? Redesign if yes.
- Do existing DB rows need a null fallback for any new columns?
- Is there a matching undo path for any new status change?
- Is the feature isolated from unrelated departments?
- Will any touched file exceed 500 lines? If yes, split first.

---

## Partials Convention

index.html is a thin shell (~120 lines: head + styles + loading div + empty #app + script tag).
All template content lives in partials/*.html — plain HTML fragments with no <html>/<body> wrappers.

Load order (defined in main.js loadPartials()):
  header, main-open,
  view-splash, view-dashboard, view-office, view-manager, view-cs,
  main-close,
  modal-pin, modal-action-panel,
  modal-tc-unit, modal-tc-stock,
  modal-tv-unit, modal-tv-stock,
  modal-misc

How it works: loadPartials() in main.js fetches all fragment files in parallel, concatenates
their text into document.getElementById('app').innerHTML, then top-level await ensures this
completes before createApp() runs. Vue reads the populated DOM at mount time — no difference
from a monolithic index.html.

Rules:
- New modals/views go in a new partial file or appended to modal-misc.html for small additions.
- Never add script logic to partial files — Vue directives only.
- Never break the load order without checking template dependencies.

---

## Active Patch Series

No active series.

---

## Completed Patch Series

### TC Assy workflow improvements
- Patch 1: detectTcMode() utility in libs/utils.js
- Patch 2: Auto-detect mode in manual WO form; optional WO #; remove Job Type picker
- Patch 3: Auto-detect in entry modal; mode badge + Change control
- Patch 4: Remove TC entry modal; go directly to workflow screen
- Patch 5: Unit completion gate; rename Stock → Subassy in TC Assy
- Patch 6: Notes field on subassy WO screen + warning prompt on completion
- Patch 7: Undo visible after WO completion
- Patch 8: Split index.html into 15 partials; index.html reduced to ~120-line shell

### Per-operator time tracking
- Patch 1: Schema — `wo_time_sessions` table (id, wo_id, wo_number, department, operator, started_at, ended_at, duration_minutes, qty_this_session, end_status). RLS disabled.
- Patch 2: DB layer — `updateOrderStatus` opens a session row on started/resumed, closes it on paused/on_hold/completed (fire-and-forget, no work_orders change)
- Patch 3: Manager KPI section — Time Report panel: By WO tab (per-WO breakdown, expandable to operator sessions) and By Part # tab (avg hrs/WO baseline per part). Date range filter.

### Reel Weld dual-operation tracking
- Patch 1: Schema (6 new columns: weld/grind_reel_status, _operator, _qty); detectReelWeld() in utils.js; REEL_PART_NUMBERS in config.js; dual-ops panel in modal-action-panel.html (light cards, qty input, cumulative counter, per-op buttons, WO summary section); updateReelOperation() in db.js; startReelOperation/pause/complete in dashboard-view.js.
- Patch 2A: Split print summary block out of modal-action-panel.html into modal-action-panel-print.html (line-cap fix).
- Patch 2B: Reel ops wired to isReel computed; hold-button operator picker for reel WOs; operator select hidden for reel.

### wo_time_sessions stage wiring
- Patch 1: Schema — `ALTER TABLE wo_time_sessions ADD COLUMN IF NOT EXISTS stage TEXT`. Added `openTimeSession`, `closeTimeSession`, `closeAllOpenSessions` helpers to db.js. Refactored Fab/Weld inline session code to use helpers (stage=null). Wired reel ops (stage='weld'|'grind'), TV Assy stages (stage=stageKey or 'stock'), TC Assy stages (stage=stageKey or 'stock'), and manual TC WO complete (closeAllOpenSessions) in db-assy.js.

### TV Assy unit WO required fields + redesign
- Patch 1: TV unit inline unit details (engine model, engine serial, unit serial) + Engine/Cart Assy panels matching TC Assy layout; `saveTvUnitInfo` + `completeTvUnitWo` in db-assy.js; `saveTvUnitDetails` + `markTvUnitWoComplete` in dashboard-tv.js; full modal-tv-unit.html redesign.

### Color standardization
- Patch 1: All violet/purple completion actions → emerald (TC complete button, TC complete modal, TCWOC badge, TVWOC badge, closeout modal, closeout view, close-out button). Removed colored text from inside form input values.

### Closeout notes + history + PINs from Supabase
- Patch 1: Schema — `wo_status_tracking.closeout_notes TEXT`; `app_pins` table (name, pin) with rows for manager/closeout_office/cs.
- Patch 2: `saveCloseoutNotes`/`fetchClosedOutOrders` in db-office.js; `closedOutOrders/From/To/Filter/filteredClosedOutOrders` in store.js; `saveCloseoutNoteInline`/`loadClosedOutOrders`/`openClosedOutHistory` in wo-status-view.js; Notes column (inline edit on blur) + "Closed Out WOs" history view (amber mode, date range, filter) in view-office.html.
- Patch 3: `libs/pins.js` (zero-import PIN cache); `fetchAppPins()` in db-shared.js; PINs removed from config.js; `splash-view.js` uses `getPin('manager'|'cs'|'closeout_office')`; `main.js` loads PINs in parallel with partials at startup.

### Manager live alert resolution + WO qty alert
- Patch 1: Schema — `manager_alert_resolutions` table (id, alert_type, reference_id, resolved_by, resolution, resolved_at); index on (alert_type, reference_id, resolved_at).
- Patch 2: `insertAlertResolution` in db-manager.js; resolved filtering + `woQtyVsCompleted` bucket in `fetchManagerAlerts`; 7 resolve modal refs in store-manager.js; `openAlertResolve`/`submitAlertResolve` in pages/manager-alerts.js; 60s auto-poll in `openManagerSection`; bucket 6 + resolve modal in view-manager-home.html.

### Engineering Customer Follow-Up
- Patch 1: Schema — `engineering_followups` + `engineering_followup_events` tables with open anon-key RLS policies; `libs/db-followup.js` with 5 CRUD functions re-exported by db.js; status/priority/fit-status constants + labels/colors in config.js.
- Patch 2: List view — `engFollowups` store state, `engFollowupSummary` + `filteredEngFollowups` computed; `partials/view-engineering-followup.html` with 6 summary cards, search/filter bar, overdue/due-today row flags.
- Patch 3: Create + detail modal — follow-up modal state in store-engineering.js; `pages/engineering-followup.js` split from engineering-view.js (500-line cap); `partials/modal-eng-followup.html` with create form + 6-tab detail view (Part/Order, Customer, Follow-Up, Fit, Checklist, History); `addCalendarDays` in utils.js.
- Patch 4: Action buttons — `addBusinessDays` in utils.js; `engFollowupActionPanel/ResponseNote/ResponseType` refs; `applyFollowupNoAnswer`, `applyFollowupFitConfirmed`, `applyFollowupFitFailed`, `submitFollowupCustomerResponded`, `onFollowupDateShippedChange` in engineering-followup.js; action bar + customer-responded inline panel in modal.
- Patch 5: Close Case — `engFollowupChecklistCount` computed; `closeEngFollowupCase()` validates fit_status ≠ pending then patches status=closed + closes modal; checklist tab badge showing X/9 count (emerald when complete).
- Patch 6: Nav badge — `enterEngineeringMenu()` in splash-view.js preloads follow-up counts on Engineering sub-menu entry; red/amber count badge on "Customer Follow Up" splash button when overdue/due-today cases exist.

### WO Request part history auto-fill
- Patch 1: Schema — `issues_receipts` table (18 columns, 4 indexes including unique dedup index on source_file_name+source_row_number); `get_part_usage_summary_12mo(p_part TEXT)` Postgres RPC with SECURITY DEFINER returning three sums (SO+O, MO+O, MO+I); RLS enabled on table.
- Patch 2: Data import — Google Sheets exported as CSV, headers renamed to match DB columns, `part_number_normalized` column added via `=UPPER(TRIM(...))` formula, dates formatted YYYY-MM-DD, imported via Supabase Table Editor CSV import.
- Patch 3: `fetchPartUsageSummary12Mo(partNumber)` in db-inventory.js — calls RPC, returns `{ qty_sold_used_12mo, qty_used_in_mfg, qty_made_past_12mo }`, defaults all to 0 on no match or error.
- Patch 4: `woRequestHistoryLoading` ref in store-inventory.js + exposed in expose-ops.js; `openWoRequestDetail()` fires non-blocking `.then()` to auto-fill three form fields; toast+log on failure.
- Patch 5: modal-wo-request.html — heading "DATA: 1/1/25–12/31/25", spinner on loading, italic subtitle, simplified field labels; blue "Suggested Qty to Make" tile = ceil((sold+used)×1.05); amber stock warning banner when qty_made ≥ (used+sold)×1.25; modal widened to 75vw; `woRequestSuggestedQty` + `woRequestStockWarning` computeds in store-inventory.js.
