// ============================================================
// libs/utils.js — Pure utility functions
//
// RULES:
//  - No side effects, no imports, no state
//  - Every function is independently testable
//  - Input validation included
// ============================================================

// Open Orders (shipping) pure helpers live in a sibling sub-file to stay
// under the 500-line cap. Re-exported here so `from './utils.js'` still works.
export * from './utils-open-orders.js';

// subassyDepthBorder — Subassy Setup tree level aid. Returns a Tailwind
// left-border color class, cycling by depth so each level reads as a distinct
// colored stripe. Input: depth (int >= 0). Output: class string.
export function subassyDepthBorder(depth) {
    const palette = [
        'border-l-sky-500', 'border-l-violet-500', 'border-l-emerald-500',
        'border-l-amber-500', 'border-l-rose-500', 'border-l-cyan-500',
    ];
    const d = Number.isInteger(depth) && depth >= 0 ? depth : 0;
    return palette[d % palette.length];
}

// Format a date string or Date object to a locale-friendly date string
export function formatDateLocal(d) {
    if (!d) return '';
    try {
        return new Date(d).toLocaleDateString();
    } catch {
        return '';
    }
}

// Format a datetime for notes/history entries
export function formatTimestamp(d) {
    if (!d) return '';
    try {
        return new Date(d).toLocaleString('en-US', {
            month:   'numeric',
            day:     'numeric',
            year:    '2-digit',
            hour:    'numeric',
            minute:  '2-digit',
            hour12:  true
        });
    } catch {
        return '';
    }
}

// How many calendar days between two dates (positive = d2 is after d1)
export function daysBetween(d1, d2) {
    const t1 = d1 instanceof Date ? d1 : new Date(d1);
    const t2 = d2 instanceof Date ? d2 : new Date(d2);
    return (t2 - t1) / 86400000;
}

// How many days ago was a date (negative = future)
export function daysAgo(dateStr) {
    if (!dateStr) return null;
    return Math.floor(daysBetween(new Date(dateStr), new Date()));
}

// Generate a unique-enough manual WO number using timestamp
// Format: MANUAL-XXXXX (base-36 last 5 chars of timestamp)
export function generateManualWoNumber() {
    return 'MANUAL-' + Date.now().toString(36).toUpperCase().slice(-5);
}

// Sanitize text input: trim, prevent XSS injection in stored text
export function sanitizeText(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/<[^>]*>/g, ''); // strip any HTML tags
}

// Convert a part number to a safe Supabase Storage folder name.
// Uppercases, trims, and replaces any character that isn't alphanumeric or dash with underscore.
// e.g. "TC 11490 / A" → "TC_11490___A"  |  "TC11490" → "TC11490"
export function sanitizePartKey(partNumber) {
    if (typeof partNumber !== 'string' || !partNumber.trim()) return '_unknown';
    return partNumber.trim().toUpperCase().replace(/[^A-Z0-9\-]/g, '_');
}

// Validate that a string is not empty after trimming
export function isNonEmpty(str) {
    return typeof str === 'string' && str.trim().length > 0;
}

// Validate a numeric quantity (must be >= 0, finite)
export function isValidQty(val) {
    const n = parseFloat(val);
    return !isNaN(n) && isFinite(n) && n >= 0;
}

// Extract hold reasons from notes text
// Notes format: "... - Reason: Something | ..."
// Returns array of reason strings found in the text
export function extractHoldReasons(notesText) {
    if (!notesText) return [];
    const reasons = [];
    const pattern = /Reason:\s*([^|\n]+)/gi;
    let match;
    while ((match = pattern.exec(notesText)) !== null) {
        const r = match[1].trim();
        if (r) reasons.push(r);
    }
    return reasons;
}

// Get historical average cycle time for a department from completed orders
// Returns null if fewer than 3 data points (not reliable)
export function getHistoricalAvgDays(historyRows, dept) {
    const relevant = historyRows.filter(x =>
        x.department === dept && x.start_date && x.comp_date
    );
    if (relevant.length < 3) return null;
    const avg = relevant.reduce((sum, x) =>
        sum + daysBetween(new Date(x.start_date), new Date(x.comp_date)), 0
    ) / relevant.length;
    return Math.max(1, Math.round(avg));
}

