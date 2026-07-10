// ============================================================
// libs/utils-open-orders.js — Pure Open Orders (shipping) helpers
//
// Split from libs/utils.js (500-line cap). Same rules as utils.js:
//  - No side effects, no imports, no state
//  - Every function is independently testable
// Re-exported by libs/utils.js so existing `from './utils.js'`
// imports keep resolving unchanged.
// ============================================================

// ── detectOpenOrderSection ────────────────────────────────────
// Auto-routes an open order to a section based on part number prefix.
// Part # starts with "TC" (case-insensitive) → 'tru_cut', else → 'trac_vac'.
// Freight and Emergency are assigned manually after creation.
export function detectOpenOrderSection(partNumber) {
    if (typeof partNumber !== 'string') return 'trac_vac';
    return partNumber.trim().toUpperCase().startsWith('TC') ? 'tru_cut' : 'trac_vac';
}

// ── openOrderMatchesFilter ────────────────────────────────────
// True when an open order row matches a search query. Checks part #,
// description, customer, SO#, WO/PO#, bins, and notes (case-insensitive).
// q must already be trimmed + lowercased (caller normalizes once per pass).
export function openOrderMatchesFilter(order, q) {
    if (!q) return true;
    return [order.part_number, order.description, order.customer, order.sales_order,
            order.wo_po_number, order.store_bin, order.update_store_bin, order.wo_va_notes]
        .some(v => (v || '').toLowerCase().includes(q));
}

// ── compareSalesOrder ─────────────────────────────────────────
// Ascending comparator for sales_order strings, numeric-aware so "99" sorts
// before "100". Extracts the first run of digits from each value and compares
// numerically; ties (or non-numeric values) fall back to case-insensitive
// string compare. Blank sales orders always sort last.
export function compareSalesOrder(a, b) {
    const sa = (a || '').trim();
    const sb = (b || '').trim();
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    const na = sa.match(/\d+/);
    const nb = sb.match(/\d+/);
    if (na && nb) {
        const diff = Number(na[0]) - Number(nb[0]);
        if (diff !== 0) return diff;
    }
    const la = sa.toLowerCase(), lb = sb.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
}

// ── openOrderGroupClass ───────────────────────────────────────
// Border classes that box consecutive rows sharing the same non-blank
// sales_order into a single dark rounded rectangle. Neighbor-based:
//   first of a 2+ group → top+sides dark, rounded top
//   middle of a group   → sides dark
//   last of a group     → bottom+sides dark, rounded bottom
// A lone SO (no matching neighbor) or a blank SO returns '' (no outline).
// prev/next are the adjacent rows in the already-sorted section (or undefined).
// Uses the ! important modifier so the dark border deterministically wins over
// the row's existing left color stripe (border-l-4) and light bottom divider
// (border-slate-100), which otherwise resolve by Tailwind source order.
export function openOrderGroupClass(order, prev, next) {
    const so = (order?.sales_order || '').trim();
    if (!so) return '';
    const samePrev = !!prev && (prev.sales_order || '').trim() === so;
    const sameNext = !!next && (next.sales_order || '').trim() === so;
    if (!samePrev && !sameNext) return '';
    if (!samePrev && sameNext)  return '!border-t-2 !border-x-2 !border-slate-700 rounded-t-lg';
    if (samePrev && sameNext)   return '!border-x-2 !border-slate-700';
    return '!border-b-2 !border-x-2 !border-slate-700 rounded-b-lg';
}

// ── normalizePasteDate ────────────────────────────────────────
// Normalize a pasted date string to YYYY-MM-DD for storage/sorting.
// Accepts: YYYY-MM-DD (pass-through), M/D, M/D/YY, M/D/YYYY (slash or dash).
// M/D with no year assumes the current year. Returns null when unparseable.
export function normalizePasteDate(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2}|\d{4}))?$/);
    if (!m) return null;
    const mo = Number(m[1]), da = Number(m[2]);
    let yr = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (m[3] && m[3].length === 2) yr += 2000;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

// ── parseClipboardTable ───────────────────────────────────────
// Parse text copied from a spreadsheet (Excel / Google Sheets) into a 2D
// array of rows × cells. The clipboard format is tab-delimited with
// RFC-4180-style quoting: a cell containing a tab, newline, or double quote
// is wrapped in double quotes, and literal double quotes inside are doubled
// ("").  This is why a naive split('\n')/split('\t') corrupts any row whose
// cell holds a line break — such cells span multiple physical lines.
// Input: raw clipboard string. Output: string[][] (never null). Handles
// \r\n and \r line endings. Cells are returned verbatim (no trimming).
export function parseClipboardTable(text) {
    if (typeof text !== 'string' || text === '') return [];
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
                else inQuotes = false;
            } else {
                field += ch;
            }
            continue;
        }
        // A quote is special only at the start of a field; a stray quote in
        // the middle of an unquoted cell (e.g. 6" CHUTE) is treated literally.
        // Excel quirk: a cell whose VALUE is a lone quote (a ditto mark) is
        // copied literally, without RFC-4180 wrapping — so a quote immediately
        // followed by a field/row terminator (or end of paste) is a complete
        // one-character cell, not an opener. Treating it as an opener would
        // swallow the newline and silently merge rows.
        if (ch === '"' && field === '') {
            const nx = text[i + 1];
            if (nx === undefined || nx === '\t' || nx === '\n' || nx === '\r') { field += '"'; }
            else inQuotes = true;
        }
        else if (ch === '\t') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;         // consume \r\n as one
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += ch;
        }
    }
    // flush the final field/row if the text did not end with a newline
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

