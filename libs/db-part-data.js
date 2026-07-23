// ============================================================
// libs/db-part-data.js — the part reference bundle
//
// ONE definition of "everything we know about a part": replacement
// chain, 12/36-month sold-used-made, recursive parent BOM demand, live
// on-hand + on-units, WIP pipeline, BOM parents, last 3 made.
//
// Every leg is keyed on the PART NUMBER alone — nothing here needs a
// wo_requests row — so any view can ask for it. Returns plain data and
// writes no state; the caller decides what to show.
//
// DEPENDENCY NOTE: this is a composite over sibling db-*.js modules
// (a one-way edge, no cycles — same pattern as store-stock.js importing
// store-inventory.js). Nothing imports back into this file.
// ============================================================

import { PURCHASING_3YR_START } from './config.js';
import { supabase, withRetry }  from './db-shared.js';
import { resolvePartCalcChain } from './db-part-changes.js';
import { fetchOnHandForParts }  from './db-onhand.js';
import { fetchPartWip }         from './db-wip.js';
import {
    fetchPartUsageSummary12Mo, fetchPartUsageSummary36Mo,
    fetchQtySoldFromSalesAnalysis, calculateRecursiveParentUsageDemand,
    fetchBomParentsForChild, fetchBinAndDescForParts,
} from './db-part-defaults.js';

// fetchPartLastMadeOrPurchased — recent MO/I + PO/I rows for a part, tagged
// by kind ('made' | 'purchased'), newest first. SECURITY DEFINER RPC.
// Local to the bundle (db-part-defaults.js is at its 500-line cap).
// Returns { data: [{ txn_date, qty, kind }], error }.
async function fetchPartLastMadeOrPurchased(partNumber) {
    const norm = (partNumber || '').trim().toUpperCase();
    if (!norm) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_last_made_or_purchased', { p_part: norm }));
    return { data: data || [], error };
}

// _settled — run a leg, never let it reject the bundle. A part-data panel is
// reference material: one dead leg should blank one figure, not the screen.
async function _settled(label, promise, fallback, errors) {
    try {
        const { data, error } = await promise;
        if (error) { errors.push(`${label}: ${error.message}`); return fallback; }
        return data ?? fallback;
    } catch (err) {
        errors.push(`${label}: ${err.message}`);
        return fallback;
    }
}

