# Native Inventory Ledger — Operations Guide

Service-role procedures for the native ledger (Patches 1–6, July 2026).
Everything here runs in the Supabase SQL editor or Table Editor — never
from a kiosk. The app itself only ever INSERTs constrained native rows.

## The moving parts

| Piece | What it is |
|---|---|
| `issues_receipts` (`source='native'`) | The ledger. Append-only from the app; every row has a deterministic `native_event_key`. |
| `part_on_hand` | Live on-hand per part, maintained by DB triggers. `counted_at` NULL = never physically counted → app shows "—". |
| `native_cutover()` | The cutover date (2026-07-16). Alere data counts before it, native data from it. Change = `CREATE OR REPLACE` that one function. |
| `reconcile-part-on-hand.sql` | Verify/repair script: recomputes on-hand from the ledger, reports drift, optional repair step. |
| `native-ledger-golive-backfill.sql` | One-time (rerunnable) SO/O backfill for board rows that predate the ledger. |

## Go-live sequence

1. Apply Patches 1–2 SQL (done), deploy the app code (Patches 3–5).
2. Run `native-ledger-golive-backfill.sql` once.
3. Do the physical count and import it (below). This activates on-hand
   tracking per counted part. Best done when no same-day WO closeouts /
   receives / ships will follow before the import lands.

## Physical count entry (IC rows)

**Per-part (the normal path):** the Inventory Adjustment screen in the app.
Entering a Real Qty + Counted By saves the item_master manual count as
before AND calls the `import_inventory_count` RPC
(native-ledger-count-rpc.sql), which writes the IC ledger row and anchors
`part_on_hand`. Nothing else to do.

**Bulk (full hard count):** import a CSV into **issues_receipts** via
Table Editor (service role bypasses the client policy — direct IC inserts
are deliberately not client-insertable; the RPC is the only app path).
One row per counted part, columns:

| column | value |
|---|---|
| `txn_date` | count date, `YYYY-MM-DD` |
| `part_number` | as counted (trigger normalizes) |
| `part_number_normalized` | `=UPPER(TRIM(part))` formula (trigger recomputes anyway) |
| `doctype` | `IC` |
| `trantype` | `C` |
| `qty` | counted quantity (this SETS on-hand) |
| `docid` | `counted by: NAME` (audit trail) |
| `source` | `native` |
| `native_event_key` | `ic|<count date>|<part_number_normalized>` — REQUIRED; makes the import rerunnable (a re-import of the same file dedups instead of double-inserting) |

The AFTER trigger sets `part_on_hand.on_hand = qty` and stamps
`counted_at` for each row as it inserts. No other step needed.

**Corrective count:** the ledger is append-only — never edit or delete an
IC row. To fix a bad count, insert a new IC row for that part with a later
date (new key). The newest count always wins.

**Recount cadence:** on-hand self-heals at every count. Drift between
counts (lost non-fatal writes, partial PO receipts, qty-edited orders) is
expected to be small; run `reconcile-part-on-hand.sql` Step 1 any time to
measure it. The reconcile diff is also the detector for suppressed or
forged `native_event_key` rows.

## Standing OPS rules (also in CLAUDE.md)

- Any future Alere import into `issues_receipts` **or**
  `sales_analysis_lines` must be trimmed to dates **before**
  `native_cutover()`, and must never touch `source='native'` rows.
- Counts and backfills are service-role only.
- If the backfill is ever wrapped in a stored function, add
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` (Postgres grants
  EXECUTE to PUBLIC by default).

## Known v1 gaps (accepted at red-team)

- Partial PO receipts don't hit the ledger until the completing receive.
- `to_ship` edits and backorder splits after entry can drift the sold
  stat vs the add-time SO/O row (reconcile/recounts absorb; no delta rows
  by design).
- Native purchase rows carry no supplier/cost (per-supplier history stays
  Alere-only until purchasing gets a supplier id).
- A mistaken closeout has no undo — correct with a fresh IC count for the
  affected parts.
- Sold semantics shift at the cutover: Alere counted sold at ship;
  native counts sold at order entry.
