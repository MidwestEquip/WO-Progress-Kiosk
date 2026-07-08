// ============================================================
// pages/purchasing-notes.js — purchaser-note carry-forward (prefill)
//
// Loads the remembered purchaser note (part_notes) for the part on the
// open Purchasing detail order, exposes it as a dated caption, and
// pre-fills the purchaser_notes field only when it is currently empty.
// The save-back stamp lives in purchasing-view.js (_doSave).
// Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadPurchasingCarriedNote — on detail-modal open, fetch the part's remembered
// purchaser note. Part orders only. Sets purchasingCarriedNote to { text, date }
// (or null) and pre-fills purchaser_notes only when that field is empty (never
// clobbers a typed note). Non-blocking; guarded against a fast A→B open by id.
export async function loadPurchasingCarriedNote(order) {
    store.purchasingCarriedNote.value = null;
    if (!order || order.request_type !== 'part' || !order.part_number) return;
    const orderId = order.id;
    const { data, error } = await db.fetchPartNote(order.part_number);
    if (error) { logError('loadPurchasingCarriedNote', error, { part: order.part_number }); return; }
    if (store.purchasingDetailOrder.value?.id !== orderId) return;   // stale: a different order opened
    if (!data || !data.purchaser_note) return;

    store.purchasingCarriedNote.value = { text: data.purchaser_note, date: data.purchaser_note_date };
    const form = store.purchasingDetailForm.value;
    if (!(form.purchaser_notes || '').trim()) form.purchaser_notes = data.purchaser_note;
}
