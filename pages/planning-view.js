// ============================================================
// pages/planning-view.js — Production Planning: Base Units tab
//
// Navigation, saved-unit list, and the derive-then-confirm kit
// wizard (sibling picker → review/edit → save).
// Imports from store + db + utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { deriveBaseUnitKit, findModularChildren, sanitizeText } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// ── Navigation ────────────────────────────────────────────────

// enterProductionPlanning — open the standalone view (manager tile) and load units.
export function enterProductionPlanning() {
    store.currentView.value = 'production_planning';
    store.planningTab.value = 'base_units';
    loadBaseUnits();
}

// exitProductionPlanning — back to splash; wizard state is kept until closed.
export function exitProductionPlanning() {
    store.currentView.value = 'splash';
}

// ── Saved base units ──────────────────────────────────────────

// loadBaseUnits — refresh the saved-unit list.
export async function loadBaseUnits() {
    store.baseUnitsLoading.value = true;
    try {
        const { data, error } = await db.fetchBaseUnits();
        if (error) throw error;
        store.baseUnits.value = data;
    } catch (err) {
        store.showToast('Failed to load base units: ' + err.message);
        logError('loadBaseUnits', err);
    } finally {
        store.baseUnitsLoading.value = false;
    }
}

// openBaseUnitDetail — fetch one unit + options into the read-only detail panel.
export async function openBaseUnitDetail(id) {
    try {
        const { data, error } = await db.fetchBaseUnitDetail(id);
        if (error) throw error;
        store.baseUnitDetail.value = data;
    } catch (err) {
        store.showToast('Failed to load base unit: ' + err.message);
        logError('openBaseUnitDetail', err, { id });
    }
}

export function closeBaseUnitDetail() { store.baseUnitDetail.value = null; }

// deleteBaseUnitConfirm — two-click delete (first click arms, second deletes).
// Removes only the kit definition; all_boms rows and item_master are untouched.
export async function deleteBaseUnitConfirm(id) {
    if (store.baseUnitDeleteId.value !== id) {
        store.baseUnitDeleteId.value = id;
        setTimeout(() => {
            if (store.baseUnitDeleteId.value === id) store.baseUnitDeleteId.value = null;
        }, 4000);
        return;
    }
    store.baseUnitDeleteId.value = null;
    try {
        const { error } = await db.deleteBaseUnit(id);
        if (error) throw error;
        store.showToast('Base unit deleted.', 'success');
        if (store.baseUnitDetail.value?.unit?.id === id) closeBaseUnitDetail();
        loadBaseUnits();
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('deleteBaseUnitConfirm', err, { id });
    }
}

// ── Wizard: pick configs ──────────────────────────────────────

// openBuWizard — reset and open the kit wizard at the config picker.
export function openBuWizard() {
    store.buWizardOpen.value    = true;
    store.buWizardStep.value    = 'pick';
    store.buFamilySearch.value  = '';
    store.buConfigResults.value = [];
    store.buKit.value           = null;
    store.buModularChildren.value = [];
    store.buSaveForm.value      = { family_name: '', base_part_number: '', notes: '' };
    store.buSaveErrors.value    = {};
}

export function closeBuWizard() { store.buWizardOpen.value = false; }

// searchBuConfigs — find sibling BOM parents for the typed family prefix.
export async function searchBuConfigs() {
    const q = sanitizeText(store.buFamilySearch.value || '');
    if (!q) return;
    store.buSearchLoading.value = true;
    try {
        const { data, error } = await db.searchBomParents(q);
        if (error) throw error;
        // Pre-include only true family configs: exact prefix or prefix + '-…'
        // (search '880' checks 880-EL, not the 88088 bracket subassembly that
        // shares the digits), and only when the BOM is meaningful (≥10 lines).
        const prefix = q.toUpperCase();
        store.buConfigResults.value = data.map(r => ({
            ...r,
            included: r.lineCount >= 10
                && (r.config === prefix || r.config.startsWith(prefix + '-')),
        }));
        if (!data.length) store.showToast('No BOM parents match that prefix.');
    } catch (err) {
        store.showToast('Search failed: ' + err.message);
        logError('searchBuConfigs', err, { q });
    } finally {
        store.buSearchLoading.value = false;
    }
}

