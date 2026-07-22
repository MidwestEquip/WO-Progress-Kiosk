// ============================================================
// libs/utils-planning.js — Production Planning pure helpers
//
// Zero imports (utils.js re-exports this file; same pattern as
// utils-ledger.js). Every function is pure: BOM rows in,
// derivation structures out. No DB access, no state.
// ============================================================

// Quantities at or above this are flagged for review — validated against
// real data (288 family had model numbers typed into qty fields: 574, 580).
const QTY_OUTLIER_THRESHOLD = 100;

function _norm(s) { return (s || '').toString().trim().toUpperCase(); }

// deriveBaseUnitKit — diff sibling config BOMs into base unit + option groups.
// Inputs: bomRows = all_boms rows [{ item_parent_normalized, item_child_normalized,
//         item_child, qty_per_assy }], includedConfigs = config part numbers to diff
//         (rows for other parents are ignored; duplicate BOM lines sum per child).
// Output: {
//   configs:    [{ config, lineCount }]           — included configs actually found
//   singleConfig: boolean                          — true when <2 configs have rows
//   base:       [{ part_number, qty, flag }]       — common to all configs, same qty
//   qtyVaries:  [{ part_number, qtyByConfig, flag }]— common to all, qty differs
//   groups:     [{ required, coveredCount, members:[{ configs, parts:[{part_number,qty,flag}] }] }]
// }
// Groups: parts sharing an identical presence signature form one choice bundle;
// bundles with mutually disjoint config sets are grouped into a decision step.
// required = the step's choices cover every config exactly once.
// Single-config path: the whole BOM becomes base; options are added manually.
export function deriveBaseUnitKit(bomRows, includedConfigs) {
    const wanted = new Set((includedConfigs || []).map(_norm).filter(Boolean));
    const perConfig = {}; // config -> child -> summed qty
    (bomRows || []).forEach(r => {
        const p = _norm(r.item_parent_normalized || r.item_parent);
        const c = _norm(r.item_child_normalized || r.item_child);
        if (!p || !c || !wanted.has(p)) return;
        const q = Number(r.qty_per_assy);
        if (!perConfig[p]) perConfig[p] = {};
        perConfig[p][c] = (perConfig[p][c] || 0) + (Number.isFinite(q) && q > 0 ? q : 1);
    });

    const parents = Object.keys(perConfig).sort();
    const n = parents.length;
    const flagOf = q => (q >= QTY_OUTLIER_THRESHOLD ? 'qty_outlier' : null);
    const out = {
        configs: parents.map(p => ({ config: p, lineCount: Object.keys(perConfig[p]).length })),
        singleConfig: n < 2,
        base: [], qtyVaries: [], groups: [],
    };
    if (n === 0) return out;

    if (n === 1) {
        out.base = Object.entries(perConfig[parents[0]])
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([part, qty]) => ({ part_number: part, qty, flag: flagOf(qty) }));
        return out;
    }

    // Classify every child by presence across configs
    const allChildren = new Set();
    parents.forEach(p => Object.keys(perConfig[p]).forEach(c => allChildren.add(c)));
    const bundlesBySig = {}; // signature -> { configs, parts }
    [...allChildren].sort().forEach(c => {
        const present = parents.filter(p => perConfig[p][c] !== undefined);
        const qtys = new Set(present.map(p => perConfig[p][c]));
        if (present.length === n) {
            if (qtys.size === 1) {
                const qty = perConfig[present[0]][c];
                out.base.push({ part_number: c, qty, flag: flagOf(qty) });
            } else {
                const qtyByConfig = {};
                present.forEach(p => { qtyByConfig[p] = perConfig[p][c]; });
                out.qtyVaries.push({
                    part_number: c, qtyByConfig,
                    flag: present.some(p => flagOf(perConfig[p][c])) ? 'qty_outlier' : null,
                });
            }
        } else {
            const sig = present.join('|');
            if (!bundlesBySig[sig]) bundlesBySig[sig] = { configs: present, parts: [] };
            const qty = perConfig[present[0]][c];
            bundlesBySig[sig].parts.push({ part_number: c, qty, flag: flagOf(qty) });
        }
    });

    // Cluster bundles into decision steps: greedy placement into the first
    // group where the bundle's configs overlap no existing member's configs.
    const bundles = Object.values(bundlesBySig).sort((a, b) => b.configs.length - a.configs.length);
    bundles.forEach(b => {
        const bSet = new Set(b.configs);
        const home = out.groups.find(g => !g.members.some(m => m.configs.some(c => bSet.has(c))));
        if (home) home.members.push(b);
        else out.groups.push({ members: [b] });
    });
    out.groups.forEach(g => {
        const covered = new Set();
        g.members.forEach(m => m.configs.forEach(c => covered.add(c)));
        g.coveredCount = covered.size;
        g.required = covered.size === n;
    });
    return out;
}

