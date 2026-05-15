-- ============================================================
-- Dev DB FULL catch-up migration — generated 2026-05-11
-- Covers every table and column in prod as of this date.
-- Fully idempotent: safe to run multiple times.
-- Run in Supabase SQL editor on the DEV project.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES (CREATE IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS app_pins (
    id   SERIAL PRIMARY KEY,
    name TEXT   NOT NULL,
    pin  TEXT   NOT NULL
);

CREATE TABLE IF NOT EXISTS eng_inquiries (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wrong_numbers            TEXT,
    part_number_trying       TEXT,
    date_entered             DATE,
    csr_rep                  TEXT,
    deck_model_number        TEXT,
    brand                    TEXT,
    deck_model               TEXT,
    deck_width               TEXT,
    year                     TEXT,
    customer_name            TEXT,
    customer_phone           TEXT,
    customer_email           TEXT,
    sales_order_number       TEXT,
    csr_notes                TEXT,
    engineering_notes        TEXT,
    correct_part_number      TEXT,
    status                   TEXT        DEFAULT 'Not Started',
    assigned_to              TEXT,
    priority                 TEXT        DEFAULT 'Medium',
    created_at               TIMESTAMPTZ DEFAULT now(),
    updated_at               TIMESTAMPTZ DEFAULT now(),
    inquiry_type             TEXT        DEFAULT 'chute',
    mower_model              TEXT,
    hitch_to_ground_distance TEXT,
    trac_vac_trailer_model   TEXT,
    current_action_step      TEXT,
    action_step_due_date     DATE,
    hose_size                TEXT,
    action_step_unread       BOOLEAN     DEFAULT false
);

CREATE TABLE IF NOT EXISTS eng_inquiries_completed (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    original_id          UUID,
    archived_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    inquiry_type         TEXT,
    wrong_numbers        TEXT,
    part_number_trying   TEXT,
    correct_part_number  TEXT,
    date_entered         DATE,
    csr_rep              TEXT,
    deck_model_number    TEXT,
    brand                TEXT,
    deck_model           TEXT,
    deck_width           TEXT,
    year                 TEXT,
    mower_model          TEXT,
    hose_size            TEXT,
    trac_vac_trailer_model TEXT,
    customer_name        TEXT,
    customer_phone       TEXT,
    customer_email       TEXT,
    sales_order_number   TEXT,
    csr_notes            TEXT,
    engineering_notes    TEXT,
    current_action_step  TEXT,
    action_step_due_date DATE,
    status               TEXT,
    assigned_to          TEXT,
    priority             TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS engineering_followups (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    part_number           TEXT NOT NULL,
    description           TEXT,
    sales_order           TEXT,
    wo_number             TEXT,
    source_type           TEXT,
    source_id             TEXT,
    source_url            TEXT,
    customer_name         TEXT,
    customer_email        TEXT,
    customer_phone        TEXT,
    customer_info_raw     TEXT,
    change_description    TEXT,
    date_changed_created  DATE,
    date_shipped          DATE,
    status                TEXT DEFAULT 'new_intake',
    next_action           TEXT,
    next_action_due_date  DATE,
    next_action_owner     TEXT,
    priority              TEXT DEFAULT 'normal',
    follow_up_questions   TEXT,
    follow_up_notes       TEXT,
    second_follow_up_date DATE,
    fit_status            TEXT DEFAULT 'pending',
    customer_response     TEXT,
    fit_notes             TEXT,
    fits_chute            TEXT,
    fits_bracket          TEXT,
    fits_adaptor          TEXT,
    fits_pin              TEXT
);

CREATE TABLE IF NOT EXISTS engineering_followup_events (
    id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    followup_id          UUID        REFERENCES engineering_followups(id) ON DELETE CASCADE,
    event_type           TEXT,
    note                 TEXT,
    old_status           TEXT,
    new_status           TEXT,
    next_action          TEXT,
    next_action_due_date DATE,
    created_by           TEXT,
    created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issues_receipts (
    id                     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_date               DATE    NOT NULL,
    part_number            TEXT    NOT NULL,
    part_number_normalized TEXT    NOT NULL,
    description            TEXT,
    doctype                TEXT    NOT NULL,
    docid                  TEXT,
    qty                    NUMERIC NOT NULL,
    cost                   NUMERIC,
    trantype               TEXT    NOT NULL,
    poto                   TEXT,
    bin                    TEXT,
    store                  TEXT,
    source                 TEXT,
    source_file_name       TEXT,
    source_row_number      INTEGER,
    import_batch_id        TEXT,
    created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manager_alert_resolutions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type   TEXT        NOT NULL,
    reference_id TEXT        NOT NULL,
    resolved_by  TEXT        NOT NULL,
    resolution   TEXT        NOT NULL,
    resolved_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS open_orders (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_type              TEXT        NOT NULL DEFAULT 'trac_vac',
    sort_order              INTEGER     DEFAULT 0,
    row_color               TEXT,
    part_number             TEXT,
    description             TEXT,
    customer                TEXT,
    sales_order             TEXT,
    wo_po_number            TEXT,
    to_ship                 INTEGER,
    qty_pulled              INTEGER,
    date_entered            TEXT,
    deadline                TEXT,
    status                  TEXT        DEFAULT 'New/Picking',
    store_bin               TEXT,
    update_store_bin        TEXT,
    wo_va_notes             TEXT,
    boxer                   TEXT,
    picker                  TEXT,
    info_enterer            TEXT,
    last_status_update      TEXT,
    box1                    TEXT,
    box2                    TEXT,
    box3                    TEXT,
    box4                    TEXT,
    dims                    TEXT,
    weight_lbs              TEXT,
    ship_quote_1            TEXT,
    ship_quote_2            TEXT,
    ship_cost_3             TEXT,
    ship_paid_4             TEXT,
    chute_status            TEXT,
    chute_date              TEXT,
    bracket_adapter_status  TEXT,
    bracket_adapter_date    TEXT,
    holding_bin_chute       TEXT,
    holding_bin_status      TEXT,
    holding_bin_part        TEXT,
    holding_bin_date        TEXT,
    override                TEXT,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    chute_bracket_last_updated TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS part_approval_defaults (
    id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    part_number            TEXT        NOT NULL,
    part_number_normalized TEXT        NOT NULL,
    fab                    TEXT,
    fab_print              TEXT,
    weld                   TEXT,
    weld_print             TEXT,
    assy_wo                TEXT,
    color                  TEXT,
    bent_rolled_part       BOOLEAN,
    source                 TEXT        DEFAULT 'manual_or_learned',
    created_by             TEXT,
    updated_by             TEXT,
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now(),
    last_used_at           TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sales_analysis_lines (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_date       DATE,
    docid           TEXT,
    linenum         TEXT,
    doctype         TEXT,
    item            TEXT        NOT NULL,
    item_normalized TEXT        NOT NULL,
    trantype        TEXT,
    qty             NUMERIC     DEFAULT 0,
    cost            NUMERIC,
    ourprice        NUMERIC,
    regprice        NUMERIC,
    descrip         TEXT,
    source          TEXT        DEFAULT 'sales_analysis_import',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS travellers (
    id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wo_errors (
    id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ts      TIMESTAMPTZ NOT NULL DEFAULT now(),
    source  TEXT        NOT NULL,
    message TEXT        NOT NULL,
    context JSONB       NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS wo_progress_events (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    work_order_id       UUID,
    wo_number           TEXT        NOT NULL,
    department          TEXT        NOT NULL,
    stage               TEXT,
    operator_name       TEXT        NOT NULL,
    action              TEXT        NOT NULL,
    session_qty         NUMERIC     DEFAULT 0,
    cumulative_qty_after NUMERIC    DEFAULT 0,
    reason              TEXT,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wo_requests (
    id                           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number                  TEXT        NOT NULL,
    description                  TEXT,
    sales_order_number           TEXT,
    qty_on_order                 NUMERIC,
    qty_in_stock                 NUMERIC,
    qty_used_per_unit            NUMERIC,
    request_date                 DATE,
    submitted_by                 TEXT        NOT NULL,
    status                       TEXT        NOT NULL DEFAULT 'pending',
    alere_qty                    NUMERIC,
    alere_bin                    TEXT,
    qty_sold_used_12mo           NUMERIC,
    where_used                   TEXT,
    qty_to_make                  NUMERIC,
    fab                          TEXT,
    fab_print                    TEXT,
    weld                         TEXT,
    weld_print                   TEXT,
    assy_wo                      TEXT,
    color                        TEXT,
    bent_rolled_part             BOOLEAN,
    set_up_time                  NUMERIC,
    estimated_lead_time          NUMERIC,
    sent_to_production           BOOLEAN     DEFAULT false,
    date_to_start                DATE,
    alere_wo_number              TEXT,
    created_by_initials          TEXT,
    created_date                 DATE,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    forecasted                   BOOLEAN     DEFAULT false,
    forecast_date                TEXT,
    forecast_reason              TEXT,
    production_notes             TEXT,
    qty_used_in_mfg              NUMERIC,
    qty_made_past_12mo           NUMERIC,
    qty_sold_parent_usage_period NUMERIC,
    traveller_id                 BIGINT,
    parent_request_id            UUID,
    subpart_plans                JSONB
);

CREATE TABLE IF NOT EXISTS wo_status_tracking (
    id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_number               TEXT        NOT NULL,
    part_number             TEXT,
    description             TEXT,
    qty_required            NUMERIC     DEFAULT 0,
    assy_received_status    TEXT,
    location                TEXT,
    spot_count              NUMERIC     DEFAULT 0,
    spot_check_name         TEXT,
    spot_check_match        TEXT,
    erp_status              TEXT        DEFAULT 'open',
    closed_by               TEXT,
    completed_info          TEXT,
    closed_at               TIMESTAMPTZ,
    received_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    qty_received            NUMERIC,
    received_by             TEXT,
    alere_bin_update_needed BOOLEAN     DEFAULT false,
    alere_bin_updated_at    TIMESTAMPTZ,
    alere_bin_updated_by    TEXT,
    closeout_notes          TEXT
);

CREATE TABLE IF NOT EXISTS wo_time_sessions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id            UUID,
    wo_number        TEXT,
    department       TEXT,
    operator         TEXT        NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ,
    duration_minutes INTEGER,
    end_status       TEXT,
    qty_this_session INTEGER     DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now(),
    stage            TEXT
);

CREATE TABLE IF NOT EXISTS wo_unit_completions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id               UUID,
    wo_number           TEXT        NOT NULL,
    department          TEXT        NOT NULL,
    unit_number         INTEGER     NOT NULL,
    unit_serial_number  TEXT,
    engine_model        TEXT,
    engine_serial_number TEXT,
    num_blades          INTEGER,
    operator            TEXT,
    completed_at        TIMESTAMPTZ DEFAULT now(),
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_orders (
    id                             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    sales_order                    TEXT,
    wo_number                      TEXT        NOT NULL,
    part_number                    TEXT,
    description                    TEXT,
    qty_required                   NUMERIC     DEFAULT 0,
    department                     TEXT,
    status                         TEXT        DEFAULT 'not_started',
    qty_completed                  NUMERIC     DEFAULT 0,
    operator                       TEXT,
    start_date                     TIMESTAMPTZ,
    comp_date                      TIMESTAMPTZ,
    due_date                       TIMESTAMPTZ,
    priority                       NUMERIC     DEFAULT 0,
    notes                          TEXT,
    unit_serial_number             TEXT,
    model                          TEXT,
    engine                         TEXT,
    engine_serial_number           TEXT,
    num_blades                     TEXT,
    customer                       TEXT,
    wo_type                        TEXT,
    tc_pre_lap_status              TEXT,
    tc_pre_lap_operator            TEXT,
    tc_final_status                TEXT,
    tc_final_operator              TEXT,
    tc_packaging_status            TEXT,
    tc_packaging_operator          TEXT,
    tv_engine_status               TEXT,
    tv_cart_status                 TEXT,
    tv_final_status                TEXT,
    created_at                     TIMESTAMPTZ DEFAULT now(),
    manager_notes                  TEXT,
    tv_job_mode                    TEXT,
    tc_job_mode                    TEXT,
    tv_engine_qty_completed        NUMERIC     DEFAULT 0,
    tv_cart_qty_completed          NUMERIC     DEFAULT 0,
    tv_final_qty_completed         NUMERIC     DEFAULT 0,
    tc_pre_lap_qty_completed       NUMERIC     DEFAULT 0,
    tc_final_qty_completed         NUMERIC     DEFAULT 0,
    tc_assy_notes_differences_mods TEXT,
    print_url                      TEXT,
    dxf_url                        TEXT,
    wo_problem_text                TEXT,
    wo_problem_status              TEXT        DEFAULT 'open',
    wo_problem_updated_at          TIMESTAMPTZ,
    wo_problem_updated_by          TEXT,
    wo_problem_resolution          TEXT,
    assigned_operator              TEXT,
    tv_assy_notes                  TEXT,
    fab_bring_to                   TEXT,
    updated_at                     TIMESTAMPTZ DEFAULT now(),
    weld_reel_status               TEXT,
    grind_reel_status              TEXT,
    weld_reel_operator             TEXT,
    grind_reel_operator            TEXT,
    weld_reel_qty                  INTEGER     DEFAULT 0,
    grind_reel_qty                 INTEGER     DEFAULT 0,
    production_notes               TEXT,
    traveller_id                   BIGINT
);

-- ============================================================
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- (safe no-ops if columns already exist)
-- ============================================================

-- wo_requests: all columns that may have been added post-creation
ALTER TABLE wo_requests
    ADD COLUMN IF NOT EXISTS alere_qty                    NUMERIC,
    ADD COLUMN IF NOT EXISTS alere_bin                    TEXT,
    ADD COLUMN IF NOT EXISTS qty_sold_used_12mo           NUMERIC,
    ADD COLUMN IF NOT EXISTS where_used                   TEXT,
    ADD COLUMN IF NOT EXISTS qty_to_make                  NUMERIC,
    ADD COLUMN IF NOT EXISTS fab                          TEXT,
    ADD COLUMN IF NOT EXISTS fab_print                    TEXT,
    ADD COLUMN IF NOT EXISTS weld                         TEXT,
    ADD COLUMN IF NOT EXISTS weld_print                   TEXT,
    ADD COLUMN IF NOT EXISTS assy_wo                      TEXT,
    ADD COLUMN IF NOT EXISTS color                        TEXT,
    ADD COLUMN IF NOT EXISTS bent_rolled_part             BOOLEAN,
    ADD COLUMN IF NOT EXISTS set_up_time                  NUMERIC,
    ADD COLUMN IF NOT EXISTS estimated_lead_time          NUMERIC,
    ADD COLUMN IF NOT EXISTS sent_to_production           BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS date_to_start                DATE,
    ADD COLUMN IF NOT EXISTS alere_wo_number              TEXT,
    ADD COLUMN IF NOT EXISTS created_by_initials          TEXT,
    ADD COLUMN IF NOT EXISTS created_date                 DATE,
    ADD COLUMN IF NOT EXISTS updated_at                   TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS forecasted                   BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS forecast_date                TEXT,
    ADD COLUMN IF NOT EXISTS forecast_reason              TEXT,
    ADD COLUMN IF NOT EXISTS production_notes             TEXT,
    ADD COLUMN IF NOT EXISTS qty_used_in_mfg              NUMERIC,
    ADD COLUMN IF NOT EXISTS qty_made_past_12mo           NUMERIC,
    ADD COLUMN IF NOT EXISTS qty_sold_parent_usage_period NUMERIC,
    ADD COLUMN IF NOT EXISTS subpart_plans                JSONB;

-- wo_requests: traveller_id FK (requires travellers table to exist first)
ALTER TABLE wo_requests
    ADD COLUMN IF NOT EXISTS traveller_id BIGINT REFERENCES travellers(id);

-- wo_requests: parent_request_id with ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wo_requests' AND column_name = 'parent_request_id'
    ) THEN
        ALTER TABLE wo_requests
            ADD COLUMN parent_request_id UUID REFERENCES wo_requests(id) ON DELETE CASCADE;
    ELSE
        -- Fix constraint if it exists without CASCADE
        DECLARE v_con TEXT;
        BEGIN
            SELECT conname INTO v_con FROM pg_constraint
            WHERE conrelid = 'wo_requests'::regclass AND conname LIKE '%parent_request_id%';
            IF v_con IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'wo_requests'::regclass AND conname = v_con AND confdeltype = 'c'
            ) THEN
                EXECUTE 'ALTER TABLE wo_requests DROP CONSTRAINT ' || quote_ident(v_con);
                ALTER TABLE wo_requests ADD CONSTRAINT wo_requests_parent_request_id_fkey
                    FOREIGN KEY (parent_request_id) REFERENCES wo_requests(id) ON DELETE CASCADE;
            END IF;
        END;
    END IF;
END $$;

-- work_orders: all columns that may have been added post-creation
ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS manager_notes                  TEXT,
    ADD COLUMN IF NOT EXISTS tv_job_mode                    TEXT,
    ADD COLUMN IF NOT EXISTS tc_job_mode                    TEXT,
    ADD COLUMN IF NOT EXISTS tv_engine_qty_completed        NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tv_cart_qty_completed          NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tv_final_qty_completed         NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tc_pre_lap_qty_completed       NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tc_final_qty_completed         NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tc_assy_notes_differences_mods TEXT,
    ADD COLUMN IF NOT EXISTS print_url                      TEXT,
    ADD COLUMN IF NOT EXISTS dxf_url                        TEXT,
    ADD COLUMN IF NOT EXISTS wo_problem_text                TEXT,
    ADD COLUMN IF NOT EXISTS wo_problem_status              TEXT DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS wo_problem_updated_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS wo_problem_updated_by          TEXT,
    ADD COLUMN IF NOT EXISTS wo_problem_resolution          TEXT,
    ADD COLUMN IF NOT EXISTS assigned_operator              TEXT,
    ADD COLUMN IF NOT EXISTS tv_assy_notes                  TEXT,
    ADD COLUMN IF NOT EXISTS fab_bring_to                   TEXT,
    ADD COLUMN IF NOT EXISTS updated_at                     TIMESTAMPTZ DEFAULT now(),
    ADD COLUMN IF NOT EXISTS weld_reel_status               TEXT,
    ADD COLUMN IF NOT EXISTS grind_reel_status              TEXT,
    ADD COLUMN IF NOT EXISTS weld_reel_operator             TEXT,
    ADD COLUMN IF NOT EXISTS grind_reel_operator            TEXT,
    ADD COLUMN IF NOT EXISTS weld_reel_qty                  INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS grind_reel_qty                 INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS production_notes               TEXT,
    ADD COLUMN IF NOT EXISTS traveller_id                   BIGINT REFERENCES travellers(id);

-- wo_status_tracking
ALTER TABLE wo_status_tracking
    ADD COLUMN IF NOT EXISTS qty_received            NUMERIC,
    ADD COLUMN IF NOT EXISTS received_by             TEXT,
    ADD COLUMN IF NOT EXISTS alere_bin_update_needed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS alere_bin_updated_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS alere_bin_updated_by    TEXT,
    ADD COLUMN IF NOT EXISTS closeout_notes          TEXT,
    ADD COLUMN IF NOT EXISTS job_number              INTEGER;

-- Allow wo_number to be NULL on wo_status_tracking (pending WOs receive before official WO# exists)
ALTER TABLE wo_status_tracking ALTER COLUMN wo_number DROP NOT NULL;

-- wo_time_sessions
ALTER TABLE wo_time_sessions
    ADD COLUMN IF NOT EXISTS stage TEXT;

-- eng_inquiries
ALTER TABLE eng_inquiries
    ADD COLUMN IF NOT EXISTS inquiry_type             TEXT DEFAULT 'chute',
    ADD COLUMN IF NOT EXISTS mower_model              TEXT,
    ADD COLUMN IF NOT EXISTS hitch_to_ground_distance TEXT,
    ADD COLUMN IF NOT EXISTS trac_vac_trailer_model   TEXT,
    ADD COLUMN IF NOT EXISTS current_action_step      TEXT,
    ADD COLUMN IF NOT EXISTS action_step_due_date     DATE,
    ADD COLUMN IF NOT EXISTS hose_size                TEXT,
    ADD COLUMN IF NOT EXISTS action_step_unread       BOOLEAN DEFAULT false;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS issues_receipts_part_normalized_idx
    ON issues_receipts (part_number_normalized);
CREATE INDEX IF NOT EXISTS issues_receipts_doctype_trantype_idx
    ON issues_receipts (doctype, trantype);
CREATE INDEX IF NOT EXISTS issues_receipts_txn_date_idx
    ON issues_receipts (txn_date);
CREATE UNIQUE INDEX IF NOT EXISTS issues_receipts_source_dedup_idx
    ON issues_receipts (source_file_name, source_row_number)
    WHERE source_file_name IS NOT NULL AND source_row_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS manager_alert_resolutions_lookup_idx
    ON manager_alert_resolutions (alert_type, reference_id, resolved_at);

CREATE UNIQUE INDEX IF NOT EXISTS part_approval_defaults_normalized_idx
    ON part_approval_defaults (part_number_normalized);

CREATE INDEX IF NOT EXISTS sales_analysis_lines_item_normalized_idx
    ON sales_analysis_lines (item_normalized);
CREATE INDEX IF NOT EXISTS sales_analysis_lines_sale_date_idx
    ON sales_analysis_lines (sale_date);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE issues_receipts ENABLE ROW LEVEL SECURITY;

ALTER TABLE engineering_followups ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engineering_followups' AND policyname = 'anon_all') THEN
        CREATE POLICY anon_all ON engineering_followups FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE engineering_followup_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'engineering_followup_events' AND policyname = 'anon_all') THEN
        CREATE POLICY anon_all ON engineering_followup_events FOR ALL TO anon USING (true) WITH CHECK (true);
    END IF;
END $$;

-- ============================================================
-- FUNCTIONS (CREATE OR REPLACE)
-- ============================================================

CREATE OR REPLACE FUNCTION get_part_bin_locations(p_parts TEXT[])
RETURNS TABLE(part_number_normalized TEXT, store TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT DISTINCT ON (part_number_normalized)
        part_number_normalized, store
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts) AND store IS NOT NULL
    ORDER BY part_number_normalized, txn_date DESC, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION get_part_bin_and_desc(p_parts TEXT[])
RETURNS TABLE(part_number_normalized TEXT, bin TEXT, description TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT DISTINCT ON (part_number_normalized)
        part_number_normalized, bin, description
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
    ORDER BY part_number_normalized, txn_date DESC, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION get_part_last_made(p_part TEXT)
RETURNS TABLE(txn_date DATE, qty NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT txn_date, qty
    FROM issues_receipts
    WHERE part_number_normalized = UPPER(TRIM(p_part))
      AND doctype = 'MO' AND trantype = 'I'
    ORDER BY txn_date DESC, created_at DESC
    LIMIT 2;
$$;

CREATE OR REPLACE FUNCTION get_part_usage_summary_12mo(p_part TEXT)
RETURNS TABLE(qty_sold_used_12mo NUMERIC, qty_used_in_mfg NUMERIC, qty_made_past_12mo NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'SO' AND trantype = 'O'), 0),
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'MO' AND trantype = 'O'), 0),
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'MO' AND trantype = 'I'), 0)
    FROM issues_receipts
    WHERE part_number_normalized = UPPER(TRIM(p_part));
$$;

CREATE OR REPLACE FUNCTION get_parts_usage_summary_batch(p_parts TEXT[], p_from DATE, p_to DATE)
RETURNS TABLE(part_number_normalized TEXT, qty_sold_used_12mo NUMERIC, qty_used_in_mfg NUMERIC, qty_made_past_12mo NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        part_number_normalized,
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'SO' AND trantype = 'O'), 0),
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'MO' AND trantype = 'O'), 0),
        COALESCE(SUM(qty) FILTER (WHERE doctype = 'MO' AND trantype = 'I'), 0)
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts) AND txn_date BETWEEN p_from AND p_to
    GROUP BY part_number_normalized;
