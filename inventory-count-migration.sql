-- ============================================================
-- inventory-count-migration.sql
-- Inventory Count sheet — parts exported from a Production Planning
-- run (or added by hand) that need a physical count.
--
-- One row = one part awaiting / holding a count. Description and bin
-- are DERIVED live from item_master at load time, never stored here
-- (CLAUDE.md: derive-don't-store).
--
-- Run once in the Supabase SQL editor, then regenerate schema.sql:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
    id                     BIGSERIAL PRIMARY KEY,
    part_number            TEXT NOT NULL,
    part_number_normalized TEXT GENERATED ALWAYS AS (UPPER(TRIM(part_number))) STORED,

    -- where this line came from
    source                 TEXT,            -- 'planning_run' | 'manual'
    source_run_id          UUID,            -- planning_runs.id (no FK: closing a run must never delete counts)

    -- the count itself (null until someone counts it)
    qty_counted            NUMERIC,
    counted_by             TEXT,
    counted_at             TIMESTAMPTZ,

    -- the manager's inventory adjustment, if they made one
    adjusted               BOOLEAN NOT NULL DEFAULT false,
    adjusted_qty           NUMERIC,
    adjusted_by            TEXT,
    adjusted_at            TIMESTAMPTZ,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             TEXT
);

-- Open sheet first (adjusted=false), adjusted history paged by recency.
CREATE INDEX IF NOT EXISTS idx_icl_open
    ON public.inventory_count_lines (adjusted, created_at DESC);

-- Dedup check on export ("is this part already open on the sheet?").
CREATE INDEX IF NOT EXISTS idx_icl_part
    ON public.inventory_count_lines (part_number_normalized);

ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;

-- Open anon policy, matching the app's other operational tables
-- (the kiosk runs on the anon key; access control is by splash role).
DROP POLICY IF EXISTS inventory_count_lines_all ON public.inventory_count_lines;
CREATE POLICY inventory_count_lines_all ON public.inventory_count_lines
    FOR ALL TO anon, authenticated
    USING (true) WITH CHECK (true);

-- Required since Oct 30 2026: new public tables are not auto-exposed to the Data API.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_lines TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.inventory_count_lines_id_seq TO anon, authenticated;
