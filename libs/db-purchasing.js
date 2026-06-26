// ============================================================
// libs/db-purchasing.js — Purchasing order DB operations
//
// All purchasing_orders and purchasing_order_events CRUD.
// Imported and re-exported by db.js.
// ============================================================

import { supabase } from './db-shared.js';

// fetchActivePosForPart — active part-type POs (status not received/canceled) for a part,
// matched dash/space-insensitively via the get_active_pos_for_part RPC.
// Returns { data: [{ id, po_number, status }], error }.
export async function fetchActivePosForPart(partNumber) {
    const part = (partNumber || '').trim();
    if (!part) return { data: [], error: null };
    const { data, error } = await supabase.rpc('get_active_pos_for_part', { p_part: part });
    if (error) return { data: [], error };
    return { data: data || [], error: null };
}

// fetchPurchasingOrders — active ordering-stage orders (not forecasted), newest first.
// Returns { data, error }
export async function fetchPurchasingOrders() {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .select('*')
        .in('status', ['requested', 'quoting', 'quoted', 'approved', 'not_approved'])
        .eq('forecasted', false)
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// fetchPoReceiveOrders — open orders pending receipt (excludes received/canceled/forecasted).
// Returns { data, error }
export async function fetchPoReceiveOrders() {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .select('*')
        .not('status', 'in', '(received,canceled)')
        .eq('forecasted', false)
        .order('last_status_update', { ascending: false });
    return { data: data || [], error };
}

// fetchReceivedPoOrders — orders with status='received', newest first, cap 100.
// Returns { data, error }
export async function fetchReceivedPoOrders() {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .select('*')
        .eq('status', 'received')
        .order('received_at', { ascending: false })
        .limit(100);
    return { data: data || [], error };
}

// fetchCompletedPurchasingOrders — ordered/received/canceled orders, newest first.
// fromDate/toDate filter on last_status_update (optional YYYY-MM-DD strings).
// Returns { data, error }
export async function fetchCompletedPurchasingOrders(fromDate, toDate) {
    let q = supabase
        .from('purchasing_orders')
        .select('*')
        .in('status', ['ordered', 'partially_received', 'received', 'canceled'])
        .order('last_status_update', { ascending: false })
        .limit(500);
    if (fromDate) q = q.gte('last_status_update', fromDate);
    if (toDate)   q = q.lte('last_status_update', toDate + 'T23:59:59');
    const { data, error } = await q;
    return { data: data || [], error };
}

// fetchForecastedOrders — all orders with forecasted=true, newest first.
// Returns { data, error }
export async function fetchForecastedOrders() {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .select('*')
        .eq('forecasted', true)
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// deletePurchasingOrder — permanently delete an order by id. Returns { error }
export async function deletePurchasingOrder(id) {
    const { error } = await supabase
        .from('purchasing_orders')
        .delete()
        .eq('id', id);
    return { error };
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

// ── Order attachments (purchasing-attachments bucket) ─────────
// Path pattern: {order_id}/{filename}

// fetchOrderAttachments — list all files for an order with 1-hour signed URLs.
// Returns { data: [{ name, path, signedUrl }], error }
export async function fetchOrderAttachments(orderId) {
    const { data: files, error } = await supabase.storage
        .from('purchasing-attachments').list(orderId);
    if (error) return { data: [], error };
    const filtered = (files || []).filter(f => f.name !== '.emptyFolderPlaceholder');
    if (filtered.length === 0) return { data: [], error: null };
    const paths = filtered.map(f => `${orderId}/${f.name}`);
    const { data: signed } = await supabase.storage
        .from('purchasing-attachments').createSignedUrls(paths, 3600);
    return {
        data: filtered.map((f, i) => ({
            name:      f.name,
            path:      paths[i],
            signedUrl: signed?.[i]?.signedUrl || null,
        })),
        error: null,
    };
}

// uploadOrderAttachment — upload a file for an order. Returns { data, error }
export async function uploadOrderAttachment(orderId, file) {
    const path = `${orderId}/${file.name}`;
    const { data, error } = await supabase.storage
        .from('purchasing-attachments')
        .upload(path, file, { upsert: true });
    return { data, error };
}

// deleteOrderAttachment — remove a file by its full storage path. Returns { error }
export async function deleteOrderAttachment(storagePath) {
    const { error } = await supabase.storage
        .from('purchasing-attachments')
        .remove([storagePath]);
    return { error };
}

// uploadMasterQuoteAttachment — upload a file for a master quote at path quotes/{quoteId}/{filename}.
// Returns { data, error }
export async function uploadMasterQuoteAttachment(quoteId, file) {
    const path = `quotes/${quoteId}/${file.name}`;
    const { data, error } = await supabase.storage
        .from('purchasing-attachments')
        .upload(path, file, { upsert: true });
    return { data, error };
}

// uploadSteelQuoteAttachment — upload a quote file for an inline steel quote slot.
// Path: {orderId}/steel_quotes/{filename}. Returns { path, error }
export async function uploadSteelQuoteAttachment(orderId, file) {
    const path = `${orderId}/steel_quotes/${file.name}`;
    const { data, error } = await supabase.storage
        .from('purchasing-attachments')
        .upload(path, file, { upsert: true });
    return { path, error };
}

// getSteelQuoteSignedUrl — generate a 1-hour signed URL for a steel quote file path.
export async function getSteelQuoteSignedUrl(filePath) {
    const { data, error } = await supabase.storage
        .from('purchasing-attachments')
        .createSignedUrl(filePath, 3600);
    return { url: data?.signedUrl || null, error };
}
