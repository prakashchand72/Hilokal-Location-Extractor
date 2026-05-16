// world:"MAIN" — runs synchronously at document_start in the page's JS context.

// ── parse socket.io frame (handles ack-id prefix) ────────────────────────────
// "42["ev",data]"    → plain event
// "4217["ev",data]"  → event with ack id 17 (the requestId you see in logs)
function _parseSio(raw) {
    if (typeof raw !== 'string' || !raw.startsWith('42')) return null;
    const s = raw.slice(2), i = s.indexOf('[');
    if (i < 0) return null;
    try { return JSON.parse(s.slice(i)); } catch (_) { return null; }
}

// ── fetch intercept (call-id extraction) ─────────────────────────────────────
const OriginalFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
    try {
        const url = typeof input === 'string' ? input
                  : (input && typeof input.url === 'string') ? input.url : '';
        const m = url.match(/\/group-call\/(\d+)\/emoji/);
        if (m) window.postMessage({ type: '__HILOKAL_CALL_ID__', callId: m[1] }, '*');
    } catch (_) {}
    return OriginalFetch(input, init);
};

// ── Ghost Speak: intercept WebRTC APIs ───────────────────────────────────────
// When window.__ghost is true, these block the browser from stopping your mic.

// 1. RTCPeerConnection.close() — blocks whole transport teardown
const _OrigRTC = window.RTCPeerConnection;
window.RTCPeerConnection = new Proxy(_OrigRTC, {
    construct(T, args) {
        const pc = new T(...args);
        const orig = pc.close.bind(pc);
        pc.close = function () {
            if (window.__ghost) { console.warn('[Ghost] ✋ pc.close() blocked'); return; }
            return orig();
        };
        return pc;
    },
});
window.RTCPeerConnection.prototype = _OrigRTC.prototype;

// 2. track.stop()
const _origStop = MediaStreamTrack.prototype.stop;
MediaStreamTrack.prototype.stop = function () {
    if (window.__ghost) { console.warn('[Ghost] ✋ track.stop() blocked'); return; }
    return _origStop.call(this);
};

// 3. track.enabled = false
const _td = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled');
if (_td && _td.set) {
    Object.defineProperty(MediaStreamTrack.prototype, 'enabled', {
        get() { return _td.get.call(this); },
        set(v) {
            if (window.__ghost && !v) { console.warn('[Ghost] ✋ track.enabled=false blocked'); return; }
            _td.set.call(this, v);
        },
        configurable: true,
    });
}

// 4. replaceTrack(null)
const _origRep = RTCRtpSender.prototype.replaceTrack;
RTCRtpSender.prototype.replaceTrack = function (t) {
    if (window.__ghost && t === null) { console.warn('[Ghost] ✋ replaceTrack(null) blocked'); return Promise.resolve(); }
    return _origRep.call(this, t);
};

// 5. removeTrack()
const _origRem = RTCPeerConnection.prototype.removeTrack;
RTCPeerConnection.prototype.removeTrack = function (s) {
    if (window.__ghost) { console.warn('[Ghost] ✋ removeTrack() blocked'); return; }
    return _origRem.call(this, s);
};

// ── WebSocket proxy ───────────────────────────────────────────────────────────
const GHOST_BLOCK = new Set([
    'leave-table',                                          // ← KEY: stops server telling others to close your audio
    'close-transport', 'closeTransport', 'closeWebRtcTransport',
    'closeProducer',   'pauseProducer',
]);

const OriginalWebSocket = window.WebSocket;

