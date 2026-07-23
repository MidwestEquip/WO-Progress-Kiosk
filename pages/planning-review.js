// ============================================================
// pages/planning-review.js — Review tab: run list, line grid,
// approve, and release into the wo_requests / purchasing pipelines.
// Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { buildWhereUsedIndex, buildRunChildIndex, computeQtyCascade, bucketPartWip } from '../libs/utils.js';
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

// selectRun — load one run's lines into the grid, then fill in the reference
// data the lines do not store (descriptions, where-used).
export async function selectRun(run) {
    store.selectedRun.value = run;
    store.runLines.value = [];
    store.runLineDescrips.value = {};
    store.runWhereUsed.value  = {};
    store.runChildIndex.value = {};   // else a qty cascade uses the last run's tree
    if (!run) return;
    store.runLinesLoading.value = true;
    try {
        const { data, error } = await db.fetchRunLines(run.id);
        if (error) throw error;
        store.runLines.value = data.map(l => ({ ...l, checked: false }));
        _loadRunLineRefs(run.id, data);
    } catch (err) {
        store.showToast('Failed to load run lines: ' + err.message);
        logError('selectRun', err, { id: run.id });
    } finally {
        store.runLinesLoading.value = false;
    }
}

// _loadRunLineRefs — non-blocking companion load for the selected run:
// item_master descriptions, and the where-used index inverted from the live
// BOM. Both are derived rather than snapshotted on the line — a description or
// a BOM link is current-state reference data, not a calc-time number like
// on_hand_snap. Guarded on the still-selected run so a fast run switch cannot
// paint one run's references over another's.
async function _loadRunLineRefs(runId, lines) {
    const parts = [...new Set((lines || []).map(l => l.part_number_normalized || l.part_number))];
    if (!parts.length) return;
    store.runRefsLoading.value = true;
    try {
        const [descs, boms] = await Promise.all([
            db.fetchItemDescriptions(parts),
            db.fetchBomsForParents(parts),
        ]);
        if (store.selectedRun.value?.id !== runId) return;
        if (descs.error) throw descs.error;
        if (boms.error)  throw boms.error;
        store.runLineDescrips.value = descs.data || {};
        store.runWhereUsed.value  = buildWhereUsedIndex(boms.data, parts);
        store.runChildIndex.value = buildRunChildIndex(boms.data, parts);
    } catch (err) {
        store.showToast('Line descriptions / where-used failed to load: ' + err.message);
        logError('_loadRunLineRefs', err, { runId });
    } finally {
        if (store.selectedRun.value?.id === runId) store.runRefsLoading.value = false;
    }
}

// saveLineQty — a qty edit from the grid. Saves the line, then (if this part
// has subparts in the run and the qty actually moved) offers to push the same
// change down the subtree. The parent is saved either way — cancelling the
// dialog leaves the parent changed and the children alone.
export async function saveLineQty(line, newQty) {
    const from = Number(line.override_qty ?? line.recommended) || 0;
    const to   = Number(newQty);
    if (!Number.isFinite(to) || to < 0) { store.showToast('Enter a quantity of 0 or more.'); return; }
    await saveLineEdit(line, { override_qty: to });
    if (to === from) return;

    const part = line.part_number_normalized || line.part_number;
    const linesByPart = {};
    store.runLines.value.forEach(l => { linesByPart[l.part_number_normalized || l.part_number] = l; });
    const { changes, skipped } = computeQtyCascade(
        part, to - from, store.runChildIndex.value, linesByPart);
    if (!changes.length && !skipped.length) return;   // no subparts in this run

    store.qtyCascadePreview.value = { part, from, to, delta: to - from, changes, skipped };
    store.qtyCascadeOpen.value = true;
}

