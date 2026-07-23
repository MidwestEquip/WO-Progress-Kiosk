// ============================================================
// pages/inventory-count-view.js — Inventory Count sheet
//
// The count sheet fed by "Export to Count" in Production Planning
// Review: list the parts, record a physical qty per part, and (for
// managers) push that qty into inventory through the same two legs
// the Inventory Adjustment view uses — item_master manual count +
// the import_inventory_count RPC that sets live part_on_hand.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

const MAX_COUNT_QTY = 100000;

function _today() { return new Date().toISOString().slice(0, 10); }

// enterInventoryCountView — open the Inventory Count sheet from the splash tile.
// Resets the filter/toggles so a previous visit never leaks in. No args, no return.
export function enterInventoryCountView() {
    store.invCountFilter.value       = '';
    store.invCountShowAdjusted.value = false;
    store.invCountRemoveId.value     = null;
    // The currentView watch in main.js fires loadInventoryCountLines().
    store.currentView.value          = 'inventory_count';
}

// loadInventoryCountLines — fetch the sheet, then the item_master reference data
// (description / bin / system on-hand) for exactly the parts on it. Reference
// data is derived live rather than snapshotted on the line: a bin move must show
// up on the sheet without re-exporting. No args, no return.
export async function loadInventoryCountLines() {
    store.invCountLoading.value = true;
    try {
        const { data, error } = await db.fetchInventoryCountLines(store.invCountShowAdjusted.value);
        if (error) throw error;
        store.invCountLines.value = data;
        _loadCountRefs(data);
    } catch (err) {
        store.showToast('Failed to load the count sheet: ' + err.message);
        logError('loadInventoryCountLines', err);
    } finally {
        store.invCountLoading.value = false;
    }
}

// _loadCountRefs — non-blocking companion load of item_master rows for the sheet.
// A failure here costs descriptions and bins, not the sheet itself.
async function _loadCountRefs(lines) {
    const parts = [...new Set((lines || []).map(l => l.part_number_normalized || l.part_number))];
    if (!parts.length) { store.invCountRefs.value = {}; return; }
    store.invCountRefsLoading.value = true;
    try {
        const { data, error } = await db.fetchItemMasterForParts(parts);
        if (error) throw error;
        store.invCountRefs.value = data || {};
    } catch (err) {
        store.showToast('Descriptions / bins failed to load: ' + err.message);
        logError('_loadCountRefs', err);
    } finally {
        store.invCountRefsLoading.value = false;
    }
}

// toggleInvCountAdjusted — flip the "show already adjusted" toggle and reload
// (the adjusted history is a bounded server-side query, not a client filter).
export function toggleInvCountAdjusted() {
    store.invCountShowAdjusted.value = !store.invCountShowAdjusted.value;
    loadInventoryCountLines();
}

// saveCountQty — persist a Qty Counted edit (fired on blur). Recording a count
// deliberately does NOT touch inventory; that is the manager's Adjust step.
// Inputs: the line, the raw input value. No return.
export async function saveCountQty(line, rawValue) {
    if (!line || line.adjusted) return;
    const raw = String(rawValue ?? '').trim();
    const qty = raw === '' ? null : Number(raw);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0 || qty >= MAX_COUNT_QTY)) {
        store.showToast('Enter a quantity between 0 and 99,999.');
        return;
    }
    if ((line.qty_counted == null ? null : Number(line.qty_counted)) === qty) return; // no change
    store.invCountSavingId.value = line.id;
    try {
        const { data, error } = await db.updateInventoryCountLine(line.id, {
            qty_counted: qty,
            counted_at:  qty === null ? null : new Date().toISOString(),
        });
        if (error) throw error;
        if (data) Object.assign(line, data);
    } catch (err) {
        store.showToast('Failed to save the count: ' + err.message);
        logError('saveCountQty', err, { id: line.id });
    } finally {
        store.invCountSavingId.value = null;
    }
}

// removeCountLine — two-click delete of a line that should not be counted.
// First click arms the confirm, second click removes it. Input: the line.
export async function removeCountLine(line) {
    if (store.invCountRemoveId.value !== line.id) {
        store.invCountRemoveId.value = line.id;
        setTimeout(() => {
            if (store.invCountRemoveId.value === line.id) store.invCountRemoveId.value = null;
        }, 4000);
        return;
    }
    store.invCountRemoveId.value = null;
    try {
        const { error } = await db.deleteInventoryCountLine(line.id);
        if (error) throw error;
        store.invCountLines.value = store.invCountLines.value.filter(l => l.id !== line.id);
        store.showToast('Removed from the count sheet.', 'success');
    } catch (err) {
        store.showToast('Remove failed: ' + err.message);
        logError('removeCountLine', err, { id: line.id });
    }
}

