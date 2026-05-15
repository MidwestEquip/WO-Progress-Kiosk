// ============================================================
// libs/db-purchasing.js — Purchasing order DB operations
//
// All purchasing_orders and purchasing_order_events CRUD.
// Imported and re-exported by db.js.
// ============================================================

import { supabase } from './db-shared.js';

// fetchPurchasingOrders — all active (non-completed) orders, newest first.
// Returns { data, error }
export async function fetchPurchasingOrders() {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .select('*')
        .not('status', 'in', '("received","canceled")')
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// fetchCompletedPurchasingOrders — received/canceled orders, newest first.
// fromDate/toDate filter on completed_at (optional YYYY-MM-DD strings).
// Returns { data, error }
export async function fetchCompletedPurchasingOrders(fromDate, toDate) {
    let q = supabase
        .from('purchasing_orders')
        .select('*')
        .in('status', ['received', 'canceled'])
        .order('completed_at', { ascending: false })
        .limit(500);
    if (fromDate) q = q.gte('completed_at', fromDate);
    if (toDate)   q = q.lte('completed_at', toDate + 'T23:59:59');
    const { data, error } = await q;
    return { data: data || [], error };
}

// insertPurchasingOrder — create a new request. Returns { data, error }
export async function insertPurchasingOrder(fields) {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}

// updatePurchasingOrder — patch any subset of fields. Returns { data, error }
export async function updatePurchasingOrder(id, fields) {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// insertPurchasingEvent — append a history entry. Returns { data, error }
export async function insertPurchasingEvent({ orderId, eventType, note, oldStatus, newStatus, createdBy }) {
    const { data, error } = await supabase
        .from('purchasing_order_events')
        .insert({
            purchasing_order_id: orderId,
            event_type:          eventType || null,
            note:                note       || null,
            old_status:          oldStatus  || null,
            new_status:          newStatus  || null,
            created_by:          createdBy  || null,
        })
        .select()
        .single();
    return { data, error };
}

// fetchPurchasingEvents — history for one order, oldest first. Returns { data, error }
export async function fetchPurchasingEvents(orderId) {
    const { data, error } = await supabase
        .from('purchasing_order_events')
        .select('*')
        .eq('purchasing_order_id', orderId)
        .order('created_at', { ascending: true });
    return { data: data || [], error };
}

// ── Master quotes (cross-order) ───────────────────────────────

// fetchAllMasterQuotes — all purchasing quotes with line items + order details, newest first.
export async function fetchAllMasterQuotes() {
    const { data, error } = await supabase
        .from('purchasing_quotes')
        .select(`
            *,
            purchasing_quote_items (
                id, qty, price, lead_time,
                purchasing_orders ( id, request_type, part_number, supply_item_name,
                    material_type, steel_shape, material_grade, material_size,
                    material_thickness, description, qty_needed, status )
            )
        `)
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// insertMasterQuote — create a quote header. Returns { data, error }
export async function insertMasterQuote(fields) {
    const { data, error } = await supabase
        .from('purchasing_quotes')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}

// insertMasterQuoteItems — bulk insert line items. Returns { data, error }
export async function insertMasterQuoteItems(items) {
    const rows = items.map(i => ({ ...i, updated_at: new Date().toISOString() }));
    const { data, error } = await supabase
        .from('purchasing_quote_items')
        .insert(rows)
        .select();
    return { data: data || [], error };
}

// updateMasterQuote — patch quote header (e.g. status). Returns { data, error }
export async function updateMasterQuote(id, fields) {
    const { data, error } = await supabase
        .from('purchasing_quotes')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// fetchPurchasingQuotes — all quotes for one order, by sort_order. Returns { data, error }
export async function fetchPurchasingQuotes(orderId) {
    const { data, error } = await supabase
        .from('purchasing_order_quotes')
        .select('*')
        .eq('purchasing_order_id', orderId)
        .order('sort_order', { ascending: true });
    return { data: data || [], error };
}

// upsertPurchasingQuote — insert or update a single quote row. Returns { data, error }
export async function upsertPurchasingQuote(fields) {
    const { data, error } = await supabase
        .from('purchasing_order_quotes')
        .upsert({ ...fields, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select()
        .single();
    return { data, error };
}

// deletePurchasingQuote — remove a quote by id. Returns { error }
export async function deletePurchasingQuote(id) {
    const { error } = await supabase
        .from('purchasing_order_quotes')
        .delete()
        .eq('id', id);
    return { error };
}
