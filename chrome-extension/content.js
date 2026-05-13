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
    if (event.data.type === '__HILOKAL_TABLE_ID__') {
        safeSend({ action: 'set_table_id', tableId: event.data.tableId });
    }
});


