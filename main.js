// ============================================================
// main.js — Entry point. Startup, lifecycle wiring only.
//
// Template bindings live in expose-core.js + expose-ops.js.
// No business logic here.
// ============================================================

import {
    createApp,
    nextTick,
    onMounted,
    onUnmounted,
    watch
} from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

import * as store from './libs/store.js';
import { PARTIAL_NAMES } from './libs/config.js';
import { fetchAppPins, normalizeDept, DEPT_ALIASES } from './libs/db-shared.js';
import { setPins } from './libs/pins.js';
import { checkConnectivity, supabase } from './libs/db.js';
import { loadHeaderLinks, loadSplashLinks } from './pages/splash-view.js';
import { loadManagerAlerts } from './pages/manager-view.js';
import { loadManagerPendingWoRequests } from './pages/wo-manager-approval.js';
import { loadReceivingEligible } from './pages/wo-status-view.js';
import { loadInventoryItems, loadPoReceiveOrders } from './pages/inventory-view.js';
import { loadWoRequests } from './pages/wo-request-view.js';
import { loadForecastedItems } from './pages/wo-forecasting-view.js';
import { loadCreateWoItems } from './pages/create-wo-view.js';
import { loadOpenOrders, loadReminderEmail } from './pages/open-orders-view.js';
import { loadCompletedOrders } from './pages/completed-orders-view.js';
import { loadPurchasingOrders, loadOrderEvents, loadOrderQuotes, syncDetailFromRealtime } from './pages/purchasing-view.js';
import { loadPoForecast, checkForecastRevisits } from './pages/purchasing-forecast.js';
import { loadAllQuotes } from './pages/purchasing-quotes-view.js';
import { stopMessagesPoll, refreshUnreadCount,
         startMessageAlert, stopMessageAlert } from './pages/messages-view.js';
import { startAppRealtime, stopAppRealtime } from './libs/realtime.js';
import { loadEngFollowups, loadEngFollowupEvents } from './pages/engineering-followup.js';
import { loadEngInquiries } from './pages/engineering-view.js';

import { buildCoreExpose } from './expose-core.js';
import { buildOpsExpose } from './expose-ops.js';

// ── Load HTML partials into #app before Vue mounts ───────────
async function loadPartials() {
    const chunks = await Promise.all(
        PARTIAL_NAMES.map(n =>
            fetch(`./partials/${n}.html`).then(r => {
                if (!r.ok) throw new Error(`Partial "${n}.html" failed to load (HTTP ${r.status})`);
                return r.text();
            })
        )
    );
    document.getElementById('app').innerHTML = chunks.join('\n');
}
const [, pinsMap] = await Promise.all([loadPartials(), fetchAppPins()]);
setPins(pinsMap);
await Promise.all([loadHeaderLinks(), loadSplashLinks()]);

const loadingEl = document.getElementById('app-loading');

