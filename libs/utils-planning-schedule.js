// ============================================================
// libs/utils-planning-schedule.js — release-date scheduling helpers.
// Zero imports (pure). Turns a run's stock-vs-demand snapshots into
// urgency-based release dates. Future planning phases (batch splitting,
// calendar placement) add their pure helpers here too.
// ============================================================

// Make/lead buffer subtracted from a part's run-out date so it is released
// early enough to be remade before stock hits zero. Flat for v1; a later
// phase can swap in per-part lead_time_days / routing hours.
export const PLAN_RELEASE_LEAD_DAYS = 60;

// Cap on how far out a release's IDEAL date is placed — and the parking date
// for lines with no demand signal. One year out; every date stays editable
// after. (Capacity overflow below can push a placed date past this cap.)
export const PLAN_RELEASE_MAX_DAYS = 365;

// Max releases placed on a single day, PER PIPELINE — up to this many WOs and
// this many POs a day. Overflow slides to the next day.
export const PLAN_RELEASE_DAILY_CAP = 8;

function _dateStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// nextWeekday — the same day when it is Mon–Fri, otherwise the following
// Monday (Sat +2, Sun +1). Nothing is ever released on a weekend, so every
// generated date passes through here. Never moves a date EARLIER.
// Input: Date or 'YYYY-MM-DD'. Output: a new Date (input never mutated);
// an unparseable input is returned untouched.
export function nextWeekday(date) {
    const d = date instanceof Date ? date : new Date((date || '') + 'T00:00:00');
    if (isNaN(d.getTime())) return date;
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = out.getDay();
    if (dow === 6)      out.setDate(out.getDate() + 2); // Sat → Mon
    else if (dow === 0) out.setDate(out.getDate() + 1); // Sun → Mon
    return out;
}

// _isWeekendOffset — is (base + day) a Saturday or Sunday? Used by the
// placement loop so weekend days hold zero releases and consume no capacity.
function _isWeekendOffset(base, day) {
    const d = new Date(base);
    d.setDate(d.getDate() + day); // setDate is DST-safe (whole days)
    const dow = d.getDay();
    return dow === 0 || dow === 6;
}

// weekStartMonday — the Monday (YYYY-MM-DD) of the week containing dateStr, for
// grouping the scheduling view by week. '' on a bad/empty date.
export function weekStartMonday(dateStr) {
    const d = new Date((dateStr || '') + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - dow);
    return _dateStr(d);
}

// _addInterval — a fresh Date `n` units after `start` (calendar math, DST-safe).
function _addInterval(start, n, unit) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (unit === 'months')     d.setMonth(d.getMonth() + n);
    else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
    else                       d.setDate(d.getDate() + n); // days
    return d;
}

// computeSplitBatches — divide a total qty into timed batches. Qty is split
// into whole units with the remainder front-loaded (251÷5 → 51,50,50,50,50);
// when total < count only `total` batches of 1 are returned (never zero-qty
// batches). Batch 1 releases on startDate; each next is intervalValue units
// later. A date landing on a weekend is reported as the following Monday
// (nextWeekday) — the interval math stays anchored on the UN-shifted date so a
// weekly cadence never drifts. Pure, zero-import.
//
// Input:  { total, count, startDate (Date|'YYYY-MM-DD'), intervalValue,
//           intervalUnit: 'days'|'weeks'|'months' }
// Output: [{ seq, qty, date: 'YYYY-MM-DD' }] — length min(count, total),
//         or [] on invalid input.
export function computeSplitBatches({ total, count, startDate, intervalValue, intervalUnit } = {}) {
    const t = Math.floor(Number(total) || 0);
    const n = Math.min(Math.floor(Number(count) || 0), t);
    const step = Math.max(1, Math.floor(Number(intervalValue) || 1));
    const unit = ['days', 'weeks', 'months'].includes(intervalUnit) ? intervalUnit : 'days';
    if (!(t > 0) || !(n >= 1)) return [];

    const start = startDate instanceof Date ? startDate : new Date((startDate || '') + 'T00:00:00');
    const base = isNaN(start.getTime())
        ? new Date() : new Date(start.getFullYear(), start.getMonth(), start.getDate());

    const q = Math.floor(t / n);
    let rem = t - q * n;
    const out = [];
    for (let i = 0; i < n; i++) {
        const qty = q + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        out.push({ seq: i + 1, qty, date: _dateStr(nextWeekday(_addInterval(base, i * step, unit))) });
    }
    return out;
}

