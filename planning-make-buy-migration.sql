-- ============================================================
-- planning-make-buy-migration.sql — Make/Buy from history (Phase B, Patch 5)
--
-- Two additive changes. Run the whole file in the Supabase SQL editor.
--   1. Extend get_parts_usage_summary_batch with a qty_purchased_12mo leg
--      (PO/I) so Planning can classify make vs buy from actual history.
--   2. Add the make/buy evidence columns to planning_run_lines.
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

-- ── 1. get_parts_usage_summary_batch: add the purchased leg ──
-- The return signature changes (new column), so the function must be dropped
-- and recreated. Wrapped in a transaction so there is no window where the
-- function is missing. qty_purchased_12mo is APPENDED (existing columns keep
-- their order); supabase-js reads columns by name, so callers are unaffected.
--
-- made and purchased are apples-to-apples: both read issues_receipts over the
-- same rolling 12 months with no source/cutover filter, so a native
-- (post-cutover) row and an Alere (pre-cutover) row are summed identically and
-- never double-count the same physical event (cutover splits the two sources).
-- Also adds the SET search_path this SECURITY DEFINER function was missing.

BEGIN;

DROP FUNCTION IF EXISTS public.get_parts_usage_summary_batch(text[]);

CREATE FUNCTION public.get_parts_usage_summary_batch(p_parts text[])
    RETURNS TABLE(part_normalized text, qty_made_12mo numeric,
                  qty_used_mfg_12mo numeric, qty_sold_12mo numeric,
                  qty_purchased_12mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT
      part_number_normalized,
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='I' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='O' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='SO' AND trantype='O' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='PO' AND trantype='I' THEN qty ELSE 0 END), 0)
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND txn_date >= NOW() - INTERVAL '12 months'
    GROUP BY part_number_normalized;
  $$;

GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO anon;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(text[]) TO service_role;

COMMIT;

-- NOTE (unchanged, flagged not fixed here): qty_sold_12mo reads only
-- issues_receipts, so pre-cutover SO/O sales (which live in
-- sales_analysis_lines) are absent from THIS RPC. That is a pre-existing
-- inconsistency used by planning-queues.js; correcting it would move those
-- numbers and belongs in its own patch. The make/buy classifier does not use
-- the sold leg — only made vs purchased.

-- ── 2. planning_run_lines: make/buy evidence columns ──
-- Snapshots captured at calc time (like on_hand_snap): the history the
-- classifier saw and why it chose the action. All nullable — old runs read
-- NULL and the grid renders them blank.
ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS qty_made_12mo      numeric,
    ADD COLUMN IF NOT EXISTS qty_purchased_12mo numeric,
    ADD COLUMN IF NOT EXISTS action_source      text;

COMMENT ON COLUMN public.planning_run_lines.action_source IS
    'Why action was chosen: ''override'' | ''history'' | ''attr'' | ''review'' | NULL (pre-Phase-B runs). Display-only evidence.';

-- planning_run_lines already has table-level grants to anon, authenticated,
-- service_role (planning-runs-migration.sql); new columns are covered.
