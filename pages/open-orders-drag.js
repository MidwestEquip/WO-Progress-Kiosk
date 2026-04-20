// ============================================================
// pages/open-orders-drag.js — Open Orders drag, paint-select,
//                             and edge-scroll logic.
//
// Extracted from open-orders-view.js to stay under the 500-line cap.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';

// ── Paint-select + drag-to-section ───────────────────────────
// Module-level ephemeral drag state (not reactive — no UI needs to read these directly).
let _isPainting     = false;
let _pendingDragIds = [];

// Reorder drag state
let _reorderDragId = null;
let _dragType = 'section'; // 'section' | 'reorder'

// Edge-scroll state — rAF loop that scrolls the list container when dragging near top/bottom.
let _scrollRAF = null;
let _scrollDir = 0;   // -1 = up, 1 = down, 0 = stopped
let _scrollEl  = null;
const SCROLL_ZONE  = 100; // px from edge that triggers scroll
const SCROLL_SPEED = 6;   // px per frame (~360px/s at 60fps)

function _doScroll() {
    if (!_scrollEl || _scrollDir === 0) return;
    _scrollEl.scrollTop += _scrollDir * SCROLL_SPEED;
    _scrollRAF = requestAnimationFrame(_doScroll);
}

function _clearScroll() {
    _scrollDir = 0;
    _scrollEl  = null;
    if (_scrollRAF) { cancelAnimationFrame(_scrollRAF); _scrollRAF = null; }
}

// onScrollAreaDragOver — attach to the scrollable container.
// Starts/stops the edge-scroll loop based on pointer proximity to top/bottom.
export function onScrollAreaDragOver(event) {
    const el   = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const y    = event.clientY;
    const newDir = y < rect.top + SCROLL_ZONE ? -1 : y > rect.bottom - SCROLL_ZONE ? 1 : 0;

    if (newDir !== _scrollDir) {
        _scrollDir = newDir;
        _scrollEl  = el;
        if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
        _scrollRAF = newDir !== 0 ? requestAnimationFrame(_doScroll) : null;
    }
}

// onRowMouseDown — starts paint-select from this row.
// Skips if the click landed on an interactive control, an already-selected row,
// or a "WO Created" row (those open the WO detail panel via @click instead).
export function onRowMouseDown(event, orderId, status) {
    if (event.target.closest('button, select, input, a')) return;
    if (status === 'WO Created') return;
    if (store.openOrderSelectedIds.value.includes(orderId)) return;
    event.preventDefault(); // block browser text-selection drag
    _isPainting = true;
    store.openOrderSelectedIds.value = [orderId];
    const stop = () => {
        _isPainting = false;
        document.removeEventListener('mouseup', stop);
    };
    document.addEventListener('mouseup', stop);
}

// onRowMouseEnter — extends the paint selection as the pointer moves over rows.
export function onRowMouseEnter(orderId) {
    if (!_isPainting) return;
    if (!store.openOrderSelectedIds.value.includes(orderId)) {
        store.openOrderSelectedIds.value = [...store.openOrderSelectedIds.value, orderId];
    }
}

// onRowDragStart — captures which rows are being dragged.
// If the dragged row is selected, drag the whole selection; else drag just this row.
export function onRowDragStart(event, orderId) {
    _isPainting = false;
    const sel = store.openOrderSelectedIds.value;
    _pendingDragIds = sel.includes(orderId) ? [...sel] : [orderId];
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(_pendingDragIds.length));
}

// onRowDragEnd — clean up after a drag (whether dropped or cancelled).
export function onRowDragEnd() {
    _pendingDragIds = [];
    store.openOrderDragOverSection.value = '';
    _clearScroll();
}

// onGripDragStart — start a within-section reorder drag from the grip handle.
// stopPropagation prevents the parent row's onRowDragStart from also firing.
export function onGripDragStart(event, orderId) {
    _dragType = 'reorder';
    _reorderDragId = orderId;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', orderId);
}

// onGripDragEnd — clean up after a reorder drag finishes (drop or cancel).
export function onGripDragEnd() {
    _reorderDragId = null;
    _dragType = 'section';
    store.openOrderDropZoneTarget.value = '';
    _clearScroll();
}

// onDropZoneDragOver — activate a between-row drop zone during a reorder drag.
// key format: 'sectionType:index' where index is the position to insert before.
export function onDropZoneDragOver(event, sectionType, index) {
    if (_dragType !== 'reorder') return;
    event.preventDefault();
    event.stopPropagation();
    store.openOrderDropZoneTarget.value = sectionType + ':' + index;
}

// clearDropZone — deactivate the current drop zone highlight.
export function clearDropZone() {
    store.openOrderDropZoneTarget.value = '';
}

// reorderDrop — drop handler for between-row zones; reorders within the section.
// insertBeforeIndex is the position (0-based) in the section's sorted list.
export async function reorderDrop(event, sectionType, insertBeforeIndex) {
    event.preventDefault();
    event.stopPropagation();
    store.openOrderDropZoneTarget.value = '';
    if (!_reorderDragId || _dragType !== 'reorder') return;

    const id = _reorderDragId;
    _reorderDragId = null;
    _dragType = 'section';

    const sectionOrders = store.openOrders.value
        .filter(o => o.order_type === sectionType)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const fromIdx = sectionOrders.findIndex(o => o.id === id);
    if (fromIdx === -1) return;

    const reordered = [...sectionOrders];
    const [moved] = reordered.splice(fromIdx, 1);
    const insertIdx = insertBeforeIndex > fromIdx ? insertBeforeIndex - 1 : insertBeforeIndex;
    reordered.splice(insertIdx, 0, moved);

    const results = await Promise.all(
        reordered.map((o, i) => db.updateOpenOrder(o.id, { sort_order: (i + 1) * 10 }))
    );
    const failed = results.filter(r => r.error);
    if (failed.length) { store.showToast(`Failed to reorder ${failed.length} row(s)`); return; }

    store.openOrders.value = store.openOrders.value.map(o => {
        const ri = reordered.findIndex(r => r.id === o.id);
        return ri !== -1 ? { ...o, sort_order: (ri + 1) * 10 } : o;
    });
}

// onSectionDragOver — highlight the section header while dragging over it.
// Ignored during reorder drags (grip handle only targets drop zones, not section headers).
export function onSectionDragOver(event, type) {
    if (_dragType === 'reorder') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    store.openOrderDragOverSection.value = type;
}

// onSectionDragLeave — un-highlight when pointer leaves the section header.
export function onSectionDragLeave(event, type) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
        if (store.openOrderDragOverSection.value === type) store.openOrderDragOverSection.value = '';
    }
}

// onSectionDrop — move all pending drag rows to the dropped section in parallel.
export async function onSectionDrop(event, type) {
    event.preventDefault();
    store.openOrderDragOverSection.value = '';
    const ids = [..._pendingDragIds];
    _pendingDragIds = [];
    if (!ids.length) return;

    const results = await Promise.all(ids.map(id => db.updateOpenOrder(id, { order_type: type })));
    const failed  = results.filter(r => r.error);
    if (failed.length) { store.showToast(`Failed to move ${failed.length} row(s)`); }

    store.openOrders.value = store.openOrders.value.map(o =>
        ids.includes(o.id) ? { ...o, order_type: type } : o
    );
    store.openOrderSelectedIds.value = [];
}

// clearRowSelection — deselect all rows.
export function clearRowSelection() {
    store.openOrderSelectedIds.value = [];
}
