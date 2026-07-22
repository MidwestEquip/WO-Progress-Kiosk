// ============================================================
// pages/planning-queues.js — Queues + Alerts tabs: coverage-ranked
// replenishment queues (banded parts), low-stock alerts, bands
// editor, one-click batch proposals. Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { computeCoverage, buildLowStockAlerts, sanitizeText } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// _deptFor — which queue a part belongs to, from learned routing:
// first non-empty of fab → weld → assy_wo; no routing = 'Unrouted'.
function _deptFor(defaults) {
    if (!defaults) return 'Unrouted';
    if ((defaults.fab || '').trim())     return 'Fab';
    if ((defaults.weld || '').trim())    return 'Weld';
    if ((defaults.assy_wo || '').trim()) return 'Assy';
    return 'Unrouted';
}

// loadPlanningQueues — build the ranked queue: every banded part with live
// on-hand, open supply, blended 12-mo demand rate, coverage, and dept.
export async function loadPlanningQueues() {
    store.queueLoading.value = true;
    try {
        const { data: banded, error: bErr } = await db.fetchBandedParts();
        if (bErr) throw bErr;
        if (!banded.length) {
            store.queueRows.value = []; store.lowStockAlerts.value = [];
            store.queueLoadedAt.value = new Date();
            return;
        }
        const parts = banded.map(b => b.part_number_normalized);
        const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        const [oh, wo, po, usage, sold, defs, mb, descs] = await Promise.all([
            db.fetchOnHandForParts(parts),
            db.fetchOpenWoSupply(parts),
            db.fetchOpenPoSupply(parts),
            db.fetchPartsUsageSummaryBatch(parts),
            db.fetchQtySoldFromSalesAnalysis(parts,
                yearAgo.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)),
            db.fetchRoutingDefaultsForParts(parts),
            db.fetchMakeBuyAttrs(parts),
            db.fetchItemDescriptions(parts),
        ]);
        for (const r of [oh, wo, po, usage, sold, defs, mb, descs]) if (r.error) throw r.error;

        const rows = banded.map(b => {
            const p = b.part_number_normalized;
            const qty12 = (Number(sold.data[p]) || 0) + (Number(usage.data[p]?.qty_used_mfg_12mo) || 0);
            const on_hand = Number(oh.data[p]?.on_hand) || 0;
            const open_supply = (Number(wo.data[p]) || 0) + (Number(po.data[p]) || 0);
            const cov = computeCoverage({ on_hand, open_supply, qty_12mo: qty12 });
            return {
                part_number: p,
                descrip: descs.data[p] || '',
                dept: _deptFor(defs.data[p]),
                on_hand, open_supply, qty_12mo: qty12,
                daily_rate: cov.daily_rate,
                days_of_supply: cov.days_of_supply,
                run_out_date: cov.run_out_date,
                min_stock: Number(b.min_stock) || 0,
                target_stock: Number(b.target_stock) || null,
                min_batch_qty: Number(b.min_batch_qty) || null,
                lead_time_days: Number(b.lead_time_days) || 0,
                make_buy: b.make_buy_override || mb.data[p] || null,
                counted_at: oh.data[p]?.counted_at || null,
                planning_hold: !!b.planning_hold,
                below_min: on_hand + open_supply < (Number(b.min_stock) || 0),
            };
        });
        store.queueRows.value = rows;
        store.lowStockAlerts.value = buildLowStockAlerts(rows.filter(r => !r.planning_hold));
        store.queueLoadedAt.value = new Date();
    } catch (err) {
        store.showToast('Failed to load queues: ' + err.message);
        logError('loadPlanningQueues', err);
    } finally {
        store.queueLoading.value = false;
    }
}

// proposeQueueBatch — one-click replenishment from a queue/alert row: order up
// to target (+ lead-time demand), batch rules applied, into the right pipeline.
export async function proposeQueueBatch(row) {
    if (store.queueProposingId.value) return;
    const target = row.target_stock || row.min_stock;
    let qty = Math.ceil(Math.max(0,
        target + (row.daily_rate || 0) * (row.lead_time_days || 0)
        - row.on_hand - row.open_supply));
    if (row.min_batch_qty > 0) qty = Math.max(qty, row.min_batch_qty);
    if (!(qty > 0)) { store.showToast('Already at or above target.'); return; }
    store.queueProposingId.value = row.part_number;
    try {
        const pseudoLine = {
            run_id: '00000000-queue', part_number: row.part_number,
            part_number_normalized: row.part_number,
            planned_release_date: null, required_date: null, family_name: 'Queue',
        };
        if (row.make_buy === 'buy') {
            const { error } = await db.createPoRequestFromLine(pseudoLine, qty, store.sessionRole.value);
            if (error) throw error;
            store.showToast(`${row.part_number}: PO request for ${qty} created.`, 'success');
        } else {
            const { data: defs } = await db.fetchRoutingDefaultsForParts([row.part_number]);
            const { error } = await db.createWoRequestFromLine(
                pseudoLine, qty, defs[row.part_number] || null, store.sessionRole.value);
            if (error) throw error;
            store.showToast(`${row.part_number}: WO request for ${qty} created.`, 'success');
        }
        row.open_supply += qty;   // reflect immediately so the rank updates
    } catch (err) {
        store.showToast('Proposal failed: ' + err.message);
        logError('proposeQueueBatch', err, { part: row.part_number });
    } finally {
        store.queueProposingId.value = null;
    }
}

// ── Bands editor ──────────────────────────────────────────────

export function openBandEditor(row = null) {
    store.bandForm.value = row ? {
        part_number: row.part_number,
        min_stock: row.min_stock, target_stock: row.target_stock,
        min_batch_qty: row.min_batch_qty, lead_time_days: row.lead_time_days,
        planning_hold: row.planning_hold,
    } : { part_number: '', min_stock: '', target_stock: '', min_batch_qty: '', lead_time_days: '', planning_hold: false };
    store.bandEditorOpen.value = true;
}
export function closeBandEditor() { store.bandEditorOpen.value = false; }

// saveBand — upsert part_planning for one part, then refresh the queue.
export async function saveBand() {
    const f = store.bandForm.value;
    const part = sanitizeText(f.part_number || '').toUpperCase();
    if (!part) { store.showToast('Part number is required.'); return; }
    if (!(Number(f.min_stock) > 0)) { store.showToast('Min stock must be above zero.'); return; }
    store.bandSaving.value = true;
    try {
        const { error } = await db.upsertPartPlanning({
            ...f, part_number: part, updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        store.showToast(`Band saved for ${part}.`, 'success');
        store.bandEditorOpen.value = false;
        loadPlanningQueues();
    } catch (err) {
        store.showToast('Band save failed: ' + err.message);
        logError('saveBand', err, { part });
    } finally {
        store.bandSaving.value = false;
    }
}
