// ============================================================
// libs/db-messages.js — Direct message DB operations
//
// All queries against the direct_messages table.
// No business logic. No Vue state.
// ============================================================

import { supabase, withRetry, logError } from './db-shared.js';

// Signed-URL cache: media_path -> { url, expires }. A private bucket needs a fresh
// signed URL per object, but the thread polls every 12s — re-signing on each poll
// would change every <img>/<video> src and make media flicker/reload. Caching the
// URL by path (re-signing only within 5 min of the 1-hour expiry) keeps src stable.
const _mediaUrlCache = new Map();
const MEDIA_URL_TTL  = 3600;   // signed-URL lifetime, seconds

// _signMediaPath — return a (cached) signed URL for a message-media object path.
// Input: storage path or null. Output: signed URL string, or null on failure/no path.
async function _signMediaPath(path) {
    if (!path) return null;
    const cached = _mediaUrlCache.get(path);
    if (cached && cached.expires - Date.now() > 5 * 60_000) return cached.url;
    const { data, error } = await supabase.storage
        .from('message-media').createSignedUrl(path, MEDIA_URL_TTL);
    if (error || !data?.signedUrl) { logError('_signMediaPath', error); return cached?.url || null; }
    _mediaUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + MEDIA_URL_TTL * 1000 });
    return data.signedUrl;
}

// _mediaLabel — inbox preview text for a media-only message (empty body).
function _mediaLabel(type) {
    return type === 'video' ? '🎥 Video' : '📷 Photo';
}

// fetchInbox — returns the latest message per conversation for myRole.
// Output: array of { other_role, body, created_at, unread_count }, newest first.
export async function fetchInbox(myRole) {
    const { data, error } = await withRetry(() =>
        supabase.from('direct_messages')
            .select('id, sender_role, recipient_role, body, media_path, media_type, created_at, read_at')
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
            // Media-only messages (blank body) get a label so the inbox preview isn't empty
            const preview = msg.body || (msg.media_path ? _mediaLabel(msg.media_type) : msg.body);
            threads[other] = { other_role: other, body: preview, created_at: msg.created_at, unread_count: 0 };
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
            .select('id, sender_role, recipient_role, body, media_path, media_type, created_at, read_at')
            .or(`and(sender_role.eq.${myRole},recipient_role.eq.${otherRole}),and(sender_role.eq.${otherRole},recipient_role.eq.${myRole})`)
            .order('created_at', { ascending: true })
            .limit(200)
    );
    if (error) { logError('fetchThread', error); return []; }
    const rows = data || [];
    // Attach a stable signed URL to each media message for inline rendering
    await Promise.all(rows.map(async (m) => {
        m.media_url = m.media_path ? await _signMediaPath(m.media_path) : null;
    }));
    return rows;
}

// uploadMessageMedia — uploads one file to the private message-media bucket under a
// random UUID name. Input: File. Output: { path, error } — path is the storage key.
export async function uploadMessageMedia(file) {
    const ext  = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
        .from('message-media').upload(path, file, { upsert: false });
    if (error) { logError('uploadMessageMedia', error); return { path: null, error }; }
    return { path, error: null };
}

// sendDm — inserts one message row (optionally with a media attachment).
// mediaPath/mediaType are null for text-only messages. Returns { data, error };
// data carries a signed media_url so the sender sees the attachment immediately.
export async function sendDm(senderRole, recipientRole, body, mediaPath = null, mediaType = null) {
    const { data, error } = await supabase
        .from('direct_messages')
        .insert({ sender_role: senderRole, recipient_role: recipientRole,
                  body: body.trim(), media_path: mediaPath, media_type: mediaType })
        .select()
        .single();
    if (error) { logError('sendDm', error); return { data, error }; }
    if (data?.media_path) data.media_url = await _signMediaPath(data.media_path);
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

// deleteDm — permanently delete one message row by id. Returns { error }.
// Caller is responsible for the manager-only authorization check.
export async function deleteDm(id) {
    const { error } = await supabase
        .from('direct_messages')
        .delete()
        .eq('id', id);
    if (error) logError('deleteDm', error);
    return { error };
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
