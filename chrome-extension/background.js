// In-memory state for race-free dedup.
let entries = [];
const seen = new Set();
let currentCallId  = null;
let currentTableId = null;
let activeTabId = null;

let initPromise = null;
function ensureInit() {
    if (!initPromise) {
        initPromise = chrome.storage.session
            .get(['entries', 'callId', 'tableId'])
            .then(({ entries: saved = [], callId, tableId }) => {
                for (const e of saved) {
                    const key = e.name + '|' + e.city;
                    if (!seen.has(key)) { seen.add(key); entries.push(e); }
                }
                if (callId)  currentCallId  = callId;
                if (tableId) currentTableId = tableId;
                if (entries.length) setBadge(entries.length);
            });
    }
    return initPromise;
}

function setBadge(n) {
    chrome.action.setBadgeText({ text: String(n) });
    chrome.action.setBadgeBackgroundColor({ color: '#4285f4' });
}

// ── Seat request core ────────────────────────────────────────────────────────

function seatFetch(callId) {
    return fetch(`https://elb.hilokal.com/group-calls/${callId}/seat-request`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
            'accept':       'application/json',
            'content-type': 'application/json',
        },
        referrer: 'https://www.hilokal.com/',
        body: '{}',
    }).then(async (res) => {
        const text = await res.text().catch(() => '');
        if (res.ok) return { ok: true };
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'Not authorised' };
        return { ok: false, error: `Server ${res.status}: ${text}` };
    }).catch(err => ({ ok: false, error: String(err) }));
}

// ── Spam state (lives in SW, survives popup closing) ─────────────────────────

let spamTimer   = null;
let spamCount   = 0;
let spamRunning = false;

// Keep the service worker alive while spamming by touching storage every 20s.
let keepAliveTimer = null;
function startKeepAlive() {
    keepAliveTimer = setInterval(() => chrome.storage.session.set({ _ka: Date.now() }), 20000);
}
function stopKeepAlive() {
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

async function spamCycle() {
    if (!spamRunning) return;
    if (!currentCallId) { spamTimer = setTimeout(spamCycle, 1000); return; }
    const res = await seatFetch(currentCallId);
    if (res.ok) spamCount++;
    if (spamRunning) spamTimer = setTimeout(spamCycle, 0);
}

function startSpam() {
    if (spamRunning) return;
    spamRunning = true;
    spamCount   = 0;
    startKeepAlive();
    spamCycle();
}

function stopSpam() {
    spamRunning = false;
    if (spamTimer) { clearTimeout(spamTimer); spamTimer = null; }
    stopKeepAlive();
}

// ── Birthday flicker (set ↔ unset loop, lives in SW) ─────────────────────────

const FLICKER_OLD_DATE   = '2001-06-24';

let flickerTimer   = null;
let flickerCount   = 0;
let flickerRunning = false;
let flickerToday   = null; // set at start time
let flickerPhase   = true; // true = today, false = old date

let flickerKeepAlive = null;
function startFlickerKeepAlive() {
    flickerKeepAlive = setInterval(() => chrome.storage.session.set({ _fka: Date.now() }), 20000);
}
function stopFlickerKeepAlive() {
    if (flickerKeepAlive) { clearInterval(flickerKeepAlive); flickerKeepAlive = null; }
}

async function flickerCycle() {
    if (!flickerRunning) return;
    const date = flickerPhase ? flickerToday : FLICKER_OLD_DATE;
    flickerPhase = !flickerPhase;
    await fetch('https://elb.hilokal.com/users/me', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        referrer: 'https://www.hilokal.com/',
        body: JSON.stringify({ birthday: date }),
    }).catch(() => {});
    flickerCount++;
    if (flickerRunning) flickerTimer = setTimeout(flickerCycle, 0);
}

function startFlicker() {
    if (flickerRunning) return;
    flickerToday   = new Date().toISOString().slice(0, 10);
    flickerRunning = true;
    flickerCount   = 0;
    flickerPhase    = true;
    startFlickerKeepAlive();
    flickerCycle();
}

