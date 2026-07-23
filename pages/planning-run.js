// ============================================================
// pages/planning-run.js — Plan tab: pick base unit, qty, option
// splits → explodeAndNet → save the run. Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { explodeAndNet, sanitizeText, bucketPartWip, normalizePartNumberStrict,
         normalizePartNumber, applyYearSupplyNetting, applyPctAdjust,
         choiceSupportableQty } from '../libs/utils.js';
import { PLAN_BASIS_YEAR_SUPPLY, PLAN_PCT_ADJUST_MIN, PLAN_PCT_ADJUST_MAX } from '../libs/config-planning.js';
import { logError } from '../libs/db-shared.js';

// selectPlanBaseUnit — load one base unit's kit and build the split editor
// (steps grouped from option rows; the default choice pre-takes the full qty).
export async function selectPlanBaseUnit(id) {
    if (!id) {
        store.planBaseUnit.value = null; store.planSplits.value = [];
        store.planBaseSold.value = null; store.planQtyIsAuto.value = true;
        store.planOptionDemand.value = {};
        return;
    }
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
                demand: null,   // 12-month demand, filled by loadOptionDemand
            });
        });
        store.planSplits.value = Object.keys(groups).sort().map(k => groups[k]);
        applyDefaultSplits();
        loadBaseUnitSold(data.unit);
        loadOptionDemand(data.unit);
    } catch (err) {
        store.showToast('Failed to load base unit: ' + err.message);
        logError('selectPlanBaseUnit', err, { id });
    }
}

// loadBaseUnitSold — fetch how many of this unit sold over the rolling window
// and, on the year-supply basis, auto-fill Qty to Plan from it.
//
// Non-blocking and non-fatal: the planner can type a qty by hand while this is
// in flight, and a failed lookup must never block planning. Guarded on the unit
// still being selected when the fetch lands (fast re-selects), and it never
// overwrites a qty the planner typed themselves (planQtyIsAuto).
async function loadBaseUnitSold(unit) {
    if (!unit) return;
    store.planBaseSold.value = null;
    store.planBaseSoldLoading.value = true;
    try {
        const { data, error } = await db.fetchBaseUnitSold12Mo(
            unit.included_configs || [], unit.base_part_number);
        if (error) throw error;
        if (store.planBaseUnit.value?.unit?.id !== unit.id) return;   // stale
        store.planBaseSold.value = data;
        if (data.total > 0) applyAutoPlanQty();
        else store.showToast('No sales history for this unit in the last 12 months — enter a qty by hand.');
    } catch (err) {
        store.showToast('Could not load sold history: ' + err.message);
        logError('loadBaseUnitSold', err, { unit: unit.family_name });
    } finally {
        store.planBaseSoldLoading.value = false;
    }
}

// loadOptionDemand — 12-month demand for every option part in the kit.
//
// Without this, an option left at qty 0 never enters the run at all, so it is
// never sized from its own demand — the planner has to guess the split by hand.
// Same two batch calls and the same rolling window as the run itself, so a
// choice's number here and its line in Review come from identical inputs.
//
// Non-blocking and non-fatal; stale-guarded against fast re-selects.
async function loadOptionDemand(unit) {
    const parts = _allOptionParts();
    if (!unit || !parts.length) { store.planOptionDemand.value = {}; return; }
    store.planOptionDemand.value = {};
    store.planOptionDemandLoading.value = true;
    try {
        const win = db.planningDemandWindow();
        const [soldRes, parentRes] = await Promise.all([
            db.fetchQtySoldFromSalesAnalysis(parts, win.start, win.end),
            db.fetchPartsParentDemandBatch(parts, win.start, win.end),
        ]);
        if (soldRes.error)   throw soldRes.error;
        if (parentRes.error) throw parentRes.error;
        if (store.planBaseUnit.value?.unit?.id !== unit.id) return;   // stale
        const demand = {};
        parts.forEach(p => {
            demand[p] = (Number(soldRes.data[p]) || 0) + (Number(parentRes.data[p]) || 0);
        });
        store.planOptionDemand.value = demand;
        // Stamp each choice with what its own history supports. Held on the
        // choice (not recomputed in the template) so the step editor stays
        // logic-free and the number survives a basis switch.
        store.planSplits.value.forEach(s => s.choices.forEach(c => {
            c.demand = c.partLess ? null : choiceSupportableQty(c.parts, demand);
        }));
        applyOptionDemandQtys();
    } catch (err) {
        store.showToast('Could not load option demand: ' + err.message);
        logError('loadOptionDemand', err, { unit: unit.family_name });
    } finally {
        store.planOptionDemandLoading.value = false;
    }
}

