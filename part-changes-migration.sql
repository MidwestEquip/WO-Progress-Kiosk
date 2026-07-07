-- ============================================================
-- part_changes — engineering part change records
-- One row per change event: replacement, revision, 2D→3D
-- conversion, finalization, or BOM change.
-- Replacement rows link the previous part number so historical
-- usage calculations can combine the chain (resolved in code —
-- libs/db-part-changes.js — never in SQL).
-- The checklist column stores only per-item STATE
-- ({item_key: {state, by, at}}); item definitions live in
-- libs/config.js (PART_CHANGE_CHECKLIST_ITEMS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.part_changes (
    id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_type                       TEXT NOT NULL,          -- 'replacement'|'revision'|'2d_to_3d'|'finalized'|'bom_change'
    part_number                       TEXT NOT NULL,
    part_number_normalized            TEXT GENERATED ALWAYS AS (UPPER(TRIM(part_number))) STORED,
    previous_part_number              TEXT,                   -- null unless replacement
    previous_part_number_normalized   TEXT GENERATED ALWAYS AS (UPPER(TRIM(previous_part_number))) STORED,
    replacement_reason                TEXT,
    carry_forward_note                TEXT,
    use_previous_for_calcs            BOOLEAN NOT NULL DEFAULT true,
    checklist                         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status                            TEXT NOT NULL DEFAULT 'open',   -- 'open'|'completed'
    created_by                        TEXT,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_part_changes_part_norm ON public.part_changes (part_number_normalized);
CREATE INDEX IF NOT EXISTS idx_part_changes_prev_norm ON public.part_changes (previous_part_number_normalized);
CREATE INDEX IF NOT EXISTS idx_part_changes_status    ON public.part_changes (status);

ALTER TABLE public.part_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY part_changes_anon_all ON public.part_changes
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Required since Oct 30 2026: new tables aren't auto-exposed to the Data API.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_changes TO anon, authenticated;
