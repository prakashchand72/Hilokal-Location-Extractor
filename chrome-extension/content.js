// Isolated-world bridge running inside www.hilokal.com page context.

function safeSend(msg) {
    try { chrome.runtime.sendMessage(msg); } catch (_) {}
}

// Relay WebSocket events from inject.js (main world) to the background SW
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === '__HILOKAL_GCC__') {
        const d = event.data;
        safeSend({
            action: 'gcc_entry',
            uid: d.uid, name: d.name, city: d.city, country: d.country,
            gender: d.gender, level: d.level, native: d.native, target: d.target,
            role: d.role, badge: d.badge, newUser: d.newUser, serious: d.serious,
            premium: d.premium, teacher: d.teacher, color: d.color,
            avatar: d.avatar, bio: d.bio, ts: d.ts,
        });
    }
    if (event.data.type === '__HILOKAL_CALL_ID__') {
        safeSend({ action: 'set_call_id', callId: event.data.callId });
    }
    if (event.data.type === '__HILOKAL_TABLE_ID__') {
        safeSend({ action: 'set_table_id', tableId: event.data.tableId });
    }
});

// ── Auto-join a table by driving the lobby UI ────────────────────────────────
// Joining is a WebSocket + audio handshake with no URL/HTTP hook, so the only
// reliable trigger is clicking the real "Listen" button. We find the table card
// by its topic text and click it, scrolling the lobby to reveal off-screen cards.
function _norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

function _listenButtons(root) {
    return [...(root || document).querySelectorAll('button')]
        .filter(b => /^\s*listen\s*$/i.test(b.textContent || ''));
}

function _tryClickTable(topic) {
    const t = _norm(topic);
    if (!t) return false;
    for (const btn of _listenButtons(document)) {
        // Grow to the largest ancestor that still contains ONLY this Listen button
        // — that's the single table card. Matching topic text within just that
        // card avoids hitting a multi-card wrapper (which contains every topic).
        let card = btn, node = btn.parentElement, depth = 0;
        while (node && depth < 12) {
            if (_listenButtons(node).length > 1) break; // node now spans multiple cards
            card = node; node = node.parentElement; depth++;
        }
        if (_norm(card.textContent).includes(t)) { btn.click(); return true; }
    }
    return false;
}

function _runJoin(topic, callId) {
    if (!/group-table/.test(location.pathname)) {
        // Not on the lobby list yet — go there; the pending-join check resumes after load.
        location.href = 'https://www.hilokal.com/en/lobby/group-table';
        return;
    }
    let tries = 0;
    const iv = setInterval(() => {
        tries++;
        if (_tryClickTable(topic)) { clearInterval(iv); chrome.storage.local.remove("pendingJoin"); return; }
        // Reveal more cards (the lobby list is virtualised).
        const sc = document.scrollingElement || document.documentElement;
        if (sc) sc.scrollTop += 700;
        window.scrollBy(0, 700);
        if (tries > 20) { clearInterval(iv); chrome.storage.local.remove("pendingJoin"); }
    }, 600);
}

chrome.runtime.onMessage.addListener((m) => {
    if (m && m.action === 'do_join') _runJoin(m.topic, m.callId);
});

// Resume a pending join after the lobby (re)loads.
try {
    chrome.storage.local.get("pendingJoin", ({ pendingJoin }) => {
        if (!pendingJoin) return;
        if (Date.now() - pendingJoin.ts > 30000) { chrome.storage.local.remove("pendingJoin"); return; }
        setTimeout(() => _runJoin(pendingJoin.topic, pendingJoin.callId), 1500);
    });
} catch (_) {}


