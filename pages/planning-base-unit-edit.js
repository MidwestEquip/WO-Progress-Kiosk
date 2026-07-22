// ============================================================
// pages/planning-base-unit-edit.js — edit a SAVED base unit
//
// Same editing surface as the build wizard, but every change writes
// straight to base_unit_options / base_unit_option_parts so a kit stays
// revisable years later without re-deriving it.
//
// A STEP has no row of its own: it is the (option_group, sort_order,
// required) triple repeated across its choice rows. Step-level edits
// therefore go through the group-wide db functions, keyed on the step's
// ORIGINAL identity (origGroup + sort_order) — see db-planning.js.
//
// Imports from store + db + utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { sanitizeText } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

const blankNewPart   = () => ({ part_number: '', qty_per_unit: 1 });
const blankNewChoice = () => ({ label: '', part_number: '', qty: 1 });

// ── Load / close ──────────────────────────────────────────────

// openBaseUnitEdit — load one saved unit and group its option rows into steps.
export async function openBaseUnitEdit(id) {
    store.baseUnitEditOpen.value    = true;
    store.baseUnitEditLoading.value = true;
    store.baseUnitEditStepForm.value = { group: '', required: false, label: '' };
    store.baseUnitEditDeleteKey.value = null;
    try {
        await _loadBaseUnitEdit(id);
    } finally {
        store.baseUnitEditLoading.value = false;
    }
}

// _loadBaseUnitEdit — (re)fetch the unit and rebuild the step model. Called
// after every structural write so row ids stay in sync with the database.
async function _loadBaseUnitEdit(id) {
    try {
        const { data, error } = await db.fetchBaseUnitDetail(id);
        if (error) throw error;
        store.baseUnitEditUnit.value = data.unit;
        const steps = [];
        data.options.forEach(o => {
            let step = steps.find(s => s.sort_order === o.sort_order && s.origGroup === o.option_group);
            if (!step) {
                step = {
                    sort_order: o.sort_order,
                    origGroup: o.option_group,
                    group: o.option_group,
                    required: o.required,
                    newChoice: blankNewChoice(),
                    choices: [],
                };
                steps.push(step);
            }
            step.choices.push({
                id: o.id,
                choice_label: o.choice_label,
                is_default: o.is_default,
                source: o.source,
                parts: (o.parts || []).map(p => ({ ...p })),
                newPart: blankNewPart(),
            });
        });
        steps.sort((a, b) => a.sort_order - b.sort_order);
        store.baseUnitEditSteps.value = steps;
    } catch (err) {
        store.showToast('Failed to load base unit: ' + err.message);
        logError('_loadBaseUnitEdit', err, { id });
    }
}

// closeBaseUnitEdit — shut the editor and refresh anything showing stale data:
// the saved-unit list, and the Plan tab if it is holding this same unit.
export function closeBaseUnitEdit() {
    const id = store.baseUnitEditUnit.value?.id;
    store.baseUnitEditOpen.value  = false;
    store.baseUnitEditUnit.value  = null;
    store.baseUnitEditSteps.value = [];
    if (store.planBaseUnit.value?.unit?.id === id) {
        store.planBaseUnit.value = null;
        store.planSplits.value   = [];
    }
    if (store.baseUnitDetail.value?.unit?.id === id) store.baseUnitDetail.value = null;
    store.loadBaseUnitsRequested.value++;
}

// ── Unit-level fields ─────────────────────────────────────────

