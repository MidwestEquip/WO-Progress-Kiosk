// ============================================================
// libs/realtime.js — Single always-on Supabase Realtime channel.
// Generic table→handler map. All logic lives in main.js callbacks.
// Imports from config only.
// ============================================================

import { supabase } from './config.js';

let _channel = null;

// startAppRealtime — opens one channel subscribed to all provided tables.
// handlers: { table_name: (payload) => void, ... }
// payload shape: { eventType: 'INSERT'|'UPDATE'|'DELETE', new: row, old: row }
export function startAppRealtime(handlers) {
    stopAppRealtime();
    let ch = supabase.channel('app-realtime');
    Object.entries(handlers).forEach(([table, handler]) => {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, handler);
    });
    _channel = ch.subscribe((status, err) => {
        if (err) console.error('[Realtime] error:', err);
        else console.log('[Realtime] status:', status);
    });
}

// stopAppRealtime — tears down the channel.
export function stopAppRealtime() {
    if (_channel) { supabase.removeChannel(_channel); _channel = null; }
}