// fetchPartDataBundle — assemble the full reference picture for one part.
//
// Input:  partNumber, opts = { excludeRequestId } — a wo_requests id to leave
//         out of the pipeline legs so a request never counts itself (omit it
//         from views that are not editing a request).
// Output: { data: {
//            part, chain, links,
//            usage12: { qty_sold_used_12mo, qty_used_in_mfg, qty_made_past_12mo },
//            usage36: { qty_sold_used_36mo, qty_used_in_mfg_36mo, qty_made_past_36mo },
//            parentDemand12, parentDemand36,
//            onHand: { on_hand, counted_at } | null,
//            onUnits: { qty, counted, total } | null,
//            wipRaw, usedOn: [{ part, qty, desc }], lastMade: [{ txn_date, qty }],
//          }, errors: [string] }
// Never rejects: legs that fail land in `errors` and leave their figure at the
// fallback, so a partial picture still renders.
export async function fetchPartDataBundle(partNumber, opts = {}) {
    const part = (partNumber || '').trim().toUpperCase();
    const errors = [];
    if (!part) return { data: null, errors: ['No part number given'] };

    const today      = new Date().toISOString().slice(0, 10);
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // The chain gates the history legs (sums span replaced parts), so it is the
    // one awaited step. It self-degrades to [self] rather than throwing.
    const chainRes = await _settled('chain', resolvePartCalcChain(part), { chain: [part], links: [] }, errors);
    const chain = chainRes.chain?.length ? chainRes.chain : [part];

    // Parent demand is shared: its pathDetails carry the ancestor × multiplier
    // data that on-units needs, so it is fetched once, not twice.
    const demand12P = calculateRecursiveParentUsageDemand(part, oneYearAgo, today);

    const [usage12, usage36, sold12Map, sold36Map, demand12, demand36, wipRaw, parentRows, lastMade] =
        await Promise.all([
            _settled('12mo usage', fetchPartUsageSummary12Mo(part, chain),
                { qty_sold_used_12mo: 0, qty_used_in_mfg: 0, qty_made_past_12mo: 0 }, errors),
            _settled('36mo usage', fetchPartUsageSummary36Mo(part, chain),
                { qty_sold_used_36mo: 0, qty_used_in_mfg_36mo: 0, qty_made_past_36mo: 0 }, errors),
            _settled('12mo sold', fetchQtySoldFromSalesAnalysis(chain, oneYearAgo, today), {}, errors),
            _settled('36mo sold', fetchQtySoldFromSalesAnalysis(chain, PURCHASING_3YR_START, today), {}, errors),
            _settled('parent demand 1yr', demand12P, { totalDemand: 0, pathDetails: [] }, errors),
            _settled('parent demand 3yr',
                calculateRecursiveParentUsageDemand(part, PURCHASING_3YR_START, today),
                { totalDemand: 0, pathDetails: [] }, errors),
            _settled('pipeline', fetchPartWip(part), null, errors),
            _settled('used on', fetchBomParentsForChild(part), [], errors),
            _settled('last made/purchased', fetchPartLastMadeOrPurchased(part), [], errors),
        ]);

    // Sales come from sales_analysis_lines summed over the chain — the RPC sums
    // are per-part, so the chain fold happens here (same as the request modal).
    usage12.qty_sold_used_12mo = chain.reduce((s, p) => s + (sold12Map[p] || 0), 0);
    usage36.qty_sold_used_36mo = chain.reduce((s, p) => s + (sold36Map[p] || 0), 0);

    // On-hand for the part, plus every BOM ancestor, in one batch. On-units
    // counts COUNTED ancestors only — an uncounted ancestor contributes 0 and
    // is surfaced through the counted/total pair.
    const ancestors = [...new Set((demand12.pathDetails || []).map(p => p.topParent))];
    const ohMap = await _settled('on hand', fetchOnHandForParts([part, ...ancestors]), {}, errors);
    let onUnits = null;
    if (ancestors.length) {
        const counted = new Set(ancestors.filter(a => ohMap[a]?.counted_at != null));
        let qty = 0;
        (demand12.pathDetails || []).forEach(p => {
            if (counted.has(p.topParent)) qty += (ohMap[p.topParent].on_hand || 0) * p.multiplier;
        });
        onUnits = { qty, counted: counted.size, total: ancestors.length };
    }

    // "Used On" parents, de-duplicated, with a description each.
    const seen = new Map();
    (parentRows || []).forEach(r => {
        const p = r.item_parent_normalized;
        if (p && !seen.has(p)) seen.set(p, Number(r.qty_per_assy) || 1);
    });
    let usedOn = [...seen.entries()]
        .map(([p, qty]) => ({ part: p, qty, desc: '' }))
        .sort((a, b) => a.part.localeCompare(b.part));
    if (usedOn.length) {
        const bd = await _settled('used-on descriptions',
            fetchBinAndDescForParts(usedOn.map(p => p.part)), { descs: {} }, errors);
        usedOn = usedOn.map(p => ({ ...p, desc: (bd.descs || {})[p.part] || '' }));
    }

    return {
        data: {
            part,
            chain,
            links: chainRes.links || [],
            usage12, usage36,
            parentDemand12: demand12.totalDemand || 0,
            parentDemand36: demand36.totalDemand || 0,
            onHand: ohMap[part] || null,
            onUnits,
            wipRaw,
            excludeRequestId: opts.excludeRequestId ?? null,
            usedOn,
            lastMade: lastMade || [],
        },
        errors,
    };
}
