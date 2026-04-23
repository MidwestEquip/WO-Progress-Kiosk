// ============================================================
// libs/store-engineering.js — Engineering tab reactive state
//
// Re-exported by store.js. No fetch calls, no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// Which engineering sub-view is active: 'inquiries' | 'followup'
export const engView = ref('inquiries');

// Inquiry list
export const engInquiries        = ref([]);
export const engInquiriesLoading = ref(false);

// Status / priority filter
export const engStatusFilter   = ref('');
export const engPriorityFilter = ref('');

// New inquiry form
export const engInquiryFormOpen   = ref(false);
export const engInquiryForm       = ref({});
export const engInquiryFormErrors = ref({});
export const engNewInquiryFiles   = ref([]); // File objects queued before insert

// Selected inquiry (detail / edit modal)
export const engSelectedInquiry    = ref(null);
export const engInquiryDetailOpen  = ref(false);

// Images for the selected inquiry
export const engInquiryImages   = ref([]);
export const engImagesLoading   = ref(false);

// filteredEngInquiries — applies status + priority filters to the list.
export const filteredEngInquiries = computed(() => {
    let list = engInquiries.value;
    if (engStatusFilter.value)   list = list.filter(r => r.status   === engStatusFilter.value);
    if (engPriorityFilter.value) list = list.filter(r => r.priority === engPriorityFilter.value);
    return list;
});
