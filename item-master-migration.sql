-- ============================================================
-- item_master — inventory master
-- Roles: manual inventory counts + system estimated on-hand (lonhand)
--        + software-wide part description source.
-- One row per sheet row (per item / store / bin).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.item_master (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item                TEXT NOT NULL,
    -- auto-derived normalized key (DO NOT include in the CSV)
    item_normalized     TEXT GENERATED ALWAYS AS (UPPER(TRIM(item))) STORED,
    descrip             TEXT,
    prodclas            TEXT,
    pricegrp            TEXT,
    glinvtgr            TEXT,
    regprice            NUMERIC,
    mavgcost            NUMERIC,
    mstdcost            NUMERIC,
    locid               TEXT,
    lavgcost            NUMERIC,
    lstdcost            NUMERIC,
    miscfld             TEXT,
    miscfld2            TEXT,
    store               TEXT,
    bin                 TEXT,
    lot                 TEXT,
    lonhand             NUMERIC,                       -- system estimated on-hand
    manual_qty_check    NUMERIC,                       -- manual count
    date_manual_count   DATE,
    source_of_count     TEXT NOT NULL DEFAULT 'ALERE', -- bulk Alere import defaults to ALERE
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_master_item_norm ON public.item_master (item_normalized);
CREATE INDEX IF NOT EXISTS idx_item_master_store_bin ON public.item_master (item_normalized, store, bin);

ALTER TABLE public.item_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_master_anon_all ON public.item_master
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Required since Oct 30 2026: new tables aren't auto-exposed to the Data API.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_master TO anon, authenticated;

-- Fallback guarantee (run AFTER import if any source_of_count came in blank):
-- UPDATE public.item_master SET source_of_count = 'ALERE'
-- WHERE source_of_count IS NULL OR btrim(source_of_count) = '';
