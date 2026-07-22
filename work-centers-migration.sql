-- ============================================================
-- Production Planning — Phase 4 Patch 1: workload master data
-- work_centers + part_routings
--
-- Routing hours are ESTIMATES for capacity planning, seeded from
-- wo_time_sessions actuals via the "Suggest from time data" button
-- (source='time_sessions') or hand-entered (source='manual').
-- They are never used for payroll or costing.
--
-- Safe migration: CREATE IF NOT EXISTS only. Rerunnable.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.work_centers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,                       -- 'Laser', 'Brake', 'Weld Robot'
    dept text,                                -- 'Fab', 'Weld', 'TC Assy', 'TV Assy'
    available_hours_week numeric NOT NULL DEFAULT 40,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_centers_name_uniq
    ON public.work_centers (upper(TRIM(BOTH FROM name)));

CREATE TABLE IF NOT EXISTS public.part_routings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    work_center_id uuid NOT NULL REFERENCES public.work_centers(id) ON DELETE CASCADE,
    seq integer NOT NULL DEFAULT 1,           -- operation order within the part
    setup_hours numeric NOT NULL DEFAULT 0,
    run_hours_per_part numeric NOT NULL DEFAULT 0,
    source text NOT NULL DEFAULT 'manual',    -- 'manual' | 'time_sessions'
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS part_routings_part_idx
    ON public.part_routings (part_number_normalized, seq);
CREATE INDEX IF NOT EXISTS part_routings_wc_idx
    ON public.part_routings (work_center_id);

ALTER TABLE public.work_centers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_routings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_centers_all ON public.work_centers;
CREATE POLICY work_centers_all ON public.work_centers
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS part_routings_all ON public.part_routings;
CREATE POLICY part_routings_all ON public.part_routings
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_centers  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_routings TO anon, authenticated;
