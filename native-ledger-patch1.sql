-- ============================================================
-- native-ledger-patch1.sql — Native Inventory Ledger, Patch 1 (Schema A)
--
-- Ledger write enablement + sold-leg cutover blend.
-- Run the whole file in the Supabase SQL editor as one script.
--
-- CUTOVER DATE: defined ONCE in native_cutover() below (step 1).
-- Set it to the day AFTER the last transaction date in your final
-- Alere imports (issues_receipts AND sales_analysis_lines), so no
-- day is counted by both sources and no day is missed.
--
-- What this patch does:
--   1. native_cutover() — single source of truth for the cutover date
--   2. issues_receipts.native_event_key + full unique index (idempotency)
--   3. REVOKE ALL / GRANT INSERT — append-only ledger at the grant level
--   4. Constrained INSERT-only RLS policy (the only client write path)
--   5. Replaces 3 RPCs whose sold leg reads sales_analysis_lines,
--      blending Alere (< cutover) with native SO/O rows (>= cutover).
--      All other RPCs are deliberately untouched — native rows land in
--      issues_receipts and blend into them automatically.
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================


-- ── 1. Cutover date (EDIT THE DATE LITERAL BEFORE RUNNING) ──────────
-- Referenced by the INSERT policy and the 3 blended RPCs.
-- To change the cutover later, CREATE OR REPLACE this one function.

CREATE OR REPLACE FUNCTION public.native_cutover() RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT DATE '2026-07-16' $$;


-- ── 2. Idempotency key ───────────────────────────────────────────────
-- Deterministic per physical event (e.g. 'closeout|<tracking_id>|MO|I').
-- FULL unique index (not partial): ON CONFLICT (native_event_key) must be
-- able to infer it. Alere rows leave it NULL; NULLs never conflict.

ALTER TABLE public.issues_receipts
    ADD COLUMN IF NOT EXISTS native_event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_issrec_native_event_key
    ON public.issues_receipts (native_event_key);


-- ── 3. Grants: append-only for clients ──────────────────────────────
-- Today anon/authenticated hold GRANT ALL (blocked only by policy-less
-- RLS). Make append-only intentional. service_role keeps full access
-- (Table Editor imports, backfill scripts, gen-schema).

REVOKE ALL ON TABLE public.issues_receipts FROM anon, authenticated;
GRANT INSERT ON TABLE public.issues_receipts TO anon, authenticated;


-- ── 4. INSERT-only policy — the single client write path ────────────
-- No SELECT/UPDATE/DELETE policies: reads stay RPC-only (SECURITY
-- DEFINER), keeping cost history off the anon key.
-- IC (inventory count) is deliberately NOT in the doctype list —
-- count rows enter only via service role (Patch 6).
-- Negative qty is allowed because reversal rows are negative by design.

DROP POLICY IF EXISTS issues_receipts_native_insert ON public.issues_receipts;
CREATE POLICY issues_receipts_native_insert ON public.issues_receipts
    FOR INSERT TO anon, authenticated
    WITH CHECK (
        source = 'native'
        AND txn_date >= public.native_cutover()
        AND txn_date <= CURRENT_DATE + 1
        AND doctype  IN ('MO', 'SO', 'PO')
        AND trantype IN ('I', 'O', 'S')
        AND qty IS NOT NULL
        AND qty <> 0
        AND abs(qty) < 100000
        AND length(btrim(part_number)) BETWEEN 1 AND 100
        AND length(coalesce(docid, '')) <= 50
        AND source_file_name IS NULL
        AND source_row_number IS NULL
    );


-- ── 5a. get_part_usage_summary_12mo — sold leg blended ──────────────
-- Body copied verbatim from the live definition; ONLY the sold CTE
-- changes (sales_analysis_lines < cutover UNION ALL native SO/O >=
-- cutover). The mfg leg reads issues_receipts and blends automatically.

CREATE OR REPLACE FUNCTION public.get_part_usage_summary_12mo(p_part text) RETURNS TABLE(qty_sold_12mo numeric, qty_used_mfg_12mo numeric, qty_made_12mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty
        FROM sales_analysis_lines
        WHERE item_normalized = p_part
          AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= CURRENT_DATE - INTERVAL '12 months'
          AND sale_date <= CURRENT_DATE
          AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty
        FROM issues_receipts
        WHERE part_number_normalized = p_part
          AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
          AND txn_date <= CURRENT_DATE
          AND txn_date >= public.native_cutover()
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part
        AND doctype = 'MO'
        AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
        AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made FROM sold, mfg;
  $$;


-- ── 5b. get_part_usage_summary_36mo — sold leg blended ──────────────

CREATE OR REPLACE FUNCTION public.get_part_usage_summary_36mo(p_part text) RETURNS TABLE(qty_sold_36mo numeric, qty_used_mfg_36mo numeric, qty_made_36mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty
        FROM sales_analysis_lines
        WHERE item_normalized = p_part
          AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= '2023-01-01'
          AND sale_date <= CURRENT_DATE
          AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty
        FROM issues_receipts
        WHERE part_number_normalized = p_part
          AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= public.native_cutover()
          AND txn_date <= CURRENT_DATE
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part
        AND doctype = 'MO'
        AND txn_date >= '2023-01-01'
        AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made FROM sold, mfg;
  $$;


-- ── 5c. get_sales_analysis_sold — blended per-part sold ─────────────
-- Feeds the recursive parent-demand rollup (calculateRecursiveParentUsageDemand).

CREATE OR REPLACE FUNCTION public.get_sales_analysis_sold(p_parts text[], p_start date, p_end date) RETURNS TABLE(item_normalized text, qty_sold numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public
    AS $$
    SELECT
      item_normalized,
      COALESCE(SUM(qty), 0) AS qty_sold
    FROM (
      SELECT item_normalized, qty
      FROM sales_analysis_lines
      WHERE item_normalized = ANY(p_parts)
        AND doctype  = 'SO'
        AND trantype = 'O'
        AND sale_date BETWEEN p_start AND p_end
        AND sale_date < public.native_cutover()
      UNION ALL
      SELECT part_number_normalized AS item_normalized, qty
      FROM issues_receipts
      WHERE part_number_normalized = ANY(p_parts)
        AND source   = 'native'
        AND doctype  = 'SO'
        AND trantype = 'O'
        AND txn_date BETWEEN p_start AND p_end
        AND txn_date >= public.native_cutover()
    ) s
    GROUP BY item_normalized;
  $$;


-- ── 6. Verification (run manually, compare before/after) ────────────
-- With zero native rows in the table, every result below must be
-- IDENTICAL to what the same call returned before this migration.
-- Pick 3-5 real part numbers you know have history.
--
-- SELECT * FROM get_part_usage_summary_12mo('YOUR-PART-1');
-- SELECT * FROM get_part_usage_summary_36mo('YOUR-PART-1');
-- SELECT * FROM get_sales_analysis_sold(ARRAY['YOUR-PART-1','YOUR-PART-2'], '2023-01-01', CURRENT_DATE);
--
-- Policy checks (run as anon via the app or API, not the SQL editor):
--   * An insert with source='native', doctype='SO', trantype='O',
--     txn_date=CURRENT_DATE, qty=1, valid part_number → SUCCEEDS.
--   * Same insert with source='ALERE' → REJECTED (policy).
--   * Same insert with txn_date < cutover → REJECTED (policy).
--   * Same insert with doctype='IC' → REJECTED (policy).
--   * UPDATE or DELETE on issues_receipts → REJECTED (no grant).
-- Clean up any test rows via the SQL editor (service role) afterwards.
