// stale-order-reminder.js — Cloudflare Worker (retired)
//
// Stale order detection has moved to the Manager's Hub "Live Alerts" section.
// This worker is no longer needed and can be undeployed.

export default {
    async scheduled(_event, _env, _ctx) {
        console.log('stale-order-reminder: retired — alerts now live in Manager Hub.');
    },
    async fetch(request) {
        return new Response('stale-order-reminder retired — see Manager Hub for stale order alerts.', { status: 200 });
    },
};
