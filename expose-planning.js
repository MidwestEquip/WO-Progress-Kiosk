// ============================================================
// expose-planning.js — Vue bindings: Production Planning domain
//
// Pure binding manifest (state + functions for templates).
// Imports from store + pages only. No logic.
// ============================================================

import * as store from './libs/store.js';

import {
    enterProductionPlanning, exitProductionPlanning,
    loadBaseUnits, openBaseUnitDetail, closeBaseUnitDetail, deleteBaseUnitConfirm,
    openBuWizard, closeBuWizard, searchBuConfigs, toggleBuConfig,
    runBuDerivation, moveBuChoice, addBuManualOption, removeBuChoice,
    addBuStep, removeBuStep, addBuChoicePart, removeBuChoicePart,
    normalizeBuPartQty, removeBuBasePart, promoteBuBasePart,
    saveBaseUnit, openBomFix,
} from './pages/planning-view.js';
import {
    openBaseUnitEdit, closeBaseUnitEdit, saveBuEditUnit,
    saveBuEditStep, deleteBuEditStep, addBuEditStep,
    addBuEditChoice, saveBuEditChoice, deleteBuEditChoice, setBuEditDefault,
    addBuEditPart, removeBuEditPart, saveBuEditPartQty,
} from './pages/planning-base-unit-edit.js';
import {
    selectPlanBaseUnit, applyDefaultSplits, runPlanningCalc, togglePlanChoice,
    setPlanBasis, setPlanPctAdjust, onPlanQtyInput, applyAutoPlanQty,
    applyOptionDemandQtys,
} from './pages/planning-run.js';
import {
    loadPlanningRuns, selectRun, saveLineEdit, approveSelected, skipLine,
    loadReleaseDue, releaseLine, releaseAllDue, releaseAllDueGroup, closeRun, cancelRun,
    saveLineQty, applyQtyCascade, closeQtyCascade, setLineMakeBuy, lineMakeBuyTooltip,
    toggleSelectAllRunLines, exportSelectedToCount,
} from './pages/planning-review.js';
import { openPartData, closePartData } from './pages/planning-part-data.js';
import {
    loadPlanningQueues, proposeQueueBatch, openBandEditor, closeBandEditor, saveBand,
} from './pages/planning-queues.js';
import {
    loadWorkload, saveWorkCenter, removeWorkCenter,
    suggestRoutingHours, saveRouting, removeRouting, workloadCellState,
} from './pages/planning-workload.js';

