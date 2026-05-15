// ============================================================
// libs/db-part-defaults.js — Part approval defaults + usage history
//
// Extracted from db-inventory.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { BOM_PERIOD_START, BOM_PERIOD_END } from './config.js';

// ── Part Approval Defaults ────────────────────────────────────

// fetchPartApprovalDefault — look up routing defaults for a part number.
// Normalizes the part number before querying. Returns { data: row|null, error }.
export async function fetchPartApprovalDefault(partNumber) {
    if (!partNumber) return { data: null, error: null };
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('part_approval_defaults')
            .select('*')
            .eq('part_number_normalized', normalized)
            .limit(1)
    );
    return { data: (data && data[0]) || null, error };
}

// learnPartApprovalDefaults — save or fill-in routing defaults after an approval.
// approvedFields: plain object with any subset of the 7 approval columns.
// Insert if no row exists; otherwise fill only null/blank stored fields.
// Never overwrites a populated default. Always updates last_used_at.
export async function learnPartApprovalDefaults(partNumber, approvedFields, updatedBy = null) {
    if (!partNumber) return { data: null, error: new Error('Part number is required') };
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: null, error: new Error('Part number normalized to empty') };

    const { data: existing, error: fetchErr } = await withRetry(() =>
        supabase.from('part_approval_defaults')
            .select('*')
            .eq('part_number_normalized', normalized)
            .maybeSingle()
    );
    if (fetchErr) return { data: null, error: fetchErr };

    const now    = new Date().toISOString();
    const FIELDS = ['fab', 'fab_print', 'weld', 'weld_print', 'assy_wo', 'color', 'bent_rolled_part'];

    if (!existing) {
        const insert = {
            part_number:            partNumber.trim(),
            part_number_normalized: normalized,
            source:                 'manual_or_learned',
            created_at:             now,
            updated_at:             now,
            last_used_at:           now,
        };
        if (updatedBy) insert.created_by = updatedBy;
        FIELDS.forEach(f => {
            const v = approvedFields[f];
            if (v !== null && v !== undefined && v !== '') insert[f] = v;
        });
        return withRetry(() =>
            supabase.from('part_approval_defaults').insert([insert]).select()
        );
    }

    // Row exists: fill only null/blank stored fields — never overwrite populated ones
    const updates   = { last_used_at: now };
    let   anyFilled = false;
    FIELDS.forEach(f => {
        const stored   = existing[f];
        const approved = approvedFields[f];
        const isEmpty  = stored === null || stored === undefined || stored === '';
        const hasValue = approved !== null && approved !== undefined && approved !== '';
        if (isEmpty && hasValue) {
            updates[f] = approved;
            anyFilled  = true;
        }
    });
    if (anyFilled) {
        updates.updated_at = now;
        if (updatedBy) updates.updated_by = updatedBy;
    }

    return withRetry(() =>
        supabase.from('part_approval_defaults')
            .update(updates)
            .eq('part_number_normalized', normalized)
            .select()
    );
}

// ── Part usage history ────────────────────────────────────────

// fetchPartUsageSummary12Mo — calls the get_part_usage_summary_12mo RPC to return
// three 12-month sums from issues_receipts for a given part number.
// Returns { data: { qty_sold_used_12mo, qty_used_in_mfg, qty_made_past_12mo }, error }.
// All three values default to 0 when no matching rows exist.
export async function fetchPartUsageSummary12Mo(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: { qty_sold_used_12mo: 0, qty_used_in_mfg: 0, qty_made_past_12mo: 0 }, error: null };

    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_usage_summary_12mo', { p_part: normalized })
    );
    if (error) return { data: { qty_sold_used_12mo: 0, qty_used_in_mfg: 0, qty_made_past_12mo: 0 }, error };

    const row = (data && data[0]) || {};
    return {
        data: {
            qty_sold_used_12mo: Number(row.qty_sold_12mo     ?? 0),
            qty_used_in_mfg:    Number(row.qty_used_mfg_12mo ?? 0),
            qty_made_past_12mo: Number(row.qty_made_12mo     ?? 0),
        },
        error: null,
    };
}