export function toggleBuConfig(config) {
    const row = store.buConfigResults.value.find(c => c.config === config);
    if (row) row.included = !row.included;
}

// ── Wizard: derive + review ───────────────────────────────────

// runBuDerivation — fetch the included configs' BOMs, run the pure engine,
// enrich with descriptions, and build the editable kit model.
export async function runBuDerivation() {
    const included = store.buIncludedConfigs.value;
    if (!included.length) { store.showToast('Include at least one config.'); return; }
    store.buDeriving.value = true;
    try {
        const { data: rows, error } = await db.fetchBomsForParents(included);
        if (error) throw error;
        const kit = deriveBaseUnitKit(rows, included);

        const allParts = new Set();
        kit.base.forEach(p => allParts.add(p.part_number));
        kit.qtyVaries.forEach(p => allParts.add(p.part_number));
        kit.groups.forEach(g => g.members.forEach(m => m.parts.forEach(p => allParts.add(p.part_number))));
        const [{ data: descs }, { data: withBoms }] = await Promise.all([
            db.fetchItemDescriptions([...allParts]),
            db.fetchPartsWithBoms([...allParts]),
        ]);
        const d = p => descs[p] || '';

        // Editable model: groups become named steps, bundles become choices.
        store.buKit.value = {
            configs: kit.configs,
            singleConfig: kit.singleConfig,
            base: kit.base.map(p => ({ ...p, descrip: d(p.part_number) })),
            qtyVaries: kit.qtyVaries.map(p => ({ ...p, descrip: d(p.part_number) })),
            steps: kit.groups.map((g, i) => ({
                name: `Step ${i + 1}`,
                required: g.required,
                choices: g.members.map(m => ({
                    label: m.parts[0] ? (d(m.parts[0].part_number) || m.parts[0].part_number) : '(unnamed)',
                    configs: m.configs,
                    source: 'derived',
                    parts: m.parts.map(p => ({ ...p, descrip: d(p.part_number) })),
                    newPart: blankNewPart(),
                })),
            })),
        };
        store.buModularChildren.value = findModularChildren(rows, included, withBoms);
        store.buSaveForm.value.family_name = sanitizeText(store.buFamilySearch.value).toUpperCase();
        store.buSaveForm.value.base_part_number =
            `BASE-${sanitizeText(store.buFamilySearch.value).toUpperCase()}`;
        store.buWizardStep.value = 'review';
    } catch (err) {
        store.showToast('Derivation failed: ' + err.message);
        logError('runBuDerivation', err, { included });
    } finally {
        store.buDeriving.value = false;
    }
}

// blankNewPart — fresh per-choice add-part input state.
function blankNewPart() { return { part_number: '', qty: 1 }; }

// moveBuChoice — move one choice to another step ('' = new step at the end).
// Emptied steps are kept, not pruned — steps are now added and deleted
// explicitly (addBuStep / removeBuStep), and an empty step saves nothing.
export function moveBuChoice(fromStep, choiceIndex, toStep) {
    const kit = store.buKit.value;
    if (!kit || toStep === 'keep' || !kit.steps[fromStep]) return;
    const [choice] = kit.steps[fromStep].choices.splice(choiceIndex, 1);
    if (!choice) return;
    if (toStep === '' || toStep === null) {
        kit.steps.push({ name: `Step ${kit.steps.length + 1}`, required: false, choices: [choice] });
    } else {
        kit.steps[Number(toStep)].choices.push(choice);
    }
}

// addBuStep — append an empty decision step for the user to fill.
export function addBuStep() {
    const kit = store.buKit.value;
    if (!kit) return;
    kit.steps.push({ name: `Step ${kit.steps.length + 1}`, required: false, choices: [] });
}

// removeBuStep — two-click delete of a whole step and all of its choices
// (first click arms for 4s, second deletes). In-memory only until save.
export function removeBuStep(stepIndex) {
    const kit = store.buKit.value;
    if (!kit || !kit.steps[stepIndex]) return;
    if (store.buStepDeleteIndex.value !== stepIndex) {
        store.buStepDeleteIndex.value = stepIndex;
        setTimeout(() => {
            if (store.buStepDeleteIndex.value === stepIndex) store.buStepDeleteIndex.value = null;
        }, 4000);
        return;
    }
    store.buStepDeleteIndex.value = null;
    kit.steps.splice(stepIndex, 1);
}