// _allOptionParts — every normalized part number across every choice in the
// current kit, de-duplicated.
function _allOptionParts() {
    const set = new Set();
    store.planSplits.value.forEach(s => s.choices.forEach(c =>
        (c.parts || []).forEach(p => {
            const n = normalizePartNumber(p.part_number);
            if (n) set.add(n);
        })));
    return [...set];
}

// applyOptionDemandQtys — size every option choice from its own demand.
//
// Year-supply basis only: on the kit basis the steps are a manual allocation of
// the plan qty and must not be touched. Runs when the demand lands and whenever
// the % changes — the same rule as the Qty to Plan box, where a % change means
// "give me the suggested numbers again", so a hand-typed choice qty is replaced
// at that point and only at that point.
export function applyOptionDemandQtys() {
    if (store.planBasis.value !== PLAN_BASIS_YEAR_SUPPLY) return;
    const pct = store.planPctAdjust.value;
    store.planSplits.value.forEach(s => s.choices.forEach(c => {
        if (c.partLess || c.demand == null) return;   // part-less: not in the material calc
        c.qty = applyPctAdjust(c.demand, pct);
    }));
}

// applyAutoPlanQty — push the sales-derived qty into the Qty to Plan box.
// Only on the year-supply basis, and only while the box is still auto (the
// planner has not typed over it). Re-runs the option splits so a required
// step still totals the new qty.
export function applyAutoPlanQty() {
    if (store.planBasis.value !== PLAN_BASIS_YEAR_SUPPLY) return;
    if (!store.planQtyIsAuto.value) return;
    const auto = store.planAutoQty.value;
    if (!(auto > 0)) return;
    store.planQty.value = auto;
    applyDefaultSplits();
}

// setPlanPctAdjust — Adjust % changed. Clamped to the config bounds, and it
// re-opts the qty box back into auto: asking for +10% means you want the
// suggested number again, not your old hand-typed one.
export function setPlanPctAdjust(value) {
    let p = Math.round(Number(value));
    if (!Number.isFinite(p)) p = 0;
    store.planPctAdjust.value = Math.min(PLAN_PCT_ADJUST_MAX, Math.max(PLAN_PCT_ADJUST_MIN, p));
    store.planQtyIsAuto.value = true;
    applyAutoPlanQty();
    applyOptionDemandQtys();
}

// onPlanQtyInput — the planner typed in Qty to Plan. Detach from auto so the
// sold lookup cannot stomp the number, then re-split.
export function onPlanQtyInput() {
    store.planQtyIsAuto.value = false;
    applyDefaultSplits();
}

// setPlanBasis — switch sizing basis. Moving to year supply fills the qty from
// sales if it is still auto; moving back to kit leaves the number alone (it is
// a perfectly good qty to explode).
export function setPlanBasis(basis) {
    store.planBasis.value = basis === PLAN_BASIS_YEAR_SUPPLY ? PLAN_BASIS_YEAR_SUPPLY : 'kit';
    applyAutoPlanQty();
    applyOptionDemandQtys();
}

// applyDefaultSplits — give each step's default choice the full plan qty
// (only where the step is still untouched / all zero).
export function applyDefaultSplits() {
    const qty  = Number(store.planQty.value) || 0;
    const prev = store.planSplitQtyApplied.value;
    store.planSplits.value.forEach(s => {
        const filled = s.choices.filter(c => Number(c.qty) > 0);
        if (!filled.length) {
            const def = s.choices.find(c => c.isDefault) || s.choices[0];
            if (def && s.required) def.qty = qty;
            return;
        }
        // A step still holding an untouched auto-fill (one choice carrying the
        // WHOLE previous plan qty) follows the qty when it changes — otherwise a
        // % nudge left the step stuck at the old number and reading as invalid.
        // Deliberately narrow: any hand-made split has ≥2 filled choices or a
        // number that never equalled the plan qty, and is never touched.
        if (s.required && filled.length === 1 && prev > 0 && Number(filled[0].qty) === prev) {
            filled[0].qty = qty;
        }
    });
    store.planSplitQtyApplied.value = qty;
}

