// ============================================================
// pages/purchasing-rfq.js — RFQ Email Drafter
//
// Copies HTML to clipboard so the table pastes cleanly into Gmail.
// Plain text version is shown in the textarea for reference.
// ============================================================

import * as store from '../libs/store.js';

// ── Helpers ───────────────────────────────────────────────────

function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _finishSpec(order) {
    return [order.material_grade, order.material_finish].filter(Boolean).join(' ') || '—';
}

// ── Shared row / header data ──────────────────────────────────

const STEEL_HEADERS  = ['Item', 'Material', 'Description', 'Size', 'Finish / Spec', 'Qty'];
const PART_HEADERS   = ['Item', 'Our Part #', 'Description', 'Qty'];
const SUPPLY_HEADERS = ['Item', 'Item', 'Description', 'Qty'];

function _steelRows(orders, offset) {
    return orders.map((o, i) => [
        String(offset + i + 1),
        o.material_type || '—',
        o.description || o.steel_shape || '—',
        o.material_size || o.material_thickness || '—',
        _finishSpec(o),
        String(o.qty_needed ?? '—'),
    ]);
}

function _partRows(orders, offset) {
    return orders.map((o, i) => [
        String(offset + i + 1),
        o.part_number || '—',
        o.description || '—',
        String(o.qty_needed ?? '—'),
    ]);
}

function _supplyRows(orders, offset) {
    return orders.map((o, i) => [
        String(offset + i + 1),
        o.supply_item_name || '—',
        o.description || o.supply_category || '—',
        String(o.qty_needed ?? '—'),
    ]);
}

function _getSection(type, orders, offset) {
    if (type === 'steel')  return { headers: STEEL_HEADERS,  rows: _steelRows(orders, offset) };
    if (type === 'part')   return { headers: PART_HEADERS,   rows: _partRows(orders, offset) };
    return                        { headers: SUPPLY_HEADERS, rows: _supplyRows(orders, offset) };
}

// Returns groups with headers + rows, item numbers continuous across types.
function _orderedSections(orders) {
    const groups = [
        { type: 'steel',  label: 'STEEL MATERIALS', items: orders.filter(o => o.request_type === 'steel') },
        { type: 'part',   label: 'PARTS',           items: orders.filter(o => o.request_type === 'part') },
        { type: 'supply', label: 'SUPPLIES',        items: orders.filter(o => o.request_type === 'supply') },
    ].filter(g => g.items.length > 0);
    let offset = 0;
    return groups.map(g => {
        const sec = _getSection(g.type, g.items, offset);
        offset += g.items.length;
        return { ...g, ...sec };
    });
}

// ── Plain text table (shown in textarea) ──────────────────────

function _plainTable(headers, rows) {
    const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
    );
    const pad  = (s, w) => String(s ?? '').padEnd(w);
    const sep  = widths.map(w => '─'.repeat(w)).join('  ');
    const head = headers.map((h, i) => pad(h, widths[i])).join('  ');
    const data = rows.map(r => r.map((c, i) => pad(c, widths[i])).join('  '));
    return [head, sep, ...data].join('\n');
}

// ── HTML table (copied to clipboard → pastes cleanly in Gmail) ─