// addBuChoicePart — add a part to one choice's package. The part must already
// exist in item_master (same rule as the BOM editor) so plans never explode on
// a typo. Input: step index, choice index — reads the choice's newPart inputs.
export async function addBuChoicePart(stepIndex, choiceIndex) {
    const choice = store.buKit.value?.steps?.[stepIndex]?.choices?.[choiceIndex];
    if (!choice) return;
    const form = choice.newPart || (choice.newPart = blankNewPart());
    const part = sanitizeText(form.part_number || '').toUpperCase();
    const qty  = Number(form.qty) > 0 ? Number(form.qty) : 1;
    if (!part) { store.showToast('Enter a part number to add.'); return; }
    if (choice.parts.some(p => p.part_number === part)) {
        store.showToast(`${part} is already on this choice.`);
        return;
    }
    store.buPartAdding.value = `${stepIndex}|${choiceIndex}`;
    try {
        const { data: exists, error } = await db.checkPartExists(part);
        if (error) throw error;
        if (!exists) {
            store.showToast(`${part} is not in item_master — create it first, then add it here.`);
            return;
        }
        const { data: descs } = await db.fetchItemDescriptions([part]);
        choice.parts.push({ part_number: part, qty, flag: null, descrip: (descs || {})[part] || '' });
        choice.newPart = blankNewPart();
    } catch (err) {
        store.showToast('Could not add part: ' + err.message);
        logError('addBuChoicePart', err, { part });
    } finally {
        store.buPartAdding.value = '';
    }
}

// removeBuChoicePart — drop one part from a choice's package. A choice with no
// parts left is still valid (it plans as a part-less option).
export function removeBuChoicePart(stepIndex, choiceIndex, partIndex) {
    const choice = store.buKit.value?.steps?.[stepIndex]?.choices?.[choiceIndex];
    if (choice) choice.parts.splice(partIndex, 1);
}

// normalizeBuPartQty — clamp an inline qty edit to a positive number.
export function normalizeBuPartQty(part) {
    if (part) part.qty = Number(part.qty) > 0 ? Number(part.qty) : 1;
}

// removeBuBasePart — drop one common part from the derived base list (it will
// not be written to the base unit's BOM).
export function removeBuBasePart(index) {
    const kit = store.buKit.value;
    if (kit) kit.base.splice(index, 1);
}

// promoteBuBasePart — move a common part out of the base and into a step as its
// own single-part choice ('' = new step at the end).
export function promoteBuBasePart(index, toStep) {
    const kit = store.buKit.value;
    if (!kit || toStep === 'keep') return;
    const [p] = kit.base.splice(index, 1);
    if (!p) return;
    const choice = {
        label: p.descrip || p.part_number,
        configs: [], source: 'manual',
        parts: [{ ...p }], newPart: blankNewPart(),
    };
    if (toStep === '' || toStep === null) {
        kit.steps.push({ name: `Step ${kit.steps.length + 1}`, required: false, choices: [choice] });
    } else {
        kit.steps[Number(toStep)].choices.push(choice);
    }
}

// addBuManualOption — add a hand-entered choice (part number optional —
// part-less choices like "Honda Upgrade" are planned but excluded from
// material calculations until they get a real part number).
export function addBuManualOption() {
    const kit = store.buKit.value;
    if (!kit) return;
    const f = store.buManualForm.value;
    const label = sanitizeText(f.label || '');
    if (!label) { store.showToast('Choice label is required.'); return; }
    const part = sanitizeText(f.part_number || '').toUpperCase();
    const choice = {
        label, configs: [], source: 'manual',
        parts: part ? [{ part_number: part, qty: Number(f.qty) > 0 ? Number(f.qty) : 1, flag: null, descrip: '' }] : [],
        newPart: blankNewPart(),
    };
    if (f.stepIndex === '' || f.stepIndex === null) {
        const group = sanitizeText(f.group || '') || `Step ${kit.steps.length + 1}`;
        kit.steps.push({ name: group, required: false, choices: [choice] });
    } else {
        kit.steps[Number(f.stepIndex)].choices.push(choice);
    }
    store.buManualForm.value = { stepIndex: '', group: '', label: '', part_number: '', qty: 1 };
}

