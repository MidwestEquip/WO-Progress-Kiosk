// ============================================================
// pages/subassy-setup.js — TEMPORARY: Subassy Setup
//
// Where-used explorer. Search a part #, see its immediate components
// (one level down) and the chain of parents up to the unit it belongs to.
// Read-only. Reuses existing all_boms helpers in db-part-defaults.js.
// Imports from store + db only. Never imported by other page files.
//
// NOTE: temporary feature — this whole file plus partials/view-subassy-setup.html
// can be deleted to remove it (also undo the small insertions in config.js,
// store-inventory.js, expose-ops.js, view-splash.html).
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { normalizePartNumber, detectTcMode } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

const MAX_DEPTH = 12;   // safety cap on how far up the BOM we climb
const MAX_NODES = 500;  // safety cap on rendered rows (common low-level parts fan out hugely)

// resetSubassyState — clear all result + search state back to a blank slate.
function resetSubassyState() {
    store.subassySearch.value     = '';
    store.subassyLoading.value    = false;
    store.subassyError.value      = '';
    store.subassyRoot.value       = null;
    store.subassyComponents.value = [];
    store.subassyUsedOnRows.value = [];
    store.subassyTruncated.value  = false;
    store.subassyUnitExpanded.value = {};
    store.subassyPopupOpen.value   = false;
    store.subassyPopupRows.value   = [];
}

// enterSubassySetup — navigate to the Subassy Setup view with a clean slate.
// splashLevel/Category are preserved so the header Back button (goBack) returns
// to the inventory sub-menu.
export function enterSubassySetup() {
    resetSubassyState();
    store.currentView.value = 'subassy_setup';
}

// clearSubassySearch — clear the search box and any results (stay on the view).
export function clearSubassySearch() {
    resetSubassyState();
}

// runSubassySearch — look up a part's immediate components (one level down).
// The used-on walk-up lands in Patch 3. Read-only.
export async function runSubassySearch() {
    const term = (store.subassySearch.value || '').trim();
    if (!term) {
        store.subassyError.value = 'Enter a part # to search.';
        return;
    }
    const normalized = normalizePartNumber(term);
    store.subassyError.value      = '';
    store.subassyLoading.value    = true;
    store.subassyRoot.value       = null;
    store.subassyComponents.value = [];
    store.subassyUsedOnRows.value = [];
    store.subassyTruncated.value  = false;
    store.subassyUnitExpanded.value = {};

    try {
        // Immediate components (one level down) from all_boms.
        const { data: kids, error: kidsErr } = await db.fetchBomChildrenForParent(normalized);
        if (kidsErr) throw kidsErr;

        // Descriptions for the searched part + each component (single batch call).
        const descParts = [normalized, ...kids.map(k => k.item_child_normalized)];
        const { data: bd } = await db.fetchBinAndDescForParts(descParts);
        const descs = (bd && bd.descs) || {};

        store.subassyRoot.value = { part: normalized, desc: descs[normalized] || '' };
        store.subassyComponents.value = kids.map(k => ({
            part: k.item_child,
            qty:  Number(k.qty_per_assy) || 1,
            desc: descs[k.item_child_normalized] || '',
        }));

        // Used-on walk-up to units.
        const { rows, truncated } = await buildUsedOnTree(normalized);
        const upParts = [...new Set(rows.map(r => r.part))];
        if (upParts.length) {
            const { data: bd2 } = await db.fetchBinAndDescForParts(upParts);
            const upDescs = (bd2 && bd2.descs) || {};
            rows.forEach(r => { r.desc = upDescs[r.part] || ''; });
        }
        store.subassyUsedOnRows.value = rows;
        store.subassyTruncated.value  = truncated;
    } catch (err) {
        logError('runSubassySearch', err, { part: normalized });
        store.subassyError.value = 'Search failed: ' + (err.message || 'unknown error');
        store.showToast('Subassy search failed: ' + (err.message || 'error'));
    } finally {
        store.subassyLoading.value = false;
    }
}

