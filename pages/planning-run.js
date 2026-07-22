// ============================================================
// pages/planning-run.js — Plan tab: pick base unit, qty, option
// splits → explodeAndNet → save the run. Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { explodeAndNet, sanitizeText, bucketPartWip, normalizePartNumberStrict } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// selectPlanBaseUnit — load one base unit's kit and build the split editor
// (steps grouped from option rows; the default choice pre-takes the full qty).
export async function selectPlanBaseUnit(id) {
    if (!id) { store.planBaseUnit.value = null; store.planSplits.value = []; return; }
    try {
        const { data, error } = await db.fetchBaseUnitDetail(id);
        if (error) throw error;
        store.planBaseUnit.value = data;
        const groups = {};
        data.options.forEach(o => {
            const key = `${o.sort_order}|${o.option_group}`;
            if (!groups[key]) groups[key] = { group: o.option_group, required: o.required, choices: [] };
            groups[key].choices.push({
                label: o.choice_label,
                parts: o.parts,
                partLess: !o.parts.length,
                isDefault: o.is_default,
                qty: 0,
            });
        });
        store.planSplits.value = Object.keys(groups).sort().map(k => groups[k]);
        applyDefaultSplits();
    } catch (err) {
        store.showToast('Failed to load base unit: ' + err.message);
        logError('selectPlanBaseUnit', err, { id });
    }
}

// applyDefaultSplits — give each step's default choice the full plan qty
// (only where the step is still untouched / all zero).
export function applyDefaultSplits() {
    const qty = Number(store.planQty.value) || 0;
    store.planSplits.value.forEach(s => {
        const total = s.choices.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
        if (total !== 0) return;
        const def = s.choices.find(c => c.isDefault) || s.choices[0];
        if (def && s.required) def.qty = qty;
    });
}

// togglePlanChoice — tick a choice into (or out of) the plan. The first choice
// picked in a step takes the whole plan quantity; each further pick takes only
// what is still unallocated, so a split is adjusted by hand from there. The qty
// box stays the source of truth — the tick mark is just `qty > 0`, so the two
// can never drift apart.
export function togglePlanChoice(step, choice) {
    if (!step || !choice) return;
    if (Number(choice.qty) > 0) { choice.qty = 0; return; }
    const qty = Number(store.planQty.value) || 0;
    const allocated = step.choices.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
    choice.qty = Math.max(0, qty - allocated);
    if (!(choice.qty > 0)) {
        store.showToast('Step is already fully allocated — lower another choice first.');
    }
}

// runPlanningCalc — validate, build demands, fetch every engine input in
// parallel, run explodeAndNet, save the run + lines, jump to Review.
export async function runPlanningCalc() {
    const bu  = store.planBaseUnit.value;
    const qty = Number(store.planQty.value) || 0;
    if (!bu)        { store.showToast('Pick a base unit first.'); return; }
    if (!(qty > 0)) { store.showToast('Enter a quantity to plan.'); return; }
    if (!store.planSplitsValid.value) {
        store.showToast('Required option steps must total exactly the plan quantity.');
        return;
    }
    store.planRunning.value = true;
    try {
        // Demand roots: the base part × qty, plus each chosen option package.
        const basePart = bu.unit.base_part_number_normalized || bu.unit.base_part_number;
        const demands = [{ part_number: basePart, qty }];
        let partLessPlanned = 0;
        if (store.planMode.value === 'full_kit') {
            store.planSplits.value.forEach(s => s.choices.forEach(c => {
                const cq = Number(c.qty) || 0;
                if (!(cq > 0)) return;
                if (c.partLess) { partLessPlanned += cq; return; }
                c.parts.forEach(p => demands.push({
                    part_number: p.part_number,
                    qty: cq * (Number(p.qty_per_unit) || 1),
                }));
            }));
        }

        const { data: bomRows, error: treeErr, truncated } = await db.fetchBomTreeRows(
            demands.map(d => d.part_number));
        if (treeErr) throw treeErr;
        if (truncated) store.showToast('BOM deeper than 12 levels — deepest levels skipped.', 'error');

        const allParts = new Set(demands.map(d => d.part_number));
        bomRows.forEach(r => { allParts.add(r.item_parent_normalized); allParts.add(r.item_child_normalized); });
        const partList = [...allParts];

        const [oh, wip, po, prm, mb] = await Promise.all([
            db.fetchOnHandForParts(partList),
            db.fetchPartsWipBatch(partList),
            db.fetchOpenPoSupply(partList),
            db.fetchPartPlanningParams(partList),
            db.fetchMakeBuyAttrs(partList),
        ]);
        for (const r of [oh, wip, po, prm, mb]) if (r.error) throw r.error;

        // In-flight supply. The WIP RPC keys on the strict normalization
        // (dashes/spaces stripped) while the engine keys on trim+upper, so
        // each part is looked up under its strict key and stored under its
        // engine key. Only COMMITTED work is subtracted — pending requests are
        // carried for display and never enter the netting.
        const inFlight = {}, inProd = {}, requested = {};
        partList.forEach(part => {
            const b = bucketPartWip(wip.data[normalizePartNumberStrict(part)] || null, null);
            inFlight[part]  = b.inProduction + b.completedNotReceived + b.receivedNotClosed;
            inProd[part]    = b.inProduction;
            requested[part] = b.requested;
        });

        // The base part is a pseudo-item: always phantom (blow straight through).
        const params = { ...prm.data, [basePart]: { ...(prm.data[basePart] || {}), phantom: true } };

        const result = explodeAndNet({
            demands, bomRows,
            onHand: oh.data, inFlight, openPo: po.data,
            params, makeBuy: mb.data,
        });
        if (result.cycleDetected) store.showToast('Circular BOM detected — affected branches truncated.', 'error');

        // Attach the supply snapshots the engine does not carry: the
        // in-production portion (continuity with older runs) and the advisory
        // requested qty (displayed, never subtracted).
        const lines = result.rows.filter(r => !r.phantom).map(r => ({
            ...r,
            open_wo:   inProd[r.part_number]    || 0,
            requested: requested[r.part_number] || 0,
        }));
        const { error: runErr } = await db.insertPlanningRun({
            base_unit_id: bu.unit.id,
            family_name: bu.unit.family_name,
            plan_qty: qty,
            mode: store.planMode.value,
            option_splits: store.planSplits.value.map(s => ({
                group: s.group, required: s.required,
                choices: s.choices.map(c => ({ label: c.label, qty: Number(c.qty) || 0 })),
            })),
            required_date: store.planRequiredDate.value || null,
            notes: sanitizeText(store.planNotes.value || '') || null,
            created_by: store.sessionRole.value || null,
        }, lines);
        if (runErr) throw runErr;

        let msg = `Run saved — ${lines.length} parts across ${result.maxDepth + 1} levels.`;
        if (partLessPlanned > 0) msg += ` ${partLessPlanned} unit(s) of part-less options NOT in material calc.`;
        store.showToast(msg, 'success');
        // Tab switch triggers the review loader via the planningTab watch in
        // main.js (pages never import pages); the fresh run is newest → auto-selected.
        store.selectedRun.value = null;
        store.planningTab.value = 'review';
    } catch (err) {
        store.showToast('Planning calc failed: ' + err.message);
        logError('runPlanningCalc', err);
    } finally {
        store.planRunning.value = false;
    }
}