// Deep clone a plain object/array (for undo snapshots)
// Only handles JSON-serializable values
export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Clamp a number between min and max
// Map of stage prefix → dedicated DB column name (authoritative source of truth)
const STAGE_QTY_COL = {
    TVENG: 'tv_engine_qty_completed',
    TVCRT: 'tv_cart_qty_completed',
    TVFIN: 'tv_final_qty_completed',
};

// Return the cumulative qty for a TV Assy unit stage.
// Prefers the dedicated DB column; falls back to notes parsing for pre-column rows.
// prefix is one of: TVENG, TVCRT, TVFIN
export function getStageCum(order, prefix) {
    const col = STAGE_QTY_COL[prefix];
    if (col && order?.[col] != null) return parseFloat(order[col]) || 0;
    const lines = (order?.notes || '').split('\n').filter(l => l.startsWith(prefix + '|'));
    if (!lines.length) return 0;
    return parseFloat(lines.at(-1).split('|')[5]) || 0;
}

export function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}

// ── detectReelWeld ────────────────────────────────────────────
// Returns true if a part number is a Weld reel part.
// Normalises input (trim + uppercase) before checking.
// reelList is passed as an argument so this function stays pure (no imports).
export function detectReelWeld(partNumber, reelList) {
    if (typeof partNumber !== 'string' || !Array.isArray(reelList)) return false;
    return reelList.includes(partNumber.trim().toUpperCase());
}

// addBusinessDays — add n Mon–Fri business days to a YYYY-MM-DD date string. Returns YYYY-MM-DD or null.
export function addBusinessDays(dateStr, n) {
    if (!dateStr || n <= 0) return dateStr || null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    let added = 0;
    while (added < n) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) added++;
    }
    return d.toISOString().slice(0, 10);
}

// addCalendarDays — add n calendar days to a YYYY-MM-DD string. Returns YYYY-MM-DD or null.
// Uses noon local time to avoid DST boundary issues.
export function addCalendarDays(dateStr, n) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

// ── detectTcMode ──────────────────────────────────────────────
// Detects TC Assy job mode from a part number.
// Normalises input (trim + uppercase) before checking.
//
// Returns 'unit'  if part starts with TCTC, TCC, or TCP.
// Returns 'stock' if part starts with TC (but not the above).
// Returns null    if part does not start with TC at all.
//
// Check order is intentional: TCTC first, then TCC, TCP, TC.
export function detectTcMode(partNumber) {
    if (typeof partNumber !== 'string') return null;
    const p = partNumber.trim().toUpperCase();
    if (!p) return null;
    if (p.startsWith('TCTC')) return 'unit';
    if (p.startsWith('TCC'))  return 'unit';
    if (p.startsWith('TCP'))  return 'unit';
    if (p.startsWith('TC'))   return 'stock';
    return null;
}

// normalizePartNumber — trim whitespace and uppercase for case-insensitive part matching.
export function normalizePartNumber(partNumber) {
    if (typeof partNumber !== 'string') return '';
    return partNumber.trim().toUpperCase();
}

// normalizePartNumberStrict — uppercase + strip ALL dashes and whitespace, for
// dash/space-insensitive matching. Mirrors the SQL de-dash in the active-order lookup RPCs
// (get_active_wos_for_part / get_active_pos_for_part) so client and server agree.
export function normalizePartNumberStrict(partNumber) {
    if (typeof partNumber !== 'string') return '';
    return partNumber.toUpperCase().replace(/[-\s]/g, '');
}