// _idealOffset — days from today a line WANTS to release, from its runway.
// A run is sized for a year's supply, so on_hand ÷ annual demand is the
// fraction of a year covered; ×365 is days of runway. Release `leadDays`
// before run-out so it is remade in time: low stock → 0 (today), higher stock
// → later, capped at maxDays. No demand (null/0) → no runway; park at the cap.
function _idealOffset(line, leadDays, maxDays) {
    const stock  = Number(line.on_hand_snap) || 0;
    const demand = Number(line.demand_12mo)  || 0;
    let offset = demand > 0 ? Math.round((stock / demand) * 365 - leadDays) : maxDays;
    if (offset < 0)       offset = 0;
    if (offset > maxDays) offset = maxDays;
    return offset;
}

// computeUrgencyReleaseDates — a release date per line: runway-based ideal
// dates, then a per-pipeline daily-cap scheduler that slides overflow later.
//
// Placement: lines are ranked by priority — most urgent (lowest ideal offset)
// first, then in-open-orders first, then higher demand, then higher qty on
// order, then part # (deterministic). In that order each line takes the first
// day >= its ideal that still has room in its pipeline (make vs buy) under
// dailyCap; a full day pushes it to the next. A line is never placed EARLIER
// than its runway — the cap only delays.
//
// Weekends: nothing releases on a Sat/Sun, so weekend days are skipped outright
// — they hold zero placements and consume no capacity, pushing the line to the
// following Monday (which then fills under its own cap).
//
// Input:  lines — [{ id, on_hand_snap, demand_12mo, action, part_number_normalized }],
//         plus opts:
//           today        — Date, injectable for tests (default: now)
//           leadDays     — make buffer in days (default PLAN_RELEASE_LEAD_DAYS)
//           maxDays      — ideal-date horizon cap (default PLAN_RELEASE_MAX_DAYS)
//           dailyCap     — placements/day/pipeline (default PLAN_RELEASE_DAILY_CAP)
//           openOrderQty — { [PART#]: qty } live open-order qty (default {})
// Output: { [lineId]: 'YYYY-MM-DD' } for every line carrying an id.
export function computeUrgencyReleaseDates(lines, opts = {}) {
    const today    = opts.today instanceof Date ? opts.today : new Date();
    const leadDays = Number.isFinite(opts.leadDays) ? opts.leadDays : PLAN_RELEASE_LEAD_DAYS;
    const maxDays  = Number.isFinite(opts.maxDays)  ? opts.maxDays  : PLAN_RELEASE_MAX_DAYS;
    const dailyCap = Number.isFinite(opts.dailyCap) && opts.dailyCap > 0
        ? opts.dailyCap : PLAN_RELEASE_DAILY_CAP;
    const ooQty = opts.openOrderQty || {};
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const ranked = (lines || [])
        .filter(l => l != null && l.id != null)
        .map(l => {
            const oo = Number(ooQty[l.part_number_normalized]) || 0;
            return {
                l,
                ideal:    _idealOffset(l, leadDays, maxDays),
                inOo:     oo > 0 ? 0 : 1,           // 0 sorts first
                demand:   Number(l.demand_12mo) || 0,
                ooQty:    oo,
                pipeline: l.action === 'buy' ? 'buy' : 'make',
                part:     l.part_number_normalized || '',
            };
        })
        .sort((a, b) =>
            a.ideal - b.ideal || a.inOo - b.inOo ||
            b.demand - a.demand || b.ooQty - a.ooQty ||
            a.part.localeCompare(b.part));

    const counts = { make: {}, buy: {} }; // pipeline -> { dayOffset: placed }
    const out = {};
    ranked.forEach(r => {
        const used = counts[r.pipeline];
        let day = r.ideal;
        while (_isWeekendOffset(base, day) || (used[day] || 0) >= dailyCap) day++;
        used[day] = (used[day] || 0) + 1;
        const d = new Date(base);
        d.setDate(d.getDate() + day); // setDate is DST-safe (whole days)
        out[r.l.id] = _dateStr(d);
    });
    return out;
}

// ── Schedule Gantt (work center × time) ───────────────────────

// Dept order a fallback routing walks when a part has no part_routings rows.
// Shop flow, not alphabetical.
export const GANTT_DEPT_ORDER = ['Fab', 'Weld', 'Paint', 'Assy'];

// Working days each dept is assumed to take when a part has no measured
// routing. THE source of truth for these defaults — part_dept_estimates stores
// only per-part overrides of them, never the defaults themselves.
export const GANTT_DEPT_DEFAULT_DAYS = { Fab: 1, Weld: 3, Paint: 10, Assy: 5 };

// Fallback for a dept with no default above (and for the Unassigned catch-all).
export const GANTT_FALLBACK_OP_DAYS = 1;

// Row id prefixes for the two synthetic rows. Real rows use the work center's
// uuid, so these can never collide.
const GANTT_DEPT_ROW = 'dept:';
const GANTT_UNASSIGNED_ROW = 'unassigned';

