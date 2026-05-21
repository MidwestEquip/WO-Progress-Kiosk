// ============================================================
// pages/purchasing-attachments.js — Order attachment logic
//
// Uploads, fetches, and deletes files from the
// purchasing-attachments bucket at path {order_id}/{filename}.
// Shown at the top of the Quoting tab in the detail modal.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadOrderAttachments — fetch all files for the open order; called on Quoting tab open.
export async function loadOrderAttachments() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    store.orderAttachmentsLoading.value = true;
    try {
        const { data, error } = await db.fetchOrderAttachments(order.id);
        if (error) throw error;
        store.orderAttachments.value = data || [];
    } catch (err) {
        store.showToast('Failed to load attachments: ' + err.message, 'error');
        logError('loadOrderAttachments', err);
    } finally {
        store.orderAttachmentsLoading.value = false;
    }
}

// uploadOrderAttachment — upload a file and refresh the list.
export async function uploadOrderAttachment(file) {
    const order = store.purchasingDetailOrder.value;
    if (!order || !file) return;
    store.orderAttachmentsUploading.value = true;
    try {
        const { error } = await db.uploadOrderAttachment(order.id, file);
        if (error) throw error;
        const { data } = await db.fetchOrderAttachments(order.id);
        store.orderAttachments.value = data || [];
    } catch (err) {
        store.showToast('Upload failed: ' + err.message, 'error');
        logError('uploadOrderAttachment', err);
    } finally {
        store.orderAttachmentsUploading.value = false;
    }
}

// deleteOrderAttachment — remove a file from storage and refresh the list.
export async function deleteOrderAttachment(attachment) {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    try {
        const { error } = await db.deleteOrderAttachment(attachment.path);
        if (error) throw error;
        const { data } = await db.fetchOrderAttachments(order.id);
        store.orderAttachments.value = data || [];
    } catch (err) {
        store.showToast('Delete failed: ' + err.message, 'error');
        logError('deleteOrderAttachment', err);
    }
}
