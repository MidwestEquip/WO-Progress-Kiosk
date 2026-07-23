-- ============================================================
-- part-on-hand-seed-estimate.sql — Seed the frozen pre-cutover estimate
-- (On-hand baseline series, Patch 2)
--
-- NOT deployed app code. Run manually in the Supabase SQL editor
-- (service role). RERUNNABLE — it SETs baseline_estimate (never adds),
-- and never touches a hard-counted part.
--
-- Requires part-on-hand-baseline-migration.sql (the baseline_estimate
-- column) applied first.
--
-- What it computes (per part, the physical-identity estimate):
--     baseline_estimate =  Σ(MO/I made)  +  Σ(PO/I purchased)
--                        − Σ(MO/O consumed as a component)
--                        − Σ(SO/O sold and gone)
--   over ALL history BEFORE cutover (txn_date < native_cutover()).
--   qty is stored positive in issues_receipts; the sign comes from
--   doctype/trantype.
--
--   TWO SOURCE TABLES (matches get_part_usage_summary_12mo):
--     * make / purchase / consume  → issues_receipts (MO/I, PO/I, MO/O)
--     * sold-and-gone              → sales_analysis_lines (SO/O)
--   Pre-cutover sales do NOT live in issues_receipts — they live in
--   sales_analysis_lines, keyed on item_normalized / sale_date. The
--   issues_receipts SO/O leg is deliberately NOT summed (it would be a
--   partial, non-canonical double of the sales table).
--
--   NOTE on the sales-outflow leg — this DELIBERATELY differs from the
--   live trigger. Post-cutover the trigger treats SO/O as booked (no
--   stock effect) and SO/S as the physical ship. But the Alere import
--   carries NO SO/S rows (verified: pre-cutover Σ SO/S = 0); the only
--   historical sales signal is SO/O, and those orders shipped. So the
--   FROZEN pre-cutover baseline subtracts SO/O as the sold-and-gone leg.
--   This also matches the app's on-screen "Est. Qty in Stock" (made −
--   sold − parent), so the seed and the modals agree.
--
--   STRADDLE CAVEAT: an order booked in Alere before cutover but shipped
--   after it (still on the Open Orders board) has its SO/O subtracted
--   here AND its native SO/S subtracted post-cutover — a small
--   double-subtract for parts with orders straddling cutover. Bounded by
--   the board's pre-cutover-booked qty; a hard count corrects it.
--
--   The raw value is stored (it may be negative). Reads floor it at 0:
--       effective on-hand (uncounted) = max(0, baseline_estimate) + on_hand
--   so a part drawn net-negative over the imported window simply seeds 0.
--
-- Why "< cutover" needs no source filter: every native row is dated
--   >= cutover by construction, so txn_date < native_cutover() already
--   excludes them — this sums Alere history only, frozen forever.
--
-- Why it's frozen: pre-cutover rows never change, so rerunning yields the
--   same number. on_hand (the post-cutover delta accumulator) is left
--   untouched, so no double-count.
--
-- ── DATA CAVEATS (read before trusting the numbers) ──
--   * Assumes tracked history begins near a zero-stock point. Alere import
--     goes back to ~2023-01-01 (see get_part_purchased_36mo). A part that
--     already had stock before the earliest imported row will seed low.
--   * The sold-and-gone leg uses SO/O (see NOTE above); STEP 1 reports both
--     SO/O and SO/S totals so the sales signal is visible.
--   Hard counts (Inventory Adjustment) are the correction path for both.
-- ============================================================

-- ── The frozen-estimate CTE, used by STEP 1 (preview) and STEP 2 (write).
-- Signed flows from BOTH source tables, unioned then summed per part.
-- (Repeated inline in each step so each block runs standalone.)

