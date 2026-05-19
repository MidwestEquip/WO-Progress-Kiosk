// ============================================================
// libs/db-activity.js — Fire-and-forget activity logging helpers
//
// Shared by db.js and db-assy.js. Imports only from config.js.
// No business logic. No state. No Vue.
// ============================================================

import { supabase } from './config.js';

// openTimeSession — inserts a time_open row into wo_progress_events.
// stage: 'weld'|'grind'|'tv_engine'|'tc_pre_lap'|'stock'|null, etc.
export function openTimeSession({ woId, woNumber, jobNumber = null, department, operator, stage = null }) {
    supabase.from('wo_progress_events').insert({
        work_order_id: woId,
        wo_number:     woNumber   || '',
        job_number:    jobNumber  || null,
        department:    department || '',
        operator_name: operator   || '',
        stage:         stage      || null,
        action:        'time_open',
        started_at:    new Date().toISOString(),
    }).then(({ error }) => {
        if (error) console.warn('time_open insert failed:', error.message);
    });
}

// closeTimeSession — closes the latest open time session for this WO + stage.
// Finds the most recent time_open row with null ended_at and updates it in place.
export function closeTimeSession({ woId, stage = null, endStatus, sessionQty = 0 }) {
    const now = new Date().toISOString();
    let q = supabase.from('wo_progress_events')
        .select('id, started_at')
        .eq('work_order_id', woId)
        .eq('action', 'time_open')
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
            supabase.from('wo_progress_events').update({
                action:           'time_close',
                ended_at:         now,
                duration_minutes: durationMinutes,
                end_status:       endStatus,
                session_qty:      sessionQty,
            }).eq('id', session.id).then(({ error: e }) => {
                if (e) console.warn('time_close update failed:', e.message);
            });
        });
}

// closeAllOpenSessions — closes every open time session for a WO (used on manual TC WO complete).
export function closeAllOpenSessions({ woId, endStatus, sessionQty = 0 }) {
    const now = new Date().toISOString();
    supabase.from('wo_progress_events')
        .select('id, started_at')
        .eq('work_order_id', woId)
        .eq('action', 'time_open')
        .is('ended_at', null)
        .then(({ data: sessions, error }) => {
            if (error || !sessions || !sessions.length) return;
            sessions.forEach(session => {
                const durationMinutes = Math.round(
                    (new Date(now) - new Date(session.started_at)) / 60000
                );
                supabase.from('wo_progress_events').update({
                    action:           'time_close',
                    ended_at:         now,
                    duration_minutes: durationMinutes,
                    end_status:       endStatus,
                    session_qty:      sessionQty,
                }).eq('id', session.id).then(({ error: e }) => {
                    if (e) console.warn('time_close closeAll failed:', e.message);
                });
            });
        });
}

// insertProgressEvent — inserts one stage-action row into wo_progress_events (fire-and-forget).
// Failures are logged to console only — never blocks the main action.
export async function insertProgressEvent({ workOrderId, woNumber, jobNumber = null, department, stage, operatorName, action, sessionQty, cumulativeQtyAfter, reason }) {
    try {
        await supabase.from('wo_progress_events').insert([{
            work_order_id:        workOrderId  || null,
            wo_number:            woNumber     || '',
            job_number:           jobNumber    || null,
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
