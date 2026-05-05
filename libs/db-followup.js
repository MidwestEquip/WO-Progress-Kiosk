// ============================================================
// libs/db-followup.js — Engineering Follow-Up DB operations
//
// engineering_followups + engineering_followup_events CRUD.
// Imported and re-exported by db.js.
// ============================================================

import { supabase } from './db-shared.js';

// fetchEngineeringFollowups — open cases (status != 'closed') sorted by created_at desc.
// Returns { data, error }
export async function fetchEngineeringFollowups() {
    const { data, error } = await supabase
        .from('engineering_followups')
        .select('*')
        .neq('status', 'closed')
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// fetchEngineeringFollowupEvents — all event rows for a case, oldest first.
// Returns { data, error }
export async function fetchEngineeringFollowupEvents(followupId) {
    const { data, error } = await supabase
        .from('engineering_followup_events')
        .select('*')
        .eq('followup_id', followupId)
        .order('created_at', { ascending: true });
    return { data: data || [], error };
}

// createEngineeringFollowup — insert a new follow-up case, returns the created record.
// Returns { data, error }
export async function createEngineeringFollowup(fields) {
    const { data, error } = await supabase
        .from('engineering_followups')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}

// updateEngineeringFollowup — patch any subset of fields on an existing case.
// Returns { data, error }
export async function updateEngineeringFollowup(id, fields) {
    const { data, error } = await supabase
        .from('engineering_followups')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// insertEngineeringFollowupEvent — append a history/event row for a case.
// Returns { data, error }
export async function insertEngineeringFollowupEvent(fields) {
    const { data, error } = await supabase
        .from('engineering_followup_events')
        .insert({ ...fields, created_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}
