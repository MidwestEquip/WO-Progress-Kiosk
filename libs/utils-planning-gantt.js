// ============================================================
// libs/utils-planning-gantt.js — pixel layout for the schedule Gantt.
// Zero imports (pure): takes buildGanttBars' output plus a zoom level and
// returns everything the template positions absolutely, pre-computed. The
// template must never call a function that builds objects (CLAUDE.md frontend
// rule) — one computed calls this once per data/zoom change.
// Re-exported by utils.js.
// ============================================================

// Pixels per calendar day at each zoom. Week = readable day bars; Quarter =
// a year of plan on one screen.
export const GANTT_ZOOMS = [
    { key: 'week',    label: 'Week',    pxPerDay: 26, band: 'week'  },
    { key: 'month',   label: 'Month',   pxPerDay: 9,  band: 'month' },
    { key: 'quarter', label: 'Quarter', pxPerDay: 3.5, band: 'month' },
];

const GANTT_LANE_H  = 20;   // px per stacked bar within one work-center row
const GANTT_ROW_PAD = 8;    // px of breathing room under a row's lanes
const GANTT_MIN_LABEL_W = 46; // narrower than this and the part # is unreadable

function _d(s) { return new Date((s || '') + 'T00:00:00'); }

function _dateStr(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Whole days from a to b. Private twin of utils-planning-schedule's
// daysBetween — this file takes no imports by design.
function _days(a, b) {
    const d1 = _d(a), d2 = _d(b);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    return Math.round((Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate())
                     - Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate())) / 86400000);
}

function _mondayOf(dateStr) {
    const d = _d(dateStr);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
}

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// _packLanes — stack overlapping bars in one row so none hide behind another.
// Bars are placed left-to-right into the first lane whose previous bar has
// already ended. Returns the lane count; mutates each bar's `lane`.
function _packLanes(bars) {
    const laneEnds = [];  // lane index -> end date of its last bar
    bars.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach(b => {
        let lane = laneEnds.findIndex(end => end < b.start);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.end); }
        else laneEnds[lane] = b.end;
        b.lane = lane;
    });
    return Math.max(1, laneEnds.length);
}

// buildGanttLayout — turn bars + a zoom level into absolute pixel geometry.
//
// The timeline starts on the Monday of the earlier of {today, first bar} and
// runs to the later of {last bar, +8 weeks}, so "today" is always on screen and
// an empty plan still draws a calendar. Bars carry ready-made style strings;
// rows carry their height (tall enough for their stacked lanes).
//
// Input:  { plan — buildGanttBars output { rows, bars, first, last },
//           zoom — 'week' | 'month' | 'quarter',
//           today — 'YYYY-MM-DD' (injectable for tests) }
// Output: { pxPerDay, width, totalDays, origin,
//           bands   — [{ key, label, left, width }] header segments,
//           rows    — [{ id, label, dept, isFallback, height, bars:[…] }],
//           todayLeft — px offset of the today marker (null if off-scale) }
export function buildGanttLayout({ plan, zoom, today } = {}) {
    const z = GANTT_ZOOMS.find(x => x.key === zoom) || GANTT_ZOOMS[0];
    const p = plan || {};
    const rowsIn = p.rows || [], barsIn = p.bars || [];
    const todayStr = today || _dateStr(new Date());

    const startSeed = p.first && p.first < todayStr ? p.first : todayStr;
    const originDate = _mondayOf(startSeed) || _mondayOf(todayStr) || new Date();
    const origin = _dateStr(originDate);

    const minEnd = new Date(originDate.getFullYear(), originDate.getMonth(), originDate.getDate() + 56);
    const lastStr = p.last && p.last > _dateStr(minEnd) ? p.last : _dateStr(minEnd);
    const totalDays = Math.max(7, _days(origin, lastStr) + 7);
    const width = Math.round(totalDays * z.pxPerDay);

    // Header band: one segment per week, or per month when zoomed out.
    const bands = [];
    if (z.band === 'week') {
        for (let d = 0; d < totalDays; d += 7) {
            const wk = new Date(originDate.getFullYear(), originDate.getMonth(), originDate.getDate() + d);
            bands.push({
                key: _dateStr(wk),
                label: `${_MONTHS[wk.getMonth()]} ${wk.getDate()}`,
                left: Math.round(d * z.pxPerDay),
                width: Math.round(7 * z.pxPerDay),
            });
        }
    } else {
        let d = 0;
        while (d < totalDays) {
            const cur = new Date(originDate.getFullYear(), originDate.getMonth(), originDate.getDate() + d);
            const firstOfNext = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            const span = Math.min(_days(_dateStr(cur), _dateStr(firstOfNext)), totalDays - d);
            bands.push({
                key: `${cur.getFullYear()}-${cur.getMonth()}`,
                label: `${_MONTHS[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
                left: Math.round(d * z.pxPerDay),
                width: Math.round(span * z.pxPerDay),
            });
            d += span;
        }
    }

    // Bars grouped onto their row, lane-packed so overlaps stay visible.
    const byRow = {};
    barsIn.forEach(b => { (byRow[b.rowId] = byRow[b.rowId] || []).push({ ...b }); });

    const rows = rowsIn.map(r => {
        const bars = byRow[r.id] || [];
        const lanes = _packLanes(bars);
        return {
            ...r,
            height: lanes * GANTT_LANE_H + GANTT_ROW_PAD,
            bars: bars.map(b => {
                const left = Math.round(_days(origin, b.start) * z.pxPerDay);
                const w = Math.max(4, Math.round((_days(b.start, b.end) + 1) * z.pxPerDay) - 2);
                // Every job shows its part #. A bar too narrow to hold the text
                // gets an outside label just to its right instead of rendering
                // blank — the bar keeps its true (short) width either way.
                const inside = w >= GANTT_MIN_LABEL_W;
                return {
                    ...b,
                    left, width: w,
                    showLabel: inside,
                    outsideLabel: !inside,
                    labelStyle: inside ? '' :
                        `left:${left + w + 3}px;top:${b.lane * GANTT_LANE_H + 4}px`,
                    style: `left:${left}px;width:${w}px;top:${b.lane * GANTT_LANE_H + 3}px;height:${GANTT_LANE_H - 4}px`,
                    title: `${b.part} · qty ${b.qty} · ${b.wcName} · ${b.start} → ${b.end}` +
                           (b.estimated ? ' · estimated (no routing)' : ` · ${b.hours}h`),
                };
            }),
        };
    });

    const tOff = _days(origin, todayStr);
    return {
        pxPerDay: z.pxPerDay, width, totalDays, origin, bands, rows,
        todayLeft: tOff >= 0 && tOff <= totalDays ? Math.round(tOff * z.pxPerDay) : null,
    };
}
