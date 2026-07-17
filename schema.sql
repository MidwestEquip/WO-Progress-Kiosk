--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: assign_job_number_if_missing(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_job_number_if_missing(p_request_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
  DECLARE
      v_job_number INTEGER;
  BEGIN
      UPDATE wo_requests
      SET job_number = nextval('job_number_seq')
      WHERE id = p_request_id AND job_number IS NULL;

      SELECT job_number INTO v_job_number
      FROM wo_requests
      WHERE id = p_request_id;

      RETURN v_job_number;
  END;
  $$;


--
-- Name: fetch_last_two_purchases_with_supplier(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fetch_last_two_purchases_with_supplier(p_part_number text) RETURNS TABLE(txn_date text, qty numeric, cost numeric, poto text, company_name text, contact text, phone text, email text, our_account_number text, street text, city text, state text, zip text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
  BEGIN
    RETURN QUERY
    SELECT
      ir.txn_date::TEXT,
      ir.qty::NUMERIC,
      ir.cost::NUMERIC,
      ir.poto::TEXT,
      s.company_name,
      s.contact,
      s.phone,
      s.email,
      s.our_account_number,
      s.street,
      s.city,
      s.state,
      s.zip
    FROM issues_receipts ir
    LEFT JOIN LATERAL (
      SELECT
        ps.company_name,
        ps.contact,
        ps.phone,
        ps.email,
        ps.our_account_number,
        ps.street,
        ps.city,
        ps.state,
        ps.zip
      FROM purchasing_suppliers ps
      WHERE ps.coid = ir.poto
      LIMIT 1
    ) s ON true
    WHERE ir.part_number_normalized = p_part_number
      AND ir.doctype  = 'PO'
      AND ir.trantype = 'I'
    ORDER BY ir.txn_date DESC
    LIMIT 3;
  END;
  $$;


--
-- Name: get_active_pos_for_part(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_pos_for_part(p_part text) RETURNS TABLE(id uuid, po_number text, status text, qty_ordered numeric, date_ordered date, cost numeric, price_each numeric, estimated_lead_time numeric, expected_date date)
    LANGUAGE sql SECURITY DEFINER
    AS $$
      SELECT id, po_number, status, qty_ordered, date_ordered,
             cost, price_each, estimated_lead_time, expected_date
      FROM purchasing_orders
      WHERE request_type = 'part'
        AND status NOT IN ('received', 'canceled')
        AND REGEXP_REPLACE(UPPER(part_number), '[-[:space:]]', '', 'g')
          = REGEXP_REPLACE(UPPER(TRIM(p_part)), '[-[:space:]]', '', 'g')
      ORDER BY date_ordered DESC NULLS LAST, created_at DESC;
  $$;


--
-- Name: get_active_wos_for_part(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_wos_for_part(p_part text) RETURNS json
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    with norm as (
      select replace(replace(upper(trim(p_part)), '-', ''), ' ', '') as k
    )
    select json_build_object(
      'work_orders', coalesce((
        select json_agg(json_build_object(
          'id',         w.id,
          'wo_number',  w.wo_number,
          'job_number', w.job_number,
          'department', w.department,
          'status',     w.status))
        from work_orders w, norm
        where norm.k <> ''
          and replace(replace(upper(trim(w.part_number)), '-', ''), ' ', '') = norm.k
      ), '[]'::json),
      'requests', coalesce((
        select json_agg(json_build_object(
          'id',     r.id,
          'status', r.status))
        from wo_requests r, norm
        where norm.k <> ''
          and r.forecasted = false
          and r.status in ('pending', 'manager_review', 'in production')
          and replace(replace(upper(trim(r.part_number)), '-', ''), ' ', '') = norm.k
      ), '[]'::json)
    );
  $$;


--
-- Name: get_company_purchase_catalog(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_purchase_catalog(p_coid text) RETURNS TABLE(part_number_normalized text, description text, total_qty numeric, last_purchased text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
  BEGIN
    RETURN QUERY
    WITH agg AS (
      SELECT
        ir.part_number_normalized,
        SUM(ir.qty::NUMERIC) AS total_qty,
        MAX(ir.txn_date)     AS last_purchased
      FROM issues_receipts ir
      WHERE ir.poto     = p_coid
        AND ir.doctype  = 'PO'
        AND ir.trantype = 'I'
      GROUP BY ir.part_number_normalized
    ),
    latest_desc AS (
      SELECT DISTINCT ON (ir.part_number_normalized)
        ir.part_number_normalized,
        ir.description
      FROM issues_receipts ir
      WHERE ir.poto        = p_coid
        AND ir.doctype     = 'PO'
        AND ir.trantype    = 'I'
        AND ir.description IS NOT NULL
      ORDER BY ir.part_number_normalized, ir.txn_date DESC
    )
    SELECT
      a.part_number_normalized,
      ld.description,
      a.total_qty,
      a.last_purchased::TEXT
    FROM agg a
    LEFT JOIN latest_desc ld
           ON ld.part_number_normalized = a.part_number_normalized
    ORDER BY a.last_purchased DESC;
  END;
  $$;


--
-- Name: get_part_bin_and_desc(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_bin_and_desc(p_parts text[]) RETURNS TABLE(part_normalized text, bin_location text, description text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
      WITH combined AS (
          SELECT item_normalized AS part_normalized, bin AS
  bin_location, descrip AS description,
                 1 AS src_priority, created_at
          FROM public.item_master
          WHERE item_normalized = ANY(p_parts)
          UNION ALL
          SELECT part_number_normalized AS part_normalized, bin AS
  bin_location, description,
                 2 AS src_priority, created_at
          FROM public.issues_receipts
          WHERE part_number_normalized = ANY(p_parts)
      )
      SELECT DISTINCT ON (part_normalized)
          part_normalized, bin_location, description
      FROM combined
      ORDER BY part_normalized, src_priority, (description IS NULL),
  (bin_location IS NULL), created_at DESC;
  $$;


--
-- Name: get_part_bin_locations(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_bin_locations(p_parts text[]) RETURNS TABLE(part_normalized text, bin_location text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT DISTINCT ON (part_number_normalized)
      part_number_normalized,
      store
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND store IS NOT NULL
      AND store != ''
    ORDER BY part_number_normalized, txn_date DESC;
  $$;


--
-- Name: get_part_description(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_description(p_part text) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    AS $$
      SELECT d FROM (
          SELECT descrip AS d, 1 AS src_priority, created_at
          FROM public.item_master
          WHERE regexp_replace(item_normalized, '[ -]', '', 'g')
                = regexp_replace(UPPER(TRIM(p_part)), '[ -]', '', 'g')
            AND descrip IS NOT NULL AND btrim(descrip) <> ''
          UNION ALL
          SELECT description AS d, 2 AS src_priority, created_at
          FROM public.issues_receipts
          WHERE regexp_replace(part_number_normalized, '[ -]', '', 'g')
                = regexp_replace(UPPER(TRIM(p_part)), '[ -]', '', 'g')
            AND description IS NOT NULL AND btrim(description) <> ''
      ) s
      ORDER BY src_priority, created_at DESC
      LIMIT 1;
  $$;


--
-- Name: get_part_last_made(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_last_made(p_part text) RETURNS TABLE(txn_date text, qty numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$SELECT txn_date::TEXT, qty
    FROM issues_receipts
    WHERE part_number_normalized = UPPER(TRIM(p_part))
      AND doctype = 'MO'
      AND trantype = 'I'
    ORDER BY txn_date DESC
    LIMIT 3;$$;


--
-- Name: get_part_purchased_12mo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_purchased_12mo(p_part text) RETURNS TABLE(txn_date text, qty numeric)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT txn_date::TEXT, qty
    FROM issues_receipts
    WHERE part_number_normalized = p_part
      AND doctype = 'PO' AND trantype = 'I'
      AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
      AND txn_date <= CURRENT_DATE
    ORDER BY txn_date DESC LIMIT 10;
  $$;


--
-- Name: get_part_purchased_36mo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_purchased_36mo(p_part text) RETURNS TABLE(txn_date text, qty numeric)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT txn_date::TEXT, qty
    FROM issues_receipts
    WHERE part_number_normalized = p_part
      AND doctype = 'PO' AND trantype = 'I'
      AND txn_date >= '2023-01-01'
      AND txn_date <= CURRENT_DATE
    ORDER BY txn_date DESC LIMIT 10;
  $$;


--
-- Name: get_part_usage_summary_12mo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_usage_summary_12mo(p_part text) RETURNS TABLE(qty_sold_12mo numeric, qty_used_mfg_12mo numeric, qty_made_12mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty
        FROM sales_analysis_lines
        WHERE item_normalized = p_part
          AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= CURRENT_DATE - INTERVAL '12 months'
          AND sale_date <= CURRENT_DATE
          AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty
        FROM issues_receipts
        WHERE part_number_normalized = p_part
          AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
          AND txn_date <= CURRENT_DATE
          AND txn_date >= public.native_cutover()
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part
        AND doctype = 'MO'
        AND txn_date >= CURRENT_DATE - INTERVAL '12 months'
        AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made FROM sold, mfg;
  $$;


--
-- Name: get_part_usage_summary_36mo(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_part_usage_summary_36mo(p_part text) RETURNS TABLE(qty_sold_36mo numeric, qty_used_mfg_36mo numeric, qty_made_36mo numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    WITH sold AS (
      SELECT COALESCE(SUM(qty), 0) AS qty FROM (
        SELECT qty
        FROM sales_analysis_lines
        WHERE item_normalized = p_part
          AND doctype = 'SO' AND trantype = 'O'
          AND sale_date >= '2023-01-01'
          AND sale_date <= CURRENT_DATE
          AND sale_date < public.native_cutover()
        UNION ALL
        SELECT qty
        FROM issues_receipts
        WHERE part_number_normalized = p_part
          AND source = 'native'
          AND doctype = 'SO' AND trantype = 'O'
          AND txn_date >= public.native_cutover()
          AND txn_date <= CURRENT_DATE
      ) s
    ),
    mfg AS (
      SELECT
        COALESCE(SUM(CASE WHEN trantype = 'O' THEN qty ELSE 0 END), 0) AS qty_used,
        COALESCE(SUM(CASE WHEN trantype = 'I' THEN qty ELSE 0 END), 0) AS qty_made
      FROM issues_receipts
      WHERE part_number_normalized = p_part
        AND doctype = 'MO'
        AND txn_date >= '2023-01-01'
        AND txn_date <= CURRENT_DATE
    )
    SELECT sold.qty, mfg.qty_used, mfg.qty_made FROM sold, mfg;
  $$;


--
-- Name: get_parts_made_all_time(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_parts_made_all_time(p_parts text[]) RETURNS TABLE(part_normalized text, qty_made numeric)
    LANGUAGE sql SECURITY DEFINER
    AS $$                                                                                                                                                      
      SELECT part_number_normalized AS part_normalized,
             SUM(qty) AS qty_made                                                                                                                                                          
      FROM issues_receipts                                  
      WHERE part_number_normalized = ANY(p_parts)
        AND doctype = 'MO'
        AND trantype = 'I'
      GROUP BY part_number_normalized;
  $$;


--
-- Name: get_parts_sold_in_period(text[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_parts_sold_in_period(p_parts text[], p_start date, p_end date) RETURNS TABLE(part_normalized text, qty_sold numeric)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT
      part_number_normalized       AS part_normalized,
      COALESCE(SUM(qty), 0)        AS qty_sold
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND doctype  = 'SO'
      AND trantype = 'O'
      AND txn_date BETWEEN p_start AND p_end
    GROUP BY part_number_normalized;
  $$;


--
-- Name: get_parts_usage_summary_batch(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_parts_usage_summary_batch(p_parts text[]) RETURNS TABLE(part_normalized text, qty_made_12mo numeric, qty_used_mfg_12mo numeric, qty_sold_12mo numeric)
    LANGUAGE sql SECURITY DEFINER
    AS $$
    SELECT
      part_number_normalized,
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='I' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='MO' AND trantype='O' THEN qty ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN doctype='SO' AND trantype='O' THEN qty ELSE 0 END), 0)
    FROM issues_receipts
    WHERE part_number_normalized = ANY(p_parts)
      AND txn_date >= NOW() - INTERVAL '12 months'
    GROUP BY part_number_normalized;
  $$;


--
-- Name: get_sales_analysis_sold(text[], date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sales_analysis_sold(p_parts text[], p_start date, p_end date) RETURNS TABLE(item_normalized text, qty_sold numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT
      item_normalized,
      COALESCE(SUM(qty), 0) AS qty_sold
    FROM (
      SELECT item_normalized, qty
      FROM sales_analysis_lines
      WHERE item_normalized = ANY(p_parts)
        AND doctype  = 'SO'
        AND trantype = 'O'
        AND sale_date BETWEEN p_start AND p_end
        AND sale_date < public.native_cutover()
      UNION ALL
      SELECT part_number_normalized AS item_normalized, qty
      FROM issues_receipts
      WHERE part_number_normalized = ANY(p_parts)
        AND source   = 'native'
        AND doctype  = 'SO'
        AND trantype = 'O'
        AND txn_date BETWEEN p_start AND p_end
        AND txn_date >= public.native_cutover()
    ) s
    GROUP BY item_normalized;
  $$;


--
-- Name: import_inventory_count(text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_inventory_count(p_part text, p_qty numeric, p_counted_by text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_part text := upper(btrim(coalesce(p_part, '')));
    v_by   text := btrim(coalesce(p_counted_by, ''));
BEGIN
    IF length(v_part) < 1 OR length(v_part) > 100 THEN
        RAISE EXCEPTION 'invalid part number';
    END IF;
    IF p_qty IS NULL OR p_qty < 0 OR p_qty >= 100000 THEN
        RAISE EXCEPTION 'count quantity must be between 0 and 99999';
    END IF;
    IF v_by = '' THEN
        RAISE EXCEPTION 'counted_by is required';
    END IF;

    INSERT INTO issues_receipts
        (txn_date, part_number, part_number_normalized, doctype, trantype,
         qty, docid, source, native_event_key)
    VALUES
        (CURRENT_DATE, v_part, v_part, 'IC', 'C',
         p_qty,
         left('counted by: ' || v_by, 50),
         'native',
         'ic|' || v_part || '|' || to_char(now(), 'YYYYMMDDHH24MISS'))
    ON CONFLICT (native_event_key) DO NOTHING;  -- same-second replay collapses
END;
$$;


--
-- Name: issrec_native_apply_onhand(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issrec_native_apply_onhand() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_delta numeric;
BEGIN
    IF NEW.doctype = 'IC' THEN
        INSERT INTO part_on_hand (part_number_normalized, on_hand, counted_at, updated_at)
        VALUES (NEW.part_number_normalized, NEW.qty, now(), now())
        ON CONFLICT (part_number_normalized)
        DO UPDATE SET on_hand    = EXCLUDED.on_hand,
                      counted_at = now(),
                      updated_at = now();
        RETURN NULL;
    END IF;

    v_delta := CASE
        WHEN NEW.doctype IN ('MO', 'PO') AND NEW.trantype = 'I' THEN  NEW.qty
        WHEN NEW.doctype = 'MO'          AND NEW.trantype = 'O' THEN -NEW.qty
        WHEN NEW.doctype = 'SO'          AND NEW.trantype = 'S' THEN -NEW.qty
        ELSE NULL   -- SO/O and anything unmapped: no on-hand effect
    END;
    IF v_delta IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO part_on_hand (part_number_normalized, on_hand, updated_at)
    VALUES (NEW.part_number_normalized, v_delta, now())
    ON CONFLICT (part_number_normalized)
    DO UPDATE SET on_hand    = part_on_hand.on_hand + EXCLUDED.on_hand,
                  updated_at = now();
    RETURN NULL;
END;
$$;


--
-- Name: issrec_native_normalize(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issrec_native_normalize() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.part_number_normalized := upper(btrim(NEW.part_number));
    RETURN NEW;   -- must return NEW or the insert is silently suppressed
END;
$$;


--
-- Name: native_cutover(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.native_cutover() RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT DATE '2026-07-16' $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: all_boms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.all_boms (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    item_parent text NOT NULL,
    item_parent_normalized text NOT NULL,
    item_child text NOT NULL,
    item_child_normalized text NOT NULL,
    qty_per_assy numeric DEFAULT 1,
    source text DEFAULT 'bom_import'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_pins (
    id integer NOT NULL,
    name text NOT NULL,
    pin text NOT NULL
);


--
-- Name: app_pins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_pins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_pins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_pins_id_seq OWNED BY public.app_pins.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text
);


--
-- Name: completed_work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.completed_work_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    sales_order text,
    wo_number text NOT NULL,
    part_number text,
    description text,
    qty_required numeric DEFAULT 0,
    department text,
    status text DEFAULT 'completed'::text,
    qty_completed numeric DEFAULT 0,
    operator text,
    start_date timestamp with time zone,
    comp_date timestamp with time zone,
    due_date timestamp with time zone,
    priority numeric DEFAULT 0,
    notes text,
    unit_serial_number text,
    engine_model text,
    engine_serial_number text,
    num_blades text,
    customer text,
    wo_type text,
    tc_pre_lap_status text,
    tc_pre_lap_operator text,
    tc_final_status text,
    tc_final_operator text,
    tv_engine_status text,
    tv_cart_status text,
    tv_final_status text,
    manager_notes text,
    tv_job_mode text,
    tc_job_mode text,
    tv_engine_qty_completed numeric DEFAULT 0,
    tv_cart_qty_completed numeric DEFAULT 0,
    tv_final_qty_completed numeric DEFAULT 0,
    tc_pre_lap_qty_completed numeric DEFAULT 0,
    tc_final_qty_completed numeric DEFAULT 0,
    tc_assy_notes_differences_mods text,
    print_url text,
    dxf_url text,
    wo_problem_text text,
    wo_problem_status text DEFAULT 'open'::text,
    wo_problem_updated_at timestamp with time zone,
    wo_problem_updated_by text,
    wo_problem_resolution text,
    assigned_operator text,
    tv_assy_notes text,
    fab_bring_to text,
    weld_reel_status text,
    grind_reel_status text,
    weld_reel_operator text,
    grind_reel_operator text,
    weld_reel_qty integer DEFAULT 0,
    grind_reel_qty integer DEFAULT 0,
    archived_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    alere_bin text,
    staging_area text,
    production_notes text,
    traveller_id bigint,
    job_number integer,
    wo_request_id uuid,
    unit_number integer,
    unit_notes text
);


--
-- Name: direct_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_role text NOT NULL,
    recipient_role text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    media_path text,
    media_type text,
    CONSTRAINT direct_messages_body_check CHECK ((((body IS NOT NULL) AND (length(TRIM(BOTH FROM body)) > 0)) OR (media_path IS NOT NULL)))
);


--
-- Name: eng_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eng_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wrong_numbers text,
    part_number_trying text,
    date_entered date,
    csr_rep text,
    deck_model_number text,
    brand text,
    deck_model text,
    deck_width text,
    year text,
    customer_name text,
    customer_phone text,
    customer_email text,
    sales_order_number text,
    csr_notes text,
    engineering_notes text,
    correct_part_number text,
    status text DEFAULT 'Not Started'::text,
    assigned_to text,
    priority text DEFAULT 'Medium'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    inquiry_type text DEFAULT 'chute'::text,
    mower_model text,
    hitch_to_ground_distance text,
    trac_vac_trailer_model text,
    current_action_step text,
    action_step_due_date date,
    hose_size text,
    action_step_unread boolean DEFAULT false,
    record_category text DEFAULT 'inquiry'::text
);


--
-- Name: eng_inquiries_completed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eng_inquiries_completed (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_id uuid,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    inquiry_type text,
    wrong_numbers text,
    part_number_trying text,
    correct_part_number text,
    date_entered date,
    csr_rep text,
    deck_model_number text,
    brand text,
    deck_model text,
    deck_width text,
    year text,
    mower_model text,
    hose_size text,
    trac_vac_trailer_model text,
    customer_name text,
    customer_phone text,
    customer_email text,
    sales_order_number text,
    csr_notes text,
    engineering_notes text,
    current_action_step text,
    action_step_due_date date,
    status text,
    assigned_to text,
    priority text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    record_category text DEFAULT 'inquiry'::text
);


--
-- Name: engineering_followup_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engineering_followup_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    followup_id uuid,
    event_type text,
    note text,
    old_status text,
    new_status text,
    next_action text,
    next_action_due_date date,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: engineering_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engineering_followups (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    part_number text NOT NULL,
    description text,
    sales_order text,
    wo_number text,
    source_type text,
    source_id text,
    source_url text,
    customer_name text,
    customer_email text,
    customer_phone text,
    customer_info_raw text,
    change_description text,
    date_changed_created date,
    date_shipped date,
    status text DEFAULT 'new_intake'::text,
    next_action text,
    next_action_due_date date,
    next_action_owner text,
    priority text DEFAULT 'normal'::text,
    follow_up_questions text,
    follow_up_notes text,
    second_follow_up_date date,
    fit_status text DEFAULT 'pending'::text,
    customer_response text,
    fit_notes text,
    fits_chute text,
    fits_bracket text,
    fits_adaptor text,
    fits_pin text,
    fits_model text,
    new_chute_number text,
    dims text,
    alere_bom_updated boolean DEFAULT false,
    alere_part_updated boolean DEFAULT false,
    print_updated boolean DEFAULT false,
    dxf_updated boolean DEFAULT false,
    autodesk_files_updated boolean DEFAULT false,
    cad_3d_updated boolean DEFAULT false,
    assembly_model_updated boolean DEFAULT false,
    manual_updated boolean DEFAULT false,
    fit_mapping_recorded boolean DEFAULT false,
    finalized_notes text,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone
);


--
-- Name: issues_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.issues_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    txn_date date NOT NULL,
    part_number text NOT NULL,
    part_number_normalized text NOT NULL,
    description text,
    doctype text NOT NULL,
    docid text,
    qty numeric NOT NULL,
    cost numeric,
    trantype text NOT NULL,
    poto text,
    bin text,
    store text,
    source text,
    source_file_name text,
    source_row_number integer,
    import_batch_id text,
    created_at timestamp with time zone DEFAULT now(),
    native_event_key text
);


--
-- Name: item_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_master (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item text NOT NULL,
    item_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM item))) STORED,
    descrip text,
    prodclas text,
    pricegrp text,
    glinvtgr text,
    regprice numeric,
    mavgcost numeric,
    mstdcost numeric,
    locid text,
    lavgcost numeric,
    lstdcost numeric,
    miscfld text,
    miscfld2 text,
    store text,
    bin text,
    lot text,
    lonhand numeric,
    manual_qty_check numeric,
    date_manual_count date,
    source_of_count text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    item_squashed text GENERATED ALWAYS AS (regexp_replace(upper(item), '[[:space:]-]'::text, ''::text, 'g'::text)) STORED,
    item_type text,
    ship_price numeric,
    box_weight numeric,
    box_length numeric,
    box_width numeric,
    box_height numeric,
    attr_purchased boolean,
    attr_stocking boolean,
    attr_component boolean,
    attr_lot_costing boolean,
    attr_ecommerce boolean,
    attr_drop_ship boolean,
    attr_sellable boolean,
    attr_manufactured boolean,
    record_source text DEFAULT 'ALERE'::text NOT NULL
);


--
-- Name: job_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.job_number_seq
    START WITH 1000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: manager_alert_resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_alert_resolutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_type text NOT NULL,
    reference_id text NOT NULL,
    resolved_by text NOT NULL,
    resolution text NOT NULL,
    resolved_at timestamp with time zone DEFAULT now()
);


--
-- Name: open_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_type text DEFAULT 'trac_vac'::text NOT NULL,
    sort_order integer DEFAULT 0,
    row_color text,
    part_number text,
    description text,
    customer text,
    sales_order text,
    wo_po_number text,
    to_ship integer,
    qty_pulled integer,
    date_entered text,
    deadline text,
    status text DEFAULT 'New'::text,
    store_bin text,
    update_store_bin text,
    wo_va_notes text,
    boxer text,
    picker text,
    info_enterer text,
    last_status_update text,
    box1 text,
    box2 text,
    box3 text,
    box4 text,
    dims text,
    weight_lbs text,
    ship_quote_1 text,
    ship_quote_2 text,
    ship_cost_3 text,
    ship_paid_4 text,
    chute_status text,
    chute_date text,
    bracket_adapter_status text,
    bracket_adapter_date text,
    holding_bin_chute text,
    holding_bin_status text,
    holding_bin_part text,
    holding_bin_date text,
    override text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    chute_bracket_last_updated timestamp with time zone,
    tracking_number text,
    waiting_on jsonb,
    backordered boolean DEFAULT false NOT NULL
);


--
-- Name: open_orders_completed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_orders_completed (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_id uuid,
    order_type text,
    sort_order integer,
    row_color text,
    part_number text,
    description text,
    customer text,
    sales_order text,
    wo_po_number text,
    to_ship integer,
    qty_pulled integer,
    date_entered text,
    deadline text,
    status text DEFAULT 'Shipped'::text,
    store_bin text,
    update_store_bin text,
    wo_va_notes text,
    boxer text,
    picker text,
    info_enterer text,
    last_status_update text,
    box1 text,
    box2 text,
    box3 text,
    box4 text,
    dims text,
    weight_lbs text,
    ship_quote_1 text,
    ship_quote_2 text,
    ship_cost_3 text,
    ship_paid_4 text,
    chute_status text,
    chute_date text,
    bracket_adapter_status text,
    bracket_adapter_date text,
    holding_bin_chute text,
    holding_bin_status text,
    holding_bin_part text,
    holding_bin_date text,
    override text,
    chute_bracket_last_updated timestamp with time zone,
    shipped_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    tracking_number text,
    backordered boolean DEFAULT false NOT NULL,
    waiting_on jsonb
);


--
-- Name: part_approval_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_approval_defaults (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    part_number text NOT NULL,
    part_number_normalized text NOT NULL,
    fab text,
    fab_print text,
    weld text,
    weld_print text,
    assy_wo text,
    color text,
    bent_rolled_part boolean,
    source text DEFAULT 'manual_or_learned'::text,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);


--
-- Name: part_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    change_type text NOT NULL,
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    previous_part_number text,
    previous_part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM previous_part_number))) STORED,
    replacement_reason text,
    carry_forward_note text,
    use_previous_for_calcs boolean DEFAULT true NOT NULL,
    checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: part_manager_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_manager_notes (
    part_number_normalized text NOT NULL,
    part_number text,
    note text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: part_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    part_number text NOT NULL,
    part_number_normalized text GENERATED ALWAYS AS (upper(TRIM(BOTH FROM part_number))) STORED,
    wo_status_note text,
    wo_status_note_date date,
    wo_status_note_by text,
    wo_production_note text,
    wo_production_note_date date,
    wo_production_note_by text,
    purchaser_note text,
    purchaser_note_date date,
    purchaser_note_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: part_on_hand; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_on_hand (
    part_number_normalized text NOT NULL,
    on_hand numeric DEFAULT 0 NOT NULL,
    counted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purchasing_order_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_order_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    purchasing_order_id uuid,
    event_type text,
    note text,
    old_status text,
    new_status text,
    created_by text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchasing_order_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_order_quotes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    purchasing_order_id uuid,
    sort_order integer DEFAULT 1 NOT NULL,
    supplier_name text,
    qty numeric,
    price numeric,
    lead_time text,
    shipping_price numeric,
    terms text,
    quote_ref text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchasing_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    request_type text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    requested_by text,
    date_requested date DEFAULT CURRENT_DATE,
    needed_by date,
    part_number text,
    sales_order text,
    wo_number text,
    job_number integer,
    description text,
    qty_needed numeric,
    estimated_qty_in_stock numeric,
    current_production_run text,
    request_location text,
    bin_location text,
    requester_notes text,
    production_notes text,
    supplier_name text,
    supplier_part_number text,
    po_number text,
    estimated_lead_time numeric,
    expected_date date,
    qty_ordered numeric,
    purchaser_notes text,
    purchaser_questions text,
    qty_received numeric DEFAULT 0,
    received_at timestamp with time zone,
    received_by text,
    supply_category text,
    supply_item_name text,
    material_type text,
    material_size text,
    material_thickness text,
    material_length text,
    material_grade text,
    steel_shape text,
    last_status_update timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    material_finish text,
    cost numeric,
    ship_to text,
    rfq_suppliers text,
    rfq_received_from text,
    steel_quotes jsonb DEFAULT '[]'::jsonb,
    date_ordered date,
    forecasted boolean DEFAULT false NOT NULL,
    forecast_revisit_date date,
    forecast_reason text,
    price_each numeric,
    CONSTRAINT purchasing_orders_request_type_check CHECK ((request_type = ANY (ARRAY['part'::text, 'supply'::text, 'steel'::text])))
);


--
-- Name: purchasing_quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_quote_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    quote_id uuid,
    purchasing_order_id uuid,
    qty numeric,
    price numeric,
    lead_time text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchasing_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_quotes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    supplier_name text,
    quote_ref text,
    terms text,
    shipping_price numeric,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: purchasing_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchasing_suppliers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    coid text NOT NULL,
    coid_normalized text NOT NULL,
    terms text,
    our_account_number text,
    poto_id text,
    poto_location text,
    dist_id text,
    company_name text,
    location_id text,
    street text,
    city text,
    state text,
    zip text,
    contact text,
    phone text,
    title text,
    email text,
    remit_id text,
    remit_location text,
    is_remit boolean,
    is_pay_to boolean,
    is_main_location boolean,
    active boolean,
    recv_via text,
    recv_fob text,
    recv_location text,
    tax_dist text,
    source text DEFAULT 'supplier_list_import'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_analysis_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_analysis_lines (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    sale_date date,
    docid text,
    linenum text,
    doctype text,
    item text NOT NULL,
    item_normalized text NOT NULL,
    trantype text,
    qty numeric DEFAULT 0,
    cost numeric,
    ourprice numeric,
    regprice numeric,
    descrip text,
    source text DEFAULT 'sales_analysis_import'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: travellers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.travellers (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: travellers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.travellers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.travellers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: wo_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wo_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    message text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: wo_progress_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wo_progress_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    work_order_id uuid,
    wo_number text NOT NULL,
    department text NOT NULL,
    stage text,
    operator_name text NOT NULL,
    action text NOT NULL,
    session_qty numeric DEFAULT 0,
    cumulative_qty_after numeric DEFAULT 0,
    reason text,
    created_at timestamp with time zone DEFAULT now(),
    job_number integer,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_minutes integer,
    end_status text,
    unit_number integer,
    unit_serial_number text,
    engine_model text,
    engine_serial_number text,
    num_blades integer,
    unit_notes text,
    completed_at timestamp with time zone
);


--
-- Name: wo_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wo_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    part_number text NOT NULL,
    description text,
    sales_order_number text,
    qty_on_order numeric,
    qty_in_stock numeric,
    qty_used_per_unit numeric,
    request_date date,
    submitted_by text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    alere_qty numeric,
    alere_bin text,
    qty_sold_used_12mo numeric,
    where_used text,
    qty_to_make numeric,
    fab text,
    fab_print text,
    weld text,
    weld_print text,
    assy_wo text,
    color text,
    bent_rolled_part boolean,
    set_up_time numeric,
    estimated_lead_time numeric,
    sent_to_production boolean DEFAULT false,
    date_to_start date,
    alere_wo_number text,
    created_by_initials text,
    created_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    forecasted boolean DEFAULT false,
    forecast_date text,
    forecast_reason text,
    production_notes text,
    qty_used_in_mfg numeric,
    qty_made_past_12mo numeric,
    qty_sold_parent_usage_period numeric,
    traveller_id bigint,
    parent_request_id uuid,
    subpart_plans jsonb,
    job_number integer,
    staging_area text,
    status_notes text,
    on_hold boolean DEFAULT false NOT NULL,
    is_assembly boolean DEFAULT false NOT NULL,
    forecasted_at date
);


--
-- Name: wo_status_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wo_status_tracking (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    wo_number text,
    part_number text,
    description text,
    qty_required numeric DEFAULT 0,
    assy_received_status text,
    location text,
    spot_count numeric DEFAULT 0,
    spot_check_name text,
    spot_check_match text,
    erp_status text DEFAULT 'open'::text,
    closed_by text,
    completed_info text,
    closed_at timestamp with time zone,
    received_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    qty_received numeric,
    received_by text,
    alere_bin_update_needed boolean DEFAULT false,
    alere_bin_updated_at timestamp with time zone,
    alere_bin_updated_by text,
    closeout_notes text,
    job_number integer
);


--
-- Name: work_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    sales_order text,
    wo_number text,
    part_number text,
    description text,
    qty_required numeric DEFAULT 0,
    department text,
    status text DEFAULT 'not_started'::text,
    qty_completed numeric DEFAULT 0,
    operator text,
    start_date timestamp with time zone,
    comp_date timestamp with time zone,
    due_date timestamp with time zone,
    priority numeric DEFAULT 0,
    notes text,
    unit_serial_number text,
    engine_model text,
    engine_serial_number text,
    num_blades text,
    customer text,
    wo_type text,
    tc_pre_lap_status text,
    tc_pre_lap_operator text,
    tc_final_status text,
    tc_final_operator text,
    tv_engine_status text,
    tv_cart_status text,
    tv_final_status text,
    created_at timestamp with time zone DEFAULT now(),
    manager_notes text,
    tv_job_mode text,
    tc_job_mode text,
    tv_engine_qty_completed numeric DEFAULT 0,
    tv_cart_qty_completed numeric DEFAULT 0,
    tv_final_qty_completed numeric DEFAULT 0,
    tc_pre_lap_qty_completed numeric DEFAULT 0,
    tc_final_qty_completed numeric DEFAULT 0,
    tc_assy_notes_differences_mods text,
    wo_problem_text text,
    wo_problem_status text DEFAULT 'open'::text,
    wo_problem_updated_at timestamp with time zone,
    wo_problem_updated_by text,
    wo_problem_resolution text,
    assigned_operator text,
    tv_assy_notes text,
    fab_bring_to text,
    updated_at timestamp with time zone DEFAULT now(),
    weld_reel_status text,
    grind_reel_status text,
    weld_reel_operator text,
    grind_reel_operator text,
    weld_reel_qty integer DEFAULT 0,
    grind_reel_qty integer DEFAULT 0,
    production_notes text,
    traveller_id bigint,
    job_number integer,
    wo_request_id uuid,
    staging_area text,
    alere_bin text,
    wo_problem_reported_by text,
    wo_problem_reported_at timestamp with time zone,
    CONSTRAINT work_orders_tc_job_mode_check CHECK ((tc_job_mode = ANY (ARRAY['unit'::text, 'stock'::text]))),
    CONSTRAINT work_orders_tv_job_mode_check CHECK ((tv_job_mode = ANY (ARRAY['unit'::text, 'stock'::text])))
);


--
-- Name: app_pins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_pins ALTER COLUMN id SET DEFAULT nextval('public.app_pins_id_seq'::regclass);


--
-- Name: all_boms all_boms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.all_boms
    ADD CONSTRAINT all_boms_pkey PRIMARY KEY (id);


--
-- Name: app_pins app_pins_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_name_key UNIQUE (name);


--
-- Name: app_pins app_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_pins
    ADD CONSTRAINT app_pins_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: open_orders_completed completed_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_orders_completed
    ADD CONSTRAINT completed_orders_pkey PRIMARY KEY (id);


--
-- Name: completed_work_orders completed_work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completed_work_orders
    ADD CONSTRAINT completed_work_orders_pkey PRIMARY KEY (id);


--
-- Name: direct_messages direct_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);


--
-- Name: eng_inquiries_completed eng_inquiries_completed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eng_inquiries_completed
    ADD CONSTRAINT eng_inquiries_completed_pkey PRIMARY KEY (id);


--
-- Name: eng_inquiries eng_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eng_inquiries
    ADD CONSTRAINT eng_inquiries_pkey PRIMARY KEY (id);


--
-- Name: engineering_followup_events engineering_followup_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engineering_followup_events
    ADD CONSTRAINT engineering_followup_events_pkey PRIMARY KEY (id);


--
-- Name: engineering_followups engineering_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engineering_followups
    ADD CONSTRAINT engineering_followups_pkey PRIMARY KEY (id);


--
-- Name: issues_receipts issues_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.issues_receipts
    ADD CONSTRAINT issues_receipts_pkey PRIMARY KEY (id);


--
-- Name: item_master item_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_master
    ADD CONSTRAINT item_master_pkey PRIMARY KEY (id);


--
-- Name: manager_alert_resolutions manager_alert_resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_alert_resolutions
    ADD CONSTRAINT manager_alert_resolutions_pkey PRIMARY KEY (id);


--
-- Name: open_orders open_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_orders
    ADD CONSTRAINT open_orders_pkey PRIMARY KEY (id);


--
-- Name: part_approval_defaults part_approval_defaults_part_number_normalized_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_approval_defaults
    ADD CONSTRAINT part_approval_defaults_part_number_normalized_key UNIQUE (part_number_normalized);


--
-- Name: part_approval_defaults part_approval_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_approval_defaults
    ADD CONSTRAINT part_approval_defaults_pkey PRIMARY KEY (id);


--
-- Name: part_changes part_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_changes
    ADD CONSTRAINT part_changes_pkey PRIMARY KEY (id);


--
-- Name: part_manager_notes part_manager_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_manager_notes
    ADD CONSTRAINT part_manager_notes_pkey PRIMARY KEY (part_number_normalized);


--
-- Name: part_notes part_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_notes
    ADD CONSTRAINT part_notes_pkey PRIMARY KEY (id);


--
-- Name: part_on_hand part_on_hand_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_on_hand
    ADD CONSTRAINT part_on_hand_pkey PRIMARY KEY (part_number_normalized);


--
-- Name: purchasing_order_events purchasing_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_order_events
    ADD CONSTRAINT purchasing_order_events_pkey PRIMARY KEY (id);


--
-- Name: purchasing_order_quotes purchasing_order_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_order_quotes
    ADD CONSTRAINT purchasing_order_quotes_pkey PRIMARY KEY (id);


--
-- Name: purchasing_orders purchasing_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_orders
    ADD CONSTRAINT purchasing_orders_pkey PRIMARY KEY (id);


--
-- Name: purchasing_quote_items purchasing_quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_quote_items
    ADD CONSTRAINT purchasing_quote_items_pkey PRIMARY KEY (id);


--
-- Name: purchasing_quotes purchasing_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_quotes
    ADD CONSTRAINT purchasing_quotes_pkey PRIMARY KEY (id);


--
-- Name: purchasing_suppliers purchasing_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_suppliers
    ADD CONSTRAINT purchasing_suppliers_pkey PRIMARY KEY (id);


--
-- Name: sales_analysis_lines sales_analysis_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_analysis_lines
    ADD CONSTRAINT sales_analysis_lines_pkey PRIMARY KEY (id);


--
-- Name: travellers travellers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.travellers
    ADD CONSTRAINT travellers_pkey PRIMARY KEY (id);


--
-- Name: wo_errors wo_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_errors
    ADD CONSTRAINT wo_errors_pkey PRIMARY KEY (id);


--
-- Name: wo_progress_events wo_progress_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_progress_events
    ADD CONSTRAINT wo_progress_events_pkey PRIMARY KEY (id);


--
-- Name: wo_requests wo_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_requests
    ADD CONSTRAINT wo_requests_pkey PRIMARY KEY (id);


--
-- Name: wo_status_tracking wo_status_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_status_tracking
    ADD CONSTRAINT wo_status_tracking_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_pkey PRIMARY KEY (id);


--
-- Name: work_orders work_orders_wo_number_department_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_wo_number_department_unique UNIQUE (wo_number, department);


--
-- Name: dm_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dm_recipient_idx ON public.direct_messages USING btree (recipient_role, created_at DESC);


--
-- Name: dm_thread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dm_thread_idx ON public.direct_messages USING btree (sender_role, recipient_role, created_at);


--
-- Name: idx_alert_res_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_res_lookup ON public.manager_alert_resolutions USING btree (alert_type, reference_id, resolved_at DESC);


--
-- Name: idx_all_boms_child_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_all_boms_child_norm ON public.all_boms USING btree (item_child_normalized);


--
-- Name: idx_all_boms_parent_child_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_all_boms_parent_child_unique ON public.all_boms USING btree (item_parent_normalized, item_child_normalized);


--
-- Name: idx_all_boms_parent_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_all_boms_parent_norm ON public.all_boms USING btree (item_parent_normalized);


--
-- Name: idx_cwo_comp_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cwo_comp_date ON public.completed_work_orders USING btree (comp_date DESC);


--
-- Name: idx_cwo_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cwo_department ON public.completed_work_orders USING btree (department);


--
-- Name: idx_cwo_part_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cwo_part_number ON public.completed_work_orders USING btree (part_number);


--
-- Name: idx_cwo_wo_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cwo_wo_number ON public.completed_work_orders USING btree (wo_number);


--
-- Name: idx_issrec_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issrec_batch ON public.issues_receipts USING btree (import_batch_id);


--
-- Name: idx_issrec_native_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_issrec_native_event_key ON public.issues_receipts USING btree (native_event_key);


--
-- Name: idx_issrec_part_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issrec_part_date ON public.issues_receipts USING btree (part_number_normalized, txn_date);


--
-- Name: idx_issrec_part_doctype_tran_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issrec_part_doctype_tran_date ON public.issues_receipts USING btree (part_number_normalized, doctype, trantype, txn_date);


--
-- Name: idx_issrec_source_row_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_issrec_source_row_unique ON public.issues_receipts USING btree (source_file_name, source_row_number) WHERE ((source_file_name IS NOT NULL) AND (source_row_number IS NOT NULL));


--
-- Name: idx_issues_receipts_part_txn_poto; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_issues_receipts_part_txn_poto ON public.issues_receipts USING btree (part_number, txn_date DESC, poto);


--
-- Name: idx_item_master_item_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_master_item_norm ON public.item_master USING btree (item_normalized);


--
-- Name: idx_item_master_item_squashed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_master_item_squashed ON public.item_master USING btree (item_squashed);


--
-- Name: idx_item_master_store_bin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_master_store_bin ON public.item_master USING btree (item_normalized, store, bin);


--
-- Name: idx_part_approval_defaults_part_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_approval_defaults_part_norm ON public.part_approval_defaults USING btree (part_number_normalized);


--
-- Name: idx_part_changes_part_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_changes_part_norm ON public.part_changes USING btree (part_number_normalized);


--
-- Name: idx_part_changes_prev_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_changes_prev_norm ON public.part_changes USING btree (previous_part_number_normalized);


--
-- Name: idx_part_changes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_part_changes_status ON public.part_changes USING btree (status);


--
-- Name: idx_part_notes_part_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_part_notes_part_norm ON public.part_notes USING btree (part_number_normalized);


--
-- Name: idx_po_quotes_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_quotes_order_id ON public.purchasing_order_quotes USING btree (purchasing_order_id);


--
-- Name: idx_pq_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pq_items_order_id ON public.purchasing_quote_items USING btree (purchasing_order_id);


--
-- Name: idx_pq_items_quote_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pq_items_quote_id ON public.purchasing_quote_items USING btree (quote_id);


--
-- Name: idx_purchasing_events_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_events_order_id ON public.purchasing_order_events USING btree (purchasing_order_id);


--
-- Name: idx_purchasing_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_orders_created ON public.purchasing_orders USING btree (created_at DESC);


--
-- Name: idx_purchasing_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_orders_status ON public.purchasing_orders USING btree (status);


--
-- Name: idx_purchasing_orders_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_orders_type ON public.purchasing_orders USING btree (request_type);


--
-- Name: idx_purchasing_suppliers_coid_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_suppliers_coid_norm ON public.purchasing_suppliers USING btree (coid_normalized);


--
-- Name: idx_purchasing_suppliers_company_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchasing_suppliers_company_name ON public.purchasing_suppliers USING btree (company_name);


--
-- Name: idx_sales_analysis_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_analysis_date ON public.sales_analysis_lines USING btree (sale_date);


--
-- Name: idx_sales_analysis_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_analysis_filters ON public.sales_analysis_lines USING btree (item_normalized, doctype, trantype, sale_date);


--
-- Name: idx_sales_analysis_item_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_analysis_item_norm ON public.sales_analysis_lines USING btree (item_normalized);


--
-- Name: idx_wo_requests_job_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wo_requests_job_number ON public.wo_requests USING btree (job_number) WHERE (job_number IS NOT NULL);


--
-- Name: idx_wo_requests_traveller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wo_requests_traveller ON public.wo_requests USING btree (traveller_id);


--
-- Name: idx_work_orders_traveller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_traveller ON public.work_orders USING btree (traveller_id);


--
-- Name: idx_work_orders_wo_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_work_orders_wo_request_id ON public.work_orders USING btree (wo_request_id);


--
-- Name: wo_errors_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wo_errors_ts_idx ON public.wo_errors USING btree (ts DESC);


--
-- Name: sales_analysis_lines ignore_duplicate_sales_analysis; Type: RULE; Schema: public; Owner: -
--

CREATE RULE ignore_duplicate_sales_analysis AS
    ON INSERT TO public.sales_analysis_lines
   WHERE (EXISTS ( SELECT 1
           FROM public.sales_analysis_lines
          WHERE ((sales_analysis_lines.docid = new.docid) AND (sales_analysis_lines.linenum = new.linenum) AND (sales_analysis_lines.item_normalized = new.item_normalized) AND (sales_analysis_lines.sale_date = new.sale_date)))) DO INSTEAD NOTHING;


--
-- Name: issues_receipts trg_issrec_native_apply_onhand; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_issrec_native_apply_onhand AFTER INSERT ON public.issues_receipts FOR EACH ROW WHEN ((new.source = 'native'::text)) EXECUTE FUNCTION public.issrec_native_apply_onhand();


--
-- Name: issues_receipts trg_issrec_native_normalize; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_issrec_native_normalize BEFORE INSERT ON public.issues_receipts FOR EACH ROW WHEN ((new.source = 'native'::text)) EXECUTE FUNCTION public.issrec_native_normalize();


--
-- Name: purchasing_order_events purchasing_order_events_purchasing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_order_events
    ADD CONSTRAINT purchasing_order_events_purchasing_order_id_fkey FOREIGN KEY (purchasing_order_id) REFERENCES public.purchasing_orders(id) ON DELETE CASCADE;


--
-- Name: purchasing_order_quotes purchasing_order_quotes_purchasing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_order_quotes
    ADD CONSTRAINT purchasing_order_quotes_purchasing_order_id_fkey FOREIGN KEY (purchasing_order_id) REFERENCES public.purchasing_orders(id) ON DELETE CASCADE;


--
-- Name: purchasing_quote_items purchasing_quote_items_purchasing_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_quote_items
    ADD CONSTRAINT purchasing_quote_items_purchasing_order_id_fkey FOREIGN KEY (purchasing_order_id) REFERENCES public.purchasing_orders(id) ON DELETE SET NULL;


--
-- Name: purchasing_quote_items purchasing_quote_items_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchasing_quote_items
    ADD CONSTRAINT purchasing_quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.purchasing_quotes(id) ON DELETE CASCADE;


--
-- Name: wo_requests wo_requests_parent_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_requests
    ADD CONSTRAINT wo_requests_parent_request_id_fkey FOREIGN KEY (parent_request_id) REFERENCES public.wo_requests(id) ON DELETE CASCADE;


--
-- Name: wo_requests wo_requests_traveller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wo_requests
    ADD CONSTRAINT wo_requests_traveller_id_fkey FOREIGN KEY (traveller_id) REFERENCES public.travellers(id);


--
-- Name: work_orders work_orders_traveller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_traveller_id_fkey FOREIGN KEY (traveller_id) REFERENCES public.travellers(id);


--
-- Name: work_orders work_orders_wo_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_orders
    ADD CONSTRAINT work_orders_wo_request_id_fkey FOREIGN KEY (wo_request_id) REFERENCES public.wo_requests(id);


--
-- Name: all_boms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.all_boms ENABLE ROW LEVEL SECURITY;

--
-- Name: travellers allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "allow all" ON public.travellers USING (true) WITH CHECK (true);


--
-- Name: open_orders_completed allow_all_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_all_roles ON public.open_orders_completed USING (true) WITH CHECK (true);


--
-- Name: open_orders allow_delete_open_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_delete_open_orders ON public.open_orders FOR DELETE TO authenticated, anon USING (true);


--
-- Name: open_orders allow_insert_open_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_insert_open_orders ON public.open_orders FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: open_orders allow_select_open_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_select_open_orders ON public.open_orders FOR SELECT TO authenticated, anon USING (true);


--
-- Name: open_orders allow_update_open_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY allow_update_open_orders ON public.open_orders FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: app_pins anon can read pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon can read pins" ON public.app_pins FOR SELECT TO authenticated, anon USING (true);


--
-- Name: purchasing_order_quotes anon delete purchasing_order_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon delete purchasing_order_quotes" ON public.purchasing_order_quotes FOR DELETE TO authenticated, anon USING (true);


--
-- Name: engineering_followup_events anon insert followup events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon insert followup events" ON public.engineering_followup_events FOR INSERT WITH CHECK (true);


--
-- Name: engineering_followups anon insert followups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon insert followups" ON public.engineering_followups FOR INSERT WITH CHECK (true);


--
-- Name: part_approval_defaults anon insert part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon insert part_approval_defaults" ON public.part_approval_defaults FOR INSERT TO anon WITH CHECK (true);


--
-- Name: purchasing_order_quotes anon insert purchasing_order_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon insert purchasing_order_quotes" ON public.purchasing_order_quotes FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: engineering_followup_events anon read followup events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon read followup events" ON public.engineering_followup_events FOR SELECT USING (true);


--
-- Name: engineering_followups anon read followups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon read followups" ON public.engineering_followups FOR SELECT USING (true);


--
-- Name: app_settings anon read/write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon read/write" ON public.app_settings TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: part_approval_defaults anon select part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon select part_approval_defaults" ON public.part_approval_defaults FOR SELECT TO anon USING (true);


--
-- Name: purchasing_order_quotes anon select purchasing_order_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon select purchasing_order_quotes" ON public.purchasing_order_quotes FOR SELECT TO authenticated, anon USING (true);


--
-- Name: engineering_followups anon update followups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon update followups" ON public.engineering_followups FOR UPDATE USING (true);


--
-- Name: part_approval_defaults anon update part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon update part_approval_defaults" ON public.part_approval_defaults FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: purchasing_order_quotes anon update purchasing_order_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "anon update purchasing_order_quotes" ON public.purchasing_order_quotes FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: all_boms anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.all_boms TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: app_pins anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.app_pins TO anon USING (true) WITH CHECK (true);


--
-- Name: eng_inquiries anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.eng_inquiries TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: eng_inquiries_completed anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.eng_inquiries_completed TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: engineering_followup_events anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.engineering_followup_events TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: engineering_followups anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.engineering_followups TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: manager_alert_resolutions anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.manager_alert_resolutions TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: open_orders_completed anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.open_orders_completed TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: purchasing_order_events anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.purchasing_order_events TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: purchasing_orders anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.purchasing_orders TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: purchasing_suppliers anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.purchasing_suppliers TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: sales_analysis_lines anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.sales_analysis_lines TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: travellers anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_all ON public.travellers TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: wo_requests anon_delete_wo_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_delete_wo_requests ON public.wo_requests FOR DELETE TO authenticated, anon USING (true);


--
-- Name: work_orders anon_delete_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_delete_work_orders ON public.work_orders FOR DELETE TO authenticated, anon USING (true);


--
-- Name: completed_work_orders anon_insert_completed_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_completed_work_orders ON public.completed_work_orders FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: wo_errors anon_insert_wo_errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_wo_errors ON public.wo_errors FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: wo_progress_events anon_insert_wo_progress_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_wo_progress_events ON public.wo_progress_events FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: wo_requests anon_insert_wo_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_wo_requests ON public.wo_requests FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: wo_status_tracking anon_insert_wo_status_tracking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_wo_status_tracking ON public.wo_status_tracking FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: work_orders anon_insert_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_work_orders ON public.work_orders FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: completed_work_orders anon_select_completed_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_completed_work_orders ON public.completed_work_orders FOR SELECT TO authenticated, anon USING (true);


--
-- Name: wo_errors anon_select_wo_errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_wo_errors ON public.wo_errors FOR SELECT TO authenticated, anon USING (true);


--
-- Name: wo_requests anon_select_wo_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_wo_requests ON public.wo_requests FOR SELECT TO authenticated, anon USING (true);


--
-- Name: wo_status_tracking anon_select_wo_status_tracking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_wo_status_tracking ON public.wo_status_tracking FOR SELECT TO authenticated, anon USING (true);


--
-- Name: work_orders anon_select_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_work_orders ON public.work_orders FOR SELECT TO authenticated, anon USING (true);


--
-- Name: wo_progress_events anon_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update ON public.wo_progress_events FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: wo_requests anon_update_wo_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_wo_requests ON public.wo_requests FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: wo_status_tracking anon_update_wo_status_tracking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_wo_status_tracking ON public.wo_status_tracking FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: work_orders anon_update_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_work_orders ON public.work_orders FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: app_pins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_pins ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_pins auth_all_app_pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_app_pins ON public.app_pins TO authenticated USING (true) WITH CHECK (true);


--
-- Name: direct_messages auth_all_direct_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_direct_messages ON public.direct_messages TO authenticated USING (true) WITH CHECK (true);


--
-- Name: eng_inquiries auth_all_eng_inquiries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_eng_inquiries ON public.eng_inquiries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: engineering_followup_events auth_all_engineering_followup_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_engineering_followup_events ON public.engineering_followup_events TO authenticated USING (true) WITH CHECK (true);


--
-- Name: engineering_followups auth_all_engineering_followups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_engineering_followups ON public.engineering_followups TO authenticated USING (true) WITH CHECK (true);


--
-- Name: manager_alert_resolutions auth_all_manager_alert_resolutions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_manager_alert_resolutions ON public.manager_alert_resolutions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: open_orders auth_all_open_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_open_orders ON public.open_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchasing_order_events auth_all_purchasing_order_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_purchasing_order_events ON public.purchasing_order_events TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchasing_order_quotes auth_all_purchasing_order_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_purchasing_order_quotes ON public.purchasing_order_quotes TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchasing_orders auth_all_purchasing_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_purchasing_orders ON public.purchasing_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchasing_quote_items auth_all_purchasing_quote_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_purchasing_quote_items ON public.purchasing_quote_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchasing_quotes auth_all_purchasing_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_purchasing_quotes ON public.purchasing_quotes TO authenticated USING (true) WITH CHECK (true);


--
-- Name: wo_errors auth_all_wo_errors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_wo_errors ON public.wo_errors TO authenticated USING (true) WITH CHECK (true);


--
-- Name: wo_progress_events auth_all_wo_progress_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_wo_progress_events ON public.wo_progress_events TO authenticated USING (true) WITH CHECK (true);


--
-- Name: wo_requests auth_all_wo_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_wo_requests ON public.wo_requests TO authenticated USING (true) WITH CHECK (true);


--
-- Name: wo_status_tracking auth_all_wo_status_tracking; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_wo_status_tracking ON public.wo_status_tracking TO authenticated USING (true) WITH CHECK (true);


--
-- Name: work_orders auth_all_work_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_all_work_orders ON public.work_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: part_approval_defaults authenticated insert part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated insert part_approval_defaults" ON public.part_approval_defaults FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: part_approval_defaults authenticated select part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated select part_approval_defaults" ON public.part_approval_defaults FOR SELECT TO authenticated USING (true);


--
-- Name: part_approval_defaults authenticated update part_approval_defaults; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated update part_approval_defaults" ON public.part_approval_defaults FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: completed_work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.completed_work_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_messages dm_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dm_insert ON public.direct_messages FOR INSERT TO authenticated WITH CHECK ((sender_role = ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)));


--
-- Name: direct_messages dm_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dm_select ON public.direct_messages FOR SELECT TO authenticated USING (((sender_role = ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)) OR (recipient_role = ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text))));


--
-- Name: direct_messages dm_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dm_update ON public.direct_messages FOR UPDATE TO authenticated USING ((recipient_role = ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text)));


--
-- Name: eng_inquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.eng_inquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: eng_inquiries eng_inquiries_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY eng_inquiries_all ON public.eng_inquiries USING (true) WITH CHECK (true);


--
-- Name: eng_inquiries_completed; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.eng_inquiries_completed ENABLE ROW LEVEL SECURITY;

--
-- Name: engineering_followup_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engineering_followup_events ENABLE ROW LEVEL SECURITY;

--
-- Name: engineering_followups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engineering_followups ENABLE ROW LEVEL SECURITY;

--
-- Name: issues_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.issues_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: issues_receipts issues_receipts_native_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issues_receipts_native_insert ON public.issues_receipts FOR INSERT TO authenticated, anon WITH CHECK (((source = 'native'::text) AND (txn_date >= public.native_cutover()) AND (txn_date <= (CURRENT_DATE + 1)) AND (doctype = ANY (ARRAY['MO'::text, 'SO'::text, 'PO'::text])) AND (trantype = ANY (ARRAY['I'::text, 'O'::text, 'S'::text])) AND (qty IS NOT NULL) AND (qty <> (0)::numeric) AND (abs(qty) < (100000)::numeric) AND ((length(btrim(part_number)) >= 1) AND (length(btrim(part_number)) <= 100)) AND (length(COALESCE(docid, ''::text)) <= 50) AND (source_file_name IS NULL) AND (source_row_number IS NULL)));


--
-- Name: issues_receipts issues_receipts_native_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY issues_receipts_native_select ON public.issues_receipts FOR SELECT TO authenticated, anon USING ((source = 'native'::text));


--
-- Name: item_master; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.item_master ENABLE ROW LEVEL SECURITY;

--
-- Name: item_master item_master_anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY item_master_anon_all ON public.item_master TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: manager_alert_resolutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_alert_resolutions ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_quote_items open purchasing_quote_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "open purchasing_quote_items" ON public.purchasing_quote_items TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: purchasing_quotes open purchasing_quotes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "open purchasing_quotes" ON public.purchasing_quotes TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: open_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: open_orders_completed; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.open_orders_completed ENABLE ROW LEVEL SECURITY;

--
-- Name: part_approval_defaults; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.part_approval_defaults ENABLE ROW LEVEL SECURITY;

--
-- Name: part_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.part_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: part_changes part_changes_anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY part_changes_anon_all ON public.part_changes TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: part_manager_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.part_manager_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: part_manager_notes part_manager_notes_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY part_manager_notes_all ON public.part_manager_notes TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: part_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.part_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: part_notes part_notes_anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY part_notes_anon_all ON public.part_notes TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: part_on_hand; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.part_on_hand ENABLE ROW LEVEL SECURITY;

--
-- Name: part_on_hand part_on_hand_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY part_on_hand_select ON public.part_on_hand FOR SELECT TO authenticated, anon USING (true);


--
-- Name: purchasing_order_events public insert purchasing_order_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public insert purchasing_order_events" ON public.purchasing_order_events FOR INSERT WITH CHECK (true);


--
-- Name: purchasing_orders public insert purchasing_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public insert purchasing_orders" ON public.purchasing_orders FOR INSERT WITH CHECK (true);


--
-- Name: purchasing_order_events public select purchasing_order_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public select purchasing_order_events" ON public.purchasing_order_events FOR SELECT USING (true);


--
-- Name: purchasing_orders public select purchasing_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public select purchasing_orders" ON public.purchasing_orders FOR SELECT USING (true);


--
-- Name: purchasing_orders public update purchasing_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public update purchasing_orders" ON public.purchasing_orders FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: purchasing_order_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_order_events ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_order_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_order_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_quote_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_quote_items ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: purchasing_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchasing_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_analysis_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_analysis_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: travellers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.travellers ENABLE ROW LEVEL SECURITY;

--
-- Name: wo_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wo_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: wo_progress_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wo_progress_events ENABLE ROW LEVEL SECURITY;

--
-- Name: wo_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wo_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: wo_status_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wo_status_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: work_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION assign_job_number_if_missing(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assign_job_number_if_missing(p_request_id uuid) TO anon;
GRANT ALL ON FUNCTION public.assign_job_number_if_missing(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.assign_job_number_if_missing(p_request_id uuid) TO service_role;


--
-- Name: FUNCTION fetch_last_two_purchases_with_supplier(p_part_number text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fetch_last_two_purchases_with_supplier(p_part_number text) TO anon;
GRANT ALL ON FUNCTION public.fetch_last_two_purchases_with_supplier(p_part_number text) TO authenticated;
GRANT ALL ON FUNCTION public.fetch_last_two_purchases_with_supplier(p_part_number text) TO service_role;


--
-- Name: FUNCTION get_active_pos_for_part(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_pos_for_part(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_active_pos_for_part(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_pos_for_part(p_part text) TO service_role;


--
-- Name: FUNCTION get_active_wos_for_part(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_wos_for_part(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_active_wos_for_part(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_active_wos_for_part(p_part text) TO service_role;


--
-- Name: FUNCTION get_company_purchase_catalog(p_coid text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_company_purchase_catalog(p_coid text) TO anon;
GRANT ALL ON FUNCTION public.get_company_purchase_catalog(p_coid text) TO authenticated;
GRANT ALL ON FUNCTION public.get_company_purchase_catalog(p_coid text) TO service_role;


--
-- Name: FUNCTION get_part_bin_and_desc(p_parts text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_bin_and_desc(p_parts text[]) TO anon;
GRANT ALL ON FUNCTION public.get_part_bin_and_desc(p_parts text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_bin_and_desc(p_parts text[]) TO service_role;


--
-- Name: FUNCTION get_part_bin_locations(p_parts text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_bin_locations(p_parts text[]) TO anon;
GRANT ALL ON FUNCTION public.get_part_bin_locations(p_parts text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_bin_locations(p_parts text[]) TO service_role;


--
-- Name: FUNCTION get_part_description(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_description(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_description(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_description(p_part text) TO service_role;


--
-- Name: FUNCTION get_part_last_made(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_last_made(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_last_made(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_last_made(p_part text) TO service_role;


--
-- Name: FUNCTION get_part_purchased_12mo(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_purchased_12mo(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_purchased_12mo(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_purchased_12mo(p_part text) TO service_role;


--
-- Name: FUNCTION get_part_purchased_36mo(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_purchased_36mo(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_purchased_36mo(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_purchased_36mo(p_part text) TO service_role;


--
-- Name: FUNCTION get_part_usage_summary_12mo(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_usage_summary_12mo(p_part text) TO service_role;


--
-- Name: FUNCTION get_part_usage_summary_36mo(p_part text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_usage_summary_36mo(p_part text) TO service_role;


--
-- Name: FUNCTION get_parts_made_all_time(p_parts text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_parts_made_all_time(p_parts text[]) TO anon;
GRANT ALL ON FUNCTION public.get_parts_made_all_time(p_parts text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_made_all_time(p_parts text[]) TO service_role;


--
-- Name: FUNCTION get_parts_sold_in_period(p_parts text[], p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_parts_sold_in_period(p_parts text[], p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.get_parts_sold_in_period(p_parts text[], p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_sold_in_period(p_parts text[], p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION get_parts_usage_summary_batch(p_parts text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(p_parts text[]) TO anon;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(p_parts text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_usage_summary_batch(p_parts text[]) TO service_role;


--
-- Name: FUNCTION get_sales_analysis_sold(p_parts text[], p_start date, p_end date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_sales_analysis_sold(p_parts text[], p_start date, p_end date) TO anon;
GRANT ALL ON FUNCTION public.get_sales_analysis_sold(p_parts text[], p_start date, p_end date) TO authenticated;
GRANT ALL ON FUNCTION public.get_sales_analysis_sold(p_parts text[], p_start date, p_end date) TO service_role;


--
-- Name: FUNCTION import_inventory_count(p_part text, p_qty numeric, p_counted_by text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.import_inventory_count(p_part text, p_qty numeric, p_counted_by text) TO anon;
GRANT ALL ON FUNCTION public.import_inventory_count(p_part text, p_qty numeric, p_counted_by text) TO authenticated;
GRANT ALL ON FUNCTION public.import_inventory_count(p_part text, p_qty numeric, p_counted_by text) TO service_role;


--
-- Name: FUNCTION issrec_native_apply_onhand(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.issrec_native_apply_onhand() TO anon;
GRANT ALL ON FUNCTION public.issrec_native_apply_onhand() TO authenticated;
GRANT ALL ON FUNCTION public.issrec_native_apply_onhand() TO service_role;


--
-- Name: FUNCTION issrec_native_normalize(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.issrec_native_normalize() TO anon;
GRANT ALL ON FUNCTION public.issrec_native_normalize() TO authenticated;
GRANT ALL ON FUNCTION public.issrec_native_normalize() TO service_role;


--
-- Name: FUNCTION native_cutover(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.native_cutover() TO anon;
GRANT ALL ON FUNCTION public.native_cutover() TO authenticated;
GRANT ALL ON FUNCTION public.native_cutover() TO service_role;


--
-- Name: TABLE all_boms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.all_boms TO anon;
GRANT ALL ON TABLE public.all_boms TO authenticated;
GRANT ALL ON TABLE public.all_boms TO service_role;


--
-- Name: TABLE app_pins; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_pins TO anon;
GRANT ALL ON TABLE public.app_pins TO authenticated;
GRANT ALL ON TABLE public.app_pins TO service_role;


--
-- Name: SEQUENCE app_pins_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.app_pins_id_seq TO anon;
GRANT ALL ON SEQUENCE public.app_pins_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.app_pins_id_seq TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE completed_work_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.completed_work_orders TO anon;
GRANT ALL ON TABLE public.completed_work_orders TO authenticated;
GRANT ALL ON TABLE public.completed_work_orders TO service_role;


--
-- Name: TABLE direct_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.direct_messages TO anon;
GRANT ALL ON TABLE public.direct_messages TO authenticated;
GRANT ALL ON TABLE public.direct_messages TO service_role;


--
-- Name: TABLE eng_inquiries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.eng_inquiries TO anon;
GRANT ALL ON TABLE public.eng_inquiries TO authenticated;
GRANT ALL ON TABLE public.eng_inquiries TO service_role;


--
-- Name: TABLE eng_inquiries_completed; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.eng_inquiries_completed TO anon;
GRANT ALL ON TABLE public.eng_inquiries_completed TO authenticated;
GRANT ALL ON TABLE public.eng_inquiries_completed TO service_role;


--
-- Name: TABLE engineering_followup_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.engineering_followup_events TO anon;
GRANT ALL ON TABLE public.engineering_followup_events TO authenticated;
GRANT ALL ON TABLE public.engineering_followup_events TO service_role;


--
-- Name: TABLE engineering_followups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.engineering_followups TO anon;
GRANT ALL ON TABLE public.engineering_followups TO authenticated;
GRANT ALL ON TABLE public.engineering_followups TO service_role;


--
-- Name: TABLE issues_receipts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.issues_receipts TO service_role;
GRANT INSERT ON TABLE public.issues_receipts TO anon;
GRANT INSERT ON TABLE public.issues_receipts TO authenticated;


--
-- Name: COLUMN issues_receipts.native_event_key; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(native_event_key) ON TABLE public.issues_receipts TO anon;
GRANT SELECT(native_event_key) ON TABLE public.issues_receipts TO authenticated;


--
-- Name: TABLE item_master; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.item_master TO anon;
GRANT ALL ON TABLE public.item_master TO authenticated;
GRANT ALL ON TABLE public.item_master TO service_role;


--
-- Name: SEQUENCE job_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.job_number_seq TO anon;
GRANT ALL ON SEQUENCE public.job_number_seq TO authenticated;
GRANT ALL ON SEQUENCE public.job_number_seq TO service_role;


--
-- Name: TABLE manager_alert_resolutions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_alert_resolutions TO anon;
GRANT ALL ON TABLE public.manager_alert_resolutions TO authenticated;
GRANT ALL ON TABLE public.manager_alert_resolutions TO service_role;


--
-- Name: TABLE open_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.open_orders TO anon;
GRANT ALL ON TABLE public.open_orders TO authenticated;
GRANT ALL ON TABLE public.open_orders TO service_role;


--
-- Name: TABLE open_orders_completed; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.open_orders_completed TO anon;
GRANT ALL ON TABLE public.open_orders_completed TO authenticated;
GRANT ALL ON TABLE public.open_orders_completed TO service_role;


--
-- Name: TABLE part_approval_defaults; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.part_approval_defaults TO anon;
GRANT ALL ON TABLE public.part_approval_defaults TO authenticated;
GRANT ALL ON TABLE public.part_approval_defaults TO service_role;


--
-- Name: TABLE part_changes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.part_changes TO anon;
GRANT ALL ON TABLE public.part_changes TO authenticated;
GRANT ALL ON TABLE public.part_changes TO service_role;


--
-- Name: TABLE part_manager_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.part_manager_notes TO anon;
GRANT ALL ON TABLE public.part_manager_notes TO authenticated;
GRANT ALL ON TABLE public.part_manager_notes TO service_role;


--
-- Name: TABLE part_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.part_notes TO anon;
GRANT ALL ON TABLE public.part_notes TO authenticated;
GRANT ALL ON TABLE public.part_notes TO service_role;


--
-- Name: TABLE part_on_hand; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.part_on_hand TO anon;
GRANT ALL ON TABLE public.part_on_hand TO authenticated;
GRANT ALL ON TABLE public.part_on_hand TO service_role;


--
-- Name: TABLE purchasing_order_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_order_events TO anon;
GRANT ALL ON TABLE public.purchasing_order_events TO authenticated;
GRANT ALL ON TABLE public.purchasing_order_events TO service_role;


--
-- Name: TABLE purchasing_order_quotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_order_quotes TO anon;
GRANT ALL ON TABLE public.purchasing_order_quotes TO authenticated;
GRANT ALL ON TABLE public.purchasing_order_quotes TO service_role;


--
-- Name: TABLE purchasing_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_orders TO anon;
GRANT ALL ON TABLE public.purchasing_orders TO authenticated;
GRANT ALL ON TABLE public.purchasing_orders TO service_role;


--
-- Name: TABLE purchasing_quote_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_quote_items TO anon;
GRANT ALL ON TABLE public.purchasing_quote_items TO authenticated;
GRANT ALL ON TABLE public.purchasing_quote_items TO service_role;


--
-- Name: TABLE purchasing_quotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_quotes TO anon;
GRANT ALL ON TABLE public.purchasing_quotes TO authenticated;
GRANT ALL ON TABLE public.purchasing_quotes TO service_role;


--
-- Name: TABLE purchasing_suppliers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.purchasing_suppliers TO anon;
GRANT ALL ON TABLE public.purchasing_suppliers TO authenticated;
GRANT ALL ON TABLE public.purchasing_suppliers TO service_role;


--
-- Name: TABLE sales_analysis_lines; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sales_analysis_lines TO anon;
GRANT ALL ON TABLE public.sales_analysis_lines TO authenticated;
GRANT ALL ON TABLE public.sales_analysis_lines TO service_role;


--
-- Name: TABLE travellers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.travellers TO anon;
GRANT ALL ON TABLE public.travellers TO authenticated;
GRANT ALL ON TABLE public.travellers TO service_role;


--
-- Name: SEQUENCE travellers_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.travellers_id_seq TO anon;
GRANT ALL ON SEQUENCE public.travellers_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.travellers_id_seq TO service_role;


--
-- Name: TABLE wo_errors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wo_errors TO anon;
GRANT ALL ON TABLE public.wo_errors TO authenticated;
GRANT ALL ON TABLE public.wo_errors TO service_role;


--
-- Name: TABLE wo_progress_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wo_progress_events TO anon;
GRANT ALL ON TABLE public.wo_progress_events TO authenticated;
GRANT ALL ON TABLE public.wo_progress_events TO service_role;


--
-- Name: TABLE wo_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wo_requests TO anon;
GRANT ALL ON TABLE public.wo_requests TO authenticated;
GRANT ALL ON TABLE public.wo_requests TO service_role;


--
-- Name: TABLE wo_status_tracking; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wo_status_tracking TO anon;
GRANT ALL ON TABLE public.wo_status_tracking TO authenticated;
GRANT ALL ON TABLE public.wo_status_tracking TO service_role;


--
-- Name: TABLE work_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.work_orders TO anon;
GRANT ALL ON TABLE public.work_orders TO authenticated;
GRANT ALL ON TABLE public.work_orders TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

