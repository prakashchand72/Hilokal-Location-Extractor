// Declared as world:"MAIN" in manifest — runs synchronously at document_start
// in the page's own JS context, before any page script can create a WebSocket.

// Only read call ID from the emoji endpoint — most reliable source.
const OriginalFetch = window.fetch.bind(window);
window.fetch = function(input, init) {
    try {
        const url = typeof input === 'string' ? input
                  : (input && typeof input.url === 'string') ? input.url : '';
        const m = url.match(/\/group-call\/(\d+)\/emoji/);
        if (m) window.postMessage({ type: '__HILOKAL_CALL_ID__', callId: m[1] }, '*');
    } catch (_) {}
    return OriginalFetch(input, init);
};

const OriginalWebSocket = window.WebSocket;

function PatchedWebSocket(url, protocols) {
    const ws = protocols
        ? new OriginalWebSocket(url, protocols)
        : new OriginalWebSocket(url);

    ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        if (!event.data.startsWith('42')) return;
        try {
            const [eventName, payload] = JSON.parse(event.data.slice(2));
            if (eventName !== 'group-call-card') return;
            extractParticipant(payload);
        } catch (_) {}
    });

    return ws;
}

PatchedWebSocket.prototype = OriginalWebSocket.prototype;
Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
window.WebSocket = PatchedWebSocket;

function extractParticipant(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.name && obj.accessCityName) {
        window.postMessage({
            type: '__HILOKAL_GCC__',
            name: obj.name,
            city: obj.accessCityName,
            ts: Date.now()
        }, '*');
    }

    for (const k in obj) {
        if (typeof obj[k] === 'object') extractParticipant(obj[k]);
    }
}
