// ============================================================
// pages/planning-part-data.js — read-only Part Data modal
//
// Opens from a Review-grid line and shows the same reference picture the
// WO Request Data panel shows, assembled by db.fetchPartDataBundle. No
// form, no writes — nothing here can change a request, a run, or a part.
//
// Imports from store + db + utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { bucketPartWip, sanitizeText } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

let _gen = 0;   // open generation: a stale bundle never paints over a newer one

// openPartData — load and show the reference bundle for one part.
// Input: part number (any casing). Safe to call repeatedly.
export async function openPartData(partNumber) {
    const part = sanitizeText(partNumber || '').toUpperCase();
    if (!part) return;
    const gen = ++_gen;
    store.partDataOpen.value    = true;
    store.partDataPart.value    = part;
    store.partData.value        = null;
    store.partDataWip.value     = null;
    store.partDataLoading.value = true;
    try {
        const { data, errors } = await db.fetchPartDataBundle(part);
        if (gen !== _gen) return;                       // a newer open won
        store.partData.value = data;
        // No request to exclude — this view is not editing one.
        store.partDataWip.value = data?.wipRaw ? bucketPartWip(data.wipRaw, null) : null;
        if (errors.length) {
            store.showToast(`Some part data could not load — ${errors[0]}`);
            logError('openPartData', new Error(errors.join('; ')), { part });
        }
    } catch (err) {
        if (gen !== _gen) return;
        store.showToast('Could not load part data: ' + err.message);
        logError('openPartData', err, { part });
    } finally {
        if (gen === _gen) store.partDataLoading.value = false;
    }
}

// closePartData — dismiss the modal and drop its data.
export function closePartData() {
    _gen++;                                             // cancel any in-flight load
    store.partDataOpen.value    = false;
    store.partDataPart.value    = '';
    store.partData.value        = null;
    store.partDataWip.value     = null;
    store.partDataLoading.value = false;
}
