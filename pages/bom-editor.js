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

// ── New Part form (native item_master creation) ──────────────

// openNewPartForm — open the New Part form, optionally prefilled with the
// part number that failed an existence check in the BOM editor.
export function openNewPartForm(prefillPart = '') {
    store.newPartForm.value = {
        item: (prefillPart || '').trim().toUpperCase(), descrip: '',
        created_by: (store.bomEditName.value || '').trim(), replaces: '',
        item_type: '', prodclas: '', pricegrp: '', glinvtgr: '',
        lonhand: '', regprice: '', ship_price: '',
        box_weight: '', box_length: '', box_width: '', box_height: '',
        attr_purchased: false, attr_stocking: false, attr_component: false,
        attr_lot_costing: false, attr_ecommerce: false, attr_drop_ship: false,
        attr_sellable: false, attr_manufactured: false,
    };
    store.newPartErrors.value        = {};
    store.newPartBomLines.value      = [];
    store.newPartReplaceBoms.value   = [];
    store.newPartReplaceSearched.value = false;
    store.newPartOpen.value          = true;
}

// closeNewPartForm — dismiss without saving.
export function closeNewPartForm() {
    store.newPartOpen.value = false;
}

// lookupReplaceBoms — find every BOM the replaced part appears in so the manager
// can pick which lines swap to the new part. All rows start selected.
export async function lookupReplaceBoms() {
    const replaced = (store.newPartForm.value.replaces || '').trim().toUpperCase();
    store.newPartReplaceBoms.value = [];
    store.newPartReplaceSearched.value = false;
    if (!replaced) { store.showToast('Enter the part # this replaces first', 'error'); return; }
    store.newPartReplaceLoading.value = true;
    const { data, error } = await db.fetchBomLinesForChild(replaced);
    store.newPartReplaceLoading.value = false;
    if (error) { store.showToast('Could not look up BOMs: ' + error.message, 'error'); return; }
    store.newPartReplaceBoms.value = (data || []).map(r => ({ ...r, selected: true }));
    store.newPartReplaceSearched.value = true;
}

// addNewPartBomRow / removeNewPartBomRow — manage the initial-BOM rows
// (this is where raw material / steel usage goes: child part + qty).
export function addNewPartBomRow() {
    store.newPartBomLines.value.push({ item_child: '', qty_per_assy: 1 });
}
export function removeNewPartBomRow(idx) {
    store.newPartBomLines.value.splice(idx, 1);
}

