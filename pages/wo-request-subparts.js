// ============================================================
// pages/wo-request-subparts.js — WO Request subpart-plan + modal close logic
//
// Handles: the inline subpart WO form, the drill-in Done/Cancel/
//          dismiss flow (restore side), and closing the detail modal.
// Split from wo-request-detail.js (500-line cap). The capture side
// (openWoRequestDetail, _captureDetailSnapshot, inspectSubpart) stays
// there; the shared open-generation counter lives in store-stock.js
// (store.woRequestDetailGen) so neither page file imports the other.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';

const SUBPART_FORM_BLANK = () => ({ expanded: false, defaultsLoaded: false, qty_to_make: '', fab: '', fab_print: '', weld: '', weld_print: '', assy_wo: '', color: '', bent_rolled_part: '', date_to_start: '', estimated_lead_time: '', set_up_time: '' });

// openSubpartWoForm — toggle the inline (compact) WO form for a subpart row; auto-fills
// defaults on first open. The fuller, data-rich alternative is inspectSubpart (full-screen).
// Both edit the same woRequestSubpartForms[key] entry, so either path can be used per row.
export async function openSubpartWoForm(sub) {
    const n = sub.item_child_normalized;
    const forms = store.woRequestSubpartForms.value;
    if (!forms[n]) forms[n] = SUBPART_FORM_BLANK();
    forms[n].expanded = !forms[n].expanded;
    store.woRequestSubpartForms.value = { ...forms };
    if (forms[n].expanded && !forms[n].defaultsLoaded) {
        forms[n].defaultsLoaded = true;
        const { data: d } = await db.fetchPartApprovalDefault(sub.item_child);
        if (d) {
            const F = ['fab','fab_print','weld','weld_print','assy_wo','color','bent_rolled_part'];
            F.forEach(f => { if (!forms[n][f] && d[f]) forms[n][f] = d[f]; });
            store.woRequestSubpartForms.value = { ...forms };
        }
    }
}

export function closeWoRequestDetail() {
    store.selectedWoRequest.value        = null;
    store.woRequestReadOnly.value        = false;
    store.woRequestDefaultsApplied.value = false;
    store.woRequestDetailActiveWos.value = [];
    store.woRequestSubparts.value         = [];
    store.woRequestSubpartsLoading.value  = false;
    store.woRequestSubpartsExpanded.value = false;
    store.woRequestSubpartBins.value      = {};
    store.woRequestSubpartDescs.value     = {};
    store.woRequestSubpartStats.value     = {};
    store.woRequestSubpartForms.value     = {};
    store.woRequestUsedOn.value           = [];
    store.woRequestUsedOnLoading.value    = false;
    store.woRequestRealCount.value        = null;
    store.woRequestSubpartStack.value     = [];
    store.woRequestMarkAllSubparts.value  = false;
}

// _restoreDetailSnapshot — put a captured parent context back; bumps the generation so
// any still-pending subpart loads bail instead of clobbering it.
function _restoreDetailSnapshot(s) {
    store.woRequestDetailGen.value++;
    store.selectedWoRequest.value         = s.selectedWoRequest;
    store.woRequestReadOnly.value         = s.woRequestReadOnly;
    store.woRequestDefaultsApplied.value  = s.woRequestDefaultsApplied;
    store.woRequestDetailForm.value       = s.detailForm;
    store.woRequestDetailActiveWos.value  = s.detailActiveWos;
    store.woRequestRealCount.value        = s.realCount;
    store.woRequestLastMade.value         = s.lastMade;
    store.woRequestSubparts.value         = s.subparts;
    store.woRequestSubpartsExpanded.value = s.subpartsExpanded;
    store.woRequestSubpartForms.value     = s.subpartForms;
    store.woRequestSubpartBins.value      = s.subpartBins;
    store.woRequestSubpartDescs.value     = s.subpartDescs;
    store.woRequestSubpartStats.value     = s.subpartStats;
    store.woRequestUsedOn.value           = s.usedOn;
    store.woFiles.value                   = s.woFiles;
    store.woRequestUsedOnLoading.value    = false;
    store.woRequestSubpartsLoading.value  = false;
    store.woFilesLoading.value            = false;
}

// _detailFormToSubpartPlan — map the detail form back to the compact subpart-plan shape.
function _detailFormToSubpartPlan(f) {
    return {
        expanded: false,
        defaultsLoaded: true,
        qty_to_make:         f.qty_to_make         ?? '',
        fab:                 f.fab                 || '',
        fab_print:           f.fab_print           || '',
        weld:                f.weld                || '',
        weld_print:          f.weld_print          || '',
        assy_wo:             f.assy_wo             || '',
        color:               f.color               || '',
        bent_rolled_part:    f.bent_rolled_part    || '',
        date_to_start:       f.date_to_start       || '',
        estimated_lead_time: f.estimated_lead_time ?? '',
        set_up_time:         f.set_up_time         ?? '',
    };
}

// _SUBPART_PLAN_FIELDS — the data fields copied between subparts (excludes UI flags).
const _SUBPART_PLAN_FIELDS = ['qty_to_make', 'fab', 'fab_print', 'weld', 'weld_print',
    'assy_wo', 'color', 'bent_rolled_part', 'date_to_start', 'estimated_lead_time', 'set_up_time'];
// _isBlankPlanValue — empty string / null / undefined = "not filled yet".
const _isBlankPlanValue = (v) => v === '' || v == null;

// finishSubpartInspect — "Done": write the inspected subpart's plan back to the parent
// map, restore the parent, pop the stack. With "mark all" ticked, also fill every other
// subpart's still-blank fields from this one (never overwrites customized values).
export function finishSubpartInspect() {
    const stack = store.woRequestSubpartStack.value;
    if (!stack.length) return;
    const snap = stack[stack.length - 1];
    const subForm = _detailFormToSubpartPlan(store.woRequestDetailForm.value);
    const markAll = store.woRequestMarkAllSubparts.value;

    _restoreDetailSnapshot(snap);
    store.woRequestSubpartStack.value = stack.slice(0, -1);

    const forms = { ...store.woRequestSubpartForms.value };
    forms[snap.subpartKey] = { ...(forms[snap.subpartKey] || {}), ...subForm };

    if (markAll) {
        // Fill blank fields of every other sibling subpart with this one's values.
        for (const sib of (snap.subparts || [])) {
            const k = sib.item_child_normalized;
            if (k === snap.subpartKey) continue;
            const target = { expanded: false, defaultsLoaded: true, ...(forms[k] || {}) };
            for (const f of _SUBPART_PLAN_FIELDS) {
                if (_isBlankPlanValue(target[f])) target[f] = subForm[f];
            }
            forms[k] = target;
        }
    }
    store.woRequestSubpartForms.value = forms;
    store.woRequestMarkAllSubparts.value = false;
}

// cancelSubpartInspect — discard the inspected subpart's edits and return to the parent.
export function cancelSubpartInspect() {
    const stack = store.woRequestSubpartStack.value;
    if (!stack.length) return;
    _restoreDetailSnapshot(stack[stack.length - 1]);
    store.woRequestSubpartStack.value = stack.slice(0, -1);
    store.woRequestMarkAllSubparts.value = false;
}

// dismissWoRequestDetail — the modal's X / backdrop handler. Pops one subpart level
// (discarding edits) while drilled in; closes the whole modal at the top level.
export function dismissWoRequestDetail() {
    if (store.woRequestSubpartStack.value.length) cancelSubpartInspect();
    else closeWoRequestDetail();
}
