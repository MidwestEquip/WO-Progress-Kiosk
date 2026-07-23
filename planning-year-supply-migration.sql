-- ============================================================
-- planning-year-supply-migration.sql — Year-Supply planning basis
-- (July 2026, Production Planning)
--
-- A planning run currently sizes every subpart from the kit explosion:
-- plan 100 mowers, build 100 frames' worth of children. That ignores parts
-- SOLD as service parts — sell 40 frames over the year and the kit can no
-- longer be built. The Year-Supply basis re-sizes each subpart from its OWN
-- rolling-12-month demand instead: what it sold, plus what its parents sold
-- (multiplied through the BOM).
--
-- This file adds ONE new function and TWO sets of nullable columns.
-- No table is dropped, no existing function is touched. Fully rerunnable.
--
-- After applying:  powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================


-- ------------------------------------------------------------
-- 1. get_parts_parent_demand — batch parent-usage demand rollup
-- ------------------------------------------------------------
-- The SQL twin of calculateRecursiveParentUsageDemand() in
-- libs/db-part-defaults.js, for MANY parts in one round trip. That JS
-- version does one query per BOM level per part — fine for a single WO
-- Request, hopeless for a 300-part planning run.
--
-- Walks all_boms UPWARD from each seed part. Each step carries:
--   mult  = accumulated product of qty_per_assy from the seed up to here
--   path  = ancestors visited on THIS branch (cycle guard)
--   depth = levels climbed, capped at 10 to match MAX_BOM_DEPTH in
--           libs/db-part-defaults.js
--
-- The same ancestor reached by several BOM paths contributes once PER PATH.
-- That is deliberate and matches the JS: each path is a distinct physical
-- usage chain (a part used in two places in the same assembly is needed
-- twice). Do not "fix" this into a DISTINCT.
--
-- Ancestor sales use the same blended definition as get_sales_analysis_sold:
-- Alere SO/O rows before the native cutover, native SO/O rows after it, so
-- Planning and WO Request can never report different numbers for a part.
--
-- Returns ROWS, not verdicts — the % adjustment, netting and batch rules all
-- live in libs/utils-planning-year.js per the CLAUDE.md "never store logic
-- in the database" rule. This function only walks, joins and sums.
--
-- Output: one row per input part ALWAYS (0 when it has no parents or its
-- parents never sold), so the client never has to guess at a missing key.
CREATE OR REPLACE FUNCTION public.get_parts_parent_demand(
    p_parts text[],
    p_start date,
    p_end   date
) RETURNS TABLE(part_normalized text, parent_demand numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    WITH RECURSIVE seeds AS (
      SELECT DISTINCT upper(btrim(p)) AS seed
      FROM unnest(coalesce(p_parts, '{}'::text[])) AS p
      WHERE btrim(coalesce(p, '')) <> ''
    ),
    walk AS (
      SELECT s.seed,
             s.seed              AS node,
             1::numeric          AS mult,
             ARRAY[s.seed]       AS path,
             0                   AS depth
      FROM seeds s
      UNION ALL
      -- A missing, zero or negative qty_per_assy is treated as 1, matching
      -- the JS `Number(row.qty_per_assy) || 1` fallback.
      SELECT w.seed,
             b.item_parent_normalized,
             w.mult * CASE WHEN coalesce(b.qty_per_assy, 0) > 0
                           THEN b.qty_per_assy ELSE 1 END,
             w.path || b.item_parent_normalized,
             w.depth + 1
      FROM walk w
      JOIN all_boms b ON b.item_child_normalized = w.node
      WHERE w.depth < 10
        AND b.item_parent_normalized IS NOT NULL
        AND b.item_parent_normalized <> w.node
        AND NOT (b.item_parent_normalized = ANY(w.path))
    ),
    ancestors AS (
      SELECT DISTINCT node FROM walk WHERE depth > 0
    ),
    sold AS (
      SELECT item_normalized, COALESCE(SUM(qty), 0) AS qty_sold
      FROM (
        SELECT item_normalized, qty
        FROM sales_analysis_lines
        WHERE item_normalized IN (SELECT node FROM ancestors)
          AND doctype  = 'SO'
          AND trantype = 'O'
          AND sale_date BETWEEN p_start AND p_end
          AND sale_date < public.native_cutover()
        UNION ALL
        SELECT part_number_normalized AS item_normalized, qty
        FROM issues_receipts
        WHERE part_number_normalized IN (SELECT node FROM ancestors)
          AND source   = 'native'
          AND doctype  = 'SO'
          AND trantype = 'O'
          AND txn_date BETWEEN p_start AND p_end
          AND txn_date >= public.native_cutover()
      ) s
      GROUP BY item_normalized
    )
    SELECT s.seed AS part_normalized,
           COALESCE(SUM(w.mult * sl.qty_sold), 0) AS parent_demand
    FROM seeds s
    LEFT JOIN walk w  ON w.seed = s.seed AND w.depth > 0
    LEFT JOIN sold sl ON sl.item_normalized = w.node
    GROUP BY s.seed;
  $$;

GRANT ALL ON FUNCTION public.get_parts_parent_demand(p_parts text[], p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.get_parts_parent_demand(p_parts text[], p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_parent_demand(p_parts text[], p_start date, p_end date) TO service_role;


-- ------------------------------------------------------------
-- 2. planning_runs — how this run was sized
-- ------------------------------------------------------------
-- plan_basis     'kit' (explosion, the existing behaviour) | 'year_supply'.
--                Existing rows default to 'kit', which is what they were.
--                No CHECK constraint: the vocabulary lives in config.js
--                (PLAN_BASIS_*) so it stays readable and editable in one place.
-- pct_adjust     the Adjust % applied to BOTH the plan qty and every
--                subpart's demand. Signed whole percent (+10 = 110%).
-- base_sold_12mo the base unit's rolling-12-month sold qty that Qty to Plan
--                was auto-filled from. Snapshotted so a reopened run still
--                explains where its number came from.
ALTER TABLE public.planning_runs
    ADD COLUMN IF NOT EXISTS plan_basis     text    NOT NULL DEFAULT 'kit',
    ADD COLUMN IF NOT EXISTS pct_adjust     numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS base_sold_12mo numeric;


-- ------------------------------------------------------------
-- 3. planning_run_lines — where each line's number came from
-- ------------------------------------------------------------
-- demand_12mo  the part's own year demand (own sold + parent usage) BEFORE
--              the % and before netting. NULL on kit-basis runs and on every
--              run created before this migration — render as em dash, never 0.
-- kit_gross    what the kit explosion would have called for, preserved when
--              year-supply overwrites `gross`. This is the column the future
--              "what did we do last time" view will compare against.
ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS demand_12mo numeric,
    ADD COLUMN IF NOT EXISTS kit_gross   numeric;
