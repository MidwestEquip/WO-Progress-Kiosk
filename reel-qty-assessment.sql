-- reel-qty-assessment.sql
-- READ-ONLY. Nothing in this file writes, updates, or deletes.
-- Purpose: measure the blast radius of the reel-WO qty_completed bug
-- (updateReelOperation / completeReelWo never wrote work_orders.qty_completed,
-- so reel WOs closed out with qty_completed = 0). Fixed forward in libs/db.js.
--
-- Run each query separately in the Supabase SQL editor and paste results back.
-- Reel part list mirrors REEL_PART_NUMBERS in libs/config.js — keep in sync.

-- ── Q1: LIVE reel WOs still on the floor with lost qty ───────────────
-- These are repaired automatically the next time an operator hits COMPLETE WO
-- (or logs any further reel op) now that the fix is in. Count tells us how
-- many will self-heal vs. how many need a nudge.
SELECT
    wo_number, part_number, department, status,
    qty_required, qty_completed,
    weld_reel_qty, grind_reel_qty,
    grind_reel_qty AS qty_completed_should_be,
    comp_date, updated_at
FROM public.work_orders
WHERE part_number IN (
        'TC27261','TC27265','TC27291','TC27292','TC27311',
        'TC44120','TC44125','TC44127',
        'TC47446','TC51070','TC51077')
  AND COALESCE(grind_reel_qty, 0) > 0
  AND COALESCE(qty_completed, 0) = 0
ORDER BY updated_at DESC;


-- ── Q2: ARCHIVED reel WOs — the ones already closed out wrong ────────
-- work_orders rows are deleted on closeout (archiveWorkOrder), so this is
-- where the damage actually lives. This is the authoritative damage list.
SELECT
    wo_number, part_number, department,
    qty_required, qty_completed,
    weld_reel_qty, grind_reel_qty,
    grind_reel_qty AS qty_completed_should_be,
    comp_date, archived_at
FROM public.completed_work_orders
WHERE part_number IN (
        'TC27261','TC27265','TC27291','TC27292','TC27311',
        'TC44120','TC44125','TC44127',
        'TC47446','TC51070','TC51077')
  AND COALESCE(grind_reel_qty, 0) > 0
  AND COALESCE(qty_completed, 0) = 0
ORDER BY archived_at DESC;


-- ── Q3: Did the under-receive reach the closeout record? ─────────────
-- Joins the damaged archived WOs to wo_status_tracking. qty_received is what
-- Office actually received; it defaults to qty_completed (db-office.js:110).
-- Rows where qty_received is 0/NULL but grind_reel_qty > 0 = under-received.
SELECT
    t.id AS tracking_id,
    t.wo_number, t.part_number,
    t.qty_required, t.qty_received,
    c.grind_reel_qty AS qty_received_should_be,
    t.erp_status, t.closed_at, t.closed_by
FROM public.wo_status_tracking t
JOIN public.completed_work_orders c ON c.wo_number = t.wo_number
WHERE c.part_number IN (
        'TC27261','TC27265','TC27291','TC27292','TC27311',
        'TC44120','TC44125','TC44127',
        'TC47446','TC51070','TC51077')
  AND COALESCE(c.grind_reel_qty, 0) > 0
  AND COALESCE(t.qty_received, 0) = 0
ORDER BY t.closed_at DESC;


-- ── Q4: How much ledger credit was never emitted? ────────────────────
-- buildWoCloseoutTxns returns [] when qty <= 0, so these closeouts emitted
-- NOTHING — no bad rows to reverse, only missing rows. Confirms that by
-- looking for the deterministic key 'closeout|<tracking_id>|MO|I'.
-- Only matters for closeouts on/after the native cutover (2026-07-16).
SELECT
    t.id AS tracking_id,
    t.wo_number, t.part_number, t.closed_at,
    c.grind_reel_qty AS missing_mo_i_qty,
    (SELECT count(*) FROM public.issues_receipts r
      WHERE r.native_event_key = 'closeout|' || t.id || '|MO|I') AS mo_i_rows_found,
    (SELECT count(*) FROM public.issues_receipts r
      WHERE r.native_event_key LIKE 'closeout|' || t.id || '|MO|O|%') AS mo_o_rows_found
FROM public.wo_status_tracking t
JOIN public.completed_work_orders c ON c.wo_number = t.wo_number
WHERE c.part_number IN (
        'TC27261','TC27265','TC27291','TC27292','TC27311',
        'TC44120','TC44125','TC44127',
        'TC47446','TC51070','TC51077')
  AND COALESCE(c.grind_reel_qty, 0) > 0
  AND t.closed_at >= public.native_cutover()
ORDER BY t.closed_at DESC;


-- ── Q5: Net on-hand impact per reel part ─────────────────────────────
-- Sums the missing finished-goods credit per part, and shows the current
-- part_on_hand number for comparison. NOTE: this is the MO/I (finished part)
-- leg only. The matching MO/O component consumption is ALSO missing, so
-- component on-hand is overstated by the same closeouts — see Q4's
-- mo_o_rows_found. Do not treat this number as the whole correction.
SELECT
    c.part_number,
    count(*)                     AS bad_closeouts,
    sum(c.grind_reel_qty)        AS missing_on_hand_credit,
    p.on_hand                    AS current_on_hand,
    p.counted_at                 AS last_physical_count
FROM public.completed_work_orders c
JOIN public.wo_status_tracking t ON t.wo_number = c.wo_number
LEFT JOIN public.part_on_hand p
       ON p.part_number_normalized = upper(trim(c.part_number))
WHERE c.part_number IN (
        'TC27261','TC27265','TC27291','TC27292','TC27311',
        'TC44120','TC44125','TC44127',
        'TC47446','TC51070','TC51077')
  AND COALESCE(c.grind_reel_qty, 0) > 0
  AND COALESCE(t.qty_received, 0) = 0
  AND t.closed_at >= public.native_cutover()
GROUP BY c.part_number, p.on_hand, p.counted_at
ORDER BY missing_on_hand_credit DESC;
