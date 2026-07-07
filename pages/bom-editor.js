// ============================================================
// pages/bom-editor.js — BOM Lookup tab (Part Changes view)
//
// Read-only lookup in this patch; line editing + new-part
// creation arrive in the following patches.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';

// How deep the expandable BOM tree may go (levels below the searched parent).
const BOM_TREE_MAX_DEPTH = 10;

// _treeRow — wrap a fetched BOM line as a tree row. depth 0 = direct child of
// the searched parent; path = ancestor part numbers (cycle guard).
function _treeRow(line, depth, path) {
    return { ...line, depth, path, expanded: false, leaf: false, loading: false };
}

// runBomSearch — load the BOM (lines + descriptions) for the searched parent part.
export async function runBomSearch() {
    const part = store.bomSearch.value.trim().toUpperCase();
    if (!part) {
        store.showToast('Enter a part number to look up', 'error');
        return;
    }
    store.bomLoading.value    = true;
    store.bomSearched.value   = true;
    store.bomParent.value     = part;
    store.bomParentDesc.value = '';
    store.bomLines.value      = [];

    const [{ data: lines, error }, { data: parentRow }] = await Promise.all([
        db.fetchBomWithDescriptions(part),
        db.fetchItemMasterByPart(part),
    ]);
    store.bomLoading.value = false;
    if (error) {
        store.showToast('Could not load BOM: ' + error.message, 'error');
        return;
    }
    store.bomLines.value      = lines.map(l => _treeRow(l, 0, [part]));
    store.bomParentDesc.value = parentRow?.descrip || '';
}

// toggleBomLine — expand a row to show the child part's own BOM (indented one
// level), or collapse it (removes all deeper rows beneath it). Rows whose part
// has no BOM are marked leaf; circular references and depth are guarded.
export async function toggleBomLine(line) {
    const rows = store.bomLines.value;
    const idx  = rows.indexOf(line);
    if (idx === -1 || line.leaf || line.loading) return;

    if (line.expanded) {
        let end = idx + 1;
        while (end < rows.length && rows[end].depth > line.depth) end++;
        rows.splice(idx + 1, end - idx - 1);
        line.expanded = false;
        return;
    }

    if (line.depth + 1 >= BOM_TREE_MAX_DEPTH) {
        store.showToast('Maximum BOM depth reached', 'error');
        return;
    }
    const childPart = line.item_child_normalized;
    if (line.path.includes(childPart)) {
        line.leaf = true;
        store.showToast('Circular BOM reference — cannot expand ' + childPart, 'error');
        return;
    }

    line.loading = true;
    const { data, error } = await db.fetchBomWithDescriptions(childPart);
    line.loading = false;
    if (error) {
        store.showToast('Could not load children: ' + error.message, 'error');
        return;
    }
    if (!data.length) {
        line.leaf = true;    // no BOM — hide the chevron from now on
        return;
    }
    rows.splice(idx + 1, 0, ...data.map(l => _treeRow(l, line.depth + 1, [...line.path, childPart])));
    line.expanded = true;
}

// clearBomSearch — reset the BOM lookup panel to its empty state.
export function clearBomSearch() {
    store.bomSearch.value     = '';
    store.bomSearched.value   = false;
    store.bomParent.value     = '';
    store.bomParentDesc.value = '';
    store.bomLines.value      = [];
}