// ── matchOpenOrderStatus ──────────────────────────────────────
// Case-insensitive match of a pasted status against the known status list.
// statuses is passed as an argument so this function stays pure (no imports).
// Returns the canonical status string, or null if unknown/blank.
export function matchOpenOrderStatus(raw, statuses) {
    if (typeof raw !== 'string' || !Array.isArray(statuses)) return null;
    const key = raw.trim().toLowerCase();
    if (!key) return null;
    return statuses.find(s => s.toLowerCase() === key) || null;
}

// isChutePart — returns true if the part number is a chute part.
// Chute parts are exactly 3 digits, a hyphen, then 6, 7, or 8.
// Examples: 900-8, 123-6, 045-7. Non-examples: 900-9, TEST-001, 1234-7.
// Input: raw part number string. Trims and uppercases before checking.
export function isChutePart(partNumber) {
    if (typeof partNumber !== 'string') return false;
    return /^\d{3}-[678]$/.test(partNumber.trim());
}

// ── businessDaysSince ─────────────────────────────────────────
// Counts Mon–Fri elapsed days between an ISO timestamp and now.
// Returns a float; partial days included. Returns 0 for null/invalid input.
export function businessDaysSince(isoTimestamp) {
    if (!isoTimestamp) return 0;
    const start = new Date(isoTimestamp);
    if (isNaN(start.getTime())) return 0;
    const now = new Date();
    if (start >= now) return 0;
    let elapsed = 0;
    const cursor = new Date(start);
    while (cursor < now) {
        const day = cursor.getDay(); // 0=Sun, 6=Sat
        if (day !== 0 && day !== 6) {
            const nextMidnight = new Date(cursor);
            nextMidnight.setHours(24, 0, 0, 0);
            elapsed += Math.min(nextMidnight.getTime(), now.getTime()) - cursor.getTime();
        }
        cursor.setHours(24, 0, 0, 0);
    }
    return elapsed / 86400000;
}

// ── openOrderEscalationLevel ───────────────────────────────────
// Passive escalation ladder for an untriaged/being-picked open order, derived
// purely from elapsed business days. No stored state, no messaging.
//   >1 business day  → 1 (owner Shipping — visible only / yellow row)
//   >2 business days → 2 (owner Shipping — "notify shipping")
//   >3 business days → 3 (owner Manager  — "notify manager")
// Applies to 'New' (inbox) and 'New/Picking' (a picker started but stalled).
// Anchor differs by status:
//   New         → date_entered (when the order came in). A freshly IMPORTED but
//                 old-dated row still goes stale, since its last_status_update
//                 is stamped at import time and would otherwise read as fresh.
//   New/Picking → last_status_update (when a picker last touched it).
// Each falls back through the other timestamps when its primary anchor is NULL.
export function openOrderEscalationLevel(order) {
    const status = order?.status || '';
    if (status !== 'New' && status !== 'New/Picking') return 0;
    const anchor = status === 'New'
        ? (order?.date_entered || order?.last_status_update || order?.created_at)
        : (order?.last_status_update || order?.date_entered || order?.created_at);
    const days = businessDaysSince(anchor);
    if (days > 3) return 3;
    if (days > 2) return 2;
    if (days > 1) return 1;
    return 0;
}

// ── getStaleHighlightColor ─────────────────────────────────────
// Returns a row highlight color when an order is overdue, or null if fresh.
// Staleness overrides manual row_color — call effectiveRowColor() in the page layer.
//   New / New/Picking + escalation level (see openOrderEscalationLevel):
//     level 1 → 'yellow', level 2 → 'amber', level 3 → 'red'
//   WO Created + deadline set + today > deadline+1 day → 'blue'
// Single source of truth: the New/Picking staleness color derives from the same
// escalation ladder the inbox badge uses.
export function getStaleHighlightColor(order) {
    const level = openOrderEscalationLevel(order);
    if (level >= 3) return 'red';
    if (level === 2) return 'amber';
    if (level === 1) return 'yellow';
    const status = order?.status || '';
    if (status === 'WO Created' && order.deadline) {
        const cutoff = new Date(order.deadline);
        cutoff.setDate(cutoff.getDate() + 1);
        if (new Date() > cutoff) return 'blue';
    }
    return null;
}

