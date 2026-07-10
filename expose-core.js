// ============================================================
// expose-core.js — Vue template bindings: shop floor modules
// Navigation, dashboard, TC/TV assy, office, CS, messaging
// (engineering bindings live in expose-eng.js)
// ============================================================

import * as store from './libs/store.js';
import { OPERATORS_BY_DEPT, HOLD_REASONS, SCRAP_REASONS,
         STAGING_AREAS, ROLE_DISPLAY_NAMES, LAST_REPORT_DATE } from './libs/config.js';
import { formatDateLocal, formatTimestamp, getStageCum, detectTcMode,
         sanitizePartKey, isChutePart, isPurchasingOrderLate, formatMsgTime,
         subassyDepthBorder } from './libs/utils.js';
import { openMessagesView, openThread, backToInbox, sendMessage,
         dmAvatarClass, dmContacts, canDeleteMessages,
         openMsgDeleteConfirm, cancelMsgDelete, confirmMsgDelete,
         onMessageMediaPick, clearMessageMedia } from './pages/messages-view.js';
import { selectDept, promptPin, submitPin, goBack,
         goHome, enterActiveWosView,
         selectCategory, selectSubCategory, splashBack,
         enterEngineeringMenu, enterPurchasingMenu,
         submitLogin, logout, enterManagerView,
         loadHeaderLinks } from './pages/splash-view.js';
import { openActionPanel, holdSince,
         updateOrderStatus, undoLastAction,
         submitNewWo, submitNote, toggleTcNewWoMode,
         submitWoProblemFromUi,
         loadWoFiles, handleWoFileUpload, handleWoFileDelete,
         startReelOperation, pauseReelOperation, completeReelOperation,
         reviseReelOperation, completeReelWo,
         toggleCompletedDeptView,
         toggleTravellerPanel } from './pages/dashboard-view.js';
import { openTvAssyEntry, tvSelectMode,
         submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
         tvStockDirectAction, saveTvStockNotes,
         tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
         saveTvUnitDetails, markTvUnitWoComplete, addTvUnit, removeTvUnit } from './pages/dashboard-tv.js';
import { openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
         saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
         submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
         openTcAssyCompleteModal, confirmTcWoComplete, addTcUnit, removeTcUnit,
         toggleTcEntryMode } from './pages/dashboard-tc.js';
import { markAlereUpdated } from './libs/db.js';
import { fetchAllWorkOrdersByWoNumber, fetchAllWorkOrdersByJobNumber } from './libs/db-inventory.js';
import { searchOfficeReceive, openReceiveModal, submitReceive,
         openCloseoutModal, submitCloseout, loadReceivingEligible,
         openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
         goToCloseout,
         saveCloseoutNoteInline, loadClosedOutOrders, openClosedOutHistory } from './pages/wo-status-view.js';
import { searchCS, searchPastOrders, selectPastWo, clearPastOrders } from './pages/cs-view.js';

function openCompletedWo(order) {
    store.actionPanelReadOnly.value = true;
    const dept = order?.department;
    if (dept === 'Tru Cut Assy') {
        openTcAssyEntry(order);
    } else if (dept === 'Trac Vac Assy') {
        openTvAssyEntry(order);
    } else {
        openActionPanel(order, true);
    }
}

async function openCreatedWoDetail(item) {
    store.linkedWoRequest.value     = item;
    store.actionPanelReadOnly.value = true;
    // Use official WO# if set; otherwise fall back to job_number lookup (wo_number still pending)
    let data;
    if (item?.alere_wo_number) {
        ({ data } = await fetchAllWorkOrdersByWoNumber(item.alere_wo_number));
    } else if (item?.job_number) {
        ({ data } = await fetchAllWorkOrdersByJobNumber(item.job_number));
    }
    if (!data || !data.length) return;
    const order = data.find(r => r.department === 'Trac Vac Assy' || r.department === 'Tru Cut Assy')
               || data.find(r => r.department === 'Weld')
               || data[0];
    openCompletedWo(order);
}

