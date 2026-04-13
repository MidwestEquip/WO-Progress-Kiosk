// ============================================================
// libs/store-manager.js — Manager Hub reactive state
//
// Re-exported by store.js. No imports from store.js (prevents circular deps).
// Contains: AI chat, manager nav, priorities, KPIs, alerts, WO problems,
//           time report.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── Manager AI Chat ───────────────────────────────────────────
export const aiChatOpen     = ref(false);
export const aiChatLoading  = ref(false);
export const aiChatInput    = ref('');
export const aiChatMessages = ref([]);

// ── Manager nav + priority ────────────────────────────────────
export const assignCustomInput = ref({ id: null, text: '' });
export const managerSubView    = ref('home');
export const priorityDept      = ref('');
export const priorityOrders    = ref([]);
export const delayedOrders     = ref([]);

const DELAYED_DEPT_ORDER = ['Fab', 'Weld', 'Trac Vac Assy', 'Tru Cut Assy'];
export const delayedOrdersByDept = computed(() => {
    const grouped = {};
    delayedOrders.value.forEach(o => {
        if (!grouped[o.department]) grouped[o.department] = [];
        grouped[o.department].push(o);
    });
    return DELAYED_DEPT_ORDER.map(dept => ({ dept, orders: grouped[dept] || [] }));
});

// ── KPIs ──────────────────────────────────────────────────────
export const kpiStats       = ref({ completedThisWeek: 0, activeJobs: 0, onHoldCount: 0, delayedCount: 0 });
export const kpiByOperator  = ref([]);
export const kpiCycleTime   = ref([]);
export const kpiHoldReasons = ref([]);
export const kpiOldestWos   = ref([]);
export const managerAlerts  = ref({
    completedNotReceived: [],
    pausedOnHold:         [],
    startedNoProgress:    [],
    qtyMismatch:          []
});

// ── Delayed WO detail modal ───────────────────────────────────
export const delayedWoDetailOpen = ref(false);
export const delayedWoDetail     = ref(null);

// ── WO Problem draft (action panel inline form) ───────────────
export const woProblemDraftText      = ref('');
export const woProblemDraftError     = ref(false);
export const woProblemDraftName      = ref('');
export const woProblemDraftNameError = ref(false);

// ── WO Problems ───────────────────────────────────────────────
export const woProblems   = ref([]);
export const woProblemCount = computed(() => woProblems.value.length);

// ── Manager badge counts ──────────────────────────────────────
export const delayedWoCount = computed(() =>
    delayedOrdersByDept.value.reduce((sum, g) => sum + g.orders.length, 0)
);
export const managerAlertCount = computed(() => {
    const a = managerAlerts.value;
    return (a.completedNotReceived?.length || 0)
         + (a.pausedOnHold?.length        || 0)
         + (a.startedNoProgress?.length   || 0)
         + (a.qtyMismatch?.length         || 0);
});
export const managerTotalBadge = computed(() =>
    delayedWoCount.value + woProblemCount.value + managerAlertCount.value
);

// ── WO Problem resolve modal ──────────────────────────────────
export const woProblemModalOpen         = ref(false);
export const woProblemTarget            = ref(null);
export const woProblemResolution        = ref('');
export const woProblemResolutionError   = ref(false);
export const woProblemResolverName      = ref('');
export const woProblemResolverNameError = ref(false);

// ── Time Report ───────────────────────────────────────────────
export const timeReportSessions    = ref([]);
export const timeReportFrom        = ref('');
export const timeReportTo          = ref('');
export const timeReportTab         = ref('wo');
export const timeReportExpandedWo  = ref(null);
export const timeReportExpandedPart = ref(null);

export const timeReportByWo = computed(() => {
    const map = {};
    for (const s of timeReportSessions.value) {
        const key = s.wo_id;
        if (!map[key]) {
            map[key] = {
                wo_id:        s.wo_id,
                wo_number:    s.wo_number,
                part_number:  s.work_orders?.part_number || '',
                department:   s.department,
                totalMinutes: 0,
                totalQty:     0,
                operators:    new Set(),
                sessions:     [],
                lastStarted:  s.started_at,
            };
        }
        const row = map[key];
        row.totalMinutes += s.duration_minutes || 0;
        row.totalQty     += s.qty_this_session || 0;
        row.operators.add(s.operator);
        row.sessions.push(s);
        if (s.started_at > row.lastStarted) row.lastStarted = s.started_at;
    }
    return Object.values(map)
        .map(r => ({ ...r, operators: [...r.operators].join(', ') }))
        .sort((a, b) => (b.lastStarted > a.lastStarted ? 1 : -1));
});

export const timeReportByPart = computed(() => {
    const map = {};
    for (const s of timeReportSessions.value) {
        const key = s.work_orders?.part_number || '(unknown)';
        if (!map[key]) {
            map[key] = {
                part_number:  key,
                woIds:        new Set(),
                totalMinutes: 0,
                totalQty:     0,
                operators:    new Set(),
                sessions:     [],
            };
        }
        const row = map[key];
        row.woIds.add(s.wo_id);
        row.totalMinutes += s.duration_minutes || 0;
        row.totalQty     += s.qty_this_session || 0;
        row.operators.add(s.operator);
        row.sessions.push(s);
    }
    return Object.values(map)
        .map(r => ({
            ...r,
            woCount:    r.woIds.size,
            avgMinutes: r.woIds.size ? Math.round(r.totalMinutes / r.woIds.size) : 0,
            operators:  [...r.operators].join(', '),
        }))
        .sort((a, b) => b.woCount - a.woCount);
});
