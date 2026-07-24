// ============================================================
// pages/planning-review.js — Review tab: run list, line grid,
// approve, and release into the wo_requests / purchasing pipelines.
// Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { buildWhereUsedIndex, buildRunChildIndex, bucketPartWip,
    computeUrgencyReleaseDates } from '../libs/utils.js';
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

// approveSelected — proposed → approved for the CHECKED lines only (use Select
// All to take the whole list), skipping held/unclassified/zero-qty rows.
// Release dates are auto-set by urgency: a part's runway (on_hand ÷ year
// demand) minus a make buffer, so low-stock parts release first. Editable
// afterward in the grid's date cell.
export async function approveSelected() {
    const targets = store.runLines.value.filter(l =>
        l.checked && l.line_status === 'proposed' && !l.hold && l.action !== 'review'
        && Number(l.override_qty ?? l.recommended) > 0);
    if (!targets.length) { store.showToast('Nothing checked to approve (unclassified lines need a Make/Buy pick first).'); return; }
    store.runApproving.value = true;
    try {
        // Open-order qty per part drives the priority tiebreak (and the daily
        // cap scheduler) — non-fatal: on failure we date by pure runway order.
        const parts = [...new Set(targets.map(l => l.part_number_normalized).filter(Boolean))];
        const { data: openOrderQty, error: ooErr } = await db.fetchOpenOrderQtyForParts(parts);
        if (ooErr) logError('approveSelected.openOrders', ooErr);
        const dateMap = computeUrgencyReleaseDates(targets, {
            today: new Date(), openOrderQty: openOrderQty || {},
        });
        for (const l of targets) {
            const { data, error } = await db.updateRunLine(l.id, {
                line_status: 'approved',
                planned_release_date: dateMap[l.id] || l.planned_release_date || _today(),
                updated_by: store.sessionRole.value || null,
            });
            if (error) throw error;
            Object.assign(l, data, { checked: false });
        }
        store.showToast(`${targets.length} line(s) approved · release dates set by urgency.`, 'success');
        loadReleaseDue();
    } catch (err) {
        store.showToast('Approve failed: ' + err.message);
        logError('approveSelected', err);
    } finally {
        store.runApproving.value = false;
    }
}

// exportSelectedToCount — send the CHECKED lines' parts to the Inventory Count
// sheet so someone can physically count them. Parts already sitting unadjusted
// on the sheet are skipped rather than duplicated (one open line per part).
// Does NOT change line_status — exporting is not approving or releasing.
export async function exportSelectedToCount() {
    const targets = store.runLines.value.filter(l => l.checked);
    if (!targets.length) { store.showToast('Check the lines you want to count first.'); return; }
    store.runExportingCount.value = true;
    try {
        const parts = [...new Set(targets.map(l => l.part_number_normalized || l.part_number))];
        const { data: onSheet, error: dupErr } = await db.fetchOpenCountParts(parts);
        if (dupErr) throw dupErr;
        const rows = targets
            .filter(l => !onSheet.has(l.part_number_normalized || (l.part_number || '').trim().toUpperCase()))
            .filter((l, i, arr) => arr.findIndex(o =>
                (o.part_number_normalized || o.part_number) === (l.part_number_normalized || l.part_number)) === i)
            .map(l => ({
                part_number:   l.part_number,
                source:        'planning_run',
                source_run_id: l.run_id ?? store.selectedRun.value?.id ?? null,
                created_by:    store.sessionRole.value || null,
            }));
        const skipped = targets.length - rows.length;
        if (rows.length) {
            const { error } = await db.insertInventoryCountLines(rows);
            if (error) throw error;
        }
        store.runLines.value.forEach(l => { if (l.checked) l.checked = false; });
        store.showToast(
            `${rows.length} part(s) sent to Inventory Count` + (skipped ? ` · ${skipped} already on the sheet.` : '.'),
            rows.length ? 'success' : 'info');
    } catch (err) {
        store.showToast('Export to count failed: ' + err.message);
        logError('exportSelectedToCount', err, { runId: store.selectedRun.value?.id });
    } finally {
        store.runExportingCount.value = false;
    }
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
    return `3yr made ${made} · purchased ${pur}${src}`;
}

// isPlanLineDue — is this approved line ready to go out (dated today or
// earlier)? Future-dated lines are "scheduled" and cannot release yet. Pure,
// reactive: editing a line's date to today flips it without a reload.
export function isPlanLineDue(line) {
    const d = line && line.planned_release_date;
    return !!d && d <= _today();
}

