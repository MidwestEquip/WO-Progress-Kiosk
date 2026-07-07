// ============================================================
// pages/open-orders-add.js — Open Orders Add Row(s) modal logic
//
// Handles: manual add form, paste-from-Excel parsing + preview,
//          and saving new rows. Split from open-orders-view.js
//          (500-line cap). Imports from store + db + utils only.
//          Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { detectOpenOrderSection, isChutePart,
         normalizePasteDate, matchOpenOrderStatus } from '../libs/utils.js';
import { OPEN_ORDER_STATUSES } from '../libs/config.js';

// cancelAddModal — close the Add Row(s) modal and reset all draft state.
export function cancelAddModal() {
    store.openOrderAddModalOpen.value = false;
    store.openOrderAddMode.value = 'manual';
    store.openOrderAddPasteText.value = '';
    store.openOrderAddPasteRows.value = [];
    store.openOrderAddForm.value = {
        part_number: '', to_ship: '', qty_pulled: '', description: '',
        store_bin: '', update_store_bin: '', customer: '', sales_order: '',
        date_entered: new Date().toISOString().split('T')[0], deadline: '', status: 'New/Picking',
        wo_va_notes: '', wo_po_number: '',
    };
    store.openOrderAddFormErrors.value = {};
}

// parsePasteRows — parse tab-delimited text (pasted from Excel) into preview rows.
// Expected column order (11 cols):
//   [0] Part #  [1] To Ship  [2] Qty Pulled  [3] Description
//   [4] Store/Bin  [5] Update Store/Bin  [6] Customer
//   [7] Sales Order #  [8] Date Entered  [9] Status  [10] Notes
// Section is auto-detected from part # prefix (TC → tru_cut, else → trac_vac).
// Blank lines and obvious header rows are skipped.
// Hardening (underscore fields are preview-only, never inserted):
//   _dupe        — SO#+part already exists on the board or earlier in this paste;
//                  skipped on save unless _add_anyway is checked in the preview.
//   _date_warn   — original date text when it could not be normalized (today used).
//   _status_warn — original status text when it matched no known status (New/Picking used).
export function parsePasteRows() {
    const text = store.openOrderAddPasteText.value || '';
    const today = new Date().toISOString().split('T')[0];
    const dupKey = (part, so) => part + '|' + (so || '').trim().toUpperCase();
    const existingKeys = new Set(
        store.openOrders.value.map(o => dupKey((o.part_number || '').trim().toUpperCase(), o.sales_order))
    );
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const c = trimmed.split('\t');
        const partRaw = (c[0] || '').trim();
        if (!partRaw || partRaw.toLowerCase() === 'part #' || partRaw.toLowerCase() === 'part number') continue;
        const part = partRaw.toUpperCase();

        const rawDate   = (c[8] || '').trim();
        const normDate  = normalizePasteDate(rawDate);
        const rawStatus = (c[9] || '').trim();
        const matched   = matchOpenOrderStatus(rawStatus, OPEN_ORDER_STATUSES);

        const key    = dupKey(part, c[7]);
        const isDupe = existingKeys.has(key);
        existingKeys.add(key); // also catches the same line pasted twice

        rows.push({
            part_number:      part,
            to_ship:          (c[1] || '').trim() || null,
            qty_pulled:       (c[2] || '').trim() || null,
            description:      (c[3] || '').trim() || null,
            store_bin:        (c[4] || '').trim() || null,
            update_store_bin: (c[5] || '').trim() || null,
            customer:         (c[6] || '').trim() || null,
            sales_order:      (c[7] || '').trim() || null,
            date_entered:     normDate || today,
            status:           matched  || 'New/Picking',
            wo_va_notes:      (c[10] || '').trim() || null,
            order_type:       detectOpenOrderSection(part),
            _dupe:            isDupe,
            _add_anyway:      false,
            _date_warn:       (rawDate   && !normDate) ? rawDate   : null,
            _status_warn:     (rawStatus && !matched)  ? rawStatus : null,
        });
    }
    store.openOrderAddPasteRows.value = rows;
}

// saveOpenOrderRow — validate and persist the current draft (manual or paste).
// Section is auto-detected from part # prefix in both modes.
// On success: closes modal, resets state, appends the inserted rows to the
// store (realtime reconciles the full list for all clients).
export async function saveOpenOrderRow() {
    const mode = store.openOrderAddMode.value;
    let inserted = [];

    if (mode === 'manual') {
        const form = store.openOrderAddForm.value;
        const errors = {};
        if (!form.part_number.trim()) errors.part_number = true;
        store.openOrderAddFormErrors.value = errors;
        if (Object.keys(errors).length) return;

        const part = form.part_number.trim().toUpperCase();
        const row = {
            part_number:      part,
            description:      form.description.trim()      || null,
            customer:         form.customer.trim()          || null,
            sales_order:      form.sales_order.trim()       || null,
            wo_po_number:     form.wo_po_number.trim()      || null,
            to_ship:          form.to_ship    ? Number(form.to_ship)    : null,
            qty_pulled:       form.qty_pulled ? Number(form.qty_pulled) : null,
            date_entered:     form.date_entered  || new Date().toISOString().split('T')[0],
            deadline:         form.deadline      || null,
            store_bin:        form.store_bin.trim()         || null,
            update_store_bin: form.update_store_bin.trim()  || null,
            status:           form.status || 'New/Picking',
            last_status_update: new Date().toISOString(),
            wo_va_notes:      form.wo_va_notes.trim()       || null,
            order_type:       detectOpenOrderSection(part),
            ...(isChutePart(part) ? { chute_status: 'New/Picking', bracket_adapter_status: 'New/Picking' } : {}),
        };

        const { data, error } = await db.insertOpenOrders([row]);
        if (error) { store.showToast('Failed to add row: ' + error.message); return; }
        inserted = data || [];

    } else {
        // paste mode — rows already validated by parsePasteRows.
        // Duplicates are skipped unless the user checked "Add anyway" in the preview.
        const rows = store.openOrderAddPasteRows.value
            .filter(r => !r._dupe || r._add_anyway)
            .map(r => ({
            part_number:      r.part_number      || null,
            to_ship:          r.to_ship    ? Number(r.to_ship)    : null,
            qty_pulled:       r.qty_pulled ? Number(r.qty_pulled) : null,
            description:      r.description      || null,
            store_bin:        r.store_bin         || null,
            update_store_bin: r.update_store_bin  || null,
            customer:         r.customer          || null,
            sales_order:      r.sales_order       || null,
            date_entered:     r.date_entered      || null,
            status:           r.status            || 'New/Picking',
            last_status_update: new Date().toISOString(),
            wo_va_notes:      r.wo_va_notes       || null,
            order_type:       r.order_type,
            ...(isChutePart(r.part_number) ? { chute_status: 'New/Picking', bracket_adapter_status: 'New/Picking' } : {}),
            }));
        if (!rows.length) { store.showToast('No rows to add — all duplicates were skipped.'); return; }

        const { data, error } = await db.insertOpenOrders(rows);
        if (error) { store.showToast('Failed to add rows: ' + error.message); return; }
        inserted = data || [];
    }

    cancelAddModal();
    if (inserted.length) store.openOrders.value = [...store.openOrders.value, ...inserted];
}
