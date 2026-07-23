// ============================================================
// expose-inventory.js — Vue bindings: Inventory Count sheet
//
// Pure binding manifest for the Inventory Count view and its Adjust
// Inventory modal. Imports from store + pages only, returns a plain
// object for Vue setup(). No logic, no DB calls.
// (Its own file rather than expose-ops.js, which is at 460/500.)
// ============================================================

import * as store from './libs/store.js';
import {
    enterInventoryCountView, loadInventoryCountLines, toggleInvCountAdjusted,
    saveCountQty, removeCountLine,
    openCountAdjust, closeCountAdjust, submitCountAdjust,
} from './pages/inventory-count-view.js';

export function buildInventoryExpose() {
    return {
        // Count sheet
        invCountLines:         store.invCountLines,
        invCountLoading:       store.invCountLoading,
        invCountRefs:          store.invCountRefs,
        invCountRefsLoading:   store.invCountRefsLoading,
        invCountShowAdjusted:  store.invCountShowAdjusted,
        invCountFilter:        store.invCountFilter,
        invCountSavingId:      store.invCountSavingId,
        invCountRemoveId:      store.invCountRemoveId,
        filteredInvCountLines: store.filteredInvCountLines,
        invCountOpenCount:     store.invCountOpenCount,
        invCountCountedCount:  store.invCountCountedCount,
        invCountAdjustedCount: store.invCountAdjustedCount,
        enterInventoryCountView, loadInventoryCountLines, toggleInvCountAdjusted,
        saveCountQty, removeCountLine,

        // Adjust Inventory modal
        invCountAdjustOpen:    store.invCountAdjustOpen,
        invCountAdjustLine:    store.invCountAdjustLine,
        invCountAdjustItem:    store.invCountAdjustItem,
        invCountAdjustLoading: store.invCountAdjustLoading,
        invCountAdjustSaving:  store.invCountAdjustSaving,
        invCountAdjustForm:    store.invCountAdjustForm,
        invCountAdjustErrors:  store.invCountAdjustErrors,
        openCountAdjust, closeCountAdjust, submitCountAdjust,
    };
}