-- ── STEP 1: preview — what will be written, and a sanity read on each leg.
WITH flows AS (
    -- make / purchase / consume from the ledger
    SELECT ir.part_number_normalized AS part,
           CASE WHEN ir.doctype IN ('MO','PO') AND ir.trantype = 'I' THEN  ir.qty
                WHEN ir.doctype = 'MO'         AND ir.trantype = 'O' THEN -ir.qty
                ELSE 0 END                                          AS signed_qty,
           CASE WHEN ir.doctype IN ('MO','PO') AND ir.trantype = 'I' THEN  ir.qty ELSE 0 END AS in_qty,
           CASE WHEN ir.doctype = 'MO'         AND ir.trantype = 'O' THEN  ir.qty ELSE 0 END AS consumed_qty,
           0::numeric                                               AS sold_qty
    FROM issues_receipts ir
    WHERE ir.txn_date < public.native_cutover()
    UNION ALL
    -- sold-and-gone from the sales table
    SELECT sal.item_normalized AS part,
           -sal.qty            AS signed_qty,
           0::numeric          AS in_qty,
           0::numeric          AS consumed_qty,
           sal.qty             AS sold_qty
    FROM sales_analysis_lines sal
    WHERE sal.doctype = 'SO' AND sal.trantype = 'O'
      AND sal.sale_date < public.native_cutover()
),
est AS (
    SELECT part,
           SUM(in_qty)       AS in_qty,
           SUM(consumed_qty) AS consumed_qty,
           SUM(sold_qty)     AS sold_qty,
           SUM(signed_qty)   AS baseline_estimate
    FROM flows
    WHERE part IS NOT NULL AND btrim(part) <> ''
    GROUP BY part
)
SELECT
    (SELECT count(*) FROM est)                                        AS parts_with_history,
    (SELECT count(*) FROM est WHERE baseline_estimate > 0)           AS parts_positive_estimate,
    (SELECT count(*) FROM est WHERE baseline_estimate <= 0)          AS parts_zero_or_negative,
    (SELECT COALESCE(SUM(in_qty), 0)       FROM est)                 AS total_made_plus_purchased,
    (SELECT COALESCE(SUM(consumed_qty), 0) FROM est)                 AS total_consumed,
    (SELECT COALESCE(SUM(sold_qty), 0)     FROM est)                 AS total_sold_so_o,
    (SELECT count(*) FROM part_on_hand WHERE counted_at IS NOT NULL) AS counted_parts_skipped;

-- Inspect a sample before writing (optional): re-run STEP 1's CTE and
-- SELECT * FROM est ORDER BY baseline_estimate DESC LIMIT 50;

-- ── STEP 2: write — upsert baseline_estimate, skipping hard-counted parts.
WITH flows AS (
    SELECT ir.part_number_normalized AS part,
           CASE WHEN ir.doctype IN ('MO','PO') AND ir.trantype = 'I' THEN  ir.qty
                WHEN ir.doctype = 'MO'         AND ir.trantype = 'O' THEN -ir.qty
                ELSE 0 END AS signed_qty
    FROM issues_receipts ir
    WHERE ir.txn_date < public.native_cutover()
    UNION ALL
    SELECT sal.item_normalized AS part, -sal.qty AS signed_qty
    FROM sales_analysis_lines sal
    WHERE sal.doctype = 'SO' AND sal.trantype = 'O'
      AND sal.sale_date < public.native_cutover()
),
est AS (
    SELECT part, SUM(signed_qty) AS baseline_estimate
    FROM flows
    WHERE part IS NOT NULL AND btrim(part) <> ''
    GROUP BY part
)
INSERT INTO part_on_hand (part_number_normalized, baseline_estimate, updated_at)
SELECT part, baseline_estimate, now()
FROM est
WHERE part IS NOT NULL AND btrim(part) <> ''
ON CONFLICT (part_number_normalized) DO UPDATE
    SET baseline_estimate = EXCLUDED.baseline_estimate,
        updated_at        = now()
    WHERE part_on_hand.counted_at IS NULL;   -- never re-baseline a counted part

-- ── STEP 3: verify — rows now carrying an estimate baseline.
SELECT count(*)                                   AS rows_with_estimate,
       count(*) FILTER (WHERE counted_at IS NULL) AS uncounted_with_estimate,
       count(*) FILTER (WHERE counted_at IS NOT NULL) AS counted_rows_present
FROM part_on_hand
WHERE baseline_estimate IS NOT NULL;