// saveBuEditUnit — persist family name, status and notes on the base_units row.
export async function saveBuEditUnit() {
    const unit = store.baseUnitEditUnit.value;
    if (!unit) return;
    const family = sanitizeText(unit.family_name || '').toUpperCase();
    if (!family) { store.showToast('Family name is required.'); return; }
    store.baseUnitEditSaving.value = 'unit';
    try {
        const { error } = await db.updateBaseUnit(unit.id, {
            family_name: family,
            status: unit.status,
            notes: sanitizeText(unit.notes || '') || null,
            updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        unit.family_name = family;
        store.showToast('Base unit saved.', 'success');
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveBuEditUnit', err, { id: unit.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// ── Steps ─────────────────────────────────────────────────────

// saveBuEditStep — apply a rename / Required toggle to every choice row in the
// step at once, so the Plan tab never sees one step split into two.
export async function saveBuEditStep(step) {
    const unit = store.baseUnitEditUnit.value;
    if (!unit || !step) return;
    const group = sanitizeText(step.group || '');
    if (!group) { store.showToast('Step name is required.'); return; }
    store.baseUnitEditSaving.value = _stepKey(step);
    try {
        const { error } = await db.updateBaseUnitOptionGroup(
            unit.id, step.sort_order, step.origGroup, { option_group: group, required: !!step.required });
        if (error) throw error;
        step.origGroup = group;
        store.showToast('Step saved.', 'success');
    } catch (err) {
        store.showToast('Step save failed: ' + err.message);
        logError('saveBuEditStep', err, { id: unit.id, step: step.origGroup });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// deleteBuEditStep — two-click delete of a whole step and all of its choices.
export async function deleteBuEditStep(step) {
    const unit = store.baseUnitEditUnit.value;
    if (!unit || !step) return;
    const key = 'step|' + _stepKey(step);
    if (store.baseUnitEditDeleteKey.value !== key) { _armDelete(key); return; }
    store.baseUnitEditDeleteKey.value = null;
    store.baseUnitEditSaving.value = _stepKey(step);
    try {
        const { error } = await db.deleteBaseUnitOptionGroup(unit.id, step.sort_order, step.origGroup);
        if (error) throw error;
        await _loadBaseUnitEdit(unit.id);
        store.showToast('Step deleted.', 'success');
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('deleteBuEditStep', err, { id: unit.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// addBuEditStep — a step exists only through its choices, so a new step is
// created by inserting its first choice at the next sort_order.
export async function addBuEditStep() {
    const unit = store.baseUnitEditUnit.value;
    if (!unit) return;
    const f = store.baseUnitEditStepForm.value;
    const group = sanitizeText(f.group || '');
    const label = sanitizeText(f.label || '');
    if (!group) { store.showToast('Step name is required.'); return; }
    if (!label) { store.showToast('Give the step a first choice.'); return; }
    const nextOrder = store.baseUnitEditSteps.value
        .reduce((max, s) => Math.max(max, s.sort_order), -1) + 1;
    store.baseUnitEditSaving.value = 'newstep';
    try {
        const { error } = await db.insertBaseUnitOption(unit.id, {
            option_group: group, sort_order: nextOrder, required: !!f.required,
            choice_label: label, is_default: true, source: 'manual', parts: [],
        });
        if (error) throw error;
        store.baseUnitEditStepForm.value = { group: '', required: false, label: '' };
        await _loadBaseUnitEdit(unit.id);
        store.showToast('Step added.', 'success');
    } catch (err) {
        store.showToast('Could not add step: ' + err.message);
        logError('addBuEditStep', err, { id: unit.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// ── Choices ───────────────────────────────────────────────────

// addBuEditChoice — add a choice to an existing step (part number optional —
// a part-less choice plans but is excluded from material calculations).
export async function addBuEditChoice(step) {
    const unit = store.baseUnitEditUnit.value;
    if (!unit || !step) return;
    const f = step.newChoice || (step.newChoice = blankNewChoice());
    const label = sanitizeText(f.label || '');
    if (!label) { store.showToast('Choice label is required.'); return; }
    // Adding reloads from the database, which would discard an unsaved rename.
    if (sanitizeText(step.group || '') !== step.origGroup) {
        store.showToast('Click "Save step" first — the step name has unsaved changes.');
        return;
    }
    const part = sanitizeText(f.part_number || '').toUpperCase();
    store.baseUnitEditSaving.value = _stepKey(step);
    try {
        if (part && !(await _partExists(part))) return;
        const { error } = await db.insertBaseUnitOption(unit.id, {
            option_group: step.origGroup, sort_order: step.sort_order, required: !!step.required,
            choice_label: label, is_default: false, source: 'manual',
            parts: part ? [{ part_number: part, qty_per_unit: Number(f.qty) > 0 ? Number(f.qty) : 1 }] : [],
        });
        if (error) throw error;
        step.newChoice = blankNewChoice();
        await _loadBaseUnitEdit(unit.id);
        store.showToast('Choice added.', 'success');
    } catch (err) {
        store.showToast('Could not add choice: ' + err.message);
        logError('addBuEditChoice', err, { id: unit.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// saveBuEditChoice — persist an inline label edit on one choice.
export async function saveBuEditChoice(choice) {
    if (!choice) return;
    const label = sanitizeText(choice.choice_label || '');
    if (!label) { store.showToast('Choice label cannot be empty.'); return; }
    store.baseUnitEditSaving.value = choice.id;
    try {
        const { error } = await db.updateBaseUnitOption(choice.id, { choice_label: label });
        if (error) throw error;
        store.showToast('Choice saved.', 'success');
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveBuEditChoice', err, { id: choice.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// deleteBuEditChoice — two-click delete of one choice (its parts cascade).
// Removing a step's last choice removes the step with it.
export async function deleteBuEditChoice(choice) {
    const unit = store.baseUnitEditUnit.value;
    if (!unit || !choice) return;
    const key = 'choice|' + choice.id;
    if (store.baseUnitEditDeleteKey.value !== key) { _armDelete(key); return; }
    store.baseUnitEditDeleteKey.value = null;
    store.baseUnitEditSaving.value = choice.id;
    try {
        const { error } = await db.deleteBaseUnitOption(choice.id);
        if (error) throw error;
        await _loadBaseUnitEdit(unit.id);
        store.showToast('Choice deleted.', 'success');
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('deleteBuEditChoice', err, { id: choice.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// setBuEditDefault — make one choice the sole default of its step (the choice
// the Plan tab pre-fills with the full run quantity).
export async function setBuEditDefault(step, choice) {
    const unit = store.baseUnitEditUnit.value;
    if (!unit || !step || !choice) return;
    store.baseUnitEditSaving.value = choice.id;
    try {
        const { error } = await db.setBaseUnitOptionDefault(
            unit.id, step.sort_order, step.origGroup, choice.id);
        if (error) throw error;
        step.choices.forEach(c => { c.is_default = c.id === choice.id; });
    } catch (err) {
        store.showToast('Could not set default: ' + err.message);
        logError('setBuEditDefault', err, { id: choice.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// ── Parts on a choice ─────────────────────────────────────────

// addBuEditPart — add a part to a choice's package. The part must already
// exist in item_master (same rule as the BOM editor and the build wizard).
export async function addBuEditPart(choice) {
    if (!choice) return;
    const f = choice.newPart || (choice.newPart = blankNewPart());
    const part = sanitizeText(f.part_number || '').toUpperCase();
    const qty  = Number(f.qty_per_unit) > 0 ? Number(f.qty_per_unit) : 1;
    if (!part) { store.showToast('Enter a part number to add.'); return; }
    if (choice.parts.some(p => p.part_number === part)) {
        store.showToast(`${part} is already on this choice.`);
        return;
    }
    store.baseUnitEditSaving.value = choice.id;
    try {
        if (!(await _partExists(part))) return;
        const next = [...choice.parts, { part_number: part, qty_per_unit: qty }];
        const { error } = await db.replaceBaseUnitOptionParts(choice.id, next);
        if (error) throw error;
        choice.parts = next;
        choice.newPart = blankNewPart();
    } catch (err) {
        store.showToast('Could not add part: ' + err.message);
        logError('addBuEditPart', err, { part });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// removeBuEditPart — drop one part from a choice's package. A choice with no
// parts left is still valid (it becomes a part-less option).
export async function removeBuEditPart(choice, partIndex) {
    if (!choice) return;
    const next = choice.parts.filter((_, i) => i !== partIndex);
    await _saveChoiceParts(choice, next);
}

// saveBuEditPartQty — persist an inline qty edit, clamped to a positive number.
export async function saveBuEditPartQty(choice, part) {
    if (!choice || !part) return;
    part.qty_per_unit = Number(part.qty_per_unit) > 0 ? Number(part.qty_per_unit) : 1;
    await _saveChoiceParts(choice, choice.parts);
}

// _saveChoiceParts — write a choice's part list, reverting the in-memory list
// on failure so the screen never shows an unsaved state.
async function _saveChoiceParts(choice, parts) {
    const before = choice.parts;
    store.baseUnitEditSaving.value = choice.id;
    try {
        const { error } = await db.replaceBaseUnitOptionParts(choice.id, parts);
        if (error) throw error;
        choice.parts = parts;
    } catch (err) {
        choice.parts = before;
        store.showToast('Could not save parts: ' + err.message);
        logError('_saveChoiceParts', err, { id: choice.id });
    } finally {
        store.baseUnitEditSaving.value = '';
    }
}

// ── Helpers ───────────────────────────────────────────────────

// _partExists — item_master guard; toasts and returns false when unknown.
async function _partExists(part) {
    const { data: exists, error } = await db.checkPartExists(part);
    if (error) throw error;
    if (!exists) {
        store.showToast(`${part} is not in item_master — create it first, then add it here.`);
        return false;
    }
    return true;
}

// _stepKey — stable key for the saving/delete-arm flags.
function _stepKey(step) { return `${step.sort_order}|${step.origGroup}`; }

// _armDelete — first click of a two-click delete; disarms after 4 seconds.
function _armDelete(key) {
    store.baseUnitEditDeleteKey.value = key;
    setTimeout(() => {
        if (store.baseUnitEditDeleteKey.value === key) store.baseUnitEditDeleteKey.value = null;
    }, 4000);
}
