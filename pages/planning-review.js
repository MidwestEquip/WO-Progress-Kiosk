// ============================================================
// pages/planning-review.js — Review tab: run list, line grid,
// approve, and release into the wo_requests / purchasing pipelines.
// Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

function _today() { return new Date().toISOString().slice(0, 10); }

// loadPlanningRuns — open runs, newest first; auto-select the newest when
// nothing is selected (the just-saved run after a Plan calc).
export async function loadPlanningRuns() {
    store.planningRunsLoading.value = true;
    try {
        const { data, error } = await db.fetchPlanningRuns('open');
        if (error) throw error;
        store.planningRuns.value = data;
        if (!store.selectedRun.value && data.length) selectRun(data[0]);
        loadReleaseDue();
    } catch (err) {
        store.showToast('Failed to load runs: ' + err.message);
        logError('loadPlanningRuns', err);
    } finally {
        store.planningRunsLoading.value = false;
    }
}

// selectRun — load one run's lines into the grid.
export async function selectRun(run) {
    store.selectedRun.value = run;
    store.runLines.value = [];
    if (!run) return;
    store.runLinesLoading.value = true;
    try {
        const { data, error } = await db.fetchRunLines(run.id);
        if (error) throw error;
        store.runLines.value = data.map(l => ({ ...l, checked: false }));
    } catch (err) {
        store.showToast('Failed to load run lines: ' + err.message);
        logError('selectRun', err, { id: run.id });
    } finally {
        store.runLinesLoading.value = false;
    }
}

