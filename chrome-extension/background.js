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
        ensureInit().then(() => {
            if (!currentCallId) {
                sendResponse({ ok: false, error: 'No call ID detected yet — join a group call first, then try again.' });
                return;
            }

            const getCookie = (url) =>
                new Promise(r => chrome.cookies.get({ url, name: 'jwt' }, r));
            const getAllCookies = () =>
                new Promise(r => chrome.cookies.getAll({ name: 'jwt' },
                    cs => r((cs || []).find(c => c.domain.includes('hilokal')) || null)));

            Promise.all([
                getCookie('https://www.hilokal.com'),
                getCookie('https://hilokal.com'),
                getCookie('https://elb.hilokal.com'),
                getAllCookies(),
            ]).then(results => {
                const cookie = results.find(Boolean);
                if (!cookie) {
                    sendResponse({ ok: false, error: 'Not logged in — jwt cookie not found.' });
                    return;
                }

                fetch(`https://elb.hilokal.com/group-calls/${currentCallId}/seat-request`, {
                    method: 'PUT',
                    headers: {
                        'accept':       'application/json',
                        'content-type': 'application/json',
                        'cookie':       `jwt=${cookie.value}`,
                        'origin':       'https://www.hilokal.com',
                        'referer':      'https://www.hilokal.com/',
                    },
                    body: '{}',
                })
                .then(async (res) => {
                    const text = await res.text().catch(() => '');
                    if (res.ok) {
                        sendResponse({ ok: true, callId: currentCallId });
                    } else if (res.status === 401 || res.status === 403) {
                        sendResponse({ ok: false, error: 'Not authorised — are you logged in to Hilokal?' });
                    } else {
                        sendResponse({ ok: false, error: `Server ${res.status}: ${text}` });
                    }
                })
                .catch(err => sendResponse({ ok: false, error: String(err) }));
            });
        });
        return true;
    }
});