// _num — form string → number or null (empty stays null, never NaN).
function _num(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

// _swapReplaceBoms — swap each SELECTED BOM line from the replaced part to the
// new part (source re-stamped 'native' by updateBomLine). Returns how many
// lines were swapped. Failures toast but don't abort (the part already exists).
async function _swapReplaceBoms(newItem) {
    const rows = store.newPartReplaceBoms.value.filter(r => r.selected);
    let swapped = 0;
    for (const row of rows) {
        const { error } = await db.updateBomLine(row.id, { item_child: newItem });
        if (error) { store.showToast(`Could not update BOM ${row.item_parent_normalized}: ${error.message}`, 'error'); continue; }
        swapped++;
    }
    return swapped;
}

// _openNewPartChangeRecord — every native part creation drops a part_changes
// record so print/BOM follow-up is tracked. Becomes a 'replacement' record when
// the part replaces another; otherwise 'new_part'. Refreshes the Records tab
// list. Non-fatal (the part is already created).
async function _openNewPartChangeRecord(item, name, replaced) {
    const isReplacement = !!replaced;
    const { error } = await db.insertPartChange({
        change_type: isReplacement ? 'replacement' : 'new_part',
        part_number: item,
        previous_part_number: replaced || null,
        use_previous_for_calcs: isReplacement,
        carry_forward_note: isReplacement
            ? `New part ${item} replaces ${replaced}`
            : 'Part created in New Part form',
        checklist: {}, status: PART_CHANGE_STATUS_OPEN, created_by: name,
    });
    if (error) return;
    const { data } = await db.fetchPartChanges();
    if (data) store.partChanges.value = data;
}

// submitNewPart — validate + create the item_master row (record_source='native'
// stamped in db-bom.js), then insert any initial BOM lines. Every BOM child
// must already exist; the part number must be new.
export async function submitNewPart() {
    const f = store.newPartForm.value;
    const item = (f.item || '').trim().toUpperCase();
    const name = (f.created_by || '').trim();
    const errors = {};
    if (!item)                       errors.item       = true;
    if (!(f.descrip || '').trim())   errors.descrip    = true;
    if (!name)                       errors.created_by = true;
    store.newPartErrors.value = errors;
    if (Object.keys(errors).length) { store.showToast('Part #, description, and your name are required', 'error'); return; }

    // validate initial BOM rows before writing anything
    const bomRows = [];
    const seen = new Set();
    for (const row of store.newPartBomLines.value) {
        const child = (row.item_child || '').trim().toUpperCase();
        const qty   = Number(row.qty_per_assy);
        if (!child) continue;                              // blank rows are ignored
        if (child === item)   { store.showToast('A part cannot be a component of itself', 'error'); return; }
        if (seen.has(child))  { store.showToast(`${child} is listed twice in the BOM`, 'error'); return; }
        if (!(qty > 0))       { store.showToast(`Qty for ${child} must be greater than 0`, 'error'); return; }
        const { data: exists, error } = await db.checkPartExists(child);
        if (error)   { store.showToast('Could not verify part: ' + error.message, 'error'); return; }
        if (!exists) { store.showToast(`BOM component ${child} is not in the item master`, 'error'); return; }
        seen.add(child);
        bomRows.push({ child, qty });
    }

    store.newPartSaving.value = true;
    try {
        const { error } = await db.insertItemMasterPart({
            item, descrip: f.descrip.trim(),
            item_type: (f.item_type || '').trim() || null,
            prodclas:  (f.prodclas  || '').trim() || null,
            pricegrp:  (f.pricegrp  || '').trim() || null,
            glinvtgr:  (f.glinvtgr  || '').trim() || null,
            lonhand:    _num(f.lonhand),
            regprice:   _num(f.regprice),
            ship_price: _num(f.ship_price),
            box_weight: _num(f.box_weight),
            box_length: _num(f.box_length),
            box_width:  _num(f.box_width),
            box_height: _num(f.box_height),
            attr_purchased:    !!f.attr_purchased,
            attr_stocking:     !!f.attr_stocking,
            attr_component:    !!f.attr_component,
            attr_lot_costing:  !!f.attr_lot_costing,
            attr_ecommerce:    !!f.attr_ecommerce,
            attr_drop_ship:    !!f.attr_drop_ship,
            attr_sellable:     !!f.attr_sellable,
            attr_manufactured: !!f.attr_manufactured,
        });
        if (error) throw error;
        for (const { child, qty } of bomRows) {
            const { error: bomErr } = await db.insertBomLine(item, child, qty);
            if (bomErr) { store.showToast(`Part created, but BOM line ${child} failed: ${bomErr.message}`, 'error'); }
        }
        // Swap the replaced part → new part on the selected BOM lines.
        const replaced = (f.replaces || '').trim().toUpperCase();
        const swapped  = replaced ? await _swapReplaceBoms(item) : 0;
        // Every new part opens a Change Record (source of truth for print/BOM follow-up).
        await _openNewPartChangeRecord(item, name, replaced || null);
        const bomMsg  = bomRows.length ? ` with ${bomRows.length} BOM line(s)` : '';
        const swapMsg = replaced ? `; replaced ${replaced} in ${swapped} BOM(s)` : '';
        store.showToast(`Part ${item} created${bomMsg}${swapMsg}`, 'success');
        store.newPartOpen.value = false;
    } catch (err) {
        store.showToast('Could not create part: ' + err.message, 'error');
    } finally {
        store.newPartSaving.value = false;
    }
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
        if (!exists) {
            store.showToast(`${newChild} is not in the item master — fill out the New Part form`, 'error');
            openNewPartForm(newChild);
            return;
        }
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
    if (!exists) {
        store.showToast(`${child} is not in the item master — fill out the New Part form`, 'error');
        openNewPartForm(child);
        return;
    }
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