export function buildCoreExpose() {
    return {
        // Navigation state
        currentView:       store.currentView,
        selectedDept:      store.selectedDept,
        loading:           store.loading,
        currentTime:       store.currentTime,
        appTitle:          store.appTitle,
        splashLevel:       store.splashLevel,
        splashCategory:    store.splashCategory,
        splashSubCategory: store.splashSubCategory,

        // Dashboard
        orders:                   store.orders,
        allOrders:                store.allOrders,
        dashboardCategories:      store.dashboardCategories,
        groupedOrders:            store.groupedOrders,
        assignedOrdersByOperator: store.assignedOrdersByOperator,
        dashSearch:               store.dashSearch,
        filteredOrders:           store.filteredOrders,
        isReel:                   store.isReel,
        travellerLinkedWos:       store.travellerLinkedWos,
        expandedTravellerWoIds:   store.expandedTravellerWoIds,
        toggleTravellerPanel,
        printRoutingChain:        store.printRoutingChain,
        OPERATORS_BY_DEPT,
        STAGING_AREAS,
        HOLD_REASONS,
        SCRAP_REASONS,

        // Action panel
        actionPanelOpen:      store.actionPanelOpen,
        actionPanelReadOnly:  store.actionPanelReadOnly,
        activeOrder:          store.activeOrder,
        linkedWoRequest:      store.linkedWoRequest,
        assyProductionNote:   store.assyProductionNote,
        selectedOperator:     store.selectedOperator,
        selectedOperators:    store.selectedOperators,
        fabWeldOperatorReady: store.fabWeldOperatorReady,
        holdSince,
        otherOperator:        store.otherOperator,
        actionForm:           store.actionForm,

        // Reel Weld per-operation state
        reelWeldOperator:  store.reelWeldOperator,
        reelGrindOperator: store.reelGrindOperator,
        reelWeldOtherOp:   store.reelWeldOtherOp,
        reelGrindOtherOp:  store.reelGrindOtherOp,
        reelWeldQty:       store.reelWeldQty,
        reelGrindQty:      store.reelGrindQty,

        // New WO modal
        newWoModalOpen:      store.newWoModalOpen,
        newWoForm:           store.newWoForm,
        newWoFormErrors:     store.newWoFormErrors,
        tcNewWoModeOverride: store.tcNewWoModeOverride,
        tcNewWoMode:         store.tcNewWoMode,
        tcEntryModeOverride: store.tcEntryModeOverride,
        tcEntryMode:         store.tcEntryMode,

        // Notes modal
        notesPanelOpen:  store.notesPanelOpen,
        noteAuthor:      store.noteAuthor,
        noteText:        store.noteText,
        noteAuthorError: store.noteAuthorError,
        noteTextError:   store.noteTextError,

        // Undo
        lastUndoAction: store.lastUndoAction,

        // Session login
        sessionRole:       store.sessionRole,
        loginUsername:     store.loginUsername,
        loginPassword:     store.loginPassword,
        loginError:        store.loginError,
        loginLoading:      store.loginLoading,
        showLoginPassword: store.showLoginPassword,

        // Auth / PIN
        pinModalOpen: store.pinModalOpen,
        pinMode:      store.pinMode,
        pinInput:     store.pinInput,

        // TV Assy unit stage state
        tvUnitHoldOpen:        store.tvUnitHoldOpen,
        tvUnitHoldReason:      store.tvUnitHoldReason,
        tvUnitHoldReasonError: store.tvUnitHoldReasonError,
        tcUnitHoldOpen:        store.tcUnitHoldOpen,
        tcUnitHoldReason:      store.tcUnitHoldReason,
        tcUnitHoldReasonError: store.tcUnitHoldReasonError,
        tvEngStage:            store.tvEngStage,
        tvCrtStage:            store.tvCrtStage,
        tvFinStage:            store.tvFinStage,
        tvEngineCum:           store.tvEngineCum,
        tvCartCum:             store.tvCartCum,
        tvFinalCum:            store.tvFinalCum,
        tvAssyUnitOpen:        store.tvAssyUnitOpen,
        tvAssyStockOpen:       store.tvAssyStockOpen,
        tvStockPending:        store.tvStockPending,
        tvStockSessionQty:     store.tvStockSessionQty,
        tvStockReason:         store.tvStockReason,
        tvStockQtyError:       store.tvStockQtyError,
        tvStockReasonError:    store.tvStockReasonError,
        tvStockNotes:          store.tvStockNotes,
        tvModeSelectOpen:      store.tvModeSelectOpen,
        tvAssyEntryName:       store.tvAssyEntryName,
        tvAssyOpEditing:       store.tvAssyOpEditing,
        tvAssyNameError:       store.tvAssyNameError,

        // TV Assy unit inline detail fields
        tvUnitDetailList: store.tvUnitDetailList,
        tvUnitNotes:      store.tvUnitNotes,
        tvUnitListError:  store.tvUnitListError,

        // TC Assy entry
        tcAssyEntryOpen:    store.tcAssyEntryOpen,
        tcAssyEntryName:    store.tcAssyEntryName,
        tcAssyNameError:    store.tcAssyNameError,
        tcAssyJobType:      store.tcAssyJobType,
        tcAssyUnitOpen:     store.tcAssyUnitOpen,
        tcAssyStockOpen:    store.tcAssyStockOpen,
        tcAssyOpEditing:    store.tcAssyOpEditing,
        tcStockPending:     store.tcStockPending,
        tcStockSessionQty:  store.tcStockSessionQty,
        tcStockReason:      store.tcStockReason,
        tcStockQtyError:    store.tcStockQtyError,
        tcStockReasonError: store.tcStockReasonError,
        tcStockNotes:       store.tcStockNotes,

        // TC Assy unit stage state
        tcPreStage:   store.tcPreStage,
        tcFinStage:   store.tcFinStage,
        tcPreCum:     store.tcPreCum,
        tcFinCum:     store.tcFinCum,

        // TC Assy complete modal + inline unit list
        tcAssyCompleteModalOpen: store.tcAssyCompleteModalOpen,
        tcUnitDetailList:        store.tcUnitDetailList,
        tcUnitNotes:             store.tcUnitNotes,
        tcUnitListError:         store.tcUnitListError,

        // Office / WO Status
        officeMode:             store.officeMode,
        officeSearchTerm:       store.officeSearchTerm,
        officeSearchResults:    store.officeSearchResults,
        receiveEligibleList:    store.receiveEligibleList,
        closeoutAuthorized:     store.closeoutAuthorized,
        officeSuccessMsg:       store.officeSuccessMsg,
        officeCloseoutFilter:   store.officeCloseoutFilter,
        filteredCloseoutOrders: store.filteredCloseoutOrders,
        woStatusOrders:         store.woStatusOrders,
        receiveModalOpen:       store.receiveModalOpen,
        receiveTarget:          store.receiveTarget,
        receiverName:           store.receiverName,
        receiverQty:            store.receiverQty,
        receiverBinLocation:    store.receiverBinLocation,
        receiverNameError:      store.receiverNameError,
        closeoutModalOpen:      store.closeoutModalOpen,
        closeoutTarget:         store.closeoutTarget,
        closeoutName:           store.closeoutName,
        closeoutNameError:      store.closeoutNameError,
        alerePendingOrders:     store.alerePendingOrders,
        alereConfirmId:         store.alereConfirmId,
        alereUpdaterName:       store.alereUpdaterName,
        alereUpdaterNameError:  store.alereUpdaterNameError,

        // WO Problem draft (action panel)
        woProblemDraftText:      store.woProblemDraftText,
        woProblemDraftError:     store.woProblemDraftError,
        woProblemDraftName:      store.woProblemDraftName,
        woProblemDraftNameError: store.woProblemDraftNameError,
        submitWoProblemFromUi,

        // CS
        csSearchTerm:   store.csSearchTerm,
        csResultInfo:   store.csResultInfo,
        csTimeline:     store.csTimeline,
        csOpenOrders:   store.csOpenOrders,
        csPastSearch:   store.csPastSearch,
        csPastResults:  store.csPastResults,
        csPastSort:     store.csPastSort,
        csPastSortDir:  store.csPastSortDir,
        csPastSelected:           store.csPastSelected,
        csUnitCompletions:        store.csUnitCompletions,
        csUnitCompletionsLoading: store.csUnitCompletionsLoading,

        // WO file attachments
        woFiles:        store.woFiles,
        woFilesLoading: store.woFilesLoading,
        woActionTab:    store.woActionTab,
        partsWithFiles: store.partsWithFiles,

        // Toast
        toastMessage: store.toastMessage,
        toastType:    store.toastType,
        isOffline:             store.isOffline,
        versionUpdateAvailable: store.versionUpdateAvailable,

        // ── Actions ──────────────────────────────────────────
        getStageCum,

        // Navigation
        selectDept, promptPin, submitPin, goBack,
        goHome, enterActiveWosView,
        selectCategory, selectSubCategory, splashBack,
        enterEngineeringMenu, enterPurchasingMenu,
        submitLogin, logout, enterManagerView,

        // Dashboard
        openActionPanel, openCompletedWo, openCreatedWoDetail, openTvAssyEntry, tvSelectMode,
        submitTvUnitStageFromUi, openTvAssyUnit, openTvAssyStock, submitTvStockActionFromUi,
        tvStockDirectAction, saveTvStockNotes,
        tvUnitStageDirectAction, tvUnitOpenHold, tvUnitConfirmHold,
        saveTvUnitDetails, markTvUnitWoComplete, addTvUnit, removeTvUnit,
        openTcAssyEntry, tcAssyContinue, openTcAssyUnit, openTcAssyStock, submitTcStockActionFromUi,
        saveTcStockNotes, saveTcUnitDetails, tcUnitOpenHold, tcUnitConfirmHold,
        submitTcUnitStageFromUi, tcStockDirectAction, tcUnitStageDirectAction,
        openTcAssyCompleteModal, confirmTcWoComplete, addTcUnit, removeTcUnit,
        updateOrderStatus, undoLastAction,
        submitNewWo, submitNote, toggleTcNewWoMode, toggleTcEntryMode,
        loadWoFiles, handleWoFileUpload, handleWoFileDelete,
        startReelOperation, pauseReelOperation, completeReelOperation, reviseReelOperation, completeReelWo,

        // Office
        searchOfficeReceive, openReceiveModal, submitReceive,
        openCloseoutModal, submitCloseout, loadReceivingEligible,
        goToCloseout, markAlereUpdated,
        openAlereConfirm, cancelAlereConfirm, submitAlereUpdated,
        saveCloseoutNoteInline, loadClosedOutOrders, openClosedOutHistory,
        closedOutOrders:         store.closedOutOrders,
        closedOutFrom:           store.closedOutFrom,
        closedOutTo:             store.closedOutTo,
        closedOutFilter:         store.closedOutFilter,
        filteredClosedOutOrders: store.filteredClosedOutOrders,

        // CS
        searchCS, searchPastOrders, selectPastWo, clearPastOrders,

        // Dept completed WOs
        completedDeptOrders:          store.completedDeptOrders,
        closedOutDeptOrders:          store.closedOutDeptOrders,
        showingCompletedDept:         store.showingCompletedDept,
        completedDeptSearch:          store.completedDeptSearch,
        filteredCompletedDeptOrders:  store.filteredCompletedDeptOrders,
        filteredClosedOutDeptOrders:  store.filteredClosedOutDeptOrders,
        toggleCompletedDeptView,

        // Utilities
        formatDateLocal, formatTimestamp, detectTcMode, sanitizePartKey, isChutePart, isPurchasingOrderLate,
        subassyDepthBorder,

        // Direct messaging
        messagesView:    store.messagesView,
        messageThreads:  store.messageThreads,
        dmInboxThreads:  store.dmInboxThreads,
        activeThread:    store.activeThread,
        threadMessages:  store.threadMessages,
        messageBody:     store.messageBody,
        messagesLoading: store.messagesLoading,
        messagesSending: store.messagesSending,
        dmUnreadCount:   store.dmUnreadCount,
        dmAlertActive:   store.dmAlertActive,
        msgDeleteId:     store.msgDeleteId,
        messageMediaFile:       store.messageMediaFile,
        messageMediaPreviewUrl: store.messageMediaPreviewUrl,
        messageMediaType:       store.messageMediaType,
        messageMediaUploading:  store.messageMediaUploading,
        dmContacts,
        canDeleteMessages,
        ROLE_DISPLAY_NAMES,
        LAST_REPORT_DATE,
        openMessagesView, openThread, backToInbox, sendMessage,
        openMsgDeleteConfirm, cancelMsgDelete, confirmMsgDelete,
        onMessageMediaPick, clearMessageMedia,
        dmAvatarClass, formatMsgTime,
    };
}
