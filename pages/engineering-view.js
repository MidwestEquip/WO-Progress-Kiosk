// ============================================================
// pages/engineering-view.js — Engineering tab logic
//
// Handles: navigation, loading inquiries, new inquiry form.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';

// enterEngineeringInquiriesView — navigate to Engineering > Customer Inquiries & Concerns.
export async function enterEngineeringInquiriesView() {
    store.engView.value      = 'inquiries';
    store.currentView.value  = 'engineering';
    await loadEngInquiries();
}

// enterEngineeringFollowupView — navigate to Engineering > Customer Follow Up.
export function enterEngineeringFollowupView() {
    store.engView.value     = 'followup';
    store.currentView.value = 'engineering';
}

// loadEngInquiries — fetch all inquiries into store.
export async function loadEngInquiries() {
    store.engInquiriesLoading.value = true;
    const { data, error } = await db.fetchEngInquiries();
    store.engInquiriesLoading.value = false;
    if (error) { store.showToast('Could not load inquiries: ' + error.message); return; }
    store.engInquiries.value = data;
}

// openEngInquiryForm — reset and open the new inquiry modal.
export function openEngInquiryForm() {
    store.engInquiryForm.value = {
        wrong_numbers:      '',
        part_number_trying: '',
        date_entered:       new Date().toISOString().slice(0, 10), // auto, not shown
        csr_rep:            '',
        deck_model_number:  '',
        brand:              '',
        deck_model:         '',
        deck_width:         '',
        year:               '',
        customer_name:      '',
        customer_phone:     '',
        customer_email:     '',
        sales_order_number: '',
        csr_notes:          '',
        engineering_notes:  '',
        status:             'Not Started',                          // auto, not shown
        assigned_to:        '',
        priority:           'Medium',
    };
    store.engInquiryFormErrors.value = {};
    store.engNewInquiryFiles.value   = [];
    store.engInquiryFormOpen.value   = true;
}

// closeEngInquiryForm — close the new inquiry modal.
export function closeEngInquiryForm() {
    store.engInquiryFormOpen.value = false;
    store.engNewInquiryFiles.value = [];
}

// handleEngNewInquiryFileSelect — append selected files to the queue.
export function handleEngNewInquiryFileSelect(event) {
    const files = Array.from(event.target.files || []);
    store.engNewInquiryFiles.value = [...store.engNewInquiryFiles.value, ...files];
    event.target.value = '';
}

// removeEngNewInquiryFile — remove a queued file by index.
export function removeEngNewInquiryFile(index) {
    const arr = [...store.engNewInquiryFiles.value];
    arr.splice(index, 1);
    store.engNewInquiryFiles.value = arr;
}

// submitEngInquiry — validate, insert, upload queued images, reload list.
export async function submitEngInquiry() {
    const form = store.engInquiryForm.value;
    const errors = {};
    if (!form.sales_order_number?.trim()) errors.sales_order_number = true;
    if (!form.customer_name?.trim())      errors.customer_name      = true;
    if (!form.customer_phone?.trim())     errors.customer_phone     = true;
    if (!form.customer_email?.trim())     errors.customer_email     = true;
    if (!form.csr_rep?.trim())            errors.csr_rep            = true;
    if (!form.brand?.trim())              errors.brand              = true;
    if (!form.deck_model?.trim())         errors.deck_model         = true;
    if (!form.deck_width?.trim())         errors.deck_width         = true;
    if (!form.year?.trim())               errors.year               = true;
    if (!form.csr_notes?.trim())          errors.csr_notes          = true;
    if (Object.keys(errors).length) {
        store.engInquiryFormErrors.value = errors;
        return;
    }
    store.loading.value = true;
    const { data: newRow, error } = await db.insertEngInquiry({
        ...form,
        part_number_trying: form.part_number_trying?.trim().toUpperCase() || null,
        wrong_numbers:      form.wrong_numbers?.trim() || null,
    });
    if (error) {
        store.loading.value = false;
        store.showToast('Could not save inquiry: ' + error.message);
        return;
    }
    // Upload any queued images now that we have the row id
    for (const file of store.engNewInquiryFiles.value) {
        await db.uploadEngInquiryImage(newRow.id, file);
    }
    store.loading.value = false;
    store.showToast('Inquiry saved.', 'success');
    store.engInquiryFormOpen.value = false;
    store.engNewInquiryFiles.value = [];
    await loadEngInquiries();
}

// openEngInquiryDetail — select an inquiry and open the detail/edit modal.
export async function openEngInquiryDetail(inquiry) {
    store.engSelectedInquiry.value   = { ...inquiry };
    store.engInquiryDetailOpen.value = true;
    store.engInquiryImages.value     = [];
    await loadEngInquiryImages(inquiry.id);
}

// closeEngInquiryDetail — close the detail modal.
export function closeEngInquiryDetail() {
    store.engInquiryDetailOpen.value = false;
    store.engSelectedInquiry.value   = null;
    store.engInquiryImages.value     = [];
}

// saveEngInquiry — patch all fields on the selected inquiry then refresh the list.
export async function saveEngInquiry() {
    const inq = store.engSelectedInquiry.value;
    if (!inq) return;
    store.loading.value = true;
    const { error } = await db.updateEngInquiry(inq.id, {
        wrong_numbers:       inq.wrong_numbers       || null,
        part_number_trying:  (inq.part_number_trying || '').trim().toUpperCase() || null,
        date_entered:        inq.date_entered         || null,
        csr_rep:             inq.csr_rep              || null,
        deck_model_number:   inq.deck_model_number    || null,
        brand:               inq.brand                || null,
        deck_model:          inq.deck_model           || null,
        deck_width:          inq.deck_width           || null,
        year:                inq.year                 || null,
        customer_name:       inq.customer_name        || null,
        customer_phone:      inq.customer_phone       || null,
        customer_email:      inq.customer_email       || null,
        sales_order_number:  inq.sales_order_number   || null,
        csr_notes:           inq.csr_notes            || null,
        engineering_notes:   inq.engineering_notes    || null,
        correct_part_number: inq.correct_part_number  || null,
        status:              inq.status               || null,
        assigned_to:         inq.assigned_to          || null,
        priority:            inq.priority             || null,
    });
    store.loading.value = false;
    if (error) { store.showToast('Could not save: ' + error.message); return; }
    store.showToast('Inquiry updated.', 'success');
    await loadEngInquiries();
}

// loadEngInquiryImages — fetch signed image URLs for the given inquiry id.
export async function loadEngInquiryImages(inquiryId) {
    if (!inquiryId) return;
    store.engImagesLoading.value = true;
    const { data, error } = await db.listEngInquiryImages(inquiryId);
    store.engImagesLoading.value = false;
    if (error) { store.showToast('Could not load images: ' + error.message); return; }
    store.engInquiryImages.value = data;
}

// handleEngImageUpload — upload a file for the selected inquiry then refresh.
export async function handleEngImageUpload(event) {
    const file = event.target.files[0];
    const inq  = store.engSelectedInquiry.value;
    if (!file || !inq) return;
    event.target.value = '';
    store.engImagesLoading.value = true;
    const { error } = await db.uploadEngInquiryImage(inq.id, file);
    store.engImagesLoading.value = false;
    if (error) { store.showToast('Upload failed: ' + error.message); return; }
    store.showToast('Image uploaded.', 'success');
    await loadEngInquiryImages(inq.id);
}
