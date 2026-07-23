// ============================================================
// libs/utils-planning-year.js — Year-Supply planning math
//
// Zero imports (utils.js re-exports this file; same pattern as
// utils-planning.js / utils-ledger.js). Pure: rows + demand maps in,
// re-sized rows out. No DB access, no state, no dates.
//
// WHY THIS EXISTS
// The kit basis sizes every subpart from the explosion: plan 100 mowers,
// build 100 frames' worth of children. That ignores parts SOLD as service
// parts — sell 40 frames over the year and the kit can no longer be built.
// The year-supply basis re-sizes each part from its OWN rolling-12-month
// demand (what it sold + what its parents sold, multiplied through the BOM).
//
// Because every part then stands on its own demand, this is a POST-PASS over
// explodeAndNet's output rather than a change to the engine: the explosion
// still decides which parts are in the run and at what level, it just no
// longer decides the quantities. No re-explosion is needed — a parent's new
// qty must NOT flow down, or the child would be counted twice (once from its
// own demand, once from its parent's).
// ============================================================

// Kept in sync by hand with libs/config.js (this file takes no imports).
// PLAN_PCT_ADJUST_MIN / _MAX and the explosion's own outlier threshold.
const PCT_MIN = -100;
const PCT_MAX = 500;
const REC_OUTLIER_THRESHOLD = 10000;

function _num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

// applyPctAdjust — the Adjust % math, defined once and used by both the
// Qty to Plan box and every subpart line so they can never drift.
// A non-finite or missing pct means "no adjustment", not zero output.
// Input: qty, pct (signed whole percent; -100 → 0, +10 → 110%).
// Output: qty scaled and rounded UP (you cannot build 4.2 of a thing).
export function applyPctAdjust(qty, pct) {
    const q = _num(qty);
    if (!(q > 0)) return 0;
    let p = Number(pct);
    if (!Number.isFinite(p)) p = 0;
    p = Math.min(PCT_MAX, Math.max(PCT_MIN, p));
    // (q × (100+p)) / 100, NOT q × (1 + p/100): the latter is float-inexact
    // (100 × 1.1 = 110.00000000000001) and ceil would turn a clean +10% into
    // one extra unit on every line.
    return Math.ceil((q * (100 + p)) / 100);
}

// choiceSupportableQty — how many of one option choice its own demand supports.
//
// A choice can carry several parts, each with a qty_per_unit (a 3-blade kit
// needs 3 blades per unit). The SCARCEST part gates the choice, so this is the
// minimum of demand ÷ qty_per_unit across its parts — not a sum and not an
// average. Floored: a part that supports 4.7 units supports 4.
//
// A choice with no parts (a part-less option) returns 0 — it is not in the
// material calc at all, which is what the Plan tab already warns about.
//
// Input: parts = [{ part_number, qty_per_unit }], demandByPart = { NORM: qty }.
// Output: whole number ≥ 0.
export function choiceSupportableQty(parts, demandByPart) {
    if (!parts || !parts.length) return 0;
    let min = Infinity;
    for (const p of parts) {
        const key = (p.part_number || '').toString().trim().toUpperCase();
        const per = _num(p.qty_per_unit) > 0 ? _num(p.qty_per_unit) : 1;
        const can = Math.floor(_num((demandByPart || {})[key]) / per);
        if (can < min) min = can;
    }
    return Number.isFinite(min) ? Math.max(0, min) : 0;
}

// applyYearSupplyNetting — re-size a finished explodeAndNet result from each
// part's own 12-month demand.
//
// Per part:
//   demand_12mo = sold + parentDemand              (rolling 12 months)
//   gross       = ceil(demand × (1 + pct/100))
//   net         = max(0, gross + min_stock − on_hand − in_flight − open_po)
//   recommended = net, then min_batch_qty / order_multiple, exactly as the
//                 engine does — batch rules apply to the recommendation only.
//
// Row types that are deliberately NOT re-sized:
//   phantom — the base pseudo-part and any blow-through assembly. It has no
//             recommendation of its own and its gross IS the plan target;
//             rewriting it would misreport what was planned.
//   held    — planning_hold still recommends 0. The gross/net are refreshed
//             so the grid shows the true shortfall behind the hold.
//
// no_history: demand is 0 while the kit explosion wanted some. Almost always
// a missing BOM link, or a parent that sells under a part number absent from
// sales_analysis_lines. The line is NOT silently backfilled with the kit qty —
// that would hide a data problem behind a plausible number. It is flagged so
// a human decides. This is the flag to watch on the first few runs.
//
// Input: rows      = explodeAndNet().rows (not mutated — new objects out)
//        sold      = { PART_NORM: qty sold 12mo }
//        parent    = { PART_NORM: parent-usage demand 12mo }
//        pct       = signed whole percent
//        params    = { PART_NORM: part_planning row } (same map the engine got)
// Output: { rows, noHistoryParts, sizedCount }
//   rows gain: kit_gross (what the explosion wanted) and demand_12mo
//   (pre-% demand, null on rows that were not re-sized).
export function applyYearSupplyNetting({ rows, sold, parent, pct, params }) {
    const S = p => _num((sold   || {})[p]);
    const D = p => _num((parent || {})[p]);
    const P = p => (params || {})[p] || {};
    const noHistoryParts = [];
    let sizedCount = 0;

    const out = (rows || []).map(r => {
        const part     = r.part_number;
        const kitGross = _num(r.gross);

        // Phantoms keep the plan's own numbers — see note above.
        if (r.phantom) return { ...r, kit_gross: kitGross, demand_12mo: null };

        const demand = S(part) + D(part);
        const gross  = applyPctAdjust(demand, pct);
        const prm    = P(part);
        const floor  = _num(r.min_stock);
        const net    = Math.max(0, gross + floor - _num(r.on_hand) - _num(r.in_flight) - _num(r.open_po));

        let rec = r.held ? 0 : net;
        if (rec > 0) {
            if (_num(prm.min_batch_qty) > 0) rec = Math.max(rec, _num(prm.min_batch_qty));
            const mult = _num(prm.order_multiple);
            if (mult > 0) rec = Math.ceil(rec / mult) * mult;
        }

        let flag = null;
        if (demand === 0 && kitGross > 0) { flag = 'no_history'; noHistoryParts.push(part); }
        else if (rec >= REC_OUTLIER_THRESHOLD) flag = 'qty_outlier';
        if (!r.held) sizedCount++;

        return { ...r, gross, net, recommended: rec, flag,
                 kit_gross: kitGross, demand_12mo: demand };
    });

    return { rows: out, noHistoryParts, sizedCount };
}
