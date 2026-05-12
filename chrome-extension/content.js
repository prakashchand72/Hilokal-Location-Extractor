// Isolated-world bridge running inside www.hilokal.com page context.

function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (_) {}
}

// Relay WebSocket events from inject.js (main world) to the background SW
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === '__HILOKAL_GCC__') {
        safeSend({ action: 'gcc_entry', name: event.data.name, city: event.data.city, ts: event.data.ts });
    }
    if (event.data.type === '__HILOKAL_CALL_ID__') {
        safeSend({ action: 'set_call_id', callId: event.data.callId });
    }
});

// Extract call ID from URL (works when it's in the path)
function reportUrlCallId() {
    const m = location.pathname.match(/\/(\d{5,})/);
    if (m) safeSend({ action: 'set_call_id', callId: m[1] });
}
reportUrlCallId();

// Watch for SPA navigation
let lastHref = location.href;
new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        reportUrlCallId();
    }
}).observe(document, { subtree: true, childList: true });

// Handle seat request from background — runs here (in page context) so that
// fetch automatically includes the jwt cookie for hilokal.com, exactly as
// the Hilokal web app does it. Background SW cookies don't cross origins.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'do_seat_request') return false;

    fetch(`https://elb.hilokal.com/table-share/${msg.callId}/group-call-share-count`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'accept':       'application/json',
            'origin':       'https://www.hilokal.com',
            'referer':      'https://www.hilokal.com/',
        },
    })
    .then(async (res) => {
        const text = await res.text().catch(() => '');
        if (res.ok) {
            sendResponse({ ok: true });
        } else if (res.status === 401 || res.status === 403) {
            sendResponse({ ok: false, error: 'Not authorised — are you logged in to Hilokal?' });
        } else {
            sendResponse({ ok: false, error: `Server ${res.status}: ${text}` });
        }
    })
    .catch(err => sendResponse({ ok: false, error: String(err) }));

    return true; // keep channel open for async sendResponse
});