// ── getStaleInfo ──────────────────────────────────────────────
// Returns { owner, reason, level } if an open order is stale, or null if fresh.
// Mirrors the staleness rules used in the open-orders row highlight and drives
// the inbox escalation badge. level 1/2/3 from openOrderEscalationLevel.
export function getStaleInfo(order) {
    const level = openOrderEscalationLevel(order);
    if (level >= 3) return { owner: 'Manager',  level, reason: 'Untouched 3+ business days — notify manager' };
    if (level === 2) return { owner: 'Shipping', level, reason: 'Untouched 2+ business days — notify shipping' };
    if (level === 1) return { owner: 'Shipping', level, reason: 'Untouched 1+ business day' };
    const status = order?.status || '';
    if (status === 'WO Created' && order.deadline) {
        const cutoff = new Date(order.deadline);
        cutoff.setDate(cutoff.getDate() + 1);
        if (new Date() > cutoff) {
            return { owner: 'Dan H', level: 0, reason: `Past est. leadtime (${order.deadline})` };
        }
    }
    return null;
}

// ── decideOpenOrderWoAttach ───────────────────────────────────
// Pure decision for auto-attaching an active work order to an imported sales
// order row. Returns which of four scenarios applies plus the fields to write.
// Zero side effects — the caller supplies the committed tally and applies the
// result (and writes any production note). Scenario codes mirror
// OPEN_ORDER_WO_SCENARIO_LABEL in config.js (utils has no imports).
//
// Inputs:
//   toShip        — qty on this sales order line (row.to_ship).
//   activeWos     — active (not-completed) work_orders for this exact part, each
//                   { wo_number, qty_required, qty_completed, status }.
//   committedByWo — map { [wo_number]: qtyAlreadyCommitted } summed from open
//                   orders already tied to that WO, incl. rows earlier in this
//                   same paste (running tally maintained by the caller).
//
// Coverage: headroom = qty_required − committed. "Enough to cover this SO plus
// the SO the WO was originally made for" is captured because that original
// order's qty is already inside committedByWo (caller derives it).
//
// Started test: a WO counts as started once it leaves 'not_started' OR any
// qty has been completed.
//
// Output: { scenario, status, wo_po_number, shortfall, reason }
//   no_wo         (c) → no active WO, or nothing to cover → New/Picking, no WO#.
//   covered       (d) → toShip ≤ headroom → attach WO#, In Progress.
//   short_new     (e) → short AND WO not started → attach WO#, In Progress,
//                       shortfall = how many more to make (caller notifies prod).
//   short_started (f) → short AND WO already started → no attach, New/Picking
//                       (a fresh WO is needed).
export function decideOpenOrderWoAttach(toShip, activeWos, committedByWo = {}) {
    const q = Number(toShip) || 0;
    const wos = Array.isArray(activeWos) ? activeWos : [];
    if (!wos.length || q <= 0) {
        return { scenario: 'no_wo', status: 'New', wo_po_number: null, shortfall: 0,
                 reason: 'No active WO — left as New (inbox)' };
    }

    // Annotate each candidate with its remaining headroom and started flag.
    const cand = wos.map(w => {
        const committed = Number(committedByWo[w.wo_number]) || 0;
        const headroom  = (Number(w.qty_required) || 0) - committed;
        const started   = (w.status && w.status !== 'not_started') || (Number(w.qty_completed) || 0) > 0;
        return { wo: w, headroom, started };
    });

    // Prefer a WO that already covers this line (most headroom wins).
    const covering = cand.filter(c => q <= c.headroom)
                         .sort((a, b) => b.headroom - a.headroom);
    if (covering.length) {
        const woNum = covering[0].wo.wo_number;
        return { scenario: 'covered', status: 'In Progress', wo_po_number: woNum, shortfall: 0,
                 reason: `Covered by WO #${woNum} — set In Progress` };
    }

    // None covers. Prefer a not-started WO so production can just make more;
    // fall back to a started WO (which then needs a brand-new WO). Most
    // headroom first so the shortfall we ask production for is smallest.
    const notStarted = cand.filter(c => !c.started).sort((a, b) => b.headroom - a.headroom);
    if (notStarted.length) {
        const c = notStarted[0];
        const shortfall = q - Math.max(0, c.headroom);
        const woNum = c.wo.wo_number;
        return { scenario: 'short_new', status: 'In Progress', wo_po_number: woNum, shortfall,
                 reason: `WO #${woNum} short by ${shortfall} — set In Progress, production notified` };
    }

    const started = cand.sort((a, b) => b.headroom - a.headroom)[0];
    return { scenario: 'short_started', status: 'New', wo_po_number: null, shortfall: 0,
             reason: `WO #${started.wo.wo_number} already started & short — needs a new WO` };
}