// Explosion depth cap (levels below the demand roots). Cycles are also
// depth-capped, so a bad BOM loop can never hang the browser.
const EXPLODE_MAX_DEPTH = 15;

// A recommendation this large is almost certainly a BOM qty error compounding
// through the explosion (the 288's qty-574 lines would do this) — flag it.
const REC_OUTLIER_THRESHOLD = 10000;

// explodeAndNet — level-by-level MRP netting over a multi-level BOM.
//
// The core correctness rule: a part is netted only AFTER every parent's net
// demand has been exploded down to it (low-level-code ordering). Netting the
// parent first means 40 frames in stock stop steel being ordered for 40
// frames' worth of children — no double-counting of shared subassemblies.
//
// Inputs (all maps keyed by normalized part number):
//   demands  = [{ part_number, qty }] top-level gross demand
//   bomRows  = all_boms rows covering every level (fetchBomTreeRows)
//   onHand   = { NORM: { on_hand } }               (part_on_hand)
//   inFlight = { NORM: qty }  committed WO-side supply: work in production
//              + finished-not-received + received-not-closed-out. NOT pending
//              wo_requests — a request can still be rejected, so it is shown
//              in the grid but never subtracted. (fetchPartsWipBatch +
//              bucketPartWip; see planning-run.js)
//   openPo   = { NORM: qty }  open PO supply       (fetchOpenPoSupply)
//   params   = { NORM: part_planning row }         (min_stock, min_batch_qty,
//              order_multiple, phantom, planning_hold, make_buy_override)
//   makeBuy  = { NORM: 'make'|'buy'|null }         derived from item_master attrs
//
// Netting per part:  net = max(0, gross + min_stock − on_hand − open supply)
// Batch rules on the recommendation only: max(net, min_batch_qty), then round
// up to order_multiple. Children explode from the RECOMMENDED qty of make
// parts (build 50 due to batch min → consume components for 50). Buy parts
// never explode. Held parts recommend 0 and do not explode. Phantoms pass
// net demand straight through with no recommendation of their own.
//
// Output: { rows: [{ part_number, level, gross, on_hand, in_flight, open_po,
//   min_stock, net, recommended, action: 'make'|'buy'|'review', held, phantom,
//   flag }], cycleDetected, maxDepth }
export function explodeAndNet({ demands, bomRows, onHand, inFlight, openPo, params, makeBuy }) {
    const P = p => (params   || {})[p] || {};
    const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // Child index: parent -> [{ child, qpa }] (duplicate lines summed)
    const children = {};
    (bomRows || []).forEach(r => {
        const par = _norm(r.item_parent_normalized || r.item_parent);
        const chl = _norm(r.item_child_normalized || r.item_child);
        if (!par || !chl || par === chl) return;
        const qpa = num(r.qty_per_assy) > 0 ? num(r.qty_per_assy) : 1;
        if (!children[par]) children[par] = {};
        children[par][chl] = (children[par][chl] || 0) + qpa;
    });

    // Low-level codes: LLC = deepest level a part appears at (BFS, depth-capped)
    const llc = {};
    let cycleDetected = false, maxDepth = 0;
    let frontier = [];
    (demands || []).forEach(d => {
        const p = _norm(d.part_number);
        if (!p || !(num(d.qty) > 0)) return;
        if (llc[p] === undefined || llc[p] < 0) llc[p] = 0;
        frontier.push({ part: p, depth: 0 });
    });
    while (frontier.length) {
        const next = [];
        for (const { part, depth } of frontier) {
            if (depth >= EXPLODE_MAX_DEPTH) { cycleDetected = true; continue; }
            for (const chl of Object.keys(children[part] || {})) {
                const d = depth + 1;
                if (llc[chl] === undefined || llc[chl] < d) {
                    llc[chl] = d;
                    if (d > maxDepth) maxDepth = d;
                    next.push({ part: chl, depth: d });
                }
            }
        }
        frontier = next;
    }

    // Accumulate gross top-down in LLC order
    const gross = {};
    (demands || []).forEach(d => {
        const p = _norm(d.part_number);
        if (p && num(d.qty) > 0) gross[p] = (gross[p] || 0) + num(d.qty);
    });
    const byLevel = {};
    Object.keys(llc).forEach(p => (byLevel[llc[p]] = byLevel[llc[p]] || []).push(p));

    const rows = [];
    for (let lvl = 0; lvl <= maxDepth; lvl++) {
        for (const part of (byLevel[lvl] || []).sort()) {
            const g = gross[part] || 0;
            if (!(g > 0)) continue;
            const prm  = P(part);
            const oh   = num((onHand || {})[part]?.on_hand);
            const inf  = num((inFlight || {})[part]);
            const po   = num((openPo || {})[part]);
            const kids = children[part] || {};
            const mb   = prm.make_buy_override || (makeBuy || {})[part] || null;

            if (prm.planning_hold) {
                rows.push({ part_number: part, level: lvl, gross: g, on_hand: oh,
                    in_flight: inf, open_po: po, min_stock: num(prm.min_stock),
                    net: 0, recommended: 0, action: mb || 'review',
                    held: true, phantom: false, flag: null });
                continue; // held: no recommendation, no explosion
            }

            if (prm.phantom) {
                const net = Math.max(0, g - oh);
                rows.push({ part_number: part, level: lvl, gross: g, on_hand: oh,
                    in_flight: inf, open_po: po, min_stock: 0,
                    net, recommended: 0, action: mb || 'review',
                    held: false, phantom: true, flag: null });
                Object.entries(kids).forEach(([chl, qpa]) => {
                    gross[chl] = (gross[chl] || 0) + net * qpa;
                });
                continue;
            }

            const floor = num(prm.min_stock);
            const net   = Math.max(0, g + floor - oh - inf - po);
            let rec = net;
            if (rec > 0) {
                if (num(prm.min_batch_qty) > 0) rec = Math.max(rec, num(prm.min_batch_qty));
                const mult = num(prm.order_multiple);
                if (mult > 0) rec = Math.ceil(rec / mult) * mult;
            }
            const action = mb || 'review';
            rows.push({ part_number: part, level: lvl, gross: g, on_hand: oh,
                in_flight: inf, open_po: po, min_stock: floor,
                net, recommended: rec, action,
                held: false, phantom: false,
                flag: rec >= REC_OUTLIER_THRESHOLD ? 'qty_outlier' : null });

            // Only what we actually build consumes components; buys never explode.
            if (action !== 'buy' && rec > 0) {
                Object.entries(kids).forEach(([chl, qpa]) => {
                    gross[chl] = (gross[chl] || 0) + rec * qpa;
                });
            }
        }
    }
    return { rows, cycleDetected, maxDepth };
}