// loadReleaseDue — the full send schedule: ALL approved lines (any date), each
// MAKE line stamped with material readiness (direct BOM children on hand vs
// needed: 'ready' | 'partial' | 'waiting' | null when no BOM/not a make).
// Only lines dated today-or-earlier (isPlanLineDue) actually release.
export async function loadReleaseDue() {
    try {
        const { data, error } = await db.fetchApprovedLines();
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

// The routing fields a released make line prefills onto its wo_request.
const _RELEASE_ROUTING_FIELDS = ['fab', 'fab_print', 'weld', 'weld_print', 'assy_wo',
    'color', 'bent_rolled_part', 'set_up_time', 'estimated_lead_time', 'staging_area'];

// _mergeReleaseRouting — routing prefill for a released make line. The part's
// LAST ACTUALLY-MADE WO wins field by field; the learned part_approval_defaults
// row fills only what that WO left blank; anything neither knows stays null for
// the manager to fill at approval. `false` and `0` are real values, not blanks.
function _mergeReleaseRouting(lastMade, defaults) {
    const a = lastMade || {}, b = defaults || {};
    const isBlank = v => v === null || v === undefined || v === '';
    const out = {};
    _RELEASE_ROUTING_FIELDS.forEach(f => {
        out[f] = !isBlank(a[f]) ? a[f] : (!isBlank(b[f]) ? b[f] : null);
    });
    return out;
}

// releaseLine — the release gate. Re-nets against LIVE numbers first (snapshot
// gross + min − live on-hand/WO/PO, batch rules re-applied); a line that is no
// longer needed is skipped, not created. Make/review → a manager_review
// wo_request (lands in Approve WO Creation, awaiting the manager's Final
// Approve) with routing prefilled from the last WO actually made, falling back
// to learned defaults; buy → purchasing part request.
// opts.deferRunCheck skips the "run fully executed?" check (batch callers run
// it once at the end instead of per line).
export async function releaseLine(line, opts = {}) {
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
            if (!opts.deferRunCheck && await maybeMarkRunExecuted(line.run_id)) loadPlanningRuns();
            return;
        }

        let refType, refId;
        if (line.action === 'buy') {
            const { data, error } = await db.createPoRequestFromLine(line, qty, store.sessionRole.value);
            if (error) throw error;
            refType = 'purchasing_order'; refId = data.id;
        } else {
            const [{ data: defs }, lastMade] = await Promise.all([
                db.fetchRoutingDefaultsForParts([part]),
                db.fetchLastMadeRoutingForPart(part),
            ]);
            const routing = _mergeReleaseRouting(lastMade.data, defs[part]);
            const { data, error } = await db.createWoRequestFromLine(
                line, qty, routing, store.sessionRole.value);
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
        store.showToast(`${part}: ${qty} → ${refType === 'wo_request' ? 'sent to Approve WO Creation' : 'PO request created'}.`, 'success');
        if (!opts.deferRunCheck && await maybeMarkRunExecuted(line.run_id)) loadPlanningRuns();
    } catch (err) {
        store.showToast('Release failed: ' + err.message);
        logError('releaseLine', err, { id: line.id });
    } finally {
        store.releasingLineId.value = null;
    }
}

// releaseAllDue — commit the whole schedule. DUE lines (today-or-earlier) go
// out to the shop now (WO/PO); FUTURE lines are committed to line_status
// 'scheduled' — they leave the panel and live on the scheduling view until
// their date arrives (Patch 4 auto-releases them). Panel returns to approved
// drafts only.
export async function releaseAllDue() {
    const all    = store.releaseDueLines.value;
    const due    = all.filter(isPlanLineDue);
    const future = all.filter(l => !isPlanLineDue(l));
    if (!due.length && !future.length) { store.showToast('Nothing to send.'); return; }
    // 1) Send the due lines into production / ordering.
    for (const line of due) await releaseLine(line, { deferRunCheck: true });
    // 2) Commit the future lines to the scheduling view.
    let scheduled = 0;
    for (const line of future) {
        const { error } = await db.updateRunLine(line.id, {
            line_status: 'scheduled', updated_by: store.sessionRole.value || null,
        });
        if (error) { logError('releaseAllDue.schedule', error, { id: line.id }); continue; }
        scheduled++;
    }
    if (scheduled) {
        const gone = new Set(future.map(l => l.id));
        store.releaseDueLines.value = store.releaseDueLines.value.filter(l => !gone.has(l.id));
    }
    await _finalizeReleasedRuns(due);
    store.showToast(`${due.length} sent · ${scheduled} scheduled.`, 'success');
}

// releaseAllDueGroup — send one action group's DUE lines (Make or Buy). Future
// lines are skipped. Same per-line gate as releaseLine (live re-net, skip).
export async function releaseAllDueGroup(lines) {
    const grp = (lines || []).filter(isPlanLineDue);
    if (!grp.length) { store.showToast('Nothing due to send in this group.'); return; }
    for (const line of grp) await releaseLine(line, { deferRunCheck: true });
    await _finalizeReleasedRuns(grp);
}

// releaseScheduledDue — auto-release: any committed 'scheduled' line whose date
// has arrived (≤ today) goes out to the shop now. Called on planning-view open
// and from the Schedule tab's manual button. Re-nets live per line (releaseLine)
// so a part covered since scheduling is skipped, not created. Returns the count
// released. Toasts only when it actually releases something.
export async function releaseScheduledDue() {
    const { data, error } = await db.fetchScheduledLines();
    if (error) { logError('releaseScheduledDue', error); return 0; }
    const today = _today();
    const due = (data || []).filter(l => l.planned_release_date && l.planned_release_date <= today);
    if (!due.length) return 0;
    for (const line of due) await releaseLine(line, { deferRunCheck: true });
    await _finalizeReleasedRuns(due);
    const gone = new Set(due.map(l => l.id));
    store.scheduledLines.value = store.scheduledLines.value.filter(l => !gone.has(l.id));
    store.showToast(`${due.length} scheduled line(s) reached their date — released.`, 'success');
    return due.length;
}

// maybeMarkRunExecuted — flip a run to 'executed' (kept as history) once it has
// no pending (proposed/approved) lines left AND at least one released line.
// Returns whether it flipped. Self-contained: swallows its own errors so the
// release itself is never failed by this bookkeeping.
async function maybeMarkRunExecuted(runId) {
    if (!runId) return false;
    try {
        const [{ count: pending, error: pErr }, { count: released, error: rErr }] =
            await Promise.all([db.countRunPendingLines(runId), db.countRunReleasedLines(runId)]);
        if (pErr || rErr || pending > 0 || released < 1) return false;
        const { error } = await db.updatePlanningRun(runId, { status: 'executed' });
        if (error) return false;
        if (store.selectedRun.value?.id === runId) store.selectedRun.value = null;
        return true;
    } catch (err) {
        logError('maybeMarkRunExecuted', err, { runId });
        return false;
    }
}

// _finalizeReleasedRuns — after a batch release, mark each affected run
// executed at most once; refresh the run list if any flipped.
async function _finalizeReleasedRuns(lines) {
    const runIds = [...new Set((lines || []).map(l => l.run_id).filter(Boolean))];
    let any = false;
    for (const id of runIds) if (await maybeMarkRunExecuted(id)) any = true;
    if (any) loadPlanningRuns();
}

// dueGroupCheckedCount — how many lines in a release-due group are checked
// (for the Delete button's label + disabled state).
export function dueGroupCheckedCount(lines) {
    return (lines || []).filter(l => l.checked).length;
}

// toggleSelectAllDue — check every line in a due group, or clear them all when
// they are already fully checked.
export function toggleSelectAllDue(lines) {
    const grp = lines || [];
    const next = !(grp.length && grp.every(l => l.checked));
    grp.forEach(l => { l.checked = next; });
}

// deleteCheckedDue — hard-delete the checked lines of a due group (planning
// artifacts, no downstream WO/PO yet). Confirms with the count, then drops the
// rows from the release-due panel AND the run grid so both stay in sync.
export async function deleteCheckedDue(lines) {
    const targets = (lines || []).filter(l => l.checked);
    if (!targets.length) { store.showToast('Check the lines you want to delete first.'); return; }
    if (!window.confirm(`Delete ${targets.length} planning line(s)? This cannot be undone.`)) return;
    const ids = targets.map(l => l.id);
    try {
        const { error } = await db.deleteRunLines(ids);
        if (error) throw error;
        const gone = new Set(ids);
        store.releaseDueLines.value = store.releaseDueLines.value.filter(l => !gone.has(l.id));
        store.runLines.value = store.runLines.value.filter(l => !gone.has(l.id));
        store.showToast(`${targets.length} line(s) deleted.`, 'success');
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('deleteCheckedDue', err, { count: ids.length });
    }
}

// closeRun / cancelRun — abandon a run: hard-delete its header + all lines.
// A run is only kept once fully executed (auto-marked on final release).
async function _deleteRunConfirmed(run, verb) {
    if (!window.confirm(`${verb} and delete this run (${run.family_name || 'run'})? Its lines are removed. This cannot be undone.`)) return;
    try {
        const { error } = await db.deletePlanningRun(run.id);
        if (error) throw error;
        store.showToast('Run removed.', 'success');
        store.selectedRun.value = null;
        loadPlanningRuns();
        loadReleaseDue();
    } catch (err) {
        store.showToast(`${verb} failed: ` + err.message);
        logError('deletePlanningRun', err, { id: run.id });
    }
}
export async function closeRun(run)  { await _deleteRunConfirmed(run, 'Close'); }
export async function cancelRun(run) { await _deleteRunConfirmed(run, 'Cancel'); }
