-- ============================================================
-- Purchasing tables — run once against the Supabase SQL editor.
-- All statements are safe to re-run (IF NOT EXISTS / IF NOT EXISTS).
-- DO NOT DROP or TRUNCATE any table.
-- ============================================================

-- ── Main purchasing orders table ──────────────────────────────

CREATE TABLE IF NOT EXISTS purchasing_orders (
  id                      UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

  request_type            TEXT NOT NULL CHECK (request_type IN ('part', 'supply', 'steel')),
  status                  TEXT NOT NULL DEFAULT 'requested',

  requested_by            TEXT,
  date_requested          DATE DEFAULT CURRENT_DATE,
  needed_by               DATE,

  -- Part fields
  part_number             TEXT,
  sales_order             TEXT,
  wo_number               TEXT,
  job_number              INTEGER,

  -- Shared
  description             TEXT,
  qty_needed              NUMERIC,
  estimated_qty_in_stock  NUMERIC,
  current_production_run  TEXT,
  request_location        TEXT,
  bin_location            TEXT,

  requester_notes         TEXT,
  production_notes        TEXT,

  -- Purchasing / ordering fields
  supplier_name           TEXT,
  supplier_part_number    TEXT,
  po_number               TEXT,
  estimated_lead_time     NUMERIC,
  expected_date           DATE,
  qty_ordered             NUMERIC,
  purchaser_notes         TEXT,
  purchaser_questions     TEXT,

  -- Receiving fields
  qty_received            NUMERIC DEFAULT 0,
  received_at             TIMESTAMP WITH TIME ZONE,
  received_by             TEXT,

  -- Supply-specific fields
  supply_category         TEXT,
  supply_item_name        TEXT,

  -- Steel-specific fields
  material_type           TEXT,
  material_size           TEXT,
  material_thickness      TEXT,
  material_length         TEXT,
  material_grade          TEXT,
  steel_shape             TEXT,

  last_status_update      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at            TIMESTAMP WITH TIME ZONE
);

-- ── History / events table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchasing_order_events (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  purchasing_order_id   UUID REFERENCES purchasing_orders(id) ON DELETE CASCADE,
  event_type            TEXT,
  note                  TEXT,
  old_status            TEXT,
  new_status            TEXT,
  created_by            TEXT,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_purchasing_orders_status
  ON purchasing_orders (status);

CREATE INDEX IF NOT EXISTS idx_purchasing_orders_type
  ON purchasing_orders (request_type);

CREATE INDEX IF NOT EXISTS idx_purchasing_orders_created
  ON purchasing_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchasing_events_order_id
  ON purchasing_order_events (purchasing_order_id);

-- ── Enable RLS with open anon-key policies ────────────────────

ALTER TABLE purchasing_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchasing_order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access purchasing_orders"
  ON purchasing_orders FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "anon full access purchasing_order_events"
  ON purchasing_order_events FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