function _dateStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// computeCoverage — rate-based run-out projection for one part (the deliberate
// v1 alternative to bucketed time-phased MRP).
// Inputs: on_hand, open_supply (undated open WOs/POs counted as available),
//         qty_12mo (rolling 12-month demand — sold + used in mfg),
//         today (Date, injectable for tests).
// Output: { daily_rate, days_of_supply, run_out_date } — days/run-out are
//         null when there is no demand history (can't divide by zero demand).
export function computeCoverage({ on_hand, open_supply, qty_12mo, today }) {
    const oh   = Number(on_hand) || 0;
    const sup  = Number(open_supply) || 0;
    const rate = (Number(qty_12mo) || 0) / 365;
    if (!(rate > 0)) return { daily_rate: 0, days_of_supply: null, run_out_date: null };
    const days = Math.max(0, (oh + sup) / rate);
    const d = new Date(today instanceof Date ? today.getTime() : Date.now());
    d.setDate(d.getDate() + Math.floor(days));
    return { daily_rate: rate, days_of_supply: Math.round(days * 10) / 10, run_out_date: _dateStr(d) };
}

// buildLowStockAlerts — which parts are projected to fall below their minimum,
// and what to do about it. Only parts with a min_stock band can alert.
// Input: parts = [{ part_number, on_hand, open_supply, qty_12mo, min_stock,
//         target_stock, lead_time_days, make_buy }], horizonDays (default 90),
//         today (Date, injectable).
// Per part: days_until_below_min = (on_hand + supply − min) / daily_rate
//         (0 when already below). Alert when within the horizon — or already
//         below min even with zero demand history.
// recommended_qty = order-up-to target (target_stock ?? min_stock) plus demand
//         over the lead time, minus what's on hand/inbound (batch rules are
//         applied later by the caller via part_planning).
// order_by_date = shortage date − lead time, clamped to today.
// Output: alerts sorted most-urgent first:
//   [{ part_number, on_hand, open_supply, min_stock, daily_rate,
//      days_until_short, shortage_date, recommended_qty, order_by_date,
//      action, already_short }]
export function buildLowStockAlerts(parts, horizonDays = 90, today = new Date()) {
    const alerts = [];
    (parts || []).forEach(p => {
        const min = Number(p.min_stock);
        if (!(min > 0)) return;
        const oh   = Number(p.on_hand) || 0;
        const sup  = Number(p.open_supply) || 0;
        const rate = (Number(p.qty_12mo) || 0) / 365;
        const position = oh + sup;

        let daysUntil = null;
        if (position < min) daysUntil = 0;
        else if (rate > 0)  daysUntil = (position - min) / rate;
        if (daysUntil === null || daysUntil > horizonDays) return;

        const lead   = Math.max(0, Number(p.lead_time_days) || 0);
        const target = Number(p.target_stock) > 0 ? Number(p.target_stock) : min;
        const rec    = Math.ceil(Math.max(0, target + rate * lead - position));
        if (!(rec > 0)) return;

        const shortD = new Date(today.getTime());
        shortD.setDate(shortD.getDate() + Math.floor(daysUntil));
        const orderD = new Date(shortD.getTime());
        orderD.setDate(orderD.getDate() - lead);
        const orderByDate = orderD.getTime() < today.getTime() ? _dateStr(today) : _dateStr(orderD);

        alerts.push({
            part_number: _norm(p.part_number),
            on_hand: oh, open_supply: sup, min_stock: min,
            daily_rate: Math.round(rate * 1000) / 1000,
            days_until_short: Math.round(daysUntil * 10) / 10,
            shortage_date: _dateStr(shortD),
            recommended_qty: rec,
            order_by_date: orderByDate,
            action: p.make_buy || 'review',
            already_short: daysUntil === 0,
        });
    });
    return alerts.sort((a, b) => a.days_until_short - b.days_until_short
        || b.recommended_qty - a.recommended_qty);
}