// saveLineEdit — persist an inline edit (override qty, hold, release date).
export async function saveLineEdit(line, fields) {
    try {
        const { data, error } = await db.updateRunLine(line.id, {
            ...fields, updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        Object.assign(line, data);
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveLineEdit', err, { id: line.id });
    }
}

// approveSelected — proposed → approved for checked (or all unchecked-none)
// lines with a positive quantity; default release date = today.
export async function approveSelected() {
    const lines = store.runLines.value.filter(l => l.line_status === 'proposed' && !l.hold);
    const checked = lines.filter(l => l.checked);
    const targets = (checked.length ? checked : lines)
        .filter(l => Number(l.override_qty ?? l.recommended) > 0);
    if (!targets.length) { store.showToast('Nothing to approve.'); return; }
    store.runApproving.value = true;
    try {
        for (const l of targets) {
            const { data, error } = await db.updateRunLine(l.id, {
                line_status: 'approved',
                planned_release_date: l.planned_release_date || _today(),
                updated_by: store.sessionRole.value || null,
            });
            if (error) throw error;
            Object.assign(l, data, { checked: false });
        }
        store.showToast(`${targets.length} line(s) approved.`, 'success');
        loadReleaseDue();
    } catch (err) {
        store.showToast('Approve failed: ' + err.message);
        logError('approveSelected', err);
    } finally {
        store.runApproving.value = false;
    }
}

// skipLine — mark one proposed line skipped (not needed).
export async function skipLine(line) {
    await saveLineEdit(line, { line_status: 'skipped' });
}

// loadReleaseDue — approved lines whose release date has arrived, each MAKE
// line stamped with material readiness (direct BOM children on hand vs needed:
// 'ready' | 'partial' | 'waiting' | null when no BOM/not a make).
export async function loadReleaseDue() {
    try {
        const { data, error } = await db.fetchReleaseDueLines(_today());
        if (error) throw error;
        const makes = data.filter(l => l.action !== 'buy');
        if (makes.length) {
            const { data: bomRows } = await db.fetchBomsForParents(
                makes.map(l => l.part_number_normalized));
            const kids = {};
            (bomRows || []).forEach(r => {
                (kids[r.item_parent_normalized] = kids[r.item_parent_normalized] || [])
                    .push({ c: r.item_child_normalized, q: Number(r.qty_per_assy) || 1 });
            });
            const childParts = [...new Set((bomRows || []).map(r => r.item_child_normalized))];
            const { data: oh } = await db.fetchOnHandForParts(childParts);
            makes.forEach(l => {
                const need = kids[l.part_number_normalized];
                if (!need || !need.length) { l.material = null; return; }
                const qty = Number(l.override_qty ?? l.recommended) || 0;
                let ready = 0;
                need.forEach(k => { if ((Number(oh[k.c]?.on_hand) || 0) >= k.q * qty) ready++; });
                l.material = ready === need.length ? 'ready' : ready > 0 ? 'partial' : 'waiting';
            });
        }
        store.releaseDueLines.value = data;
    } catch (err) {
        logError('loadReleaseDue', err);
    }
}

// releaseLine — the release gate. Re-nets against LIVE numbers first (snapshot
// gross + min − live on-hand/WO/PO, batch rules re-applied); a line that is no
// longer needed is skipped, not created. Make/review → pending wo_request with
// learned routing prefilled; buy → purchasing part request.
export async function releaseLine(line) {
    if (store.releasingLineId.value) return;
    store.releasingLineId.value = line.id;
    try {
        const part = line.part_number_normalized;
        const [oh, wo, po, prm] = await Promise.all([
            db.fetchOnHandForParts([part]),
            db.fetchOpenWoSupply([part]),
            db.fetchOpenPoSupply([part]),
            db.fetchPartPlanningParams([part]),
        ]);
        const p    = prm.data[part] || {};
        const live = Math.max(0,
            (Number(line.gross) || 0) + (Number(p.min_stock) || 0)
            - (Number(oh.data[part]?.on_hand) || 0)
            - (Number(wo.data[part]) || 0) - (Number(po.data[part]) || 0));
        let qty = Number(line.override_qty ?? 0) > 0 ? Number(line.override_qty) : live;
        if (qty > 0 && !(Number(line.override_qty) > 0)) {
            if (Number(p.min_batch_qty) > 0) qty = Math.max(qty, Number(p.min_batch_qty));
            if (Number(p.order_multiple) > 0) qty = Math.ceil(qty / Number(p.order_multiple)) * Number(p.order_multiple);
        }
        if (!(qty > 0)) {
            await db.updateRunLine(line.id, { line_status: 'skipped', updated_by: store.sessionRole.value || null });
            store.releaseDueLines.value = store.releaseDueLines.value.filter(l => l.id !== line.id);
            store.showToast(`${part}: covered by live stock/supply — skipped.`, 'success');
            return;
        }

        let refType, refId;
        if (line.action === 'buy') {
            const { data, error } = await db.createPoRequestFromLine(line, qty, store.sessionRole.value);
            if (error) throw error;
            refType = 'purchasing_order'; refId = data.id;
        } else {
            const { data: defs } = await db.fetchRoutingDefaultsForParts([part]);
            const { data, error } = await db.createWoRequestFromLine(
                line, qty, defs[part] || null, store.sessionRole.value);
            if (error) throw error;
            refType = 'wo_request'; refId = data.id;
        }
        const { error: upErr } = await db.updateRunLine(line.id, {
            line_status: 'released', created_ref_type: refType, created_ref_id: refId,
            updated_by: store.sessionRole.value || null,
        });
        if (upErr) throw upErr;
        store.releaseDueLines.value = store.releaseDueLines.value.filter(l => l.id !== line.id);
        const inRun = store.runLines.value.find(l => l.id === line.id);
        if (inRun) Object.assign(inRun, { line_status: 'released', created_ref_type: refType, created_ref_id: refId });
        store.showToast(`${part}: ${qty} → ${refType === 'wo_request' ? 'WO request' : 'PO request'} created.`, 'success');
    } catch (err) {
        store.showToast('Release failed: ' + err.message);
        logError('releaseLine', err, { id: line.id });
    } finally {
        store.releasingLineId.value = null;
    }
}

// releaseAllDue — release every due line sequentially (order preserved).
export async function releaseAllDue() {
    const due = [...store.releaseDueLines.value];
    for (const line of due) await releaseLine(line);
}

// closeRun / cancelRun — run lifecycle.
export async function closeRun(run) {
    try {
        const { error } = await db.updatePlanningRun(run.id, { status: 'closed' });
        if (error) throw error;
        store.showToast('Run closed.', 'success');
        store.selectedRun.value = null;
        loadPlanningRuns();
    } catch (err) {
        store.showToast('Close failed: ' + err.message);
        logError('closeRun', err, { id: run.id });
    }
}
export async function cancelRun(run) {
    try {
        const { error } = await db.updatePlanningRun(run.id, { status: 'cancelled' });
        if (error) throw error;
        store.showToast('Run cancelled.', 'success');
        store.selectedRun.value = null;
        loadPlanningRuns();
    } catch (err) {
        store.showToast('Cancel failed: ' + err.message);
        logError('cancelRun', err, { id: run.id });
    }
}
