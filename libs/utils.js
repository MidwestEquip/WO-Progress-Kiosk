// ============================================================
// libs/utils.js — Pure utility functions
//
// RULES:
//  - No side effects, no imports, no state
//  - Every function is independently testable
//  - Input validation included
// ============================================================

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

// ── detectOpenOrderSection ────────────────────────────────────
// Auto-routes an open order to a section based on part number prefix.
// Part # starts with "TC" (case-insensitive) → 'tru_cut', else → 'trac_vac'.
// Freight and Emergency are assigned manually after creation.
export function detectOpenOrderSection(partNumber) {
    if (typeof partNumber !== 'string') return 'trac_vac';
    return partNumber.trim().toUpperCase().startsWith('TC') ? 'tru_cut' : 'trac_vac';
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

// ── getStaleHighlightColor ─────────────────────────────────────
// Returns a row highlight color when an order is overdue, or null if fresh.
// Staleness overrides manual row_color — call effectiveRowColor() in the page layer.
//   New/Picking  + >1.5 business days since last update → 'yellow'
//   WO Created   + deadline set + today > deadline+1 day  → 'blue'
export function getStaleHighlightColor(order) {
    const status = order?.status || '';
    if (status === 'New/Picking' && businessDaysSince(order.last_status_update) > 1.5) {
        return 'yellow';
    }
    if (status === 'WO Created' && order.deadline) {
        const cutoff = new Date(order.deadline);
        cutoff.setDate(cutoff.getDate() + 1);
        if (new Date() > cutoff) return 'blue';
    }
    return null;
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

// ── getStaleInfo ──────────────────────────────────────────────
// Returns { owner, reason } if an open order is stale, or null if fresh.
// Mirrors the staleness rules used in the open-orders row highlight.
export function getStaleInfo(order) {
    const status = order?.status || '';
    if (status === 'New/Picking' && businessDaysSince(order.last_status_update) > 1.5) {
        return { owner: 'Shipping', reason: 'No update in 1.5+ business days' };
    }
    if (status === 'WO Created' && order.deadline) {
        const cutoff = new Date(order.deadline);
        cutoff.setDate(cutoff.getDate() + 1);
        if (new Date() > cutoff) {
            return { owner: 'Dan H', reason: `Past est. leadtime (${order.deadline})` };
        }
    }
    return null;
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
