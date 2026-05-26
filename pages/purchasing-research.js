// ============================================================
// pages/purchasing-research.js — Supplier catalog lookup logic
//
// Used by the Research tab in the purchasing detail modal.
// Reads the current purchase history to find supplier(s), then
// fetches all parts ever purchased from the chosen company.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// openSupplierCatalogFromHistory — reads purchasingPartPurchaseHistory and extracts
// distinct companies (by poto). If exactly one → loads catalog immediately.
// If 2+ → sets supplierCatalogChoices so the template shows a company picker.
export function openSupplierCatalogFromHistory() {
    const history = store.purchasingPartPurchaseHistory.value;
    if (!history || !history.length) return;

    // Build unique company map: poto → company_name
    const seen = new Map();
    for (const row of history) {
        if (row.poto && !seen.has(row.poto)) {
            seen.set(row.poto, row.company_name || row.poto);
        }
    }

    const choices = Array.from(seen.entries()).map(([poto, company_name]) => ({ poto, company_name }));
    if (choices.length === 0) return;

    // Reset any stale catalog state before showing new data
    store.supplierCatalogParts.value  = [];
    store.supplierCatalogSearch.value = '';
    store.supplierCatalogCoid.value   = null;
    store.supplierCatalogName.value   = '';

    if (choices.length === 1) {
        store.supplierCatalogChoices.value = [];
        loadSupplierCatalog(choices[0].poto, choices[0].company_name);
    } else {
        // Surface the picker — user must choose before we fetch
        store.supplierCatalogChoices.value = choices;
    }
}

// loadSupplierCatalog — fetches all parts purchased from a given supplier coid (all time).
// Called either directly (single company) or from the company picker template.
export async function loadSupplierCatalog(coid, companyName) {
    store.supplierCatalogChoices.value = []; // dismiss picker once a choice is made
    store.supplierCatalogCoid.value    = coid;
    store.supplierCatalogName.value    = companyName || coid;
    store.supplierCatalogSearch.value  = '';
    store.supplierCatalogLoading.value = true;
    store.supplierCatalogParts.value   = [];
    try {
        const { data, error } = await db.fetchCompanyPurchaseCatalog(coid);
        if (error) throw error;
        store.supplierCatalogParts.value = data || [];
    } catch (err) {
        store.showToast('Failed to load supplier catalog: ' + err.message);
        logError('loadSupplierCatalog', err);
    } finally {
        store.supplierCatalogLoading.value = false;
    }
}

// clearSupplierCatalog — resets all catalog state. Called by the × button in the template.
export function clearSupplierCatalog() {
    store.supplierCatalogLoading.value = false;
    store.supplierCatalogParts.value   = [];
    store.supplierCatalogCoid.value    = null;
    store.supplierCatalogName.value    = '';
    store.supplierCatalogSearch.value  = '';
    store.supplierCatalogChoices.value = [];
}
