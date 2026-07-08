-- ============================================================
-- part_notes — per-part carry-forward notes
-- One row per part number (keyed by the normalized part number).
-- Remembers the LAST note of each kind plus the date it was written,
-- so the note carries forward the next time a WO Request or Purchasing
-- order is opened for the same part.
--   wo_status_*     — WO Request status note
--   wo_production_* — WO Request production note
--   purchaser_*     — Purchasing purchaser note
-- Only the note text/date/author is stored here; the carry-forward
-- rule itself lives in code (never in SQL).
-- Safe to re-run (IF NOT EXISTS). DO NOT DROP or TRUNCATE.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.part_notes (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number               TEXT NOT NULL,
    part_number_normalized    TEXT GENERATED ALWAYS AS (UPPER(TRIM(part_number))) STORED,

    wo_status_note            TEXT,
    wo_status_note_date       DATE,
    wo_status_note_by         TEXT,

    wo_production_note        TEXT,
    wo_production_note_date   DATE,
    wo_production_note_by     TEXT,

    purchaser_note            TEXT,
    purchaser_note_date       DATE,
    purchaser_note_by         TEXT,

    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per part: unique on the normalized key so upserts target it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_part_notes_part_norm
    ON public.part_notes (part_number_normalized);

ALTER TABLE public.part_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY part_notes_anon_all ON public.part_notes
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Required since Oct 30 2026: new tables aren't auto-exposed to the Data API.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_notes TO anon, authenticated;