// togglePlanChoice — tick a choice into (or out of) the plan. The first choice
// picked in a step takes the whole plan quantity; each further pick takes only
// what is still unallocated, so a split is adjusted by hand from there. The qty
// box stays the source of truth — the tick mark is just `qty > 0`, so the two
// can never drift apart.
export function togglePlanChoice(step, choice) {
    if (!step || !choice) return;
    if (Number(choice.qty) > 0) { choice.qty = 0; return; }
    // Year supply: choices are not an allocation of the plan qty — each carries
    // its own demand — so re-ticking restores that, not "whatever is left over".
    // (The allocation path below would find the step already full and refuse.)
    if (store.planBasis.value === PLAN_BASIS_YEAR_SUPPLY && choice.demand != null) {
        choice.qty = applyPctAdjust(choice.demand, store.planPctAdjust.value);
        if (!(choice.qty > 0)) store.showToast('No 12-month demand found for this option.');
        return;
    }
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

        const [oh, wip, po, prm, mb, usage] = await Promise.all([
            db.fetchOnHandForParts(partList),
            db.fetchPartsWipBatch(partList),
            db.fetchOpenPoSupply(partList),
            db.fetchPartPlanningParams(partList),
            db.fetchMakeBuyAttrs(partList),
            db.fetchPartsUsageSummaryBatch(partList),
        ]);
        for (const r of [oh, wip, po, prm, mb, usage]) if (r.error) throw r.error;

        // Make/buy history: rolling-12mo made vs purchased per part, the
        // classifier's primary signal (override + attr are fallbacks).
        const mbHistory = {};
        partList.forEach(part => {
            const u = usage.data[part];
            if (u) mbHistory[part] = { made: u.qty_made_12mo, purchased: u.qty_purchased_12mo };
        });

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
            params, makeBuy: mb.data, makeBuyHistory: mbHistory,
        });
        if (result.cycleDetected) store.showToast('Circular BOM detected — affected branches truncated.', 'error');

        // Year-supply basis: the explosion above decided WHICH parts are in the
        // run and at what level; this re-sizes each one from its own 12-month
        // demand so parts sold as service parts are not silently eaten out of
        // the kit. Fetched here (not in the Promise.all above) because it only
        // needs the part list the explosion produced.
        let rows = result.rows, noHistoryParts = [];
        const isYear = store.planBasis.value === PLAN_BASIS_YEAR_SUPPLY;
        if (isYear) {
            const yearWindow = db.planningDemandWindow();
            const [soldRes, parentRes] = await Promise.all([
                db.fetchQtySoldFromSalesAnalysis(partList, yearWindow.start, yearWindow.end),
                db.fetchPartsParentDemandBatch(partList, yearWindow.start, yearWindow.end),
            ]);
            // Hard-fail: a partial demand map would silently zero out real
            // parts, which is worse than not saving the run at all.
            if (soldRes.error)   throw soldRes.error;
            if (parentRes.error) throw parentRes.error;
            const sized = applyYearSupplyNetting({
                rows, sold: soldRes.data, parent: parentRes.data,
                pct: store.planPctAdjust.value, params,
            });
            rows = sized.rows;
            noHistoryParts = sized.noHistoryParts;
        }

        // Attach the supply snapshots the engine does not carry: the
        // in-production portion (continuity with older runs) and the advisory
        // requested qty (displayed, never subtracted).
        const lines = rows.filter(r => !r.phantom).map(r => ({
            ...r,
            open_wo:    inProd[r.part_number]    || 0,
            requested:  requested[r.part_number] || 0,
            // Whether on_hand_snap came from a count or an estimate, captured
            // from the same live read the engine netted against.
            basis_snap: oh.data[r.part_number]?.basis || null,
        }));
        const { error: runErr } = await db.insertPlanningRun({
            base_unit_id: bu.unit.id,
            family_name: bu.unit.family_name,
            plan_qty: qty,
            mode: store.planMode.value,
            plan_basis: store.planBasis.value,
            pct_adjust: isYear ? store.planPctAdjust.value : 0,
            base_sold_12mo: isYear ? (store.planBaseSold.value?.total ?? null) : null,
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
        // Loud and separate: a no-history part is sized 0 and will not get built
        // unless someone looks at it. Almost always a missing BOM link.
        if (noHistoryParts.length) {
            store.showToast(`${noHistoryParts.length} part(s) have no 12-month demand — sized 0. Check the red flags in Review.`, 'error');
        }
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
