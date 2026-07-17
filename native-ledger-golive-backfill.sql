-- ============================================================
-- native-ledger-golive-backfill.sql — Native Ledger, Patch 6 (go-live ops)
--
-- One-time (but SAFELY RERUNNABLE) backfill of SO/O "sold" rows for open
-- orders that were already on the board when the ledger went live — their
-- add happened before Patch 4b existed, so no SO/O was ever emitted.
-- Without this, a later delete/cancel of such a row writes a reversal
-- with no positive to net against, and sold undercounts.
--
-- Run in the Supabase SQL editor (service role — bypasses the insert
-- policy, which is fine: rows are dated exactly AT the cutover).
--
-- Safety properties:
--   * Keys are the STANDARD add keys ('oo|<board id>|SO|O'), so:
--       - rerunning skips everything already inserted (conflict-ignore)
--       - a row added live by Patch 4b already owns its key → skipped
--       - a backfilled row later deleted/cancelled gets its reversal
--         dated at the cutover too (the clamp) → they net in every window
--   * SO/O has no on-hand effect, so this can run before or after the
--     physical count import — order does not matter.
--   * Part B covers rows that left the board (Shipped/Deleted/Cancelled)
--     between the Patch 4b deploy and this run — keyed on original_id,
--     which equals the old board id, so the same dedup applies.
-- ============================================================

-- ── Part A: rows currently on the board ─────────────────────────────
INSERT INTO public.issues_receipts
    (txn_date, part_number, part_number_normalized, doctype, trantype,
     qty, docid, source, native_event_key)
SELECT
    public.native_cutover(),
    btrim(o.part_number),
    upper(btrim(o.part_number)),
    'SO', 'O',
    o.to_ship,
    nullif(left(coalesce(o.sales_order, ''), 50), ''),
    'native',
    'oo|' || o.id || '|SO|O'
FROM public.open_orders o
WHERE o.part_number IS NOT NULL
  AND btrim(o.part_number) <> ''
  AND o.to_ship IS NOT NULL
  AND o.to_ship > 0
ON CONFLICT (native_event_key) DO NOTHING;

-- ── Part B: rows that reached Completed after go-live ───────────────
-- (deploy-window coverage; also harmlessly re-covers rows Patch 4b
--  already ledgered — their keys collide and are skipped)
INSERT INTO public.issues_receipts
    (txn_date, part_number, part_number_normalized, doctype, trantype,
     qty, docid, source, native_event_key)
SELECT
    public.native_cutover(),
    btrim(c.part_number),
    upper(btrim(c.part_number)),
    'SO', 'O',
    c.to_ship,
    nullif(left(coalesce(c.sales_order, ''), 50), ''),
    'native',
    'oo|' || c.original_id || '|SO|O'
FROM public.open_orders_completed c
WHERE c.original_id IS NOT NULL
  AND c.status IN ('Shipped', 'Deleted', 'Cancelled')
  AND c.shipped_at >= public.native_cutover()
  AND c.part_number IS NOT NULL
  AND btrim(c.part_number) <> ''
  AND c.to_ship IS NOT NULL
  AND c.to_ship > 0
ON CONFLICT (native_event_key) DO NOTHING;

-- ── Verify ──────────────────────────────────────────────────────────
-- Row counts inserted so far under backfill-style keys (rerun-safe view):
-- SELECT count(*) FROM issues_receipts
--   WHERE source='native' AND doctype='SO' AND trantype='O'
--     AND txn_date = public.native_cutover();