// findModularChildren — detect two-level (kit-style) families: kit children
// that are themselves BOM parents (e.g. 880-ELK contains 880-EL, which has
// its own 36-line BOM). Those child config sets get their own derivation pass.
// Inputs: bomRows + includedConfigs as in deriveBaseUnitKit; partsWithBoms =
//         child part numbers known to have their own all_boms rows.
// Output: [{ part_number, inConfigs }] sorted by widest usage first.
export function findModularChildren(bomRows, includedConfigs, partsWithBoms) {
    const wanted = new Set((includedConfigs || []).map(_norm).filter(Boolean));
    const hasBom = new Set((partsWithBoms || []).map(_norm).filter(Boolean));
    const usage = {}; // child -> Set of configs
    (bomRows || []).forEach(r => {
        const p = _norm(r.item_parent_normalized || r.item_parent);
        const c = _norm(r.item_child_normalized || r.item_child);
        if (!p || !c || !wanted.has(p) || !hasBom.has(c)) return;
        (usage[c] = usage[c] || new Set()).add(p);
    });
    return Object.entries(usage)
        .map(([part, set]) => ({ part_number: part, inConfigs: [...set].sort() }))
        .sort((a, b) => b.inConfigs.length - a.inConfigs.length || a.part_number.localeCompare(b.part_number));
}