// ── Adjust Inventory modal ────────────────────────────────────

// openCountAdjust — open the adjustment popup for one counted line. Loads the
// part's item_master row for the summary tiles (and its PK, needed to save the
// manual count); prefills Real Qty with what was counted, still editable.
// Input: the line. No return.
export async function openCountAdjust(line) {
    if (!line || line.adjusted) return;
    store.invCountAdjustLine.value    = line;
    store.invCountAdjustItem.value    = null;
    store.invCountAdjustErrors.value  = { qty: false, counted_by: false };
    store.invCountAdjustForm.value    = {
        qty:        line.qty_counted == null ? '' : line.qty_counted,
        date:       (line.counted_at || '').slice(0, 10) || _today(),
        counted_by: line.counted_by || '',
    };
    store.invCountAdjustOpen.value    = true;
    store.invCountAdjustLoading.value = true;
    try {
        const { data, error } = await db.fetchItemMasterByPart(line.part_number);
        if (error) throw error;
        if (store.invCountAdjustLine.value?.id !== line.id) return;  // stale: another line opened
        store.invCountAdjustItem.value = data;
    } catch (err) {
        store.showToast('Part lookup failed: ' + err.message);
        logError('openCountAdjust', err, { part: line.part_number });
    } finally {
        if (store.invCountAdjustLine.value?.id === line.id) store.invCountAdjustLoading.value = false;
    }
}

export function closeCountAdjust() {
    store.invCountAdjustOpen.value = false;
    store.invCountAdjustLine.value = null;
    store.invCountAdjustItem.value = null;
}

// submitCountAdjust — the manager's Save Count. Three legs, each reported on its
// own: (1) the item_master manual count (skipped when the part has no
// item_master row), (2) the import_inventory_count RPC that sets live on-hand,
// (3) the adjusted stamp on the count line. The RPC is the leg that actually
// moves inventory, so a failure there aborts before the line is marked adjusted.
export async function submitCountAdjust() {
    const line = store.invCountAdjustLine.value;
    const item = store.invCountAdjustItem.value;
    const form = store.invCountAdjustForm.value;
    if (!line) return;

    const qty       = Number(form.qty);
    const countedBy = (form.counted_by || '').trim();
    const errors    = {
        qty:        form.qty === '' || !Number.isFinite(qty) || qty < 0 || qty >= MAX_COUNT_QTY,
        counted_by: !countedBy,
    };
    store.invCountAdjustErrors.value = errors;
    if (errors.qty || errors.counted_by) return;

    const dateStr = form.date || _today();
    store.invCountAdjustSaving.value = true;
    try {
        // Leg 1 — item_master manual count (non-fatal; a native part may have no row).
        if (item?.id) {
            const { error: imErr } = await db.saveManualCount(item.id, qty, dateStr);
            if (imErr) {
                store.showToast('Item master count did not save: ' + imErr.message);
                logError('submitCountAdjust:itemMaster', imErr, { id: item.id });
            }
        } else {
            store.showToast(`${line.part_number}: no item master row — recording the live count only.`, 'info');
        }

        // Leg 2 — live on-hand (IC row via the RPC). Fatal: without it nothing moved.
        const { error: icErr } = await db.importInventoryCount(line.part_number, qty, countedBy);
        if (icErr) throw icErr;

        // Leg 3 — stamp the sheet line.
        const { data, error } = await db.updateInventoryCountLine(line.id, {
            qty_counted:  qty,
            counted_by:   countedBy,
            counted_at:   line.counted_at || new Date().toISOString(),
            adjusted:     true,
            adjusted_qty: qty,
            adjusted_by:  countedBy,
            adjusted_at:  new Date().toISOString(),
        });
        if (error) throw error;
        const row = store.invCountLines.value.find(l => l.id === line.id);
        if (row && data) Object.assign(row, data);

        closeCountAdjust();
        store.showToast(`${line.part_number}: inventory adjusted to ${qty}.`, 'success');
    } catch (err) {
        store.showToast('Adjustment failed: ' + err.message);
        logError('submitCountAdjust', err, { id: line.id, part: line.part_number });
    } finally {
        store.invCountAdjustSaving.value = false;
    }
}
