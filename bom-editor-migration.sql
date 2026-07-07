-- ============================================================
-- BOM editor / native part creation — item_master extension
-- (Run against live DB July 7, 2026, by user via dashboard.)
--
-- Adds Alere item fields the app previously never stored, plus
-- record_source so natively-created parts can be distinguished
-- from bulk Alere imports.
--
-- OPS RULE: any future Alere import/squash procedure must SKIP
-- or PRESERVE rows WHERE record_source = 'native'.
-- ============================================================

ALTER TABLE public.item_master
  ADD COLUMN IF NOT EXISTS item_type         TEXT,
  ADD COLUMN IF NOT EXISTS ship_price        NUMERIC,
  ADD COLUMN IF NOT EXISTS box_weight        NUMERIC,
  ADD COLUMN IF NOT EXISTS box_length        NUMERIC,
  ADD COLUMN IF NOT EXISTS box_width         NUMERIC,
  ADD COLUMN IF NOT EXISTS box_height        NUMERIC,
  ADD COLUMN IF NOT EXISTS attr_purchased    BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_stocking     BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_component    BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_lot_costing  BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_ecommerce    BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_drop_ship    BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_sellable     BOOLEAN,
  ADD COLUMN IF NOT EXISTS attr_manufactured BOOLEAN,
  ADD COLUMN IF NOT EXISTS record_source     TEXT NOT NULL DEFAULT 'ALERE';