// ── Vue App ───────────────────────────────────────────────────
try {
    const app = createApp({
        setup() {
            // Clock: update every second
            const clockInterval = setInterval(() => {
                store.currentTime.value = new Date().toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                });
            }, 1000);
            onUnmounted(() => { clearInterval(clockInterval); stopAppRealtime(); });

            // Version poller — reload when version.json changes
            let _seenVersion = null;
            async function checkVersion() {
                try {
                    const res = await fetch(`./version.json?_=${Date.now()}`);
                    if (!res.ok) return;
                    const { v } = await res.json();
                    if (_seenVersion === null) { _seenVersion = v; return; }
                    if (v !== _seenVersion) store.versionUpdateAvailable.value = true;
                } catch { /* ignore network errors */ }
            }
            checkVersion();
            const versionInterval = setInterval(checkVersion, 60_000);
            onUnmounted(() => clearInterval(versionInterval));

            // Global unread-message poll — manager only
            const unreadInterval = setInterval(() => {
                if (store.sessionRole.value === 'manager') refreshUnreadCount();
            }, 15_000);
            onUnmounted(() => clearInterval(unreadInterval));

            // Drive the beep loop off the unread count (edge-flash is CSS via dmAlertActive)
            watch(store.dmUnreadCount, (count) => {
                if (count > 0) startMessageAlert();
                else stopMessageAlert();
            });

            // Offline detection
            async function probeConnectivity() {
                store.isOffline.value = !(await checkConnectivity());
            }
            const onOfflineEvent = () => { store.isOffline.value = true; };
            window.addEventListener('offline', onOfflineEvent);
            window.addEventListener('online',  probeConnectivity);
            const connectivityInterval = setInterval(probeConnectivity, 30_000);
            onUnmounted(() => {
                clearInterval(connectivityInterval);
                window.removeEventListener('offline', onOfflineEvent);
                window.removeEventListener('online',  probeConnectivity);
            });

            onMounted(async () => {
                probeConnectivity();
                let session = null;
                try {
                    const { data, error } = await supabase.auth.getSession();
                    if (error) {
                        console.warn('[Auth] stale session, clearing:', error.message);
                        await supabase.auth.signOut();
                    } else {
                        session = data.session;
                    }
                } catch (err) {
                    console.warn('[Auth] getSession threw, clearing:', err.message);
                    await supabase.auth.signOut();
                }
                if (session?.user) {
                    const role = session.user.app_metadata?.role || null;
                    if (role) {
                        store.sessionRole.value = role;
                        store.currentView.value = 'splash';
                        loadManagerAlerts();
                        refreshUnreadCount();
                        startAppRealtime({
                            work_orders: ({ eventType, new: row, old }) => {
                                if (store.currentView.value !== 'dashboard') return;
                                const dept = store.selectedDept.value;
                                const deptFilter = new Set([dept, ...(DEPT_ALIASES[dept] || [])]);
                                const rawDept = row?.department || old?.department;
                                if (!rawDept || !deptFilter.has(rawDept)) return;
                                if (eventType === 'UPDATE') {
                                    const norm = normalizeDept(row);
                                    const idx = store.orders.value.findIndex(o => o.id === norm.id);
                                    if (norm.status === 'completed') {
                                        if (idx !== -1) store.orders.value.splice(idx, 1);
                                    } else if (idx !== -1) {
                                        store.orders.value.splice(idx, 1, norm);
                                        if (store.activeOrder.value?.id === norm.id) store.activeOrder.value = norm;
                                    }
                                } else if (eventType === 'INSERT') {
                                    const norm = normalizeDept(row);
                                    if (norm.status !== 'completed' && !store.orders.value.find(o => o.id === norm.id))
                                        store.orders.value.push(norm);
                                } else if (eventType === 'DELETE') {
                                    store.orders.value = store.orders.value.filter(o => o.id !== old.id);
                                }
                            },
                            purchasing_orders: ({ eventType, new: row }) => {
                                console.log('[RT] purchasing_orders', eventType, row?.id, 'view:', store.currentView.value, 'modalOpen:', store.purchasingDetailOpen.value, 'openId:', store.purchasingDetailOrder.value?.id);
                                const v = store.currentView.value;
                                if (v === 'purchasing' || v === 'po_request') {
                                    loadPurchasingOrders();
                                    if (eventType === 'UPDATE' && row) syncDetailFromRealtime(row);
                                } else if (v === 'po_forecasting') loadPoForecast();
                            },
                            wo_requests: () => {
                                const v = store.currentView.value;
                                if (v === 'wo_request') loadWoRequests();
                                else if (v === 'wo_approval' || v === 'manager') loadManagerPendingWoRequests();
                            },
                            open_orders: () => {
                                if (store.currentView.value === 'open_orders') loadOpenOrders();
                            },
                            engineering_followups: () => {
                                if (store.currentView.value === 'engineering' && store.engView.value === 'followup')
                                    loadEngFollowups();
                            },
                            eng_inquiries: () => {
                                if (store.currentView.value === 'engineering' && store.engView.value === 'inquiries')
                                    loadEngInquiries();
                            },
                            wo_status_tracking: () => {
                                if (store.currentView.value === 'wo_status') loadReceivingEligible();
                            },
                            direct_messages: () => {
                                if (store.sessionRole.value === 'manager') refreshUnreadCount();
                            },
                            purchasing_quotes: () => {
                                if (store.currentView.value === 'po_request') loadAllQuotes();
                            },
                            purchasing_order_events: () => {
                                if (store.purchasingDetailOpen.value) loadOrderEvents();
                            },
                            purchasing_order_quotes: () => {
                                if (store.purchasingDetailOpen.value) loadOrderQuotes();
                            },
                            engineering_followup_events: () => {
                                if (store.engFollowupModalOpen.value && store.engFollowupSelected.value?.id)
                                    loadEngFollowupEvents(store.engFollowupSelected.value.id);
                            },
                            wo_progress_events: () => { /* append-only log — no list view to refresh */ },
                            wo_errors:          () => { /* error log — no list view to refresh */ },
                        });
                    }
                }
                await nextTick();
                if (loadingEl) loadingEl.remove();
            });

            // Load data on view entry
            watch(store.currentView, (v, oldV) => {
                if (oldV === 'messages') stopMessagesPoll();
                if (v !== 'dashboard') store.showingCompletedDept.value = false;
                if (v !== 'wo_status') store.closeoutAuthorized.value = false;
                if (v === 'wo_status')       loadReceivingEligible();
                if (v === 'manager')         { loadManagerAlerts(); loadManagerPendingWoRequests(); }
                if (v === 'wo_approval')     loadManagerPendingWoRequests();
                if (v === 'inventory' && store.inventoryMode.value === 'parts')     loadInventoryItems();
                if (v === 'inventory' && store.inventoryMode.value === 'po_receive') loadPoReceiveOrders();
                if (v === 'wo_request')      loadWoRequests();
                if (v === 'wo_forecasting')  loadForecastedItems();
                if (v === 'create_wo')       loadCreateWoItems();
                if (v === 'open_orders')     { loadOpenOrders(); loadReminderEmail(); }
                if (v === 'completed_orders') loadCompletedOrders();
                if (v === 'purchasing')       { checkForecastRevisits(); loadPurchasingOrders(); }
                if (v === 'po_request')       { checkForecastRevisits(); loadPurchasingOrders(); }
                if (v === 'po_forecasting')   { checkForecastRevisits(); loadPoForecast(); }
            });
            watch(store.managerSubView, (v) => {
                if (v === 'home' && store.currentView.value === 'manager') loadManagerAlerts();
            });
            watch(store.versionUpdateAvailable, (v) => {
                if (v) setTimeout(() => location.reload(), 10_000);
            });

            return { ...buildCoreExpose(), ...buildOpsExpose() };
        }
    });

    app.config.errorHandler = (err, vm, info) => {
        console.error('[Vue Error]', info, err);
        store.showToast('Something went wrong. Please try again.', 'error');
    };

    app.mount('#app');

} catch (err) {
    console.error('[Mount Error]', err);
    if (loadingEl) {
        loadingEl.innerHTML = `
            <div style="text-align:center;padding:2rem;">
                <h2 style="font-size:2rem;font-weight:bold;color:#ef4444;margin-bottom:1rem;">App Failed to Load</h2>
                <p style="color:#94a3b8;margin-bottom:0.5rem;">${err.message}</p>
                <button onclick="location.reload()"
                    style="background:#2563eb;color:white;padding:0.75rem 2rem;border-radius:0.5rem;
                           font-weight:bold;border:none;cursor:pointer;font-size:1.125rem;margin-top:1rem;">
                    Reload Page
                </button>
            </div>`;
    }
}