function _htmlTable(headers, rows) {
    const TH = 'text-align:left;padding:6px 20px 6px 0;border-bottom:2px solid #333;font-weight:bold;white-space:nowrap;';
    const TD = 'text-align:left;padding:5px 20px 5px 0;border-bottom:1px solid #e0e0e0;white-space:nowrap;';
    const ths = headers.map(h => `<th style="${TH}">${_esc(h)}</th>`).join('');
    const trs = rows.map(r =>
        `<tr>${r.map(c => `<td style="${TD}">${_esc(c)}</td>`).join('')}</tr>`
    ).join('');
    return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin-bottom:16px;"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ── Subject ───────────────────────────────────────────────────

function _buildSubject(orders, shipTo) {
    const loc = shipTo ? ` – Ship to ${shipTo}` : '';
    if (orders.length === 1) {
        const o = orders[0];
        if (o.request_type === 'steel')  return `RFQ – ${o.material_type || 'Steel'} Material${loc}`;
        if (o.request_type === 'supply') return `RFQ – ${o.supply_item_name || 'Supply Item'}${loc}`;
        return `RFQ – ${o.part_number || 'Part'}${loc}`;
    }
    const types = [...new Set(orders.map(o => o.request_type))];
    if (types.length === 1) {
        if (types[0] === 'steel')  return `RFQ – Steel Materials${loc}`;
        if (types[0] === 'supply') return `RFQ – Supply Items${loc}`;
        return `RFQ – Parts${loc}`;
    }
    return `RFQ – ${orders.length} Items${loc}`;
}

// ── Body builders ─────────────────────────────────────────────

function _buildPlainBody(sections, shipTo, itemWord) {
    const isMixed   = sections.length > 1;
    const shipBlock = shipTo ? `Ship To:\n${shipTo}\n\n` : '';
    const tables    = isMixed
        ? sections.map(s => `${s.label}\n${_plainTable(s.headers, s.rows)}`).join('\n\n')
        : _plainTable(sections[0].headers, sections[0].rows);
    return `Hello,\n\nPlease quote the following ${itemWord}.\n\n${shipBlock}${tables}\n\nThank you,`;
}

function _buildHtmlBody(sections, shipTo, itemWord) {
    const isMixed = sections.length > 1;
    const P = 'font-family:Arial,sans-serif;font-size:14px;margin:0 0 12px 0;';
    let html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">`;
    html += `<p style="${P}">Hello,</p>`;
    html += `<p style="${P}">Please quote the following ${_esc(itemWord)}.</p>`;
    if (shipTo) html += `<p style="${P}"><strong>Ship To:</strong><br>${_esc(shipTo)}</p>`;
    if (isMixed) {
        sections.forEach(s => {
            html += `<p style="${P}"><strong>${_esc(s.label)}</strong></p>`;
            html += _htmlTable(s.headers, s.rows);
        });
    } else {
        html += _htmlTable(sections[0].headers, sections[0].rows);
    }
    html += `<p style="${P}">Thank you,</p></div>`;
    return html;
}

// ── Rebuild ───────────────────────────────────────────────────

function _rebuildEmail() {
    const orders = store.rfqDraftOrders.value;
    if (!orders.length) return;

    const shipTo   = store.purchasingDetailForm.value.ship_to?.trim() || orders[0].ship_to?.trim() || '';
    const types    = [...new Set(orders.map(o => o.request_type))];
    const itemWord = types.length === 1 && types[0] === 'steel'  ? 'materials'
                   : types.length === 1 && types[0] === 'part'   ? 'parts'
                   :                                               'items';
    const sections = _orderedSections(orders);

    store.rfqDraftSubject.value = _buildSubject(orders, shipTo);
    store.rfqDraftText.value    = _buildPlainBody(sections, shipTo, itemWord);
    store.rfqDraftHtml.value    = _buildHtmlBody(sections, shipTo, itemWord);
}

// ── Exported actions ──────────────────────────────────────────

// openRfqDraft — seed draft with current order, reset picker, open modal.
export function openRfqDraft() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    store.rfqDraftOrders.value  = [order];
    store.rfqPickerOpen.value   = false;
    store.rfqPickerSearch.value = '';
    store.rfqDraftCopied.value  = false;
    _rebuildEmail();
    store.rfqDraftOpen.value = true;
}

// addOrderToRfq — append an order to the draft and regenerate; ignores duplicates.
export function addOrderToRfq(order) {
    if (store.rfqDraftOrders.value.some(o => o.id === order.id)) return;
    store.rfqDraftOrders.value  = [...store.rfqDraftOrders.value, order];
    store.rfqPickerSearch.value = '';
    store.rfqPickerOpen.value   = false;
    _rebuildEmail();
}

// removeOrderFromRfq — remove an order by id and regenerate; requires at least 1 to remain.
export function removeOrderFromRfq(orderId) {
    if (store.rfqDraftOrders.value.length <= 1) return;
    store.rfqDraftOrders.value = store.rfqDraftOrders.value.filter(o => o.id !== orderId);
    _rebuildEmail();
}

// closeRfqDraft — dismiss the draft modal.
export function closeRfqDraft() {
    store.rfqDraftOpen.value = false;
}

// copyRfqDraft — copy HTML to clipboard (Gmail renders it as a table).
// Falls back to plain text if ClipboardItem API is unavailable.
export async function copyRfqDraft() {
    const subject = store.rfqDraftSubject.value;
    const html    = store.rfqDraftHtml.value;
    const plain   = store.rfqDraftText.value;
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html':  new Blob([html],  { type: 'text/html' }),
                'text/plain': new Blob([plain], { type: 'text/plain' }),
            })
        ]);
        store.rfqDraftCopied.value = true;
        setTimeout(() => { store.rfqDraftCopied.value = false; }, 2000);
    } catch {
        try {
            await navigator.clipboard.writeText(`Subject: ${subject}\n\n${plain}`);
            store.rfqDraftCopied.value = true;
            setTimeout(() => { store.rfqDraftCopied.value = false; }, 2000);
        } catch {
            store.showToast('Could not copy to clipboard — try selecting and copying manually.', 'error');
        }
    }
}
