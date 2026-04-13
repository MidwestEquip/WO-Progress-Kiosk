// ============================================================
// libs/db-shared.js — Shared DB infrastructure
//
// Imported by db.js and all db-*.js sub-files.
// Contains: withRetry helper, dept alias maps, normalizeDept.
// No business logic. No Vue imports.
// ============================================================

import { supabase } from './config.js';

// ── Retry helper ──────────────────────────────────────────────
// Retries a Supabase operation up to maxRetries times on network failure.
// Returns { data, error } — same shape as Supabase responses.
export async function withRetry(operation, maxRetries = 2) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await operation();
            // Supabase returns { data, error } — propagate error without retrying on DB errors
            if (result.error) {
                const msg = result.error.message || '';
                // Only retry on network-level errors, not DB constraint errors
                const isNetworkError = msg.includes('Failed to fetch') ||
                                       msg.includes('NetworkError') ||
                                       msg.includes('timeout');
                if (!isNetworkError || attempt === maxRetries) return result;
                lastError = result.error;
            } else {
                return result;
            }
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries) return { data: null, error: err };
        }
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
    return { data: null, error: lastError };
}

// ── Dept normalization ────────────────────────────────────────
// Department aliases: Google Sheets sends "TC. Assy" / "TV. Assy" with a dot.
// DEPT_ALIASES maps canonical name → all accepted DB variants (for querying).
// DEPT_CANONICAL maps any variant → canonical name (for normalizing results).
export const DEPT_ALIASES = {
    'Tru Cut Assy':  ['TC Assy', 'TC. Assy', 'Tru Cut Assy'],
    'Trac Vac Assy': ['TV Assy', 'TV. Assy', 'TV Assy.', 'Trac Vac Assy'],
};
export const DEPT_CANONICAL = {
    'TC Assy':  'Tru Cut Assy',
    'TC. Assy': 'Tru Cut Assy',
    'TV Assy':  'Trac Vac Assy',
    'TV. Assy': 'Trac Vac Assy',
    'TV Assy.': 'Trac Vac Assy',
};

// Normalize a single row's department to its canonical name.
export function normalizeDept(row) {
    const canon = DEPT_CANONICAL[row.department];
    return canon ? { ...row, department: canon } : row;
}

export { supabase };
