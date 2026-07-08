// ============================================================
// libs/db-part-notes.js — per-part carry-forward notes CRUD
//
// One part_notes row per part number (keyed by the normalized part).
// Remembers the last note of each kind + the date it was written so it
// can be carried forward the next time a WO Request / Purchasing order
// is opened for the same part. Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { PART_NOTE_KIND } from './config.js';

// Column group for each note kind: { note, date, by }.
const KIND_COLUMNS = {
    [PART_NOTE_KIND.WO_STATUS]:     { note: 'wo_status_note',     date: 'wo_status_note_date',     by: 'wo_status_note_by' },
    [PART_NOTE_KIND.WO_PRODUCTION]: { note: 'wo_production_note', date: 'wo_production_note_date', by: 'wo_production_note_by' },
    [PART_NOTE_KIND.PURCHASER]:     { note: 'purchaser_note',     date: 'purchaser_note_date',     by: 'purchaser_note_by' },
};

// fetchPartNote — the single part_notes row for a part number, or null.
// Normalizes the part number first. Returns { data: row|null, error }.
export async function fetchPartNote(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('part_notes')
            .select('*')
            .eq('part_number_normalized', normalized)
            .maybeSingle()
    );
    return { data: data || null, error };
}

// upsertPartNote — save (or clear) one note kind for a part, stamping today's date.
// kind must be a PART_NOTE_KIND value. Blank/whitespace text clears that note
// (note/date/by → null). Never touches the other two note kinds on the row.
// Returns { data, error }. No-op (returns nulls) when clearing a note on a part
// that has no row yet.
export async function upsertPartNote(partNumber, kind, text, by = null) {
    const cols = KIND_COLUMNS[kind];
    if (!cols) return { data: null, error: new Error('Unknown part note kind: ' + kind) };
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: null, error: new Error('Part number normalized to empty') };

    const clean = (text || '').trim();
    const now   = new Date().toISOString();
    const today = now.slice(0, 10);

    const { data: existing, error: fetchErr } = await withRetry(() =>
        supabase.from('part_notes')
            .select('id')
            .eq('part_number_normalized', normalized)
            .maybeSingle()
    );
    if (fetchErr) return { data: null, error: fetchErr };

    // Nothing to remember and no row to update — skip the write entirely.
    if (!existing && !clean) return { data: null, error: null };

    const fields = {
        [cols.note]: clean || null,
        [cols.date]: clean ? today : null,
        [cols.by]:   clean ? (by || null) : null,
        updated_at:  now,
    };

    if (existing) {
        return withRetry(() =>
            supabase.from('part_notes').update(fields).eq('id', existing.id).select()
        );
    }
    return withRetry(() =>
        supabase.from('part_notes').insert([{ part_number: partNumber.trim(), ...fields }]).select()
    );
}