export function buildPlanningExpose() {
    return {
        // ── Base Units tab ───────────────────────────────────
        planningTab:        store.planningTab,
        baseUnits:          store.baseUnits,
        baseUnitsLoading:   store.baseUnitsLoading,
        baseUnitDetail:     store.baseUnitDetail,
        baseUnitDeleteId:   store.baseUnitDeleteId,
        buWizardOpen:       store.buWizardOpen,
        buWizardStep:       store.buWizardStep,
        buFamilySearch:     store.buFamilySearch,
        buSearchLoading:    store.buSearchLoading,
        buConfigResults:    store.buConfigResults,
        buDeriving:         store.buDeriving,
        buKit:              store.buKit,
        buModularChildren:  store.buModularChildren,
        buSaveForm:         store.buSaveForm,
        buSaveErrors:       store.buSaveErrors,
        buSaving:           store.buSaving,
        buManualForm:       store.buManualForm,
        buStepDeleteIndex:  store.buStepDeleteIndex,
        buPartAdding:       store.buPartAdding,
        buIncludedConfigs:  store.buIncludedConfigs,
        buModularLabel:     store.buModularLabel,
        buExcludedConfigs:  store.buExcludedConfigs,
        buFlagCount:        store.buFlagCount,
        enterProductionPlanning, exitProductionPlanning,
        loadBaseUnits, openBaseUnitDetail, closeBaseUnitDetail, deleteBaseUnitConfirm,
        openBuWizard, closeBuWizard, searchBuConfigs, toggleBuConfig,
        runBuDerivation, moveBuChoice, addBuManualOption, removeBuChoice,
        addBuStep, removeBuStep, addBuChoicePart, removeBuChoicePart,
        normalizeBuPartQty, removeBuBasePart, promoteBuBasePart,
        saveBaseUnit, openBomFix,

        // ── Saved base unit editor ───────────────────────────
        baseUnitEditOpen:      store.baseUnitEditOpen,
        baseUnitEditUnit:      store.baseUnitEditUnit,
        baseUnitEditSteps:     store.baseUnitEditSteps,
        baseUnitEditLoading:   store.baseUnitEditLoading,
        baseUnitEditSaving:    store.baseUnitEditSaving,
        baseUnitEditDeleteKey: store.baseUnitEditDeleteKey,
        baseUnitEditStepForm:  store.baseUnitEditStepForm,
        openBaseUnitEdit, closeBaseUnitEdit, saveBuEditUnit,
        saveBuEditStep, deleteBuEditStep, addBuEditStep,
        addBuEditChoice, saveBuEditChoice, deleteBuEditChoice, setBuEditDefault,
        addBuEditPart, removeBuEditPart, saveBuEditPartQty,

        // ── Plan tab ─────────────────────────────────────────
        planBaseUnit:      store.planBaseUnit,
        planQty:           store.planQty,
        planMode:          store.planMode,
        planRequiredDate:  store.planRequiredDate,
        planNotes:         store.planNotes,
        planSplits:        store.planSplits,
        planRunning:       store.planRunning,
        planSplitStatus:   store.planSplitStatus,
        planSplitsValid:   store.planSplitsValid,
        planBasis:         store.planBasis,
        planPctAdjust:     store.planPctAdjust,
        planBaseSold:      store.planBaseSold,
        planBaseSoldLoading: store.planBaseSoldLoading,
        planQtyIsAuto:     store.planQtyIsAuto,
        planOptionDemand:  store.planOptionDemand,
        planOptionDemandLoading: store.planOptionDemandLoading,
        planAutoQty:       store.planAutoQty,
        selectPlanBaseUnit, applyDefaultSplits, runPlanningCalc, togglePlanChoice,
        setPlanBasis, setPlanPctAdjust, onPlanQtyInput, applyAutoPlanQty,
        applyOptionDemandQtys,

        // ── Review tab ───────────────────────────────────────
        planningRuns:        store.planningRuns,
        planningRunsLoading: store.planningRunsLoading,
        selectedRun:         store.selectedRun,
        runLines:            store.runLines,
        runLinesLoading:     store.runLinesLoading,
        runLineFilter:       store.runLineFilter,
        runLineDescrips:     store.runLineDescrips,
        runWhereUsed:        store.runWhereUsed,
        runRefsLoading:      store.runRefsLoading,
        filteredRunLines:    store.filteredRunLines,
        runLinesAllChecked:  store.runLinesAllChecked,
        runLinesSomeChecked: store.runLinesSomeChecked,
        runNoHistoryCount:   store.runNoHistoryCount,
        runReviewCount:      store.runReviewCount,
        releaseDueLines:     store.releaseDueLines,
        releaseDueGroups:    store.releaseDueGroups,
        releasingLineId:     store.releasingLineId,
        runApproving:        store.runApproving,
        runExportingCount:   store.runExportingCount,
        exportSelectedToCount,
        loadPlanningRuns, selectRun, saveLineEdit, approveSelected, skipLine,
        loadReleaseDue, releaseLine, releaseAllDue, releaseAllDueGroup, closeRun, cancelRun,
        saveLineQty, applyQtyCascade, closeQtyCascade, setLineMakeBuy, lineMakeBuyTooltip,
        toggleSelectAllRunLines,
        runChildIndex:      store.runChildIndex,
        qtyCascadeOpen:     store.qtyCascadeOpen,
        qtyCascadeSaving:   store.qtyCascadeSaving,
        qtyCascadePreview:  store.qtyCascadePreview,

        // ── Part Data modal ──────────────────────────────────
        partDataOpen:         store.partDataOpen,
        partDataPart:         store.partDataPart,
        partDataLoading:      store.partDataLoading,
        partData:             store.partData,
        partDataWip:          store.partDataWip,
        partDataPipelineQty:  store.partDataPipelineQty,
        partDataEstInStock:   store.partDataEstInStock,
        partDataSuggestedQty: store.partDataSuggestedQty,
        openPartData, closePartData,

        // ── Queues & Alerts tab ──────────────────────────────
        queueRows:         store.queueRows,
        queueLoading:      store.queueLoading,
        queueLoadedAt:     store.queueLoadedAt,
        queueDeptFilter:   store.queueDeptFilter,
        filteredQueueRows: store.filteredQueueRows,
        lowStockAlerts:    store.lowStockAlerts,
        bandEditorOpen:    store.bandEditorOpen,
        bandForm:          store.bandForm,
        bandSaving:        store.bandSaving,
        queueProposingId:  store.queueProposingId,
        loadPlanningQueues, proposeQueueBatch, openBandEditor, closeBandEditor, saveBand,

        // ── Workload tab ─────────────────────────────────────
        workCenters:       store.workCenters,
        workloadLines:     store.workloadLines,
        workloadLoading:   store.workloadLoading,
        workloadLoadedAt:  store.workloadLoadedAt,
        workloadWeeks:     store.workloadWeeks,
        workloadGrid:      store.workloadGrid,
        wcForm:            store.wcForm,
        routingForm:       store.routingForm,
        routingSuggestion: store.routingSuggestion,
        loadWorkload, saveWorkCenter, removeWorkCenter,
        suggestRoutingHours, saveRouting, removeRouting, workloadCellState,
    };
}
