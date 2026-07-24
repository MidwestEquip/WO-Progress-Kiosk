-- ============================================================
-- planning-make-buy-3yr-migration.sql — Make/Buy auto-classify off 3 years
--
-- One additive change: extend get_parts_usage_summary_batch with a 36-month
-- made/purchased pair so the planning Action column can auto-pick make vs buy
-- from 3 years of history instead of 12 months.
--
-- The four existing 12-month legs are UNCHANGED — each keeps its own inner
-- 12-month date guard, so coverage/run-out math (planning-queues) and the
-- part-data panel legs read exactly the same numbers as before. The outer scan
-- widens to 36 months (a superset) to feed the two new legs. New columns are
-- APPENDED, so supabase-js (reads by name) leaves all existing callers alone.
--
-- Run the whole file in the Supabase SQL editor, then regenerate the snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_parts_usage_summary_batch(text[]);

CREATE FUNCTION public.get_parts_usage_summary_batch(p_parts text[])
    RETURNS TABLE(part_normalized text, qty_made_12mo numeric,
                  qty_used_mfg_12mo numeric, qty_sold_12mo numeric,
                  qty_purchased_12mo numeric,
                  qty_made_36mo numeric, qty_purchased_36mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT
      part_number_normalized,
      -- Existing 12-month legs (unchanged): inner-guarded to 12 months so the
      -- wider 36-month scan below does not alter their values.
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='I' AND txn_date >= NOW() - INTERVAL '12 months' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='O' AND txn_date >= NOW() - INTERVAL '12 months' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='SO' AND trantype='O' AND txn_date >= NOW() - INTERVAL '12 months' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='PO' AND trantype='I' AND txn_date >= NOW() - INTERVAL '12 months' THEN qty ELSE 0 END), 0),
      -- New 36-month legs: made (MO/I) vs purchased (PO/I) over the full scan
      -- window. These feed the make/buy classifier only.
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='I' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='PO' AND trantype='I' THEN qty ELSE 0 END), 0)
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND txn_date >= NOW() - INTERVAL '36 months'
    GROUP BY part_number_normalized;
  $$;

GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO anon;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO service_role;

COMMIT;
