# CLAUDE.md
Permanent instructions for Claude. Read this entire file before every task.

---

## What This Project Is

A manufacturing operations platform for managing work orders, purchasing, engineering,
and production across multiple factory locations. It covers the full production lifecycle:
work order creation and routing, department-level shop floor tracking, purchasing and
receiving, engineering follow-up, customer service, and management reporting.

It is designed to scale — additional factory locations run their own instance against a
separate Supabase database, and the platform is being built toward integration with
external accounting software so that purchasing, job costing, and invoicing data flow
between systems without manual re-entry.

Departments currently supported: Fab, Weld, TV Assy, TC Assy, Office, CS, Manager.

- Frontend: Vanilla HTML + Vue 3 loaded from CDN. No build step. No npm. No bundler.
- Backend: Supabase (Postgres database + realtime API). No server to manage.
- Deployment: Static files served directly per location. Refresh the browser to get new code.
- Primary tables: work_orders, purchasing_orders, wo_requests, engineering_followups, open_orders.
- External integrations: Gemini AI via Cloudflare Worker proxy (pattern reused for future accounting API sync).

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
    expose-core.js     <- Imports from store + pages. Builds Vue template bindings (state + core UI).
    expose-ops.js      <- Imports from store + pages. Builds Vue template bindings (ops + workflows).
    expose-eng.js      <- Imports from store + pages. Builds Vue template bindings (engineering domain).
    expose-shipping.js <- Imports from store + pages. Builds Vue template bindings (open orders + completed orders).
         |
    main.js        <- Startup + lifecycle only. Calls buildCoreExpose() + buildOpsExpose() + buildEngExpose() + buildShippingExpose(). No logic.
         |
    partials/*.html <- Template fragments. No logic. All behavior via Vue directives.

Rules that enforce the tree:

- config.js: zero imports allowed (except the Supabase CDN library)
- utils.js: zero imports allowed. Every function must be pure (input in, output out, no side effects)
- store.js: only ref() and computed(). No fetch calls. No DB access. Import from config + utils only.
- db.js: all Supabase calls go here and ONLY here. No business logic. Import from config + utils only.
- pages/*.js: business logic and UI handlers. May import from store, db, utils. Never from other page files.
- expose-core.js / expose-ops.js / expose-eng.js / expose-shipping.js: import from store + pages only. Return plain objects for Vue setup(). No logic.
- main.js: startup, lifecycle watchers, loadPartials(). Calls expose files. Zero business logic.
- partials/*.html: template only. Never add script logic blocks. All behavior via Vue directives.

If you feel the urge to break this tree, stop and propose an alternative. Never break it.
---

## File Purpose Reference

| File                            | Single Responsibility                               | Never Add                       |
|---------------------------------|-----------------------------------------------------|---------------------------------|
| libs/config.js                  | Supabase client, constants, PARTIAL_NAMES           | Business logic, fetch calls     |
| libs/utils.js                   | Pure helpers (formatting, detection, math)          | State, imports, side effects    |
| libs/store.js                   | Re-exports all store-*.js sub-files                 | Direct state, fetch calls       |
| libs/store-*.js                 | Reactive state by domain (ref, computed only)       | Fetch calls, DB access          |
| libs/db.js                      | Re-exports all db-*.js sub-files + core WO queries  | UI logic, state mutations       |
| libs/db-*.js                    | Supabase queries by domain                          | Business logic, state           |
| libs/pins.js                    | In-memory PIN cache (fetched once at startup)       | Any imports, side effects       |
| libs/db-shared.js               | withRetry, supabase client, fetchAppPins            | Domain queries                  |
| pages/dashboard-view.js         | Fab/Weld workflow actions                           | TC/TV logic                     |
| pages/dashboard-tc.js           | TC Assy workflow actions                            | Other dept logic                |
| pages/dashboard-tv.js           | TV Assy workflow actions                            | Other dept logic                |
| pages/splash-view.js            | Navigation, dept/category selection                 | Workflow logic                  |
| pages/wo-status-view.js         | Office receive and closeout                         | Other dept logic                |
| pages/manager-view.js           | Manager KPIs, alerts, priorities, time report       | Operator workflow               |
| pages/manager-alerts.js         | Alert resolve modal logic                           | KPI/priority logic              |
| pages/wo-manager-approval.js    | WO final approval queue (manager-only view)         | Other dept logic                |
| pages/wo-request-view.js        | WO request form, detail, send-to-manager            | Approval/routing execution      |
| pages/cs-view.js                | Customer service lookup                             | Other dept logic                |
| pages/purchasing-view.js        | Purchasing order list, detail, tabs                 | Approval logic                  |
| pages/purchasing-approval.js    | Manager PO approval/revise                          | Order creation logic            |
| pages/engineering-followup.js   | Engineering customer follow-up actions              | Inquiry logic                   |
| expose-core.js                  | Vue bindings: state, core UI functions              | Business logic, DB calls        |
| expose-ops.js                   | Vue bindings: ops, workflows, management            | Business logic, DB calls        |
| expose-eng.js                   | Vue bindings: engineering domain                    | Business logic, DB calls        |
| expose-shipping.js              | Vue bindings: open orders + completed orders        | Business logic, DB calls        |
| main.js                         | Startup, lifecycle watchers, loadPartials()         | Business logic, DB calls        |
| index.html                      | Thin shell: head + #app div + script tag only       | Any template content            |
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

7. Every new table needs explicit grants (enforced October 30, 2026).
   Supabase no longer auto-exposes new public-schema tables to the Data API.
   After every CREATE TABLE statement, add:
     GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table_name TO anon, authenticated;
   Without this, supabase-js queries will silently return empty results.
   RLS policies still control row-level access — this grant just opens the door.
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

## WO Request: Status Lifecycle

wo_requests rows move through a fixed status pipeline. Never skip or reverse steps.

    pending
      │  Submitted by planner. Visible in WO Request view.
      │  Planner fills routing fields, clicks "Send to Manager".
      ▼
    manager_review
      │  Routing saved, awaiting manager final approval.
      │  Visible in Approve WO Creation view (production tab, manager only).
      │  Manager can revise fields or send back (→ pending) with a note.
      ▼
    in production
      │  Manager clicked "Final Approve". job_number assigned via RPC.
      │  work_orders rows created via insertWorkOrdersFromRequest().
      │  Visible in Create WO view (awaiting official Alere WO#).
      ▼
    in production + alere_wo_number set
      │  Official WO# entered. work_orders.wo_number backfilled.
      ▼
    completed / forecasted
         forecasted=true rows are sidelined to WO Forecasting view.

Rules:
- `sendToManagerApproval()` in wo-request-view.js handles pending → manager_review.
  It saves routing fields but does NOT assign job_number or create work_orders.
- `managerFinalApproveWo()` in wo-manager-approval.js handles manager_review → in production.
  It assigns job_number (RPC, race-safe) and calls insertWorkOrdersFromRequest().
- Never call insertWorkOrdersFromRequest() from wo-request-view.js. That is now manager-only.
- The `WO_REQUEST_STATUS_MANAGER_REVIEW = 'manager_review'` constant lives in config.js.

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

## Red-Team Review: On Request Only

This runs ONLY when the user explicitly says "red team" (or "red team this").
Never run it automatically on a change. For normal changes, follow the Patch Process
above and implement directly. When the user does invoke it, run the full flow below.
It happens AFTER the patch plan is agreed and BEFORE any implementation.

1. North Star. Produce the phased patch plan per the Patch Process above:
   what we want, what we explicitly do NOT want, files touched, schema deltas,
   and a manual test checklist. No code yet.

2. Red team. Spin up subagents in parallel (Agent tool), each with ONE lens.
   Each attacks the PLAN, not code (code does not exist yet):
   - Architecture cop  — dependency tree, file boundaries, 500-line cap, partials convention.
   - Database & scale  — migration safety, GRANTs, unbounded queries, null fallbacks, derive-don't-store.
   - Security          — RLS/grants, PIN/auth, input sanitization, outward-facing actions.
   - Frontend/Vue      — reactivity traps, computed perf, modal pattern, no logic in templates/main.js.
   - Simplicity critic — argue to cut scope and kill complexity. Keep the plan as simple as effective.

3. Triage & fix. Each agent returns findings ranked high / medium / low. The main
   agent fixes the real ones in the plan and explicitly states which findings it
   dismissed and why (especially any that contradict this CLAUDE.md).

4. Repeat steps 2-3 until TWO consecutive red-team rounds surface only cosmetic
   issues or nothing. Then — and only then — implement, following the Patch Process.

Proportionality:
- Full 5-agent panel for any change touching logic, schema, DB, reactive state,
  routing, security, or more than one file.
- Reduced panel or skip for trivial cosmetic edits (typo, color, copy, single
  static string). State which agents were skipped and why.
- No formal P0/P1/P2 gate yet — high/medium/low ranking only. Add the hard gate
  later if the loop fails to converge.
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
| Auth         | PIN-based + Supabase Auth | PINs fetched from `app_pins` table at startup via `fetchAppPins()` in db-shared.js; cached in `libs/pins.js`. Supabase Auth used for session roles (manager, office, etc.) |
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
- `main.js` (~176 lines): startup + lifecycle only. Template bindings moved to expose-core.js
  and expose-ops.js. Cap is 250 lines — if it grows past that, something is wrong.
- `expose-core.js` / `expose-ops.js` / `expose-eng.js` / `expose-shipping.js`: pure binding manifests, grow linearly. Keep each under 500 lines.
- `partials/view-open-orders.html` (~722 lines): single continuous row template with 18
  columns; there is no v-if boundary left to split at (top bar and action bar already
  extracted; config-driven cell compression proposed July 2026 and declined). Keep under
  800 lines. USER DIRECTIVE: any NEW Open Orders UI block (bars, panels, modals) goes in
  its own partial — only edits to existing row-grid cells may touch this file.
- `pages/wo-request-view.js` (~530 lines): pre-existing over-cap. Split deferred — do not
  add to this file without splitting first.

---

## Checklist Before Any New Feature

- Does new state belong in the appropriate store-*.js sub-file?
- Does new DB logic belong in the appropriate db-*.js sub-file?
- Does new detection or calculation logic belong in utils.js?
- Do expose-core.js or expose-ops.js need to expose anything new?
- Does the new feature break the dependency tree? Redesign if yes.
- Do existing DB rows need a null fallback for any new columns?
- Is there a matching undo path for any new status change?
- Is the feature isolated from unrelated departments?
- Will any touched file exceed 500 lines? If yes, split first.
- Does any new table have an explicit GRANT to anon and authenticated roles?
- If adding a new view: is it added to PARTIAL_NAMES in config.js?
- If adding a new view: is currentView === 'new_view' handled in main.js watch?
- If adding a new splash button: is it manager-only (v-if="sessionRole === 'manager'") if appropriate?

---

## Partials Convention

index.html is a thin shell (~120 lines: head + styles + loading div + empty #app + script tag).
All template content lives in partials/*.html — plain HTML fragments with no <html>/<body> wrappers.

The authoritative load order is the PARTIAL_NAMES array in libs/config.js.
That array is the single source of truth — do not maintain a duplicate list here.

How it works: loadPartials() in main.js fetches all fragment files in parallel, concatenates
their text into document.getElementById('app').innerHTML, then top-level await ensures this
completes before createApp() runs. Vue reads the populated DOM at mount time — no difference
from a monolithic index.html.

Hard rules:
- Never add script logic to partial files — Vue directives only.
- Never break the load order without checking template dependencies.
- Every new partial must be added to PARTIAL_NAMES in config.js or it will not load.
- Never split a partial without proposing the split first (see Partial Split Protocol below).

---

## Partials: Decision Guide

Use this when adding any new UI. Answer each question in order.

### Step 1 — What type of UI is this?

```
New top-level view (new currentView value, new splash destination)?
  → New file:  partials/view-{name}.html
  → New file:  pages/{name}-view.js  (unless it fits in an existing domain JS file)
  → goto Step 2

New sub-view inside an existing domain (e.g. new tab in Purchasing)?
  → New file:  partials/view-{domain}-{subview}.html
  → Reuse existing domain pages/*.js (if under 500 lines), else propose a split
  → goto Step 2

New manager sub-view (only reachable from Manager Hub home screen)?
  → New file:  partials/view-manager-{name}.html
  → Add logic to pages/manager-view.js (if under 500 lines), else propose a split
  → goto Step 2

New modal (overlay triggered by a button)?
  → Simple: single purpose, under 80 lines → add a block to modal-misc.html
  → Complex: tabs, multiple sections, or over 80 lines → new partials/modal-{domain}-{name}.html
  → goto Step 2

Small addition to an existing view (new column, button, filter, section)?
  → Edit the existing partial directly IF the result stays under 500 lines
  → If it would push past 500 lines → propose a split first (see Partial Split Protocol)
  → STOP — no new file needed
```

### Step 2 — Naming convention

| Pattern | Example | Use when |
|---|---|---|
| `view-{name}` | `view-purchasing` | Top-level standalone view |
| `view-{domain}-{subview}` | `view-purchasing-ordering` | Sub-view/tab within a domain |
| `view-manager-{name}` | `view-manager-kpi` | Manager Hub sub-view only |
| `modal-{name}` | `modal-pin` | Simple modal not tied to one domain |
| `modal-{domain}-{name}` | `modal-purchasing-detail` | Domain-specific complex modal |

Use kebab-case always. Match the `currentView` value or `managerSubView` value when naming view partials.

### Step 3 — Where does it go in PARTIAL_NAMES?

PARTIAL_NAMES has seven zones. Insert your new file in the correct zone:

```
Zone 1 — Structural openers:   header, main-open            ← never move these
Zone 2 — Core views:           view-splash, view-dashboard, view-office, view-cs
Zone 3 — Manager sub-views:    view-manager-home and all view-manager-* grouped together
Zone 4 — Domain view groups:   view-{domain} followed immediately by its view-{domain}-* sub-views
Zone 5 — Standalone misc views: view-messages, view-po-request, and similar one-off views
Zone 6 — Structural closer:    main-close                   ← always last before modals
Zone 7 — All modals:           domain modals first, then modal-misc, then structural modals last
```

Sub-views must come immediately after their parent view in Zone 4.
Domain modals (Zone 7) should be grouped near other modals from the same domain.

### Step 4 — Which JS file pairs with this partial?

Each domain has one primary JS file. Sub-views and modals within that domain share it.
Only create a new JS file if the domain file would exceed 500 lines.

| Domain | View partials | Modal partials | Primary JS file |
|---|---|---|---|
| Purchasing | view-purchasing, view-purchasing-* | modal-purchasing-* | pages/purchasing-view.js |
| Engineering | view-engineering-* | modal-eng-* | pages/engineering-view.js + pages/engineering-followup.js |
| Manager | view-manager-* | — | pages/manager-view.js + pages/manager-alerts.js |
| Dashboard | view-dashboard | modal-action-panel, modal-tc-*, modal-tv-* | pages/dashboard-view.js + pages/dashboard-tc.js + pages/dashboard-tv.js |
| WO Request | view-wo-request, view-create-wo | modal-wo-request | pages/wo-request-view.js |

When splitting a JS file: name it `pages/{domain}-{subfeature}.js`. Never import from another
pages/*.js file — that breaks the dependency tree.

### Step 5 — Wiring checklist

**For a new view:**
- [ ] Created `partials/view-{name}.html`
- [ ] Created or updated `pages/{name}-view.js`
- [ ] Added to PARTIAL_NAMES in the correct zone
- [ ] Added `if (v === '{name}') load{Name}()` in the currentView watch in main.js
- [ ] New state refs added to the appropriate `libs/store-*.js`
- [ ] New DB functions added to the appropriate `libs/db-*.js`
- [ ] New functions exported from expose-ops.js or expose-core.js
- [ ] Navigation wired (splash button or tab link that sets currentView)

**For a new modal:**
- [ ] Decided: simple → modal-misc.html, complex → new partial
- [ ] Open/close/form refs added to the appropriate `libs/store-*.js`
- [ ] Open/close/submit functions added to the domain's `pages/*.js`
- [ ] If new partial: added to PARTIAL_NAMES in Zone 7 near other domain modals
- [ ] Functions exported from expose-ops.js

**For a new manager sub-view:**
- [ ] Created `partials/view-manager-{name}.html`
- [ ] Logic added to `pages/manager-view.js` or a proposed split
- [ ] Added to PARTIAL_NAMES in Zone 3 with other view-manager-* files
- [ ] `v-if="managerSubView === '{name}'"` on the root element of the partial
- [ ] Data load wired in the managerSubView watch in main.js if needed
- [ ] Tile added to `partials/view-manager-home.html`

---

## Partial Split Protocol

A split is required when a partial would exceed 500 lines. Splits are never done silently.

**Before splitting any partial, Claude must propose:**
1. The name and purpose of each new file being created
2. Exactly which blocks of HTML move to which file
3. Whether a `<Teleport>` target div is needed in the parent (and where it goes)
4. Any `v-if` or `v-show` conditions that move with the block
5. The new PARTIAL_NAMES positions for each new file
6. Which expose-ops.js or store bindings are affected (if any)
7. Confirmation that no circular dependencies are introduced

**Circular dependency check for partials:**
Partials have no imports, but they reference Vue bindings by name. A circular dependency
in this context means a split that causes two partials to depend on each other's DOM structure
(e.g., a Teleport target in file A that is only rendered when file B's content is mounted).
Always verify: does file A's template require anything that only exists because file B loaded?
If yes, reconsider the split boundary.

**Split commits are always isolated:**
Never combine a partial split with a feature change in the same commit.
Never propose a split and a feature in the same patch plan.

---

## Standalone Views vs Manager Sub-Views

Two patterns exist for views accessible from the manager role:

1. **Manager sub-view**: `currentView === 'manager' && managerSubView === 'xyz'`
   Use for views that are only ever reached through the Manager Hub home screen.
   Examples: KPIs, Priorities, Delayed WOs, WO Problems.

2. **Standalone view**: `currentView === 'xyz'`
   Use when the view is also accessible from somewhere other than Manager Hub
   (e.g. a production tab button, a splash tile, etc.).
   Examples: `currentView === 'wo_approval'` (accessible from production tab AND manager home tile).
   Standalone views must be added to the currentView watch in main.js to trigger data loading.

Always prefer standalone for any manager view that shop floor staff might also need to reach.

---

## Active Patch Series

### BOM editor + native part creation (July 2026)
Goal: BOM lookup/edit tab in the Part Changes view + New Part form (Alere replacement).
Decisions: item_master extended (not a second table); BOM edits auto-open a bom_change
part_changes record; editing/creating is manager-only (read-only otherwise).
- Patch 1 (DONE, user-run SQL): item_master + item_type, ship_price, box_weight, box_l/w/h,
  8 attr_* booleans, record_source (default 'ALERE'). See bom-editor-migration.sql.
- Patch 2: libs/db-bom.js (BOM line CRUD stamped source='native', fetchBomWithDescriptions,
  checkPartExists, insertItemMasterPart) + ITEM_ATTRIBUTES / RECORD_SOURCE_NATIVE in config.js.
- Patch 3 (DONE): BOM Lookup tab (read-only) — view-part-changes-bom.html (Teleport into
  #bom-tab-body), pages/bom-editor.js. 3B: expandable tree — click a row to load the child's
  own BOM indented one level (flat bomLines rows carry depth/path/expanded/leaf; cycle guard,
  depth cap 10, leaf rows lose the chevron).
- Patch 4: manager-only BOM editing + auto-open bom_change record per parent.
- Patch 5: New Part form (modal-new-part.html) from unknown-part flow + standalone button.

OPS RULE (from Patch 1): any Alere import/squash into item_master or all_boms must skip or
preserve rows WHERE record_source/source = 'native'.

### Open Orders production-readiness (July 2026)
Goal: harden the Open Orders (shipping) view before go-live. Approved order:
- Patch 0A (DONE): selection action bar split → `view-open-orders-actionbar.html` (line-cap relief).
- Patch 0B (DONE): Open Orders + Completed Orders bindings split from expose-ops.js → `expose-shipping.js`.
- Patch 1 (DONE): Request WO / Request PO buttons on open order rows (pre-fill + navigate).
- Patch 2 (DONE): stale/insert fixes — set `last_status_update` on insert; `getStaleHighlightColor` fallback; chute init in paste mode.
- Patch 3 (DONE): 3A split Add Row(s) modal logic → `pages/open-orders-add.js`; 3B paste hardening —
  dedup warning w/ per-row "Add anyway" override, `normalizePasteDate` + `matchOpenOrderStatus` in utils.js,
  paste-preview warning banners + Add?/Date columns, `openOrderPasteAdd/Dup/WarnCount` computeds.
- Patch 4 (DONE): filter box in top bar — `openOrdersFilter` ref, pure `openOrderMatchesFilter` in utils.js
  wired into `_openSectionSorted`; filter reset in `enterOpenOrdersView`. view-open-orders.html at 797/800 —
  Patch 5 needs a mini split first.
- Patch 5A (DONE): top bar split → `view-open-orders-topbar.html` (Teleport into `#oo-topbar`).
- Patch 5B (DONE): Qty Pulled ("PLD") shown + inline-editable in Part#/Qty cell; amber when ≠ To Ship.
- Patch 6A (DONE): purchasing-view.js split (825→459) — steel tab functions → `pages/purchasing-steel.js`;
  detail-modal quotes → `pages/purchasing-quotes-view.js`. expose-ops + main.js imports repointed.
- Patch 6B (DONE): PO → open orders sync via shared `_syncOpenOrderForPo` helper in purchasing-receive.js
  (non-fatal, part orders w/ SO# only, never touches Boxed/Shipped rows). Sites: submit → 'PO Requested';
  completeOrder + manual status→ordered in _doSave → 'PO Created' + PO# + expected date as deadline;
  full receive → 'New/Picking' when row still PO Requested/Created.
- Patch 7 (DONE): delete safety — row deletes now move to open_orders_completed with status 'Deleted'
  (shipOpenOrder gained a finalStatus param; Restore brings them back; no schema change, no hard deletes).
  Cleanup: removed unused `moveToSection` + db-level `deleteOpenOrder`, deleted orphaned
  `modal-open-orders-edit.html`, completed-view count chip says "rows".
SERIES COMPLETE (July 7, 2026) — remaining deferred items: reminder-email sender backend; Wald/KY section.
- Deferred: reminder-email sender (button stays; no backend yet). Wald/KY section (bin-prefix routing) is secondary, after this series.

## Split Needed (pre-existing over-cap files)

- `pages/wo-request-detail.js` (509 lines): went over cap in the Part Changes chain patch (April counts used a blank-line-skipping counter). Split deferred at user direction — do not add to this file without splitting first. Natural boundary: subpart-inspect functions → pages/wo-request-subparts.js.
- `partials/modal-purchasing-detail.html` (689 lines): Split deferred — do not add without splitting first.
- `partials/modal-wo-request.html` (365 lines): Owed split DONE — the Data section (heading through "Last 3 Times Made") was extracted into the teleported partial `modal-wo-request-data.html` (target div `#wo-request-data-body`, same pattern as the subparts teleport). Now under cap.

---

## Completed Patch Series

### Part Changes (replacement history + BOM update checklist, July 2026)
- Patch 1: expose split — engineering bindings moved from expose-core.js to new `expose-eng.js` (expose-ops was at 498/500); main.js calls buildEngExpose().
- Patch 2: Schema — `part_changes` table (change_type, part/previous part + generated normalized cols, replacement_reason, carry_forward_note, use_previous_for_calcs, checklist JSONB state, status, created/completed meta) + indexes + RLS + GRANT; PART_CHANGE_* constants incl. 7 checklist item definitions in config.js (DB stores only per-item state).
- Patch 3: `libs/db-part-changes.js` — CRUD + `resolvePartCalcChain` (replacement links only, depth-capped 5, loop-guarded, falls back to [self]) + `fetchOpenChangesForPart`; re-exported by db.js.
- Patch 4: chain-aware history — `fetchPartUsageSummary12Mo/36Mo` sum across the chain (optional pre-resolved chain param; return gains chain+links; purchasing combines automatically with zero edits); wo-request-detail.js resolves chain once and feeds all 4 history fetches (qty_sold summed over chain; parent BOM demand deliberately single-part); `woRequestCalcChain/ChainParts` in store-inventory.js; indigo breadcrumb banner in modal-wo-request-data.html. Purchasing breadcrumb BANNER deferred until purchasing-view.js/modal-purchasing-detail.html splits.
- Patch 5: Part Changes view — `pages/part-changes-view.js`, `view-part-changes.html` (engView='part_changes' under currentView='engineering' — no main.js watch needed), `modal-part-change.html` create form, Engineering sub-menu tile (grid 3→4 cols), state in store-engineering.js.
- Patch 6: detail modal + checklist — ✓/N-A per item stamped {state, by, at} (name required), X/7 badge, `completePartChange` gate (all items checked or N/A), reopen path, editable reason/note/calc-flag locked when completed.
- Patch 7: warnings — amber "Eng Change Open — verify print/BOM" pills on WO Request detail (selectedWoRequest watch in main.js → `loadWoRequestOpenChanges`, keeping frozen wo-request-detail.js untouched); part-change open-count preload in enterEngineeringMenu + amber badge on the splash tile.

### view-purchasing.html split + location grouping
- Split: `view-purchasing.html` (811 lines) reduced to ~65-line shell with empty `#po-tab-body` target div. Tab content extracted to 4 new partials via Vue 3 `<Teleport to="#po-tab-body">`: `view-purchasing-ordering.html` (parts + supplies + steel), `view-purchasing-approval.html`, `view-purchasing-completed.html`, `view-purchasing-quotes.html`. All 4 added to PARTIAL_NAMES after `view-purchasing`.
- Feature: `partOrdersByLocation`, `supplyOrdersByLocation`, `poForecastOrdersByLocation` computeds added to store-purchasing.js (same pattern as `steelOrdersByLocation`); exposed in expose-ops.js. Parts and supplies ordering tabs now group rows by ship-to location with section headers. Steel tab unchanged (already grouped). `view-po-forecasting.html` updated to group forecasted orders by location using `poForecastOrdersByLocation`.

### PO Forecasting
- Patch 1: Schema — `ALTER TABLE purchasing_orders ADD COLUMN IF NOT EXISTS forecasted BOOLEAN NOT NULL DEFAULT false`.
- Patch 2: `fetchForecastedOrders` + `deletePurchasingOrder` in db-purchasing.js; `fetchPurchasingOrders` + `fetchPoReceiveOrders` updated to exclude forecasted=true; `poForecastOrders/Loading/DeleteId/MoveBackId` refs in store-purchasing.js; new `pages/purchasing-forecast.js` (enter/exit, load, delete, move-back); new `partials/view-po-forecasting.html`; `view-po-forecasting` in PARTIAL_NAMES; PO Forecasting splash button in purchasing sub-menu (grid updated to 3-col non-manager, 4-col manager); expose-ops.js + main.js wired.
- Patch A: Removed "Forecast for Later" from new request form (modal-purchasing-request.html footer restored to 2 buttons).
- Patch B: Schema — `ALTER TABLE purchasing_orders ADD COLUMN IF NOT EXISTS forecast_revisit_date DATE; ADD COLUMN IF NOT EXISTS forecast_reason TEXT`.
- Patch C: `openPoForecastSend/closePoForecastSend/submitPoForecastSend` in purchasing-forecast.js; `poForecastSendOpen/Saving/Errors/Form` refs in store-purchasing.js; "Forecast for Later" button in modal-purchasing-detail.html footer (indigo, non-approval only); new `partials/modal-purchasing-forecast-send.html` (z-60 overlay, revisit date + reason fields); view-po-forecasting.html columns updated to show `forecast_revisit_date`/`forecast_reason`; `modal-purchasing-forecast-send` in PARTIAL_NAMES; expose-ops.js updated.

### Purchasing section (ordering workflow)
- Patch 1: Schema (`purchasing_orders` + `purchasing_order_events` tables, RLS enabled with open anon policies); `libs/db-purchasing.js` (6 CRUD functions re-exported by db.js); `libs/store-purchasing.js` (all reactive state); `pages/purchasing-view.js` (business logic); `partials/view-purchasing.html` shell; `partials/modal-purchasing-request.html` (new request form); navigation wired in splash sub-menu (PO Requests → modal, Ordering → purchasing view); `enterPurchasingView` in splash-view.js; `isPurchasingOrderLate` in utils.js; all state + functions exposed in expose-ops.js / expose-core.js; PARTIAL_NAMES + purchasing constants in config.js.
- Patch 2: Full create-request modal with type selector (Part/Supply/Steel) and dynamic field sets; active order list views per tab with late/overdue indicators; Completed tab with date range filter.
- Patch 3: Detail/edit modal with Ordering tab (status, supplier, PO, lead time, expected date, qty, notes), Receiving tab (qty received, received by, auto-status to received/partially_received), Request Info tab (read-only requester fields).
- Patch 4: History tab in detail modal showing `purchasing_order_events` timeline (type badge, old→new status arrow, note, created-by, timestamp); `loadOrderEvents()` triggered on tab click; overdue indicators on order rows; Completed tab fully implemented with date range filter.

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

### Manager Approve WO Creation
- Patch 1: `WO_REQUEST_STATUS_MANAGER_REVIEW` constant in config.js; `fetchManagerPendingWoRequests()` in db-inventory.js (filter status='manager_review').
- Patch 2: `approveWoRequest()` replaced by `sendToManagerApproval()` in wo-request-view.js — same 11-field validation but sets status='manager_review' only, no job# or work_orders created. Button renamed "Send to Manager" (blue). expose-ops.js updated.
- Patch 3: `libs/store-manager.js` — 8 new refs for approval queue state; new `pages/wo-manager-approval.js` — PIN auth (later removed), load list, open/close detail, save, `managerFinalApproveWo` (full routing logic + traveller/subpart support), send back; new `partials/view-manager-wo-approval.html`; manager home tile added; PARTIAL_NAMES + expose-ops.js + main.js wired.
- Post-patch revision: PIN gate removed; view converted to standalone (`currentView === 'wo_approval'`); "Approve WO" button added to production tab between Request WO and Create WO (manager-only, with badge count); `enterWoApprovalView` / `exitWoApprovalView` added to wo-manager-approval.js; manager home tile updated to call `enterWoApprovalView`.
- UI revision: list changed from left-panel to full-width card grid; detail opens as modal overlay on card click.

### WO Request part history auto-fill
- Patch 1: Schema — `issues_receipts` table (18 columns, 4 indexes including unique dedup index on source_file_name+source_row_number); `get_part_usage_summary_12mo(p_part TEXT)` Postgres RPC with SECURITY DEFINER returning three sums (SO+O, MO+O, MO+I); RLS enabled on table.
- Patch 2: Data import — Google Sheets exported as CSV, headers renamed to match DB columns, `part_number_normalized` column added via `=UPPER(TRIM(...))` formula, dates formatted YYYY-MM-DD, imported via Supabase Table Editor CSV import.
- Patch 3: `fetchPartUsageSummary12Mo(partNumber)` in db-inventory.js — calls RPC, returns `{ qty_sold_used_12mo, qty_used_in_mfg, qty_made_past_12mo }`, defaults all to 0 on no match or error.
- Patch 4: `woRequestHistoryLoading` ref in store-inventory.js + exposed in expose-ops.js; `openWoRequestDetail()` fires non-blocking `.then()` to auto-fill three form fields; toast+log on failure.
- Patch 5: modal-wo-request.html — heading "DATA: 1/1/25–12/31/25", spinner on loading, italic subtitle, simplified field labels; blue "Suggested Qty to Make" tile = ceil((sold+used)×1.05); amber stock warning banner when qty_made ≥ (used+sold)×1.25; modal widened to 75vw; `woRequestSuggestedQty` + `woRequestStockWarning` computeds in store-inventory.js.