// daysBetween — whole calendar days from a to b (b − a). Negative if b is
// earlier. Used by the timeline to turn a date into an x-offset.
// Input: 'YYYY-MM-DD' or Date. Output: integer (0 on a bad date).
export function daysBetween(a, b) {
    const d1 = a instanceof Date ? a : new Date((a || '') + 'T00:00:00');
    const d2 = b instanceof Date ? b : new Date((b || '') + 'T00:00:00');
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    const u1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const u2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((u2 - u1) / 86400000);
}

// _addWorkingDays — advance `n` WORKING days from a Date, skipping weekends.
// n=0 returns the same day (bumped off a weekend). Returns a new Date.
function _addWorkingDays(start, n) {
    let d = nextWeekday(start);
    for (let i = 0; i < n; i++) {
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        d = nextWeekday(d);
    }
    return d;
}

// _isPainted — does this part get painted? Any real colour counts; the blanks
// and the explicit "no colour" spellings do not.
function _isPainted(flags) {
    const c = String((flags || {}).color || '').trim().toLowerCase();
    return c !== '' && c !== 'no' && c !== 'none' && c !== 'raw';
}

// _fallbackDepts — the guessed routing for a part with no part_routings rows,
// read off its routing flags: fab/weld/assy_wo are 'yes'/'no' strings, and any
// real colour implies a paint step. Walked in shop-flow dept order.
// Returns [] when nothing at all is known (caller parks it Unassigned).
function _fallbackDepts(flags) {
    const f = flags || {};
    const yes = v => String(v || '').trim().toLowerCase() === 'yes';
    const on = { Fab: yes(f.fab), Weld: yes(f.weld), Paint: _isPainted(f), Assy: yes(f.assy_wo) };
    return GANTT_DEPT_ORDER.filter(dept => on[dept]);
}

// _estDays — working days for one estimated dept step: the part's own override
// (part_dept_estimates) when set, else the dept default. 0 is a legitimate
// override meaning "skip this dept", so only null/undefined/'' fall through.
function _estDays(estimates, part, dept) {
    const v = ((estimates || {})[part] || {})[dept];
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
        return Math.max(0, Number(v));
    }
    return GANTT_DEPT_DEFAULT_DAYS[dept] ?? GANTT_FALLBACK_OP_DAYS;
}