// buildWhereUsedIndex — invert BOM rows into child → [parent part numbers],
// restricted to the parts present in a planning run.
//
// The netting engine emits each part ONCE at its lowest level, with demand
// summed over every parent that uses it, so a line legitimately has several
// parents. This index is what lets the Review grid say what a line is a
// subpart of. Pure: no imports, no side effects.
//
// Input: bomRows = all_boms rows, runParts = part numbers in the run.
// Output: { CHILD_NORM: [PARENT_NORM, ...] } (sorted, de-duplicated).
export function buildWhereUsedIndex(bomRows, runParts) {
    const inRun = new Set((runParts || []).map(_norm).filter(Boolean));
    const index = {};
    (bomRows || []).forEach(r => {
        const parent = _norm(r.item_parent_normalized || r.item_parent);
        const child  = _norm(r.item_child_normalized  || r.item_child);
        if (!parent || !child || parent === child) return;
        if (!inRun.has(child)) return;
        if (!index[child]) index[child] = new Set();
        index[child].add(parent);
    });
    Object.keys(index).forEach(k => { index[k] = [...index[k]].sort(); });
    return index;
}

// buildRunChildIndex — parent → [{ child, qpa }] for the parts in a run.
// The companion to buildWhereUsedIndex: that one drops qty_per_assy because
// it only names parents; a qty cascade needs the per-assembly multiplier.
// Duplicate BOM lines for the same pair are summed. Pure.
// Output: { PARENT_NORM: [{ child, qpa }] }.
export function buildRunChildIndex(bomRows, runParts) {
    const inRun = new Set((runParts || []).map(_norm).filter(Boolean));
    const acc = {};
    (bomRows || []).forEach(r => {
        const parent = _norm(r.item_parent_normalized || r.item_parent);
        const child  = _norm(r.item_child_normalized  || r.item_child);
        if (!parent || !child || parent === child) return;
        if (!inRun.has(parent) || !inRun.has(child)) return;
        const qpa = Number(r.qty_per_assy) > 0 ? Number(r.qty_per_assy) : 1;
        if (!acc[parent]) acc[parent] = {};
        acc[parent][child] = (acc[parent][child] || 0) + qpa;
    });
    const out = {};
    Object.keys(acc).forEach(p => {
        out[p] = Object.entries(acc[p])
            .map(([child, qpa]) => ({ child, qpa }))
            .sort((a, b) => a.child.localeCompare(b.child));
    });
    return out;
}

// computeQtyCascade — preview a parent qty change flowing down its subtree.
//
// A child used twice per assembly moves by twice the parent's delta, and a
// grandchild compounds the multipliers. A part reached by several BOM paths
// accumulates the delta from EVERY path (each path is a distinct physical
// usage), matching how parent-usage demand is calculated elsewhere.
//
// Only 'proposed' lines change; anything already approved / released / skipped
// is reported instead, never silently moved. Quantities clamp at 0.
// Cycle-safe: each branch carries its own visited path, depth-capped.
//
// Input: parentPart, delta (signed), childIndex (buildRunChildIndex),
//        linesByPart = { NORM: run line }.
// Output: { changes: [{ part, from, to, delta, perAssy }], skipped: [{ part, status }] }.
export function computeQtyCascade(parentPart, delta, childIndex, linesByPart) {
    const changes = [], skipped = [];
    const root = _norm(parentPart);
    const d = Number(delta);
    if (!root || !Number.isFinite(d) || d === 0) return { changes, skipped };

    // Total multiplier per descendant, summed over every path from the root.
    const totalMult = {};
    let frontier = [{ part: root, mult: 1, path: new Set([root]) }];
    for (let depth = 0; depth < EXPLODE_MAX_DEPTH && frontier.length; depth++) {
        const next = [];
        for (const node of frontier) {
            for (const { child, qpa } of (childIndex[node.part] || [])) {
                if (node.path.has(child)) continue;          // cycle on this branch
                const mult = node.mult * qpa;
                totalMult[child] = (totalMult[child] || 0) + mult;
                const path = new Set(node.path); path.add(child);
                next.push({ part: child, mult, path });
            }
        }
        frontier = next;
    }

    Object.keys(totalMult).sort().forEach(part => {
        const line = (linesByPart || {})[part];
        if (!line) return;                                    // not in this run
        if (line.line_status !== 'proposed') {
            skipped.push({ part, status: line.line_status });
            return;
        }
        const from = Number(line.override_qty ?? line.recommended) || 0;
        const to   = Math.max(0, from + d * totalMult[part]);
        if (to !== from) changes.push({ part, from, to, delta: to - from, perAssy: totalMult[part] });
    });
    return { changes, skipped };
}
