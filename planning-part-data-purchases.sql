-- ============================================================
-- planning-part-data-purchases.sql — Surface purchases (Patch 9)
--
-- Part Data + WO Request modals showed made qty but never purchased qty, so a
-- purchased part looked like it had no stock history. Three RPC changes:
--   1. get_part_usage_summary_12mo  += qty_purchased_12mo (PO/I)
--   2. get_part_usage_summary_36mo  += qty_purchased_36mo (PO/I)
--   3. get_part_last_made_or_purchased — new: recent MO/I + PO/I with a kind tag
--
-- purchased is blended pre/post-cutover exactly like made (all in issues_receipts,
-- no source/cutover filter — cutover splits Alere vs native so no double-count).
-- Signature changes → DROP + CREATE + re-GRANT, wrapped per function.
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

-- ── 1. get_part_usage_summary_12mo: add purchased leg ──
BEGIN;
DROP FUNCTION IF EXISTS public.get_part_usage_summary_12mo(text);
CREATE FUNCTION public.get_part_usage_summary_12mo(p_part text)
    RETURNS TABLE(qty_sold_12mo numeric, qty_used_mfg_12mo numeric,
                  qty_made_12mo numeric, qty_purchased_12mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty FROM sales_analysis_lines
        WHERE item_normalized = p_part AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= CURRENT_DATE - INTERVAL '12 months'
          AND sale_date <= CURRENT_DATE AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty FROM issues_receipts
        WHERE part_number_normalized = p_part AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
          AND txn_date <= CURRENT_DATE AND txn_date >= public.native_cutover()
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part AND doctype = 'MO'
        AND txn_date >= CURRENT_DATE - INTERVAL '12 months' AND txn_date <= CURRENT_DATE
    ),
    purch AS (
      SELECT COALESCE(SUM(qty), 0) AS qty
      FROM issues_receipts
      WHERE part_number_normalized = p_part AND doctype = 'PO' AND trantype = 'I'
        AND txn_date >= CURRENT_DATE - INTERVAL '12 months' AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made, purch.qty FROM sold, mfg, purch;
  $$;
GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(text) TO anon;
GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(text) TO service_role;
COMMIT;

-- ── 2. get_part_usage_summary_36mo: add purchased leg ──
BEGIN;
DROP FUNCTION IF EXISTS public.get_part_usage_summary_36mo(text);
CREATE FUNCTION public.get_part_usage_summary_36mo(p_part text)
    RETURNS TABLE(qty_sold_36mo numeric, qty_used_mfg_36mo numeric,
                  qty_made_36mo numeric, qty_purchased_36mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty FROM sales_analysis_lines
        WHERE item_normalized = p_part AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= '2023-01-01'
          AND sale_date <= CURRENT_DATE AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty FROM issues_receipts
        WHERE part_number_normalized = p_part AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= public.native_cutover() AND txn_date <= CURRENT_DATE
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part AND doctype = 'MO'
        AND txn_date >= '2023-01-01' AND txn_date <= CURRENT_DATE
    ),
    purch AS (
      SELECT COALESCE(SUM(qty), 0) AS qty
      FROM issues_receipts
      WHERE part_number_normalized = p_part AND doctype = 'PO' AND trantype = 'I'
        AND txn_date >= '2023-01-01' AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made, purch.qty FROM sold, mfg, purch;
  $$;
GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(text) TO anon;
GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(text) TO service_role;
COMMIT;

-- ── 3. get_part_last_made_or_purchased — recent MO/I + PO/I, tagged ──
-- New function (leaves get_part_last_made intact for the WO modal's existing use).
CREATE OR REPLACE FUNCTION public.get_part_last_made_or_purchased(p_part text)
    RETURNS TABLE(txn_date text, qty numeric, kind text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT txn_date::text, qty,
           CASE WHEN doctype = 'PO' THEN 'purchased' ELSE 'made' END AS kind
    FROM issues_receipts
    WHERE part_number_normalized = p_part
      AND ((doctype = 'MO' AND trantype = 'I') OR (doctype = 'PO' AND trantype = 'I'))
    ORDER BY txn_date DESC
    LIMIT 5;
  $$;
GRANT ALL ON FUNCTION public.get_part_last_made_or_purchased(text) TO anon;
GRANT ALL ON FUNCTION public.get_part_last_made_or_purchased(text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_last_made_or_purchased(text) TO service_role;
