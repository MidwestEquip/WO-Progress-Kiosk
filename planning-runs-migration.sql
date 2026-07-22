-- ============================================================
-- Production Planning — Phase 3 Patch 1: planning runs
-- planning_runs (header) + planning_run_lines (one row per part)
--
-- The run is the audit trail and the bridge into the existing
-- wo_requests / purchasing pipelines. Line snapshots record what
-- the numbers were AT CALCULATION TIME; approval re-nets against
-- live numbers before anything is created (design decision).
-- Lines flow: proposed → approved (planned_release_date set)
--           → released (created_ref_* points at the WO/PO row)
--           / skipped.
--
-- Safe migration: CREATE IF NOT EXISTS only. Rerunnable.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planning_runs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    base_unit_id uuid REFERENCES public.base_units(id) ON DELETE SET NULL,
    family_name text NOT NULL,           -- denormalized: survives base-unit deletion
    plan_qty numeric NOT NULL,
    mode text NOT NULL DEFAULT 'full_kit',        -- 'full_kit' | 'base_only'
    option_splits jsonb NOT NULL DEFAULT '[]'::jsonb,  -- snapshot of the per-step qty splits
    required_date date,
    status text NOT NULL DEFAULT 'open',          -- 'open' | 'closed' | 'cancelled'
    notes text,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planning_runs_status_idx
    ON public.planning_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.planning_run_lines (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES public.planning_runs(id) ON DELETE CASCADE,
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    level integer NOT NULL DEFAULT 0,
    -- calc-time snapshot (display + audit; approval re-nets live)
    gross numeric NOT NULL DEFAULT 0,
    on_hand_snap numeric NOT NULL DEFAULT 0,
    open_wo_snap numeric NOT NULL DEFAULT 0,
    open_po_snap numeric NOT NULL DEFAULT 0,
    min_stock_snap numeric NOT NULL DEFAULT 0,
    net numeric NOT NULL DEFAULT 0,
    recommended numeric NOT NULL DEFAULT 0,
    action text NOT NULL DEFAULT 'review',        -- 'make' | 'buy' | 'review'
    flag text,                                    -- 'qty_outlier' | NULL
    -- manager decisions
    override_qty numeric,                         -- NULL = use recommended
    hold boolean NOT NULL DEFAULT false,
    line_status text NOT NULL DEFAULT 'proposed', -- 'proposed'|'approved'|'released'|'skipped'
    planned_release_date date,
    required_date date,
    -- what got created at release
    created_ref_type text,                        -- 'wo_request' | 'purchasing_order'
    created_ref_id uuid,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planning_run_lines_run_idx
    ON public.planning_run_lines (run_id, level, part_number_normalized);

-- The release panel's query: approved lines due for release, oldest date first.
CREATE INDEX IF NOT EXISTS planning_run_lines_release_idx
    ON public.planning_run_lines (line_status, planned_release_date);

ALTER TABLE public.planning_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_run_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planning_runs_all ON public.planning_runs;
CREATE POLICY planning_runs_all ON public.planning_runs
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS planning_run_lines_all ON public.planning_run_lines;
CREATE POLICY planning_run_lines_all ON public.planning_run_lines
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planning_runs      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planning_run_lines TO anon, authenticated;