// applyQtyCascade — write the previewed child quantities. Each line is saved
// individually (no bulk endpoint); a failure stops the batch and reports how
// far it got, so the grid is never silently half-applied without saying so.
export async function applyQtyCascade() {
    const preview = store.qtyCascadePreview.value;
    if (!preview) return;
    const byPart = {};
    store.runLines.value.forEach(l => { byPart[l.part_number_normalized || l.part_number] = l; });
    store.qtyCascadeSaving.value = true;
    let done = 0;
    try {
        for (const c of preview.changes) {
            const line = byPart[c.part];
            if (!line) continue;
            const { data, error } = await db.updateRunLine(line.id, {
                override_qty: c.to, updated_by: store.sessionRole.value || null,
            });
            if (error) throw error;
            Object.assign(line, data);
            done++;
        }
        store.showToast(`Updated ${done} subpart line(s).`, 'success');
        closeQtyCascade();
    } catch (err) {
        store.showToast(`Cascade stopped after ${done} of ${preview.changes.length}: ${err.message}`);
        logError('applyQtyCascade', err, { part: preview.part, done });
    } finally {
        store.qtyCascadeSaving.value = false;
    }
}

export function closeQtyCascade() {
    store.qtyCascadeOpen.value = false;
    store.qtyCascadePreview.value = null;
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

// toggleSelectAllRunLines — check every selectable row in the CURRENT filtered
// view, or clear them all when they are already checked. Rows hidden by the
// filter are left alone. No args, no return.
export function toggleSelectAllRunLines() {
    const next = !store.runLinesAllChecked.value;
    store.selectableRunLines.value.forEach(l => { l.checked = next; });
}

// approveSelected — proposed → approved for the CHECKED lines only (use Select
// All to take the whole list), skipping held/unclassified/zero-qty rows;
// default release date = today.
export async function approveSelected() {
    const targets = store.runLines.value.filter(l =>
        l.checked && l.line_status === 'proposed' && !l.hold && l.action !== 'review'
        && Number(l.override_qty ?? l.recommended) > 0);
    if (!targets.length) { store.showToast('Nothing checked to approve (unclassified lines need a Make/Buy pick first).'); return; }
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

// setLineMakeBuy — planner override of the make/buy classification. Persists
// make_buy_override on part_planning (so every future run agrees), then
// reflects it on the line locally: action + source 'override'. This is the
// only way to clear a 'review' line so it can be released.
export async function setLineMakeBuy(line, value) {
    if (value !== 'make' && value !== 'buy') return;
    try {
        const { error } = await db.upsertPartPlanning({
            part_number: line.part_number,
            make_buy_override: value,
            updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        Object.assign(line, { action: value, action_source: 'override' });
        store.showToast(`${line.part_number}: set to ${value}.`, 'success');
    } catch (err) {
        store.showToast('Make/Buy change failed: ' + err.message);
        logError('setLineMakeBuy', err, { id: line.id });
    }
}

// lineMakeBuyTooltip — the classification evidence for a line's Action cell.
export function lineMakeBuyTooltip(line) {
    const made = line.qty_made_12mo == null ? '—' : line.qty_made_12mo;
    const pur  = line.qty_purchased_12mo == null ? '—' : line.qty_purchased_12mo;
    const src  = line.action_source ? ` · via ${line.action_source}` : '';
    return `12mo made ${made} · purchased ${pur}${src}`;
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
    // Unclassified lines have no destination — a WO request and a PO request are
    // different pipelines. Force a Make/Buy choice before anything is created.
    if (line.action !== 'make' && line.action !== 'buy') {
        store.showToast(`${line.part_number}: classify as Make or Buy before releasing.`);
        return;
    }
    store.releasingLineId.value = line.id;
    try {
        const part = line.part_number_normalized;
        const [oh, wip, po, prm] = await Promise.all([
            db.fetchOnHandForParts([part]),
            db.fetchPartWip(part),
            db.fetchOpenPoSupply([part]),
            db.fetchPartPlanningParams([part]),
        ]);
        const p = prm.data[part] || {};
        // Same in-flight measure the calc used, or release would create work
        // the plan already said was covered. Pending requests stay excluded.
        const b = bucketPartWip(wip.data, null);
        const inFlight = b.inProduction + b.completedNotReceived + b.receivedNotClosed;
        const live = Math.max(0,
            (Number(line.gross) || 0) + (Number(p.min_stock) || 0)
            - (Number(oh.data[part]?.on_hand) || 0)
            - inFlight - (Number(po.data[part]) || 0));
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

// releaseAllDueGroup — release one action group (Make or Buy) from the split
// release-due panel. Same per-line gate as releaseLine (live re-net, skip).
export async function releaseAllDueGroup(lines) {
    for (const line of [...(lines || [])]) await releaseLine(line);
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
