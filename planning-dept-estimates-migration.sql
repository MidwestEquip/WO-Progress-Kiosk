-- ============================================================
-- planning-dept-estimates-migration.sql — per-part, per-dept shop-day
-- estimates (Planning Phase 3: schedule Gantt)
--
-- A part with real part_routings gets its bar length from measured hours
-- (setup + run × qty). Everything else is drawn from a dept-level estimate:
-- Fab 1 day, Weld 3, Paint 10, Assy 5 by default. This table holds the
-- per-part overrides of those defaults — one row per part per dept, each op
-- estimated on its own.
--
-- The DEFAULTS are NOT stored here: they live in libs/utils-planning-schedule.js
-- (GANTT_DEPT_DEFAULT_DAYS) with the rest of the scheduling rules. This table
-- stores only what the user has deliberately overridden — no rule, just data
-- (CLAUDE.md: never store logic in the database).
--
-- Safe/additive: CREATE TABLE IF NOT EXISTS. Rerunnable. No existing table
-- is touched.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.part_dept_estimates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    part_number text NOT NULL,
    -- Generated, like part_routings — every lookup is on the normalized value.
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    -- 'Fab' | 'Weld' | 'Paint' | 'Assy'. Kept as free text (not an enum) so a
    -- new dept never needs a migration; the UI offers the four.
    dept text NOT NULL,
    -- Working days this part spends in that dept. 0 is allowed (skip the step).
    est_days numeric NOT NULL DEFAULT 1,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- One estimate per part per dept — the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS part_dept_estimates_part_dept_uniq
    ON public.part_dept_estimates (part_number_normalized, dept);

-- The Gantt reads these in one batch keyed on the normalized part.
CREATE INDEX IF NOT EXISTS part_dept_estimates_part_idx
    ON public.part_dept_estimates (part_number_normalized);

ALTER TABLE public.part_dept_estimates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS part_dept_estimates_all ON public.part_dept_estimates;
CREATE POLICY part_dept_estimates_all ON public.part_dept_estimates
    USING (true) WITH CHECK (true);

-- Required since Oct 30 2026: new public tables are not auto-exposed to the
-- Data API. Without this, supabase-js reads return empty with no error.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_dept_estimates TO anon, authenticated;
