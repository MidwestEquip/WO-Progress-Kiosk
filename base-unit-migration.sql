-- ============================================================
-- Production Planning — Patch 1: Base Unit schema
-- base_units + base_unit_options + base_unit_option_parts
--
-- A Base Unit's COMMON PARTS are stored as normal all_boms rows under a
-- base-unit item_master part (record_source='native') so the BOM editor
-- and the multi-level explosion work on them unchanged. These tables
-- store only what all_boms cannot express: the kit's decision steps
-- (option groups), their choices, and per-choice part packages.
--
-- Safe migration: CREATE IF NOT EXISTS only. Rerunnable.
-- After applying: regenerate schema.sql
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

-- ── 1. base_units — one row per whole-good family ───────────────────
CREATE TABLE IF NOT EXISTS public.base_units (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    family_name text NOT NULL,                 -- '288', 'C27', '880'
    base_part_number text NOT NULL,            -- item_master part holding the common-parts BOM
    base_part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM base_part_number))) STORED,
    included_configs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- sibling config part #s used in the derivation (reproducibility)
    excluded_configs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- deliberately left out (e.g. 880-KK rare) — the decision, on record
    status text NOT NULL DEFAULT 'draft',      -- draft | active | archived
    notes text,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS base_units_family_uniq
    ON public.base_units (upper(TRIM(BOTH FROM family_name)));

-- ── 2. base_unit_options — one row per CHOICE within a decision step ─
-- The step ("Choose Engine") is the (option_group, sort_order, required)
-- triple repeated across its choice rows; choices with no parts rows are
-- valid (part-less manual options, e.g. "Honda Upgrade" sales line).
CREATE TABLE IF NOT EXISTS public.base_unit_options (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    base_unit_id uuid NOT NULL REFERENCES public.base_units(id) ON DELETE CASCADE,
    option_group text NOT NULL,                -- step name: 'Engine', 'Intake Hose Size'
    sort_order integer NOT NULL DEFAULT 0,     -- step order: Step 1, Step 2, ...
    required boolean NOT NULL DEFAULT false,   -- true = every planned unit picks exactly one choice
    choice_label text NOT NULL,                -- 'Champ FX750 — 22 HP', 'Honda GX160 Upgrade', 'None'
    is_default boolean NOT NULL DEFAULT false,
    source text NOT NULL DEFAULT 'derived',    -- derived (BOM diff) | manual (added in wizard)
    choice_configs jsonb NOT NULL DEFAULT '[]'::jsonb,  -- which sibling configs carried this choice (provenance)
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS base_unit_options_unit_idx
    ON public.base_unit_options (base_unit_id, sort_order);

-- ── 3. base_unit_option_parts — the part package behind one choice ───
-- Uniform for single-part choices (FX750 x1) and packages (speed reducer
-- = 4 parts). A part-less choice simply has no rows here.
CREATE TABLE IF NOT EXISTS public.base_unit_option_parts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    option_id uuid NOT NULL REFERENCES public.base_unit_options(id) ON DELETE CASCADE,
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    qty_per_unit numeric NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS base_unit_option_parts_option_idx
    ON public.base_unit_option_parts (option_id);
CREATE INDEX IF NOT EXISTS base_unit_option_parts_part_idx
    ON public.base_unit_option_parts (part_number_normalized);

-- ── 4. RLS + grants (same open-anon pattern as purchasing/part_changes;
--       Data API grant required since Oct 30 2026 policy change) ──────
ALTER TABLE public.base_units             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_unit_options      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.base_unit_option_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS base_units_all ON public.base_units;
CREATE POLICY base_units_all ON public.base_units
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS base_unit_options_all ON public.base_unit_options;
CREATE POLICY base_unit_options_all ON public.base_unit_options
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS base_unit_option_parts_all ON public.base_unit_option_parts;
CREATE POLICY base_unit_option_parts_all ON public.base_unit_option_parts
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_units             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_unit_options      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.base_unit_option_parts TO anon, authenticated;
