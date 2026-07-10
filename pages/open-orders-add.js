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
         normalizePasteDate, matchOpenOrderStatus,
         parseClipboardTable, decideOpenOrderWoAttach } from '../libs/utils.js';
import { OPEN_ORDER_STATUSES, OPEN_ORDER_STATUS_NEW, PART_NOTE_KIND } from '../libs/config.js';
import { logError } from '../libs/db-shared.js';

// cancelAddModal — close the Add Row(s) modal and reset all draft state.
export function cancelAddModal() {
    store.openOrderAddModalOpen.value = false;
    store.openOrderAddMode.value = 'manual';
    store.openOrderAddPasteText.value = '';
    store.openOrderAddPasteRows.value = [];
    store.openOrderAddForm.value = {
        part_number: '', to_ship: '', qty_pulled: '', description: '',
        store_bin: '', update_store_bin: '', customer: '', sales_order: '',
        date_entered: new Date().toISOString().split('T')[0], deadline: '', status: OPEN_ORDER_STATUS_NEW,
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
// Blank lines and obvious header rows are skipped. A row with an empty Part #
// cell is kept (description-only / misc lines) — the part # can be added later
// by clicking the cell on the board.
// Hardening (underscore fields are preview-only, never inserted):
//   _dupe        — SO#+part already exists on the board or earlier in this paste;
//                  warned in the preview but added by default — uncheck the
//                  row's _add_anyway box to skip it on save.
//   _date_warn   — original date text when it could not be normalized (today used).
//   _status_warn — original status text when it matched no known status (New used).
export function parsePasteRows() {
    const text = store.openOrderAddPasteText.value || '';
    const today = new Date().toISOString().split('T')[0];
    const dupKey = (part, so) => part + '|' + (so || '').trim().toUpperCase();
    const existingKeys = new Set(
        store.openOrders.value.map(o => dupKey((o.part_number || '').trim().toUpperCase(), o.sales_order))
    );
    const rows = [];
    // parseClipboardTable respects spreadsheet quoting so cells with embedded
    // newlines (multi-line notes) stay in one row instead of shattering.
    for (const c of parseClipboardTable(text)) {
        if (c.every(cell => !cell || !cell.trim())) continue;  // skip blank rows
        const partRaw = (c[0] || '').trim();
        if (partRaw.toLowerCase() === 'part #' || partRaw.toLowerCase() === 'part number') continue;
        const part = partRaw.toUpperCase() || null;

        const rawDate   = (c[8] || '').trim();
        const normDate  = normalizePasteDate(rawDate);
        const rawStatus = (c[9] || '').trim();
        const matched   = matchOpenOrderStatus(rawStatus, OPEN_ORDER_STATUSES);

        // Dedup only applies to rows with a part # — no-part lines on the same
        // SO would otherwise falsely flag each other as duplicates.
        let isDupe = false;
        if (part) {
            const key = dupKey(part, c[7]);
            isDupe    = existingKeys.has(key);
            existingKeys.add(key); // also catches the same line pasted twice
        }

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
            status:           matched  || OPEN_ORDER_STATUS_NEW,
            wo_va_notes:      (c[10] || '').trim() || null,
            order_type:       detectOpenOrderSection(part),
            _dupe:            isDupe,
            _add_anyway:      isDupe,  // dupes default to included — uncheck to skip
            _date_warn:       (rawDate   && !normDate) ? rawDate   : null,
            _status_warn:     (rawStatus && !matched)  ? rawStatus : null,
        });
    }
    store.openOrderAddPasteRows.value = rows;
}

// ── Auto-attach active WOs to pasted rows ─────────────────────

