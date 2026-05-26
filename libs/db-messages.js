// ============================================================
// libs/db-messages.js — Direct message DB operations
//
// All queries against the direct_messages table.
// No business logic. No Vue state.
// ============================================================

import { supabase, withRetry, logError } from './db-shared.js';

// fetchInbox — returns the latest message per conversation for myRole.
// Output: array of { other_role, body, created_at, unread_count }, newest first.
export async function fetchInbox(myRole) {
    const { data, error } = await withRetry(() =>
        supabase.from('direct_messages')
            .select('id, sender_role, recipient_role, body, created_at, read_at')
            .or(`sender_role.eq.${myRole},recipient_role.eq.${myRole}`)
            .order('created_at', { ascending: false })
            .limit(500)
    );
    if (error) { logError('fetchInbox', error); return []; }

    // Group by the other party, track latest message + unread count
    const threads = {};
    for (const msg of (data || [])) {
        const other = msg.sender_role === myRole ? msg.recipient_role : msg.sender_role;
        if (!threads[other]) {
            threads[other] = { other_role: other, body: msg.body, created_at: msg.created_at, unread_count: 0 };
        }
        if (msg.recipient_role === myRole && !msg.read_at) {
            threads[other].unread_count++;
        }
    }
    return Object.values(threads).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// fetchThread — returns all messages between myRole and otherRole, oldest first.
// Output: array of direct_messages rows.
export async function fetchThread(myRole, otherRole) {
    const { data, error } = await withRetry(() =>
        supabase.from('direct_messages')
            .select('id, sender_role, recipient_role, body, created_at, read_at')
            .or(`and(sender_role.eq.${myRole},recipient_role.eq.${otherRole}),and(sender_role.eq.${otherRole},recipient_role.eq.${myRole})`)
            .order('created_at', { ascending: true })
            .limit(200)
    );
    if (error) { logError('fetchThread', error); return []; }
    return data || [];
}

// sendDm — inserts one message row. Returns { data, error }.
export async function sendDm(senderRole, recipientRole, body) {
    const { data, error } = await supabase
        .from('direct_messages')
        .insert({ sender_role: senderRole, recipient_role: recipientRole, body: body.trim() })
        .select()
        .single();
    if (error) logError('sendDm', error);
    return { data, error };
}

// markThreadRead — sets read_at on all unread messages from otherRole to myRole.
export async function markThreadRead(myRole, otherRole) {
    await supabase.from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_role', myRole)
        .eq('sender_role', otherRole)
        .is('read_at', null);
}

// fetchUnreadCount — total unread message count for myRole across all senders.
// Output: number.
export async function fetchUnreadCount(myRole) {
    const { count, error } = await supabase.from('direct_messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_role', myRole)
        .is('read_at', null);
    if (error) return 0;
    return count || 0;
}
