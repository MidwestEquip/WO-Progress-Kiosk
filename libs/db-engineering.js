// ============================================================
// libs/db-engineering.js — Engineering inquiry DB operations
//
// All eng_inquiries CRUD + eng-inquiry-images storage.
// Imported and re-exported by db.js.
// ============================================================

import { supabase } from './db-shared.js';

const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// fetchEngInquiries — all rows, sorted by priority then created_at desc.
// Returns { data, error }
export async function fetchEngInquiries() {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .select('*')
        .order('created_at', { ascending: false });
    if (error || !data) return { data: [], error };
    data.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99;
        const pb = PRIORITY_ORDER[b.priority] ?? 99;
        return pa !== pb ? pa - pb : new Date(b.created_at) - new Date(a.created_at);
    });
    return { data, error: null };
}

// insertEngInquiry — insert a new row, returns the created record.
// Returns { data, error }
export async function insertEngInquiry(fields) {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .insert({ ...fields, updated_at: new Date().toISOString() })
        .select()
        .single();
    return { data, error };
}

// updateEngInquiry — patch any subset of fields on an existing row.
// Returns { data, error }
export async function updateEngInquiry(id, fields) {
    const { data, error } = await supabase
        .from('eng_inquiries')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// uploadEngInquiryImage — upload a file to eng-inquiry-images/{id}/{filename}.
// upsert:true replaces same-named files.
// Returns Supabase storage response { data, error }
export async function uploadEngInquiryImage(inquiryId, file) {
    const path = `${inquiryId}/${file.name}`;
    return supabase.storage.from('eng-inquiry-images').upload(path, file, { upsert: true });
}

// listEngInquiryImages — list files for an inquiry with 1-hour signed URLs.
// Returns { data: [{name, signedUrl}], error }
export async function listEngInquiryImages(inquiryId) {
    const { data: files, error } = await supabase.storage
        .from('eng-inquiry-images')
        .list(inquiryId);
    if (error) return { data: [], error };

    const filtered = (files || []).filter(f => f.name !== '.emptyFolderPlaceholder');
    if (filtered.length === 0) return { data: [], error: null };

    const paths = filtered.map(f => `${inquiryId}/${f.name}`);
    const { data: signed } = await supabase.storage
        .from('eng-inquiry-images')
        .createSignedUrls(paths, 3600);

    const result = filtered.map((f, i) => ({
        name: f.name,
        signedUrl: signed?.[i]?.signedUrl || null
    }));
    return { data: result, error: null };
}
