// ============================================================
// expose-shipping.js — Vue template bindings: shipping domain
// Open Orders board + Completed (Shipped) Orders
// Split from expose-ops.js (500-line cap). Pure binding manifest:
// imports from store + pages only, returns a plain object. No logic.
// ============================================================

import * as store from './libs/store.js';
import { OPEN_ORDER_STATUSES, CHUTE_PART_STATUSES,
         OPEN_ORDER_SORT_FIELDS,
         OPEN_ORDER_GRID_COLS_FULL, OPEN_ORDER_GRID_COLS_NEW } from './libs/config.js';
import { enterOpenOrdersView } from './pages/splash-view.js';
import { loadOpenOrders, setSectionSort, openOrderSortIcon,
         setRowColor, effectiveRowColor, openOrderRowClass,
         saveReminderEmail,
         openOrderHasLine3, openOrderGroupClass,
         bulkChangeStatus,
         startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder, cancelOpenOrder,
         requestToShipEdit, confirmToShipEdit, cancelToShipEdit,
         toggleOpenOrderExpand,
         canRequestFromOpenOrder, requestWoFromOpenOrder, requestPoFromOpenOrder,
         moveSalesOrderToFreight,
         openWoDetailPanel, closeWoDetailPanel, goToActiveWo } from './pages/open-orders-view.js';
import { openOrderColorDotClass, openOrderStatusClass, chuteStatusClass,
         woDeptBadgeClass, woStatusBadgeClass } from './libs/utils.js';
import { cancelAddModal, parsePasteRows, saveOpenOrderRow,
         enrichPasteRowsWithWoAttach, pasteWoScenarioLabel,
         pasteWoScenarioClass } from './pages/open-orders-add.js';
import { verifyInStock, startPicking, startAssembly, setShippingTab, markShipped, printPickingTicket,
         openWaitingModal, closeWaitingModal, addWaitingEntry, removeWaitingEntry,
         saveWaitingOn, reqWoForSubpart, loadWaitingOnWoStatuses,
         subpartWoNumber, subpartWoStatus, subpartStatusLabel, subpartStatusClass,
         subpartWoIsPending } from './pages/open-orders-shipping.js';
import { openBackorderModal, closeBackorderModal, submitBackorder, unBackorderRow } from './pages/open-orders-backorder.js';
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
        shippingTab:              store.shippingTab,
        boxedOrders:              store.boxedOrders,
        openOrderColorPickerRow:  store.openOrderColorPickerRow,
        openOrderWoMenuRow:       store.openOrderWoMenuRow,
        openOrderEditingCell:     store.openOrderEditingCell,
        openOrderEditingValue:    store.openOrderEditingValue,
        openOrderQtyConfirm:      store.openOrderQtyConfirm,
        openOrderSelectedIds:     store.openOrderSelectedIds,
        openOrderSingleSelectedRow: store.openOrderSingleSelectedRow,
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
        openOrderPasteColumnInfo: store.openOrderPasteColumnInfo,
        openOrderStatuses:        OPEN_ORDER_STATUSES,
        chutePartStatuses:        CHUTE_PART_STATUSES,
        openOrderSortFields:      OPEN_ORDER_SORT_FIELDS,
        ooGridColsFull:           OPEN_ORDER_GRID_COLS_FULL,
        ooGridColsNew:            OPEN_ORDER_GRID_COLS_NEW,

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
        openOrderGroupClass,
        cancelAddModal,
        parsePasteRows,
        enrichPasteRowsWithWoAttach,
        pasteWoScenarioLabel,
        pasteWoScenarioClass,
        saveOpenOrderRow,
        bulkChangeStatus,
        onRowMouseDown, onRowMouseEnter, onRowDragStart, onRowDragEnd,
        onSectionDragOver, onSectionDragLeave, onSectionDrop, clearRowSelection,
        onScrollAreaDragOver, onGripDragStart, onGripDragEnd,
        onDropZoneDragOver, clearDropZone, reorderDrop,
        startCellEdit, saveCellEdit, cancelCellEdit, deleteOpenOrder, cancelOpenOrder,
        requestToShipEdit, confirmToShipEdit, cancelToShipEdit,
        toggleOpenOrderExpand,
        canRequestFromOpenOrder, requestWoFromOpenOrder, requestPoFromOpenOrder,
        verifyInStock, startPicking, startAssembly, setShippingTab, markShipped, printPickingTicket,

        // Open Orders — Backorder
        backorderModalOpen: store.backorderModalOpen,
        backorderRow:       store.backorderRow,
        backorderForm:      store.backorderForm,
        backorderErrors:    store.backorderErrors,
        backorderSaving:    store.backorderSaving,
        openBackorderModal, closeBackorderModal, submitBackorder, unBackorderRow,

        // Open Orders — Waiting On
        waitingOnModalOpen:  store.waitingOnModalOpen,
        waitingOnRow:        store.waitingOnRow,
        waitingOnForm:       store.waitingOnForm,
        waitingOnErrors:     store.waitingOnErrors,
        waitingOnSaving:     store.waitingOnSaving,
        woStatusByNumber:    store.woStatusByNumber,
        openWaitingModal, closeWaitingModal, addWaitingEntry, removeWaitingEntry,
        saveWaitingOn, reqWoForSubpart, loadWaitingOnWoStatuses,
        subpartWoNumber, subpartWoStatus, subpartStatusLabel, subpartStatusClass,
        subpartWoIsPending,
        moveSalesOrderToFreight,

        // WO detail drill-down panel
        openOrderWoPanel:        store.openOrderWoPanel,
        openOrderWoPanelOrders:  store.openOrderWoPanelOrders,
        openOrderWoPanelLoading: store.openOrderWoPanelLoading,
        openWoDetailPanel, closeWoDetailPanel, goToActiveWo,
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
