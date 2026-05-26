// ============================================================
// libs/store-messages.js — Reactive state for direct messaging
//
// Re-exported by store.js. No fetch calls, no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

export const messagesView    = ref('inbox'); // 'inbox' | 'thread' (used by poll logic)
export const messageThreads  = ref([]);      // all contacts merged with thread data
export const activeThread    = ref(null);    // role key of the open conversation, or null = inbox
export const threadMessages  = ref([]);      // messages in the active thread
export const messageBody     = ref('');      // compose textarea
export const messagesLoading = ref(false);
export const messagesSending = ref(false);
export const dmUnreadCount   = ref(0);

// Inbox rows: only contacts that have at least one message, newest first.
export const dmInboxThreads = computed(() =>
    messageThreads.value.filter(t => t.body !== null)
);

// True while there are unread messages — drives the screen edge-flash + beep loop.
export const dmAlertActive = computed(() => dmUnreadCount.value > 0);