function PatchedWebSocket(url, protocols) {
    const ws = protocols
        ? new OriginalWebSocket(url, protocols)
        : new OriginalWebSocket(url);

    const isMed = url.includes('hilokal-media') || url.includes('mediasoup');

    // Intercept outgoing sends — log EVERYTHING when ghost is on, block known events
    const origSend = ws.send.bind(ws);
    ws.send = function (raw) {
        const p = _parseSio(raw);
        if (p) {
            const [ev, pl] = p;
            // Log ALL sends on BOTH sockets when ghost is on so we miss nothing
            if (window.__ghost) {
                console.log('[' + (isMed ? 'media→' : 'main→ ') + ']', JSON.stringify(ev), pl !== undefined ? JSON.stringify(pl).slice(0, 120) : '');
            }
            if (isMed && window.__ghost && GHOST_BLOCK.has(ev)) {
                console.warn('[Ghost] ✋ BLOCKED media emit "' + ev + '"');
                return;
            }
        }
        return origSend(raw);
    };

    // Intercept incoming messages — participant cards + chat
    ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        if (!event.data.startsWith('42')) return;
        const p = _parseSio(event.data);
        if (!p) return;
        const [eventName, payload] = p;
        if (!eventName) return;

        if (isMed && window.__ghost) {
            // Log ALL incoming media events when ghost is on
            console.log('[media←]', JSON.stringify(eventName), payload !== undefined ? JSON.stringify(payload).slice(0, 120) : '');
        }

        if (eventName === 'group-call-card') {
            extractParticipant(payload);
        } else if (payload && payload.userId && (payload.body || payload.message || payload.text)) {
            // Chat message — relay to extension
            window.postMessage({
                type:    '__HILOKAL_CHAT__',
                who:     payload.senderName || ('user#' + payload.userId),
                text:    payload.body || payload.message || payload.text,
                eventName,
            }, '*');
        }
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
            ts:   Date.now(),
        }, '*');
    }
    for (const k in obj) {
        if (typeof obj[k] === 'object') extractParticipant(obj[k]);
    }
}

// ── Ghost toggle (popup communicates via postMessage) ─────────────────────────
window.__ghost = false;
window.ghostOn  = () => { window.__ghost = true;  console.warn('[Ghost] 🟢 ON');  updateGhostBtn(); };
window.ghostOff = () => { window.__ghost = false; console.warn('[Ghost] 🔴 OFF'); updateGhostBtn(); };

window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === '__GHOST_ON')  window.ghostOn();
    if (e.data.type === '__GHOST_OFF') window.ghostOff();
});

// Keyboard shortcut: Ctrl+Shift+G
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        window.__ghost = !window.__ghost;
        updateGhostBtn();
        console.warn('[Ghost]', window.__ghost ? '🟢 ON (Ctrl+Shift+G)' : '🔴 OFF (Ctrl+Shift+G)');
    }
}, true);

// Floating button
let _ghostBtn = null;
function updateGhostBtn() {
    if (!_ghostBtn) return;
    _ghostBtn.textContent      = window.__ghost ? '🎤 Ghost ON'  : '🎤 Ghost OFF';
    _ghostBtn.style.background = window.__ghost ? '#43a047' : '#e53935';
}
function addGhostButton() {
    if (document.getElementById('__hkGhostBtn')) return;
    _ghostBtn = document.createElement('button');
    _ghostBtn.id = '__hkGhostBtn';
    Object.assign(_ghostBtn.style, {
        position: 'fixed', bottom: '80px', right: '16px', zIndex: '2147483647',
        padding: '10px 18px', borderRadius: '24px', border: '2px solid rgba(255,255,255,0.8)',
        color: '#fff', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
        boxShadow: '0 3px 14px rgba(0,0,0,0.6)',
    });
    _ghostBtn.onclick = () => {
        window.__ghost = !window.__ghost;
        updateGhostBtn();
        console.warn('[Ghost]', window.__ghost ? '🟢 ON' : '🔴 OFF');
    };
    updateGhostBtn();
    document.body.appendChild(_ghostBtn);
}

if (document.body) addGhostButton();
else document.addEventListener('DOMContentLoaded', addGhostButton);

console.warn('[Ghost] inject.js loaded — Ctrl+Shift+G or click button bottom-right');
