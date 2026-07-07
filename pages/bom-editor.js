// ============================================================
// pages/bom-editor.js — BOM Lookup tab (Part Changes view)
//
// Read-only lookup in this patch; line editing + new-part
// creation arrive in the following patches.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { PART_CHANGE_STATUS_OPEN } from '../libs/config.js';

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

// clearBomSearch — reset the BOM lookup panel (including any edit state).
export function clearBomSearch() {
    store.bomSearch.value     = '';
    store.bomSearched.value   = false;
    store.bomParent.value     = '';
    store.bomParentDesc.value = '';
    store.bomLines.value      = [];
    store.bomEditLineId.value   = null;
    store.bomDeleteLineId.value = null;
    store.bomAddOpen.value      = false;
}

// ── BOM editing (manager-only UI) ────────────────────────────

// _requireEditName — edits are stamped onto auto-opened bom_change records.
function _requireEditName() {
    const name = store.bomEditName.value.trim();
    if (!name) store.showToast('Enter your name (above the table) before editing', 'error');
    return name;
}

// _collapseDescendants — remove all rows deeper than `line` directly below it.
function _collapseDescendants(line) {
    const rows = store.bomLines.value;
    const idx  = rows.indexOf(line);
    if (idx === -1) return;
    let end = idx + 1;
    while (end < rows.length && rows[end].depth > line.depth) end++;
    rows.splice(idx + 1, end - idx - 1);
    line.expanded = false;
}

// _ensureBomChangeRecord — auto-open a bom_change part_changes record for the
// edited parent unless one is already open (the checklist + WO-request warning
// fire from it). Refreshes the Records tab list on create.
async function _ensureBomChangeRecord(parentPart, name) {
    const { data: open, error } = await db.fetchOpenChangesForPart(parentPart);
    if (error) return;
    if ((open || []).some(r => r.change_type === 'bom_change')) return;
    const { error: insErr } = await db.insertPartChange({
        change_type: 'bom_change', part_number: parentPart,
        carry_forward_note: 'BOM edited in BOM Lookup',
        checklist: {}, status: PART_CHANGE_STATUS_OPEN, created_by: name,
    });
    if (insErr) return;
    store.showToast(`BOM Change record opened for ${parentPart} — complete its checklist`, 'success');
    const { data } = await db.fetchPartChanges();
    if (data) store.partChanges.value = data;
}

// startBomLineEdit — put one row into inline edit mode (part # + qty).
export function startBomLineEdit(line) {
    store.bomDeleteLineId.value = null;
    store.bomEditLineId.value   = line.id;
    store.bomEditForm.value     = { item_child: line.item_child_normalized, qty_per_assy: line.qty_per_assy };
}

// cancelBomLineEdit — leave edit mode without saving.
export function cancelBomLineEdit() {
    store.bomEditLineId.value = null;
}

// saveBomLineEdit — validate + persist the edited row. A changed part # must
// already exist in item_master; the row's expanded subtree collapses since it
// belonged to the old part. Auto-opens a bom_change record for the row's parent.
export async function saveBomLineEdit() {
    const line = store.bomLines.value.find(l => l.id === store.bomEditLineId.value);
    if (!line) return;
    const name = _requireEditName();
    if (!name) return;
    const f        = store.bomEditForm.value;
    const newChild = (f.item_child || '').trim().toUpperCase();
    const newQty   = Number(f.qty_per_assy);
    if (!newChild)      { store.showToast('Part # cannot be blank', 'error'); return; }
    if (!(newQty > 0))  { store.showToast('Qty per assy must be greater than 0', 'error'); return; }
    const childChanged = newChild !== line.item_child_normalized;
    if (childChanged) {
        const { data: exists, error } = await db.checkPartExists(newChild);
        if (error)   { store.showToast('Could not verify part: ' + error.message, 'error'); return; }
        if (!exists) { store.showToast(`${newChild} is not in the item master — create the part first`, 'error'); return; }
    }
    store.bomEditSaving.value = true;
    const { data, error } = await db.updateBomLine(line.id,
        childChanged ? { qty_per_assy: newQty, item_child: newChild } : { qty_per_assy: newQty });
    store.bomEditSaving.value = false;
    if (error) { store.showToast('Could not save BOM line: ' + error.message, 'error'); return; }

    if (childChanged && line.expanded) _collapseDescendants(line);
    line.qty_per_assy = data.qty_per_assy;
    line.source       = data.source;
    if (childChanged) {
        line.item_child            = data.item_child;
        line.item_child_normalized = data.item_child_normalized;
        line.expanded = false;
        line.leaf     = false;
        const { data: im } = await db.fetchItemMasterByPart(newChild);
        line.description = im?.descrip || '';
    }
    store.bomEditLineId.value = null;
    store.showToast('BOM line updated', 'success');
    _ensureBomChangeRecord(line.path[line.path.length - 1], name);
}

