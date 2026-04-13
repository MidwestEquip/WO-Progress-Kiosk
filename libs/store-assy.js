// ============================================================
// libs/store-assy.js — TV Assy + TC Assy reactive state
//
// Re-exported by store.js. No imports from store.js.
// Note: tcEntryMode + tcEntryModeOverride live in store.js because
// tcEntryMode computed references activeOrder from store.js core.
// ============================================================

import { ref } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── Right-panel active tab ────────────────────────────────────
export const woActionTab = ref('notes');  // 'attach' | 'notes' | 'complete'

// ── TV Assy state ─────────────────────────────────────────────
export const tvModeSelectOpen   = ref(false);  // mode picker shown when tv_job_mode not yet saved
export const tvAssyEntryName    = ref('');
export const tvAssyNameError    = ref(false);
export const tvAssyOpEditing    = ref(false);  // inline operator-name edit in unit/stock modal
export const tvAssyJobType      = ref('');     // 'stock' | 'unit'
export const tvAssyStockOpen    = ref(false);
export const tvAssyUnitOpen     = ref(false);
export const tvStockPending     = ref('');     // ''|'cant_start'|'pause'|'complete'|'hold'
export const tvStockSessionQty  = ref('');
export const tvStockReason      = ref('');
export const tvStockQtyError    = ref(false);
export const tvStockReasonError = ref(false);
export const tvStockNotes       = ref('');

// ── TV Assy Unit: per-stage action state ──────────────────────
export const tvUnitHoldOpen        = ref(false);
export const tvUnitHoldReason      = ref('');
export const tvUnitHoldReasonError = ref(false);
export const tvEngStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tvCrtStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tvFinStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });

// ── TC Assy state ─────────────────────────────────────────────
export const tcUnitHoldOpen        = ref(false);
export const tcUnitHoldReason      = ref('');
export const tcUnitHoldReasonError = ref(false);

export const tcAssyEntryOpen    = ref(false);
export const tcAssyEntryName    = ref('');
export const tcAssyNameError    = ref(false);
export const tcAssyJobType      = ref('');    // 'stock' | 'unit'
export const tcAssyUnitOpen     = ref(false);
export const tcAssyStockOpen    = ref(false);
export const tcAssyOpEditing    = ref(false);
export const tcStockPending     = ref('');    // ''|'start'|'cant_start'|'pause'|'resume'|'complete'|'hold'
export const tcStockSessionQty  = ref('');
export const tcStockReason      = ref('');
export const tcStockQtyError    = ref(false);
export const tcStockReasonError = ref(false);
export const tcStockNotes       = ref('');    // optional notes on subassy completion
export const tcPreStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });
export const tcFinStage = ref({ pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false });

export const tcAssyCompleteModalOpen = ref(false);
export const tcAssyCompleteForm   = ref({ salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '', notes: '' });
export const tcAssyCompleteErrors = ref({ salesOrder: false, unitSerial: false, engine: false, engineSerial: false, numBlades: false });

// Inline-editable unit detail fields on the TC Unit workflow screen
export const tcUnitInfoForm = ref({ salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '', notes: '' });
