// ============================================================
// expose-shipping.js — Vue template bindings: shipping domain
// Open Orders board + Completed (Shipped) Orders
// Split from expose-ops.js (500-line cap). Pure binding manifest:
// imports from store + pages only, returns a plain object. No logic.
// ============================================================

import * as store from './libs/store.js';
import { OPEN_ORDER_STATUSES, CHUTE_PART_STATUSES,
         OPEN_ORDER_SORT_FIELDS } from './libs/config.js';
import { enterOpenOrdersView } from './pages/splash-view.js';
import { loadOpenOrders, setSectionSort, openOrderSortIcon,
         setRowColor, effectiveRowColor, openOrderRowClass, openOrderColorDotClass,
         saveReminderEmail,
         openOrderStatusClass, chuteStatusClass, openOrderHasLine3,
         bulkChangeStatus,
         startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
         requestToShipEdit, confirmToShipEdit, cancelToShipEdit,
         toggleOpenOrderExpand,
         canRequestFromOpenOrder, requestWoFromOpenOrder, requestPoFromOpenOrder,
         openWoDetailPanel, closeWoDetailPanel,
         woDeptBadgeClass, woStatusBadgeClass } from './pages/open-orders-view.js';
import { cancelAddModal, parsePasteRows, saveOpenOrderRow } from './pages/open-orders-add.js';
import { onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
         onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
         onScrollAreaDragOver, onGripDragStart, onGripDragEnd,
         onDropZoneDragOver, clearDropZone, reorderDrop } from './pages/open-orders-drag.js';
import { enterCompletedOrdersView, loadCompletedOrders, restoreCompletedOrder } from './pages/completed-orders-view.js';

export function buildShippingExpose() {
    return {
        // Open Orders — state
        openOrders:               store.openOrders,
        openOrdersLoading:        store.openOrdersLoading,
        openOrdersFilter:         store.openOrdersFilter,
        openOrdersSort:           store.openOrdersSort,
        openOrderSections:        store.openOrderSections,
        openOrderColorPickerRow:  store.openOrderColorPickerRow,
        openOrderEditingCell:     store.openOrderEditingCell,
        openOrderEditingValue:    store.openOrderEditingValue,
        openOrderQtyConfirm:      store.openOrderQtyConfirm,
        openOrderSelectedIds:     store.openOrderSelectedIds,
        openOrderBulkStatus:      store.openOrderBulkStatus,
        openOrderDragOverSection: store.openOrderDragOverSection,
        openOrderDropZoneTarget:  store.openOrderDropZoneTarget,
        openOrderExpandedCols:    store.openOrderExpandedCols,
        openOrderAddModalOpen:    store.openOrderAddModalOpen,
        openOrderAddMode:         store.openOrderAddMode,
        openOrderAddForm:         store.openOrderAddForm,
        openOrderAddFormErrors:   store.openOrderAddFormErrors,
        openOrderAddPasteText:    store.openOrderAddPasteText,
        openOrderAddPasteRows:    store.openOrderAddPasteRows,
        openOrderPasteAddCount:   store.openOrderPasteAddCount,
        openOrderPasteDupCount:   store.openOrderPasteDupCount,
        openOrderPasteWarnCount:  store.openOrderPasteWarnCount,
        openOrderStatuses:        OPEN_ORDER_STATUSES,
        chutePartStatuses:        CHUTE_PART_STATUSES,
        openOrderSortFields:      OPEN_ORDER_SORT_FIELDS,

        // Open Orders — functions
        enterOpenOrdersView,
        loadOpenOrders,
        setSectionSort,
        openOrderSortIcon,
        setRowColor,
        effectiveRowColor,
        openOrderRowClass,
        openOrderColorDotClass,
        openOrderStatusClass,
        chuteStatusClass,
        openOrderHasLine3,
        cancelAddModal,
        parsePasteRows,
        saveOpenOrderRow,
        bulkChangeStatus,
        onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
        onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
        onScrollAreaDragOver, onGripDragStart, onGripDragEnd,
        onDropZoneDragOver, clearDropZone, reorderDrop,
        startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder,
        requestToShipEdit, confirmToShipEdit, cancelToShipEdit,
        toggleOpenOrderExpand,
        canRequestFromOpenOrder, requestWoFromOpenOrder, requestPoFromOpenOrder,

        // WO detail drill-down panel
        openOrderWoPanel:        store.openOrderWoPanel,
        openOrderWoPanelOrders:  store.openOrderWoPanelOrders,
        openOrderWoPanelLoading: store.openOrderWoPanelLoading,
        openWoDetailPanel, closeWoDetailPanel,
        woDeptBadgeClass, woStatusBadgeClass,

        // Task reminder email settings
        reminderEmailModalOpen: store.reminderEmailModalOpen,
        reminderEmail:          store.reminderEmail,
        reminderEmailSaving:    store.reminderEmailSaving,
        saveReminderEmail,

        // Completed (Shipped) Orders
        completedOrders:        store.completedOrders,
        completedOrdersLoading: store.completedOrdersLoading,
        enterCompletedOrdersView, loadCompletedOrders, restoreCompletedOrder,
    };
}
