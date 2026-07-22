-- ============================================================
-- Production Planning — Phase 2 Patch 1: part_planning parameters
--
-- One optional row per part. Serves BOTH planning tiers:
--   · components/subparts: batch rules, lead time, make/buy override
--   · sellable configs:    the finished-goods stock band
--     (min_stock 12 / target_stock 20 / min_batch_qty 5 per config)
-- Parts with no row use pure defaults (no band, no batch rounding).
-- Everything derivable stays derived: make/buy comes from item_master
-- attr_manufactured/attr_purchased unless make_buy_override is set;
-- demand rates and on-hand are never stored here.
--
-- Safe migration: CREATE IF NOT EXISTS only. Rerunnable.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.part_planning (
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    min_stock numeric,            -- alert trigger + demand floor (NULL = no band)
    target_stock numeric,         -- order-up-to level
    min_batch_qty numeric,        -- never make/buy fewer than this
    order_multiple numeric,       -- round recommendations up to a multiple
    lead_time_days integer,       -- make or buy lead time (drives order-by dates)
    make_buy_override text,       -- 'make' | 'buy' | NULL = derive from item_master attrs
    phantom boolean NOT NULL DEFAULT false,  -- explosion blows through (never stocked)
    planning_hold boolean NOT NULL DEFAULT false,  -- excluded from recommendations
    notes text,
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One planning row per part (normalized) — upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS part_planning_part_uniq
    ON public.part_planning (part_number_normalized);

ALTER TABLE public.part_planning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS part_planning_all ON public.part_planning;
CREATE POLICY part_planning_all ON public.part_planning
    FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_planning TO anon, authenticated;