// fetchPartLastMade — last 2 MO receipt rows for a part (doctype=MO, trantype=I),
// newest first. Uses SECURITY DEFINER RPC to bypass RLS on issues_receipts.
// Returns { data: [{ txn_date, qty }], error }.
export async function fetchPartLastMade(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_last_made', { p_part: normalized })
    );
    return { data: data || [], error };
}

// fetchPartsUsageSummaryBatch — calls get_parts_usage_summary_batch RPC for a batch of parts.
// Returns { data: { [part_normalized]: { qty_made_12mo, qty_used_mfg_12mo } }, error }.
export async function fetchPartsUsageSummaryBatch(partNumbers) {
    if (!partNumbers || partNumbers.length === 0) return { data: {}, error: null };
    const normalized = partNumbers.map(p => normalizePartNumber(p)).filter(Boolean);
    if (!normalized.length) return { data: {}, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_parts_usage_summary_batch', { p_parts: normalized })
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => { map[r.part_normalized] = { qty_made_12mo: r.qty_made_12mo, qty_used_mfg_12mo: r.qty_used_mfg_12mo }; });
    return { data: map, error: null };
}

// fetchBinLocationsForParts — calls get_part_bin_locations RPC for a batch of part numbers.
// Returns the most recent non-null issues_receipts.store value per part.
// Returns { data: { [part_normalized]: bin_location }, error }.
export async function fetchBinLocationsForParts(partNumbers) {
    if (!partNumbers || partNumbers.length === 0) return { data: {}, error: null };
    const normalized = partNumbers.map(p => normalizePartNumber(p)).filter(Boolean);
    if (!normalized.length) return { data: {}, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_bin_locations', { p_parts: normalized })
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => { map[r.part_normalized] = r.bin_location; });
    return { data: map, error: null };
}

// fetchPartsMadeAllTime — calls get_parts_made_all_time RPC for a batch of normalized part numbers.
// Returns all-time MO+I qty from issues_receipts with no date filter.
// Returns { data: { [part_normalized]: qty_made }, error }.
export async function fetchPartsMadeAllTime(partNumbers) {
    if (!partNumbers || partNumbers.length === 0) return { data: {}, error: null };
    const normalized = partNumbers.map(p => normalizePartNumber(p)).filter(Boolean);
    if (!normalized.length) return { data: {}, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_parts_made_all_time', { p_parts: normalized })
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => { map[r.part_normalized] = Number(r.qty_made) || 0; });
    return { data: map, error: null };
}

// fetchBinAndDescForParts — calls get_part_bin_and_desc RPC (SECURITY DEFINER) for a batch of
// normalized part numbers. Returns most recent bin + description per part from issues_receipts.
// Returns { data: { bins: { [part_normalized]: bin }, descs: { [part_normalized]: desc } }, error }.
export async function fetchBinAndDescForParts(partNumbers) {
    if (!partNumbers || partNumbers.length === 0) return { data: { bins: {}, descs: {} }, error: null };
    const normalized = partNumbers.map(p => normalizePartNumber(p)).filter(Boolean);
    if (!normalized.length) return { data: { bins: {}, descs: {} }, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_bin_and_desc', { p_parts: normalized })
    );
    if (error) return { data: { bins: {}, descs: {} }, error };
    const bins = {}, descs = {};
    (data || []).forEach(r => {
        if (r.bin_location) bins[r.part_normalized] = r.bin_location;
        if (r.description)  descs[r.part_normalized] = r.description;
    });
    return { data: { bins, descs }, error: null };
}

// fetchBomChildrenForParent — returns BOM child rows for a single parent part.
// Returns { data: [{ item_child, item_child_normalized, qty_per_assy }], error }.
export async function fetchBomChildrenForParent(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_child, item_child_normalized, qty_per_assy')
            .eq('item_parent_normalized', normalized)
            .order('item_child_normalized', { ascending: true })
    );
    return { data: data || [], error };
}

// fetchBomParentsForChild — returns BOM parent rows for a single child part.
// Returns { data: [{ item_parent_normalized, qty_per_assy }], error }.
export async function fetchBomParentsForChild(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_parent_normalized, qty_per_assy')
            .eq('item_child_normalized', normalized)
    );
    return { data: data || [], error };
}