// askBomLineDelete / cancelBomLineDelete — two-click delete confirm per row.
export function askBomLineDelete(line) {
    store.bomEditLineId.value   = null;
    store.bomDeleteLineId.value = line.id;
}
export function cancelBomLineDelete() {
    store.bomDeleteLineId.value = null;
}

// confirmBomLineDelete — remove the line (and its expanded subtree) from the
// BOM. The part itself is untouched. Auto-opens a bom_change record.
export async function confirmBomLineDelete(line) {
    const name = _requireEditName();
    if (!name) return;
    const { error } = await db.deleteBomLine(line.id);
    if (error) { store.showToast('Could not delete BOM line: ' + error.message, 'error'); return; }
    _collapseDescendants(line);
    const rows = store.bomLines.value;
    const idx  = rows.indexOf(line);
    if (idx !== -1) rows.splice(idx, 1);
    store.bomDeleteLineId.value = null;
    store.showToast(`${line.item_child_normalized} removed from BOM`, 'success');
    _ensureBomChangeRecord(line.path[line.path.length - 1], name);
}

// openBomAdd / cancelBomAdd — inline add-component form (top level of the
// searched parent; to add inside a subassembly, search that part directly).
export function openBomAdd() {
    store.bomAddForm.value = { item_child: '', qty_per_assy: 1 };
    store.bomAddOpen.value = true;
}
export function cancelBomAdd() {
    store.bomAddOpen.value = false;
}

// submitBomAdd — validate + insert a new top-level line for the searched parent.
export async function submitBomAdd() {
    const name = _requireEditName();
    if (!name) return;
    const f     = store.bomAddForm.value;
    const child = (f.item_child || '').trim().toUpperCase();
    const qty   = Number(f.qty_per_assy);
    if (!child)        { store.showToast('Enter the part # to add', 'error'); return; }
    if (!(qty > 0))    { store.showToast('Qty per assy must be greater than 0', 'error'); return; }
    if (child === store.bomParent.value) { store.showToast('A part cannot be a component of itself', 'error'); return; }
    const { data: exists, error: checkErr } = await db.checkPartExists(child);
    if (checkErr) { store.showToast('Could not verify part: ' + checkErr.message, 'error'); return; }
    if (!exists)  { store.showToast(`${child} is not in the item master — create the part first`, 'error'); return; }
    if (store.bomLines.value.some(l => l.depth === 0 && l.item_child_normalized === child)) {
        store.showToast(`${child} is already on this BOM`, 'error'); return;
    }
    store.bomAddSaving.value = true;
    const { data, error } = await db.insertBomLine(store.bomParent.value, child, qty);
    store.bomAddSaving.value = false;
    if (error) { store.showToast('Could not add BOM line: ' + error.message, 'error'); return; }
    const { data: im } = await db.fetchItemMasterByPart(child);
    store.bomLines.value.push(_treeRow({ ...data, description: im?.descrip || '' }, 0, [store.bomParent.value]));
    store.bomAddOpen.value = false;
    store.showToast(`${child} added to ${store.bomParent.value}`, 'success');
    _ensureBomChangeRecord(store.bomParent.value, name);
}