$$;

CREATE OR REPLACE FUNCTION get_parts_made_all_time(p_parts TEXT[])
RETURNS TABLE(part_number_normalized TEXT, qty_made NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        part_number_normalized,
        COALESCE(SUM(qty), 0) AS qty_made
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts) AND doctype = 'MO' AND trantype = 'I'
    GROUP BY part_number_normalized;
$$;

CREATE OR REPLACE FUNCTION get_parts_sold_in_period(p_parts TEXT[], p_start DATE, p_end DATE)
RETURNS TABLE(part_number_normalized TEXT, qty_sold NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        part_number_normalized,
        COALESCE(SUM(qty), 0) AS qty_sold
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND doctype = 'SO' AND trantype = 'O'
      AND txn_date BETWEEN p_start AND p_end
    GROUP BY part_number_normalized;
$$;

CREATE OR REPLACE FUNCTION get_sales_analysis_sold(p_parts TEXT[], p_start DATE, p_end DATE)
RETURNS TABLE(item_normalized TEXT, qty_sold NUMERIC)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        item_normalized,
        COALESCE(SUM(qty), 0) AS qty_sold
    FROM sales_analysis_lines
    WHERE item_normalized = ANY(p_parts) AND sale_date BETWEEN p_start AND p_end
    GROUP BY item_normalized;
$$;

-- ============================================================
-- Job # system (2026-05-12)
-- job_number is the internal WIP number assigned on approval.
-- alere_wo_number is the official Alere/ERP number entered later.
-- These two values are always separate and never overwrite each other.
-- ============================================================

-- Sequence for job numbers — starts at 1000
CREATE SEQUENCE IF NOT EXISTS job_number_seq START 1000;

-- work_orders: job_number column (may have been added in an earlier migration)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS job_number INTEGER;

-- work_orders: allow wo_number to be NULL (pending official Alere WO# entry)
ALTER TABLE work_orders ALTER COLUMN wo_number DROP NOT NULL;

-- work_orders: link back to the wo_request that created this row
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS wo_request_id UUID REFERENCES wo_requests(id);

CREATE INDEX IF NOT EXISTS idx_work_orders_wo_request_id
    ON work_orders(wo_request_id);

-- Staging area: where the part goes after paint (e.g. W1 Staging … W5 Staging)
ALTER TABLE wo_requests  ADD COLUMN IF NOT EXISTS staging_area TEXT;
ALTER TABLE work_orders  ADD COLUMN IF NOT EXISTS staging_area TEXT;
ALTER TABLE work_orders  ADD COLUMN IF NOT EXISTS alere_bin    TEXT;

-- wo_requests: job_number column
ALTER TABLE wo_requests ADD COLUMN IF NOT EXISTS job_number INTEGER;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_requests_job_number
    ON wo_requests(job_number)
    WHERE job_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_job_number
    ON work_orders(job_number);

-- assign_job_number_if_missing — atomically assigns the next job_number from the
-- sequence to a wo_requests row. Idempotent: returns the existing value if already set.
-- Race-safe: uses UPDATE ... WHERE job_number IS NULL so two concurrent calls cannot
-- both assign a number to the same row.
CREATE OR REPLACE FUNCTION assign_job_number_if_missing(p_request_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_job_number INTEGER;
BEGIN
    SELECT job_number INTO v_job_number
    FROM wo_requests WHERE id = p_request_id;

    IF v_job_number IS NOT NULL THEN
        RETURN v_job_number;
    END IF;

    UPDATE wo_requests
    SET    job_number = nextval('job_number_seq')
    WHERE  id = p_request_id AND job_number IS NULL
    RETURNING job_number INTO v_job_number;

    RETURN v_job_number;
END;
$$;

-- ============================================================
-- DONE
-- ============================================================