// removeBuChoice — drop one choice from a step. The step itself is kept
// (delete it explicitly with removeBuStep).
export function removeBuChoice(stepIndex, choiceIndex) {
    const kit = store.buKit.value;
    if (!kit || !kit.steps[stepIndex]) return;
    kit.steps[stepIndex].choices.splice(choiceIndex, 1);
}

// openBomFix — navigate to the BOM editor preloaded on one config parent so a
// flagged line can be corrected. Store writes only (the template chains the
// already-exposed runBomSearch() — no page-to-page import). The wizard keeps
// its state; returning via Manager Hub → re-derive picks up the fix.
export function openBomFix(configPart) {
    const part = sanitizeText(configPart || '').toUpperCase();
    if (!part) return;
    store.bomSearch.value      = part;
    store.partChangesTab.value = 'boms';
    store.engView.value        = 'part_changes';
    store.currentView.value    = 'engineering';
}

// ── Wizard: save ──────────────────────────────────────────────

// saveBaseUnit — persist the confirmed kit:
//   1. create the base-unit item_master part if missing (item_type BASE_UNIT)
//   2. write the common parts as all_boms rows under it (source='native')
//   3. insert base_units + options + option parts
export async function saveBaseUnit() {
    const kit  = store.buKit.value;
    const form = store.buSaveForm.value;
    const errors = {};
    const family = sanitizeText(form.family_name || '').toUpperCase();
    const basePart = sanitizeText(form.base_part_number || '').toUpperCase();
    if (!family)   errors.family_name = 'Required';
    if (!basePart) errors.base_part_number = 'Required';
    if (!kit || !kit.base.length) errors.base = 'Nothing derived to save';
    store.buSaveErrors.value = errors;
    if (Object.keys(errors).length) return;

    store.buSaving.value = true;
    try {
        // A base part that already owns BOM lines means this family was saved
        // before — block rather than silently double the common-parts BOM.
        const { data: bomOwners, error: ownErr } = await db.fetchPartsWithBoms([basePart]);
        if (ownErr) throw ownErr;
        if (bomOwners.length) {
            throw new Error(`${basePart} already has a BOM — delete the old base unit and its BOM lines first, or use a different part #`);
        }
        const { data: exists, error: exErr } = await db.checkPartExists(basePart);
        if (exErr) throw exErr;
        if (!exists) {
            const { error: insErr } = await db.insertItemMasterPart({
                item: basePart,
                descrip: `${family} BASE UNIT (common parts)`,
                item_type: 'BASE_UNIT',
            });
            if (insErr) throw insErr;
        }

        const { error: bomErr } = await db.insertBomLinesBatch(
            basePart,
            kit.base.map(p => ({ item_child: p.part_number, qty_per_assy: p.qty }))
        );
        if (bomErr) throw bomErr;

        const options = [];
        kit.steps.forEach((s, si) => {
            s.choices.forEach((c, ci) => {
                options.push({
                    option_group: s.name,
                    sort_order: si,
                    required: !!s.required,
                    choice_label: c.label,
                    is_default: ci === 0,
                    source: c.source,
                    choice_configs: c.configs,
                    parts: c.parts.map(p => ({ part_number: p.part_number, qty_per_unit: p.qty })),
                });
            });
        });
        const { error: kitErr } = await db.insertBaseUnitKit({
            family_name: family,
            base_part_number: basePart,
            included_configs: store.buIncludedConfigs.value,
            excluded_configs: store.buExcludedConfigs.value,
            status: 'active',
            notes: sanitizeText(form.notes || '') || null,
            created_by: store.sessionRole.value || null,
        }, options);
        if (kitErr) throw kitErr;

        store.showToast(`Base unit ${family} saved.`, 'success');
        closeBuWizard();
        loadBaseUnits();
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveBaseUnit', err, { family });
    } finally {
        store.buSaving.value = false;
    }
}
