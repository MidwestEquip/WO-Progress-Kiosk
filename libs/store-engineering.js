// ============================================================
// libs/store-engineering.js — Engineering tab reactive state
//
// Re-exported by store.js. No fetch calls, no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { PART_CHANGE_CHECKLIST_ITEMS, ENG_RECORD_CATEGORIES } from './config.js';

// Which engineering sub-view is active: 'inquiries' | 'followup' | 'part_changes'
export const engView = ref('inquiries');

// ── BOM Lookup tab (inside Part Changes view) ────────────────
export const partChangesTab = ref('records');   // 'records' | 'boms'
export const bomSearch      = ref('');
export const bomLoading     = ref(false);
export const bomSearched    = ref(false);       // true once a lookup has run
export const bomParent      = ref('');          // normalized parent last searched
export const bomParentDesc  = ref('');
export const bomLines       = ref([]);   // flat tree rows: { …line, depth, path, expanded, leaf, loading }

// bomTopLevelCount — direct children of the searched parent (excludes expanded
// deeper levels, which also live in bomLines).
export const bomTopLevelCount = computed(() =>
    bomLines.value.filter(l => l.depth === 0).length
);

// BOM editing (manager-only). One row edits at a time; deletes are two-click.
export const bomEditName     = ref('');     // stamps auto-opened bom_change records
export const bomEditLineId   = ref(null);   // id of the row in edit mode
export const bomEditForm     = ref({});     // { item_child, qty_per_assy }
export const bomEditSaving   = ref(false);
export const bomDeleteLineId = ref(null);   // id of the row pending delete confirm
export const bomAddOpen      = ref(false);
export const bomAddForm      = ref({});     // { item_child, qty_per_assy }
export const bomAddSaving    = ref(false);

// New Part form (native item_master creation, manager-only)
export const newPartOpen     = ref(false);
export const newPartSaving   = ref(false);
export const newPartForm     = ref({});
export const newPartErrors   = ref({});
export const newPartBomLines = ref([]);   // initial BOM rows: { item_child, qty_per_assy }

// ── Part Changes (part_changes table) ────────────────────────
export const partChanges            = ref([]);
export const partChangesLoading     = ref(false);
export const partChangeSearch       = ref('');
export const partChangeStatusFilter = ref('open');   // 'open' | 'completed' | '' (all)

// New part change form
export const partChangeFormOpen   = ref(false);
export const partChangeSaving     = ref(false);
export const partChangeForm       = ref({});
export const partChangeFormErrors = ref({});

// filteredPartChanges — status filter + text search over the loaded records.
export const filteredPartChanges = computed(() => {
    const q = partChangeSearch.value.trim().toLowerCase();
    let rows = partChanges.value;
    if (partChangeStatusFilter.value) rows = rows.filter(r => r.status === partChangeStatusFilter.value);
    if (!q) return rows;
    return rows.filter(r =>
        (r.part_number          || '').toLowerCase().includes(q) ||
        (r.previous_part_number || '').toLowerCase().includes(q) ||
        (r.replacement_reason   || '').toLowerCase().includes(q) ||
        (r.carry_forward_note   || '').toLowerCase().includes(q) ||
        (r.created_by           || '').toLowerCase().includes(q)
    );
});

// partChangeOpenCount — open records (for the splash badge).
export const partChangeOpenCount = computed(() =>
    partChanges.value.filter(r => r.status === 'open').length
);

// woRequestOpenChanges — open part_changes records for the WO Request detail's
// part; drives the amber "engineering change in progress" warning pills.
// Loaded by the selectedWoRequest watch in main.js.
export const woRequestOpenChanges = ref([]);

// Detail modal (record view + checklist)
export const partChangeDetailOpen   = ref(false);
export const partChangeSelected     = ref(null);
export const partChangeDetailSaving = ref(false);
export const partChangeCheckName    = ref('');   // stamps checklist items; persists per session

// partChangeChecklistDone — how many of the 7 items are checked or N/A'd
// on the selected record. Pairs with partChangeChecklistItems.length in the badge.
export const partChangeChecklistDone = computed(() => {
    const cl = partChangeSelected.value?.checklist || {};
    return PART_CHANGE_CHECKLIST_ITEMS.filter(i => cl[i.key]?.state).length;
});

// Inquiry list
export const engInquiries        = ref([]);
export const engInquiriesLoading = ref(false);

// Status / priority / assignee filters; manual sort key ('' = auto-sort)
export const engStatusFilter   = ref('');
export const engPriorityFilter = ref('');
export const engAssigneeFilter = ref('');
export const engManualSort     = ref('');

