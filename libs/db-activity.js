// ============================================================
// libs/db-activity.js — Fire-and-forget activity logging helpers
//
// Shared by db.js and db-assy.js. Imports only from config.js.
// No business logic. No state. No Vue.
// ============================================================

import { supabase } from './config.js';

// openTimeSession — opens a new row in wo_time_sessions.
// stage: 'weld'|'grind'|'tv_engine'|'tc_pre_lap'|'stock'|null, etc.
export function openTimeSession({ woId, woNumber, department, operator, stage = null }) {
    supabase.from('wo_time_sessions').insert({
        wo_id:      woId,
        wo_number:  woNumber   || '',
        department: department || '',
        operator:   operator   || '',
        stage:      stage      || null,
        started_at: new Date().toISOString(),
    }).then(({ error }) => {
        if (error) console.warn('wo_time_sessions open failed:', error.message);
    });
}

// closeTimeSession — closes the latest open session for this WO + stage.
// Filtering by stage prevents TV/TC concurrent-stage rows from clobbering each other.
// For Fab/Weld (stage=null) it matches rows where stage IS NULL.
export function closeTimeSession({ woId, stage = null, endStatus, sessionQty = 0 }) {
    const now = new Date().toISOString();
    let q = supabase.from('wo_time_sessions')
        .select('id, started_at')
        .eq('wo_id', woId)
        .is('ended_at', null);
    q = stage ? q.eq('stage', stage) : q.is('stage', null);
    q.order('started_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data: session, error }) => {
            if (error || !session) return;
            const durationMinutes = Math.round(
                (new Date(now) - new Date(session.started_at)) / 60000
            );
            supabase.from('wo_time_sessions').update({
                ended_at:         now,
                duration_minutes: durationMinutes,
                end_status:       endStatus,
                qty_this_session: sessionQty,
            }).eq('id', session.id).then(({ error: e }) => {
                if (e) console.warn('wo_time_sessions close failed:', e.message);
            });
        });
}

// closeAllOpenSessions — closes every open session for a WO (used on manual TC WO complete).
export function closeAllOpenSessions({ woId, endStatus, sessionQty = 0 }) {
    const now = new Date().toISOString();
    supabase.from('wo_time_sessions')
        .select('id, started_at')
        .eq('wo_id', woId)
        .is('ended_at', null)
        .then(({ data: sessions, error }) => {
            if (error || !sessions || !sessions.length) return;
            sessions.forEach(session => {
                const durationMinutes = Math.round(
                    (new Date(now) - new Date(session.started_at)) / 60000
                );
                supabase.from('wo_time_sessions').update({
                    ended_at:         now,
                    duration_minutes: durationMinutes,
                    end_status:       endStatus,
                    qty_this_session: sessionQty,
                }).eq('id', session.id).then(({ error: e }) => {
                    if (e) console.warn('wo_time_sessions closeAll failed:', e.message);
                });
            });
        });
}

// insertProgressEvent — inserts one row into wo_progress_events (fire-and-forget).
// Failures are logged to console only — never blocks the main action.
export async function insertProgressEvent({ workOrderId, woNumber, department, stage, operatorName, action, sessionQty, cumulativeQtyAfter, reason }) {
    try {
        await supabase.from('wo_progress_events').insert([{
            work_order_id:        workOrderId  || null,
            wo_number:            woNumber     || '',
            department:           department   || '',
            stage:                stage        || null,
            operator_name:        operatorName || '',
            action:               action       || '',
            session_qty:          parseFloat(sessionQty)         || 0,
            cumulative_qty_after: parseFloat(cumulativeQtyAfter) || 0,
            reason:               reason       || null
        }]);
    } catch (err) {
        console.warn('[insertProgressEvent] failed silently:', err);
    }
}