// buildGanttBars — the schedule timeline. Every committed make line is walked
// through its routing in seq order: op 1 starts on the line's release date and
// each next op starts the working day after the previous one ends (true
// chaining, not all-at-once). Duration = (setup + run × qty) hours ÷ that work
// center's hours-per-working-day, rounded UP to whole working days, minimum 1.
// Weekends are never occupied — consistent with the release-date scheduler.
//
// Parts with no part_routings fall back to dept steps derived from their
// routing flags, one per dept they touch (Fab and/or Weld and/or Paint and/or
// Assy). Each estimated step is sized on its own: the part's part_dept_estimates
// override if it has one, else GANTT_DEPT_DEFAULT_DAYS. They are marked
// estimated:true so the UI can render a guess differently from measured data;
// a part with no signal at all lands on a single "Unassigned" row. Nothing is
// ever silently dropped.
//
// Paint is special: a part with a real colour gets a Paint step even when it
// HAS a measured routing (paint is rarely on the routing but always happens),
// slotted after the last Fab/Weld op and before Assy — unless its routing
// already passes through a Paint work center.
//
// An estimated step lands on the dept's real work center when that dept has
// exactly one (Paint), otherwise on a "<Dept> — unassigned" row, because
// naming one of five Fab machines would be a fiction.
//
// This is a LOAD picture, not a finite-capacity schedule: bars may overlap on a
// machine. Over-capacity weeks are the Workload heatmap's job.
//
// Input:  { lines       — [{ id, run_id, part_number, part_number_normalized,
//                            recommended, override_qty, planned_release_date, … }]
//           routings    — { NORM: [part_routings rows] }
//           deptFlags   — { NORM: { fab, weld, assy_wo, color } }
//           deptEstimates — { NORM: { Fab: days, Weld: days, … } } overrides
//           workCenters — [{ id, name, dept, available_hours_week, sort_order }] }
// Output: { rows — [{ id, label, dept, estimated, isFallback }] in display order,
//                   only rows that carry at least one bar,
//           bars — [{ key, lineId, runId, rowId, part, qty, seq, wcName, hours,
//                     days, start, end, estimated }],
//           first, last — 'YYYY-MM-DD' span of all bars ('' when empty),
//           unroutedParts — count of distinct parts placed by fallback }
export function buildGanttBars({ lines, routings, deptFlags, deptEstimates, workCenters } = {}) {
    const wcById = {};
    (workCenters || []).forEach(w => {
        // available_hours_week is a 5-day week; 0/blank would divide by zero.
        const perDay = (Number(w.available_hours_week) || 40) / 5;
        wcById[w.id] = { ...w, hoursPerDay: perDay > 0 ? perDay : 8 };
    });
    const wcOrder = {};
    (workCenters || []).forEach((w, i) => { wcOrder[w.id] = i; });

    // Depts with exactly one work center can host an estimated step by name.
    const soleWcByDept = {};
    (workCenters || []).forEach(w => {
        const d = w.dept || '';
        if (!d) return;
        soleWcByDept[d] = soleWcByDept[d] === undefined ? w : null; // 2nd sighting → null
    });

    // estimatedOp — one guessed step, on the dept's sole work center when there
    // is one, else on the dept's unassigned row.
    const estimatedOp = (part, dept) => {
        const sole = soleWcByDept[dept];
        return {
            rowId: sole ? sole.id : GANTT_DEPT_ROW + dept,
            label: sole ? sole.name : dept + ' — unassigned',
            dept, hours: 0, days: _estDays(deptEstimates, part, dept),
            estimated: true, isFallback: !sole,
        };
    };

    const bars = [];
    const usedRows = {};       // rowId -> row descriptor
    const fallbackParts = new Set();

    const touchRow = (id, label, dept, isFallback) => {
        if (!usedRows[id]) usedRows[id] = { id, label, dept: dept || '', isFallback: !!isFallback };
    };

    (lines || []).forEach(line => {
        if (!line || !line.planned_release_date) return;
        const part = line.part_number_normalized || line.part_number || '';
        const qty  = Number(line.override_qty ?? line.recommended) || 0;
        if (!(qty > 0)) return;

        const real = (routings && routings[part] ? routings[part].slice() : [])
            .filter(r => wcById[r.work_center_id])
            .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));

        // ops: a uniform shape whether measured or guessed
        let ops;
        if (real.length) {
            ops = real.map((r, i) => {
                const wc = wcById[r.work_center_id];
                const hours = (Number(r.setup_hours) || 0) + (Number(r.run_hours_per_part) || 0) * qty;
                return {
                    rowId: wc.id, label: wc.name, dept: wc.dept, seq: Number(r.seq) || (i + 1),
                    hours, days: Math.max(1, Math.ceil(hours / wc.hoursPerDay)),
                    estimated: false, isFallback: false,
                };
            });
            // Paint happens whether or not anyone wrote it on the routing.
            if (_isPainted(deptFlags && deptFlags[part]) && !ops.some(o => o.dept === 'Paint')) {
                const at = ops.findIndex(o => o.dept === 'Assy');
                ops.splice(at === -1 ? ops.length : at, 0, estimatedOp(part, 'Paint'));
                ops.forEach((o, i) => { o.seq = i + 1; });   // renumber after the insert
            }
        } else {
            const depts = _fallbackDepts(deptFlags && deptFlags[part]);
            fallbackParts.add(part);
            ops = depts.length
                ? depts.map((dept, i) => ({ ...estimatedOp(part, dept), seq: i + 1 }))
                : [{
                    rowId: GANTT_UNASSIGNED_ROW, label: 'Unassigned', dept: '',
                    seq: 1, hours: 0, days: GANTT_FALLBACK_OP_DAYS,
                    estimated: true, isFallback: true,
                }];
        }

        // An override of 0 days means "this part skips that dept" — drop the step
        // rather than drawing a zero-length bar.
        ops = ops.filter(o => o.days > 0);

        // Chain: each op starts the working day after the previous one ends.
        let cursor = nextWeekday(line.planned_release_date);
        ops.forEach((op, i) => {
            const start = cursor;
            const end   = _addWorkingDays(start, op.days - 1);
            touchRow(op.rowId, op.label, op.dept, op.isFallback);
            bars.push({
                key: `${line.id}:${i}`, lineId: line.id, runId: line.run_id,
                rowId: op.rowId, part: line.part_number || part, qty,
                seq: op.seq, wcName: op.label, hours: Math.round(op.hours * 10) / 10,
                days: op.days, start: _dateStr(start), end: _dateStr(end),
                estimated: op.estimated,
            });
            cursor = _addWorkingDays(end, 1);
        });
    });

    // Row order: real work centers in their configured order, then the dept
    // fallback rows in shop-flow order, then Unassigned last.
    const rows = Object.values(usedRows).sort((a, b) => {
        const rank = r => r.id === GANTT_UNASSIGNED_ROW ? 2 : (r.isFallback ? 1 : 0);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (rank(a) === 0) return (wcOrder[a.id] ?? 999) - (wcOrder[b.id] ?? 999);
        return GANTT_DEPT_ORDER.indexOf(a.dept) - GANTT_DEPT_ORDER.indexOf(b.dept);
    });

    let first = '', last = '';
    bars.forEach(b => {
        if (!first || b.start < first) first = b.start;
        if (!last  || b.end   > last)  last  = b.end;
    });
    return { rows, bars, first, last, unroutedParts: fallbackParts.size };
}