// computePrintRoutingChain — derives the ordered routing steps for a work order traveller.
// order: a work_orders row. travellerWos: { [traveller_id]: [work_orders rows] } map from store.
// Returns an array of step strings, e.g. ['Fab', 'Weld', 'Paint', 'W2 Staging'].
// Rules:
//   - Fab WO present → 'Fab'
//   - Weld WO present → 'Weld' then 'Paint' (weld always ends at paint)
//   - No Weld WO but Fab WO has fab_bring_to → use that value as the next step
//   - staging_area on the order → appended after the last paint/weld step
//   - Assy WOs → appended at the end
export function computePrintRoutingChain(order, travellerWos) {
    if (!order) return [];
    const wos  = order.traveller_id
        ? (travellerWos[order.traveller_id] || [order])
        : [order];

    const hasFab    = wos.some(w => w.department === 'Fab');
    const hasWeld   = wos.some(w => w.department === 'Weld');
    const hasTvAssy = wos.some(w => w.department === 'Trac Vac Assy');
    const hasTcAssy = wos.some(w => w.department === 'Tru Cut Assy');
    const fabWo     = wos.find(w => w.department === 'Fab');

    const steps = [];
    if (hasFab) steps.push('Fab');

    if (hasWeld) {
        steps.push('Weld');
        steps.push('Paint');
    } else if (hasFab && fabWo?.fab_bring_to) {
        steps.push(fabWo.fab_bring_to);
    }

    if (order.staging_area) steps.push(order.staging_area);
    if (hasTvAssy) steps.push('TV Assy');
    if (hasTcAssy) steps.push('TC Assy');

    return steps;
}

// isPurchasingOrderLate — true if expected_date is past and order is not complete/canceled.
export function isPurchasingOrderLate(order) {
    if (!order?.expected_date) return false;
    if (['received', 'canceled'].includes(order.status)) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(order.expected_date) < today;
}

// formatMsgTime — compact timestamp for direct message display.
// Today → "2:34 PM"; this year → "May 21"; older → "5/21/24". Input: ISO string. Output: string.
export function formatMsgTime(dateStr) {
    if (!dateStr) return '';
    try {
        const d   = new Date(dateStr);
        const now = new Date();
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
        if (d.getFullYear() === now.getFullYear()) {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
    } catch { return ''; }
}

// missingSubpartRoutingFields — for a single subpart plan/form, returns the labels of
// required routing fields that are still blank. Returns [] when Qty to Make is not a
// positive number (an un-filled subpart imposes no requirements). Pure: no side effects.
// A field counts as filled if it is not '' and not null/undefined (0 is allowed, e.g.
// set_up_time), matching the parent send-to-manager gate's semantics.
export function missingSubpartRoutingFields(form) {
    if (!form || !(parseFloat(form.qty_to_make) > 0)) return [];
    const REQUIRED = [
        ['fab',                 'Fab'],
        ['fab_print',           'Fab Print'],
        ['weld',                'Weld'],
        ['weld_print',          'Weld Print'],
        ['assy_wo',             'Assy WO'],
        ['bent_rolled_part',    'Bent/Rolled'],
        ['date_to_start',       'Date to Start'],
        ['estimated_lead_time', 'Lead Time'],
        ['set_up_time',         'Setup Time'],
    ];
    return REQUIRED
        .filter(([key]) => form[key] === '' || form[key] == null)
        .map(([, label]) => label);
}

// validateEngInquiryForm — returns an { field: true } errors object for the
// create-inquiry form. Category-aware: for record_category 'inquiry' the sales
// order # and all mower/trailer info are optional (only customer contact + CSR
// notes are required); for 'order' / 'issue_warranty' the full field set is
// required. Pure: no side effects. Empty object means valid.
export function validateEngInquiryForm(form) {
    const errors = {};
    const f = form || {};
    const mowerRequired = f.record_category === 'order' || f.record_category === 'issue_warranty';
    if (!f.customer_name?.trim())  errors.customer_name  = true;
    if (!f.customer_phone?.trim()) errors.customer_phone = true;
    if (!f.customer_email?.trim()) errors.customer_email = true;
    if (!f.csr_rep?.trim())        errors.csr_rep        = true;
    if (!f.csr_notes?.trim())      errors.csr_notes      = true;
    if (mowerRequired) {
        if (!f.sales_order_number?.trim()) errors.sales_order_number = true;
        if (!f.brand?.trim())              errors.brand              = true;
        if (!f.year?.trim())               errors.year               = true;
        if (f.inquiry_type === 'hitch') {
            if (!f.mower_model?.trim())            errors.mower_model            = true;
            if (!f.trac_vac_trailer_model?.trim()) errors.trac_vac_trailer_model = true;
        } else {
            if (!f.deck_model?.trim()) errors.deck_model = true;
            if (!f.deck_width?.trim()) errors.deck_width = true;
            if (!f.hose_size?.trim())  errors.hose_size  = true;
        }
    }
    return errors;
}