// fetchBomParentsForChildren — batch version: finds all BOM rows where
// item_child_normalized is any of the given normalized part numbers.
// Returns { data: [{ item_child_normalized, item_parent_normalized, qty_per_assy }], error }.
export async function fetchBomParentsForChildren(partNumbers) {
    if (!partNumbers || partNumbers.length === 0) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_child_normalized, item_parent_normalized, qty_per_assy')
            .in('item_child_normalized', partNumbers)
    );
    return { data: data || [], error };
}

// fetchPartsSoldInPeriod — calls get_parts_sold_in_period RPC for a batch of
// normalized part numbers. Single round-trip regardless of how many parents.
// Returns { data: [{ part_normalized, qty_sold }], error }.
export async function fetchPartsSoldInPeriod(partNumbers, pStart, pEnd) {
    if (!partNumbers || partNumbers.length === 0) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_parts_sold_in_period', {
            p_parts: partNumbers,
            p_start: pStart,
            p_end:   pEnd,
        })
    );
    return { data: data || [], error };
}

// fetchQtySoldFromSalesAnalysis — calls get_sales_analysis_sold RPC for a batch
// of part numbers. Normalizes inputs internally. Defaults to BOM_PERIOD_START/END.
// Returns { data: { [item_normalized]: qty_sold }, error }.
export async function fetchQtySoldFromSalesAnalysis(partNumbers, pStart = BOM_PERIOD_START, pEnd = BOM_PERIOD_END) {
    if (!partNumbers || partNumbers.length === 0) return { data: {}, error: null };
    const normalized = partNumbers.map(p => normalizePartNumber(p)).filter(Boolean);
    if (!normalized.length) return { data: {}, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_sales_analysis_sold', {
            p_parts: normalized,
            p_start: pStart,
            p_end:   pEnd,
        })
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => { map[r.item_normalized] = Number(r.qty_sold) || 0; });
    return { data: map, error: null };
}

// fetchPartPurchased12Mo — calls get_part_purchased_12mo RPC (SECURITY DEFINER).
// Returns PO receipts (doctype=PO, trantype=IO) for a part in the last 12 months.
// Returns { data: [{txn_date, qty}] (last 2 only), qty_12mo (full sum), error }.
export async function fetchPartPurchased12Mo(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: [], qty_12mo: 0, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_purchased_12mo', { p_part: normalized })
    );
    if (error) return { data: [], qty_12mo: 0, error };
    const rows     = data || [];
    const qty_12mo = rows.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
    return { data: rows.slice(0, 2), qty_12mo, error: null };
}

// fetchLastTwoPurchasesWithSupplier — enriched last-2 PO receipts for a part.
// Joins issues_receipts → purchasing_suppliers via lateral join (best-match COID).
// Returns { data: [{ txn_date, qty, cost, company_name, contact, phone, email,
//   our_account_number, street, city, state, zip }], error }.
export async function fetchLastTwoPurchasesWithSupplier(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('fetch_last_two_purchases_with_supplier', { p_part_number: normalized })
    );
    return { data: data || [], error };
}

// calculateQtySoldParentUsage — single-level parent demand (kept for reference).
// Superseded by calculateRecursiveParentUsageDemand for production use.
export async function calculateQtySoldParentUsage(partNumber) {
    const { data: parents, error: bomErr } = await fetchBomParentsForChild(partNumber);
    if (bomErr) return { data: 0, error: bomErr };
    if (!parents.length) return { data: 0, error: null };

    const parentParts = parents.map(p => p.item_parent_normalized);
    const { data: salesRows, error: salesErr } = await fetchPartsSoldInPeriod(
        parentParts, BOM_PERIOD_START, BOM_PERIOD_END
    );
    if (salesErr) return { data: 0, error: salesErr };

    const salesMap = {};
    (salesRows || []).forEach(r => { salesMap[r.part_normalized] = Number(r.qty_sold) || 0; });

    const total = parents.reduce((sum, p) => {
        const sold = salesMap[p.item_parent_normalized] || 0;
        return sum + sold * (Number(p.qty_per_assy) || 1);
    }, 0);

    return { data: total, error: null };
}