// New inquiry form
export const engInquiryFormOpen   = ref(false);
export const engInquiryForm       = ref({});
export const engInquiryFormErrors = ref({});
export const engNewInquiryFiles   = ref([]); // File objects queued before insert

// Selected inquiry (detail / edit modal)
export const engSelectedInquiry    = ref(null);
export const engInquiryDetailOpen  = ref(false);
export const engImagesModalOpen    = ref(false); // images-only popup

// Images for the selected inquiry
export const engInquiryImages   = ref([]);
export const engImagesLoading   = ref(false);

// Per-card new log entry inputs, keyed as `${inq.id}_csr`, `_eng`, `_action`
export const engNewEntries = ref({});

// Add-note popup modal
export const engNoteModalOpen    = ref(false);
export const engNoteModalContext = ref(null); // { inq, field, entryKey, title }
export const engNoteModalText    = ref('');

// Delete confirmation modal
export const engDeleteConfirmOpen = ref(false);
export const engDeleteTarget      = ref(null);

// Completed inquiries view
export const engCompletedInquiries = ref([]);
export const engCompletedLoading   = ref(false);
export const engCompletedFrom      = ref('');
export const engCompletedTo        = ref('');
export const engCompletedSearch    = ref('');

export const filteredEngCompleted = computed(() => {
    const search = engCompletedSearch.value.trim().toLowerCase();
    if (!search) return engCompletedInquiries.value;
    return engCompletedInquiries.value.filter(r =>
        (r.customer_name     || '').toLowerCase().includes(search) ||
        (r.sales_order_number|| '').toLowerCase().includes(search) ||
        (r.part_number_trying|| '').toLowerCase().includes(search) ||
        (r.correct_part_number||'').toLowerCase().includes(search)
    );
});

// ── Engineering Follow-Up modal ──────────────────────────────
export const engFollowupModalOpen    = ref(false);
export const engFollowupModalMode    = ref('create'); // 'create' | 'detail'
export const engFollowupForm         = ref({});
export const engFollowupFormErrors   = ref({});
export const engFollowupSelected     = ref(null);
export const engFollowupActiveTab    = ref('part');   // 'part'|'customer'|'followup'|'fit'|'checklist'|'history'
export const engFollowupEvents       = ref([]);
export const engFollowupEventsLoading = ref(false);
export const engFollowupNewNote      = ref('');
export const engFollowupNewNoteBy    = ref('');
export const engFollowupActionPanel  = ref('');  // '' | 'customer_responded'
export const engFollowupResponseNote = ref('');
export const engFollowupResponseType = ref('needs_engineering_review');

// ── Engineering Follow-Up list ────────────────────────────────
export const engFollowups              = ref([]);
export const engFollowupsLoading       = ref(false);
export const engFollowupSearch         = ref('');
export const engFollowupStatusFilter   = ref('');
export const engFollowupPriorityFilter = ref('');

// engFollowupSummary — counts for the 6 summary cards.
export const engFollowupSummary = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const list  = engFollowups.value;
    return {
        open:               list.length,
        dueToday:           list.filter(r => r.next_action_due_date === today).length,
        overdue:            list.filter(r => r.next_action_due_date && r.next_action_due_date < today).length,
        waitingOnCustomer:  list.filter(r => r.status === 'waiting_on_customer').length,
        needsEngReview:     list.filter(r => r.status === 'needs_engineering_review').length,
        finalizationNeeded: list.filter(r => r.status === 'finalization_needed').length,
    };
});

// filteredEngFollowups — applies status/priority/text filters; pre-computes _isOverdue/_isDueToday flags.
export const filteredEngFollowups = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    let list = engFollowups.value;
    if (engFollowupStatusFilter.value)   list = list.filter(r => r.status   === engFollowupStatusFilter.value);
    if (engFollowupPriorityFilter.value) list = list.filter(r => r.priority === engFollowupPriorityFilter.value);
    const q = engFollowupSearch.value.trim().toLowerCase();
    if (q) list = list.filter(r =>
        (r.part_number   || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.sales_order   || '').toLowerCase().includes(q) ||
        (r.wo_number     || '').toLowerCase().includes(q) ||
        (r.description   || '').toLowerCase().includes(q)
    );
    return list.map(r => ({
        ...r,
        _isOverdue:  !!(r.next_action_due_date && r.next_action_due_date < today),
        _isDueToday: r.next_action_due_date === today,
    }));
});