function stopFlicker() {
    flickerRunning = false;
    if (flickerTimer) { clearTimeout(flickerTimer); flickerTimer = null; }
    stopFlickerKeepAlive();
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    if (sender.tab && sender.tab.id) activeTabId = sender.tab.id;

    if (msg.action === 'gcc_entry') {
        ensureInit().then(() => {
            const key = msg.name + '|' + msg.city;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({ name: msg.name, city: msg.city, ts: msg.ts });
                chrome.storage.session.set({ entries });
                setBadge(entries.length);
            }
        });
        return false;
    }

    if (msg.action === 'set_call_id') {
        ensureInit().then(() => {
            if (msg.callId && msg.callId !== currentCallId) {
                currentCallId = msg.callId;
                chrome.storage.session.set({ callId: currentCallId });
            }
        });
        return false;
    }

    if (msg.action === 'set_table_id') {
        ensureInit().then(() => {
            if (msg.tableId && msg.tableId !== currentTableId) {
                currentTableId = msg.tableId;
                chrome.storage.session.set({ tableId: currentTableId });
            }
        });
        return false;
    }

    if (msg.action === 'get_entries') {
        ensureInit().then(() => sendResponse({ entries, callId: currentCallId }));
        return true;
    }

    if (msg.action === 'clear_entries') {
        entries = [];
        seen.clear();
        initPromise = null;
        chrome.storage.session.set({ entries: [] });
        chrome.action.setBadgeText({ text: '' });
        return false;
    }

    if (msg.action === 'seat_request') {
        ensureInit().then(async () => {
            if (!currentCallId) {
                sendResponse({ ok: false, error: 'No call ID detected yet — join a group call first.' });
                return;
            }
            const result = await seatFetch(currentCallId);
            sendResponse({ ...result, callId: currentCallId });
        });
        return true;
    }

    if (msg.action === 'send_burst') {
        ensureInit().then(async () => {
            if (!currentCallId) {
                sendResponse({ ok: false, error: 'No call ID — join a group call first.' });
                return;
            }
            let sent = 0;
            for (let i = 0; i < msg.count; i++) {
                const res = await seatFetch(currentCallId);
                if (res.ok) sent++;
            }
            sendResponse({ ok: true, sent, total: msg.count });
        });
        return true;
    }

    if (msg.action === 'start_spam') {
        ensureInit().then(() => {
            if (!currentCallId) {
                sendResponse({ ok: false, error: 'No call ID detected yet — join a group call first.' });
                return;
            }
            startSpam();
            sendResponse({ ok: true });
        });
        return true;
    }

    if (msg.action === 'stop_spam') {
        stopSpam();
        sendResponse({ ok: true, count: spamCount });
        return true;
    }

    if (msg.action === 'spam_status') {
        sendResponse({ running: spamRunning, count: spamCount });
        return true;
    }

    if (msg.action === 'start_flicker') {
        startFlicker();
        sendResponse({ ok: true });
        return true;
    }

    if (msg.action === 'stop_flicker') {
        stopFlicker();
        sendResponse({ ok: true, count: flickerCount });
        return true;
    }

    if (msg.action === 'flicker_status') {
        sendResponse({ running: flickerRunning, count: flickerCount });
        return true;
    }

    if (msg.action === 'set_birthday' || msg.action === 'remove_birthday') {
        const body = msg.action === 'set_birthday' ? JSON.stringify({ birthday: msg.birthday }) : '{}';
        fetch('https://elb.hilokal.com/users/me', {
            method: 'PUT',
            credentials: 'include',
            headers: {
                'accept':       'application/json',
                'content-type': 'application/json',
            },
            referrer: 'https://www.hilokal.com/',
            body,
        }).then(async (res) => {
            const text = await res.text().catch(() => '');
            if (res.ok) { sendResponse({ ok: true }); return; }
            if (res.status === 401 || res.status === 403) { sendResponse({ ok: false, error: 'Not authorised' }); return; }
            sendResponse({ ok: false, error: `Server ${res.status}: ${text}` });
        }).catch(err => sendResponse({ ok: false, error: String(err) }));
        return true;
    }
});