const MAX_BOM_DEPTH = 10;

// calculateRecursiveParentUsageDemand — multi-level BFS BOM demand rollup.
//
// Traverses BOM parents level-by-level (one batch query per level to all_boms).
// Each frontier node carries { part, multiplier, path[] } where multiplier is the
// accumulated product of qty_per_assy from the requested child up to this ancestor.
// The same ancestor reached via multiple BOM paths contributes separately per path —
// this is correct demand math (each path represents a distinct physical usage chain).
//
// After full traversal: one batch sales query for all unique ancestors.
// Returns { data: { totalDemand, parentCount, maxDepthReached, cycleDetected, pathDetails }, error }.
export async function calculateRecursiveParentUsageDemand(
    partNumber,
    pStart = BOM_PERIOD_START,
    pEnd   = BOM_PERIOD_END
) {
    const normalized = normalizePartNumber(partNumber);
    const empty = { totalDemand: 0, parentCount: 0, maxDepthReached: 0, cycleDetected: false, pathDetails: [] };
    if (!normalized) return { data: empty, error: null };

    // frontier: nodes we still need to find parents for
    let frontier = [{ part: normalized, multiplier: 1, path: [normalized] }];
    const allAncestors = []; // every ancestor node found across all levels
    let cycleDetected  = false;
    let maxDepthReached = 0;

    for (let depth = 0; depth < MAX_BOM_DEPTH; depth++) {
        if (frontier.length === 0) break;

        // One batch query for all parts in the current frontier
        const childParts = [...new Set(frontier.map(n => n.part))];
        const { data: bomRows, error: bomErr } = await fetchBomParentsForChildren(childParts);
        if (bomErr) return { data: { ...empty, maxDepthReached, cycleDetected }, error: bomErr };
        if (!bomRows.length) break;

        maxDepthReached = depth + 1;

        // Build a lookup from child part → frontier nodes that have that child
        const frontierByChild = {};
        for (const node of frontier) {
            if (!frontierByChild[node.part]) frontierByChild[node.part] = [];
            frontierByChild[node.part].push(node);
        }

        const nextFrontier = [];
        for (const row of bomRows) {
            const parentPart = row.item_parent_normalized;
            const childPart  = row.item_child_normalized;
            const qpa        = Number(row.qty_per_assy) || 1;
            const nodes      = frontierByChild[childPart] || [];

            for (const node of nodes) {
                if (node.path.includes(parentPart)) {
                    cycleDetected = true;
                    continue; // skip this path to avoid infinite loop
                }
                const newMultiplier = node.multiplier * qpa;
                const newPath       = [...node.path, parentPart];
                allAncestors.push({ part: parentPart, multiplier: newMultiplier, path: newPath });
                nextFrontier.push({ part: parentPart, multiplier: newMultiplier, path: newPath });
            }
        }

        frontier = nextFrontier;
    }

    if (allAncestors.length === 0) {
        return { data: { ...empty, maxDepthReached, cycleDetected }, error: null };
    }

    // One batch sales lookup for all unique ancestor parts (from sales_analysis_lines)
    const uniqueParts = [...new Set(allAncestors.map(a => a.part))];
    const { data: salesMap, error: salesErr } = await fetchQtySoldFromSalesAnalysis(uniqueParts, pStart, pEnd);
    if (salesErr) return { data: { ...empty, maxDepthReached, cycleDetected }, error: salesErr };

    // Sum demand across all paths
    let totalDemand = 0;
    const contributingParts = new Set();
    const pathDetails = [];

    for (const ancestor of allAncestors) {
        const parentQtySold      = salesMap[ancestor.part] || 0;
        const demandContribution = parentQtySold * ancestor.multiplier;
        totalDemand += demandContribution;
        if (parentQtySold > 0) contributingParts.add(ancestor.part);
        pathDetails.push({
            topParent:          ancestor.part,
            path:               ancestor.path.join(' → '),
            multiplier:         ancestor.multiplier,
            parentQtySold,
            demandContribution,
        });
    }

    return {
        data: {
            totalDemand,
            parentCount:    contributingParts.size,
            maxDepthReached,
            cycleDetected,
            pathDetails,
        },
        error: null,
    };
}