// buildUsedOnTree — climb all_boms parents from rootNormalized up to units.
// Returns { rows, truncated }. rows = flattened pre-order
// [{ child, part, qty, depth, isUnit, desc }] where `child` is used on `part`.
// A node is a Tru Cut Unit when its part # starts with TCC/TCTC/TCP
// (detectTcMode === 'unit'); climbing stops once a unit is reached.
// One batch query per level (BFS); a per-path visited set breaks cyclic BOM data;
// MAX_DEPTH / MAX_NODES guard against runaway fan-out on common low-level parts.
async function buildUsedOnTree(rootNormalized) {
    // Phase A — BFS: collect child→parents edges, one query per level.
    // Units are recorded as edges but never expanded further (they are the top).
    const childToParents = new Map();        // normChild -> [{ parent, qty }]
    let frontier = new Set([rootNormalized]);
    const queried = new Set();
    for (let depth = 0; depth < MAX_DEPTH && frontier.size > 0; depth++) {
        const { data, error } = await db.fetchBomParentsForChildren([...frontier]);
        if (error) throw error;
        const next = new Set();
        for (const r of (data || [])) {
            const child  = r.item_child_normalized;
            const parent = r.item_parent_normalized;
            if (!parent) continue;
            if (!childToParents.has(child)) childToParents.set(child, []);
            childToParents.get(child).push({ parent, qty: Number(r.qty_per_assy) || 1 });
            if (!queried.has(parent) && detectTcMode(parent) !== 'unit') next.add(parent);
        }
        for (const p of frontier) queried.add(p);
        frontier = next;
    }

    // Phase B — DFS pre-order flatten from the searched part's parents upward.
    const rows = [];
    let truncated = false;
    const walk = (node, depth, path) => {
        const parents = childToParents.get(node) || [];
        for (const { parent, qty } of parents) {
            if (rows.length >= MAX_NODES) { truncated = true; return; }
            if (path.has(parent)) continue;   // cycle guard along this path
            const isUnit = detectTcMode(parent) === 'unit';
            rows.push({ child: node, part: parent, qty, depth, isUnit, desc: '' });
            if (!isUnit) {                     // stop climbing once we hit a unit
                path.add(parent);
                walk(parent, depth + 1, path);
                path.delete(parent);
            }
        }
    };
    walk(rootNormalized, 0, new Set([rootNormalized]));
    return { rows, truncated };
}

// toggleUnitChildren — expand/collapse a unit's immediate components (one level
// down). Lazily fetches the first-level BOM the first time a unit is expanded.
export async function toggleUnitChildren(unitPart) {
    const map = store.subassyUnitExpanded.value;
    if (map[unitPart]) {                       // already expanded → collapse
        const next = { ...map };
        delete next[unitPart];
        store.subassyUnitExpanded.value = next;
        return;
    }
    store.subassyUnitExpanded.value = { ...map, [unitPart]: { loading: true, children: [] } };
    try {
        const { data: kids, error } = await db.fetchBomChildrenForParent(unitPart);
        if (error) throw error;
        const { data: bd } = await db.fetchBinAndDescForParts(kids.map(k => k.item_child_normalized));
        const descs = (bd && bd.descs) || {};
        const children = kids.map(k => ({
            part: k.item_child,
            qty:  Number(k.qty_per_assy) || 1,
            desc: descs[k.item_child_normalized] || '',
        }));
        store.subassyUnitExpanded.value = { ...store.subassyUnitExpanded.value, [unitPart]: { loading: false, children } };
    } catch (err) {
        logError('toggleUnitChildren', err, { unit: unitPart });
        store.showToast('Failed to load unit components: ' + (err.message || 'error'));
        const next = { ...store.subassyUnitExpanded.value };
        delete next[unitPart];
        store.subassyUnitExpanded.value = next;
    }
}

// openComponentUsedOn — popup showing the where-used walk-up for a clicked
// component (reuses buildUsedOnTree, same chain up to the Tru Cut unit).
export async function openComponentUsedOn(part) {
    const normalized = normalizePartNumber(part);
    store.subassyPopupPart.value      = normalized;
    store.subassyPopupOpen.value      = true;
    store.subassyPopupLoading.value   = true;
    store.subassyPopupRows.value      = [];
    store.subassyPopupTruncated.value = false;
    try {
        const { rows, truncated } = await buildUsedOnTree(normalized);
        const upParts = [...new Set(rows.map(r => r.part))];
        if (upParts.length) {
            const { data: bd } = await db.fetchBinAndDescForParts(upParts);
            const descs = (bd && bd.descs) || {};
            rows.forEach(r => { r.desc = descs[r.part] || ''; });
        }
        store.subassyPopupRows.value      = rows;
        store.subassyPopupTruncated.value = truncated;
    } catch (err) {
        logError('openComponentUsedOn', err, { part: normalized });
        store.showToast('Failed to load where-used: ' + (err.message || 'error'));
    } finally {
        store.subassyPopupLoading.value = false;
    }
}

export function closeComponentUsedOn() {
    store.subassyPopupOpen.value = false;
    store.subassyPopupRows.value = [];
}