// _groupActiveWos — collapse raw work_orders rows (one per department per WO)
// into one summary per wo_number, bucketed by part number. qty_required is the
// build target (same across dept rows — max guards against stray data); a WO
// counts as started once ANY dept row leaves not_started or has completed qty.
// Input: raw rows from fetchActiveWosForParts. Output: Map<PART#, woSummary[]>.
function _groupActiveWos(rows) {
    const byWo = new Map();
    for (const r of (rows || [])) {
        const wo = r.wo_number;
        if (!wo) continue;
        const started = (r.status && r.status !== 'not_started') || (Number(r.qty_completed) || 0) > 0;
        const cur = byWo.get(wo);
        if (!cur) {
            byWo.set(wo, {
                wo_number:     wo,
                part_number:   r.part_number,
                sales_order:   r.sales_order || null,
                qty_required:  Number(r.qty_required) || 0,
                qty_completed: started ? 1 : 0,
                status:        started ? 'started' : 'not_started',
            });
        } else {
            cur.qty_required = Math.max(cur.qty_required, Number(r.qty_required) || 0);
            if (started) { cur.status = 'started'; cur.qty_completed = 1; }
            if (!cur.sales_order && r.sales_order) cur.sales_order = r.sales_order;
        }
    }
    const byPart = new Map();
    for (const s of byWo.values()) {
        const key = (s.part_number || '').trim().toUpperCase();
        if (!byPart.has(key)) byPart.set(key, []);
        byPart.get(key).push(s);
    }
    return byPart;
}

// _committedForWo — qty already dedicated to a WO, derived (not stored) from the
// current board: every open order tied to it by WO/PO # OR sharing the WO's
// original sales_order. Each row is counted at most once (single pass). This is
// how the WO's original SO demand gets included in the coverage math.
function _committedForWo(woSummary, openOrders) {
    const wo = woSummary.wo_number;
    const so = (woSummary.sales_order || '').trim();
    let sum = 0;
    for (const o of (openOrders || [])) {
        const tiedByWo = (o.wo_po_number || '').trim() === wo;
        const tiedBySo = so && (o.sales_order || '').trim() === so;
        if (tiedByWo || tiedBySo) sum += Number(o.to_ship) || 0;
    }
    return sum;
}

// enrichPasteRowsWithWoAttach — after parsePasteRows, auto-attach a covering
// active WO to each fresh (New/Picking, non-duplicate) pasted row and set its
// status, per decideOpenOrderWoAttach. One bounded query for all pasted parts;
// runs only at paste time, never on view load. Duplicate rows and rows with a
// non-default status are left untouched. Reassigns the rows array so Vue
// re-renders with the decision baked in (preview shows it; save persists it).
export async function enrichPasteRowsWithWoAttach() {
    const rows = store.openOrderAddPasteRows.value;
    if (!rows || !rows.length) return;
    const parts = rows.map(r => r.part_number).filter(Boolean);
    if (!parts.length) return;

    const { data, error } = await db.fetchActiveWosForParts(parts);
    if (error) { logError('enrichPasteRowsWithWoAttach', error); return; }
    const byPart = _groupActiveWos(data || []);

    // Baseline committed qty per WO from the current board (before this paste).
    const committedByWo = {};
    for (const list of byPart.values()) {
        for (const s of list) committedByWo[s.wo_number] = _committedForWo(s, store.openOrders.value);
    }

    const enriched = rows.map(r => {
        const next = { ...r, _scenario: null, _shortfall: 0, _wo_reason: null,
                       wo_po_number: r.wo_po_number || null };
        // Only auto-attach fresh, non-duplicate rows (respect an explicit status).
        // A freshly-parsed row defaults to 'New'; an explicit pasted status is
        // honored (skips auto-attach).
        if (r._dupe || (r.status && r.status !== OPEN_ORDER_STATUS_NEW)) return next;
        const wos = byPart.get((r.part_number || '').trim().toUpperCase()) || [];
        const decision = decideOpenOrderWoAttach(r.to_ship, wos, committedByWo);
        next._scenario  = decision.scenario;
        next._shortfall = decision.shortfall;
        next._wo_reason = decision.reason;
        if (decision.wo_po_number) {
            next.wo_po_number = decision.wo_po_number;
            next.status       = decision.status;
            // running tally so a later row in this same paste sees reduced headroom
            committedByWo[decision.wo_po_number] =
                (committedByWo[decision.wo_po_number] || 0) + (Number(r.to_ship) || 0);
        }
        return next;
    });
    store.openOrderAddPasteRows.value = enriched;
}

// pasteWoScenarioLabel / pasteWoScenarioClass — short badge label + Tailwind
// classes for the auto-attach outcome shown in the paste preview's WO Auto cell.
export function pasteWoScenarioLabel(scenario) {
    const map = { covered: 'WO attached', short_new: 'WO + notify prod', short_started: 'Needs new WO' };
    return map[scenario] || '';
}
export function pasteWoScenarioClass(scenario) {
    const map = {
        covered:       'bg-green-100 text-green-800',
        short_new:     'bg-amber-100 text-amber-800',
        short_started: 'bg-red-100   text-red-800',
    };
    return map[scenario] || '';
}

