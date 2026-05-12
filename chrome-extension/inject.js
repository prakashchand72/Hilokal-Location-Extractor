// Declared as world:"MAIN" in manifest — runs synchronously at document_start
// in the page's own JS context, before any page script can create a WebSocket.
const OriginalWebSocket = window.WebSocket;

function PatchedWebSocket(url, protocols) {
    // The WebSocket URL itself often contains the group call ID
    if (typeof url === 'string') {
        const m = url.match(/group.calls?[\/=](\d{4,})/i) || url.match(/[\/=](\d{6,})/);
        if (m) window.postMessage({ type: '__HILOKAL_CALL_ID__', callId: m[1] }, '*');
    }

    const ws = protocols
        ? new OriginalWebSocket(url, protocols)
        : new OriginalWebSocket(url);

    ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        if (!event.data.startsWith('42')) return;
        try {
            const [eventName, payload] = JSON.parse(event.data.slice(2));

            // Scan EVERY Socket.IO event for a call ID, not just group-call-card
            const callId = findCallId(payload);
            if (callId) window.postMessage({ type: '__HILOKAL_CALL_ID__', callId }, '*');

            if (eventName !== 'group-call-card') return;
            extractParticipant(payload);
        } catch (_) {}
    });

    return ws;
}

PatchedWebSocket.prototype = OriginalWebSocket.prototype;
Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
window.WebSocket = PatchedWebSocket;

// Recursively search for a group call ID in any payload object.
// Checks common field names first, then recurses into nested objects.
function findCallId(obj, depth) {
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 5) return null;
    const fields = [
        'groupCallId', 'group_call_id',
        'callId',      'call_id',
        'tableId',     'table_id',
        'roomId',      'room_id',
        'groupId',     'group_id',
        'id'
    ];
    for (const f of fields) {
        const v = obj[f];
        if (v && /^\d{5,}$/.test(String(v))) return String(v);
    }
    for (const k in obj) {
        if (typeof obj[k] === 'object') {
            const found = findCallId(obj[k], depth + 1);
            if (found) return found;
        }
    }
    return null;
}

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