// engFollowupChecklistCount — how many of the 9 finalization items are checked on the selected case.
export const engFollowupChecklistCount = computed(() => {
    const row = engFollowupSelected.value;
    if (!row) return { done: 0, total: 9 };
    const fields = ['alere_bom_updated','alere_part_updated','print_updated','dxf_updated',
                    'autodesk_files_updated','cad_3d_updated','assembly_model_updated',
                    'manual_updated','fit_mapping_recorded'];
    return { done: fields.filter(f => row[f]).length, total: 9 };
});

// ── Prints / Files Update sub-view ───────────────────────────
export const engPrintsSearch             = ref('');
export const engPrintsFiles              = ref([]);
export const engPrintsLoading            = ref(false);
export const engPrintsSearchedPart       = ref('');
export const engPrintsDeleteConfirmOpen   = ref(false);
export const engPrintsDeleteTarget        = ref(null);
export const engPrintsReplaceConfirmOpen  = ref(false);
export const engPrintsUploadConfirmOpen   = ref(false);

// Text search for active inquiries — customer name is the primary field
export const engInquirySearch = ref('');

// filteredEngInquiries — filters by status/priority/assignee + text search, then sorts.
export const filteredEngInquiries = computed(() => {
    let list = engInquiries.value;
    if (engStatusFilter.value)   list = list.filter(r => r.status      === engStatusFilter.value);
    if (engPriorityFilter.value) list = list.filter(r => r.priority    === engPriorityFilter.value);
    if (engAssigneeFilter.value) list = list.filter(r => r.assigned_to === engAssigneeFilter.value);
    const q = engInquirySearch.value.trim().toLowerCase();
    if (q) list = list.filter(r =>
        (r.customer_name        || '').toLowerCase().includes(q) ||
        (r.sales_order_number   || '').toLowerCase().includes(q) ||
        (r.part_number_trying   || '').toLowerCase().includes(q) ||
        (r.correct_part_number  || '').toLowerCase().includes(q) ||
        (r.brand                || '').toLowerCase().includes(q) ||
        (r.deck_model           || '').toLowerCase().includes(q) ||
        (r.wrong_numbers        || '').toLowerCase().includes(q) ||
        (r.csr_rep              || '').toLowerCase().includes(q)
    );

    const PRIORITY = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const STATUS   = { 'Not Started': 0, 'In Progress': 1, 'Ready to Design': 2,
                       'Needs Measurements': 3,
                       'Design Complete / Ready to Order': 4,
                       'On Hold': 5, 'Done': 6, 'Canceled': 7 };
    const out = [...list];
    const ms  = engManualSort.value;
    if (!ms) {
        out.sort((a, b) => {
            const pd = (PRIORITY[a.priority] ?? 4) - (PRIORITY[b.priority] ?? 4);
            if (pd !== 0) return pd;
            const da = a.date_entered || '', db = b.date_entered || '';
            if (da !== db) return da < db ? -1 : 1;
            return (STATUS[a.status] ?? 8) - (STATUS[b.status] ?? 8);
        });
    } else if (ms === 'date_entered') {
        out.sort((a, b) => {
            const da = a.date_entered || '', db = b.date_entered || '';
            return da < db ? 1 : da > db ? -1 : 0;
        });
    } else if (ms === 'status') {
        out.sort((a, b) => (STATUS[a.status] ?? 8) - (STATUS[b.status] ?? 8));
    } else if (ms === 'assigned_to') {
        out.sort((a, b) => (a.assigned_to || '').localeCompare(b.assigned_to || ''));
    } else if (ms === 'priority') {
        out.sort((a, b) => (PRIORITY[a.priority] ?? 4) - (PRIORITY[b.priority] ?? 4));
    }
    return out;
});

// groupedEngInquiries — partitions filteredEngInquiries into the record-category
// sections (Orders / Issues-Warranty / Inquiries) in config order, preserving the
// filter+sort order within each group. Empty groups are dropped so headers only
// appear when there are rows. Each group carries its badge/label for the template.
export const groupedEngInquiries = computed(() => {
    const rows = filteredEngInquiries.value;
    return ENG_RECORD_CATEGORIES
        .map(cat => ({ ...cat, rows: rows.filter(r => (r.record_category || 'inquiry') === cat.key) }))
        .filter(g => g.rows.length > 0);
});

// engCreateCategoryLabel — singular heading for the create modal, driven by the
// category the form was opened with. Falls back to the inquiry badge.
export const engCreateCategoryLabel = computed(() => {
    const key = engInquiryForm.value?.record_category || 'inquiry';
    return (ENG_RECORD_CATEGORIES.find(c => c.key === key) || {}).badge || 'Inquiry';
});