// notifyProductionForShortfalls — for each scenario-e (short_new) row saved,
// append a dated line to the part's production note (part_notes.wo_production_note),
// which shows as a banner on the TC/TV assembly cards. Preserves any existing
// note text (single-slot per part). Non-fatal — toasts + logs on failure, never
// blocks the save. Input: the source preview rows that were actually inserted.
async function notifyProductionForShortfalls(sourceRows) {
    const shorts = (sourceRows || []).filter(
        r => r._scenario === 'short_new' && r.wo_po_number && r._shortfall > 0);
    for (const r of shorts) {
        try {
            const { data: existing } = await db.fetchPartNote(r.part_number);
            const prior = (existing?.wo_production_note || '').trim();
            const today = new Date().toISOString().slice(0, 10);
            const so    = (r.sales_order || '').trim();
            const line  = `[${today}] Auto (Open Orders): WO #${r.wo_po_number} short by ${r._shortfall}`
                        + (so ? ` for SO# ${so}` : '')
                        + ` — please make ${r._shortfall} more and dedicate to this order.`;
            const text  = prior ? `${prior}\n${line}` : line;
            const { error } = await db.upsertPartNote(r.part_number, PART_NOTE_KIND.WO_PRODUCTION, text, 'Auto-Import');
            if (error) throw error;
        } catch (err) {
            store.showToast('Could not message production for ' + r.part_number + ': ' + err.message);
            logError('notifyProductionForShortfalls', err);
        }
    }
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
            status:           form.status || OPEN_ORDER_STATUS_NEW,
            last_status_update: new Date().toISOString(),
            wo_va_notes:      form.wo_va_notes.trim()       || null,
            order_type:       detectOpenOrderSection(part),
            ...(isChutePart(part) ? { chute_status: 'New/Picking', bracket_adapter_status: 'New/Picking' } : {}),
        };

        const { data, error } = await db.insertOpenOrders([row]);
        if (error) { store.showToast('Failed to add row: ' + error.message); return; }
        inserted = data || [];

    } else {
        // paste mode — rows already validated by parsePasteRows + enriched with
        // any auto-attached WO by enrichPasteRowsWithWoAttach.
        // Duplicates are skipped unless the user checked "Add anyway" in the preview.
        const sourceRows = store.openOrderAddPasteRows.value.filter(r => !r._dupe || r._add_anyway);
        const rows = sourceRows.map(r => ({
            part_number:      r.part_number      || null,
            to_ship:          r.to_ship    ? Number(r.to_ship)    : null,
            qty_pulled:       r.qty_pulled ? Number(r.qty_pulled) : null,
            description:      r.description      || null,
            store_bin:        r.store_bin         || null,
            update_store_bin: r.update_store_bin  || null,
            customer:         r.customer          || null,
            sales_order:      r.sales_order       || null,
            wo_po_number:     r.wo_po_number       || null,
            date_entered:     r.date_entered      || null,
            status:           r.status            || OPEN_ORDER_STATUS_NEW,
            last_status_update: new Date().toISOString(),
            wo_va_notes:      r.wo_va_notes       || null,
            order_type:       r.order_type,
            ...(isChutePart(r.part_number) ? { chute_status: 'New/Picking', bracket_adapter_status: 'New/Picking' } : {}),
            }));
        if (!rows.length) { store.showToast('No rows to add — all duplicates were skipped.'); return; }

        const { data, error } = await db.insertOpenOrders(rows);
        if (error) { store.showToast('Failed to add rows: ' + error.message); return; }
        inserted = data || [];

        // Message production for any short-WO (scenario e) rows just saved (non-fatal).
        await notifyProductionForShortfalls(sourceRows);
    }

    cancelAddModal();
    // Realtime may have already delivered some/all of these rows while the
    // insert response was in flight (big pastes) — append only what's missing
    // or every row would show twice until the next reload.
    if (inserted.length) {
        const have  = new Set(store.openOrders.value.map(o => o.id));
        const fresh = inserted.filter(r => !have.has(r.id));
        if (fresh.length) store.openOrders.value = [...store.openOrders.value, ...fresh];
    }
}
