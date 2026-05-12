// In-memory state for race-free dedup.
let entries = [];
const seen = new Set();
let currentCallId = null;
let activeTabId = null;  // tab ID of the most recent hilokal content script message

let initPromise = null;
function ensureInit() {
    if (!initPromise) {
        initPromise = chrome.storage.session
            .get(['entries', 'callId'])
            .then(({ entries: saved = [], callId }) => {
                for (const e of saved) {
                    const key = e.name + '|' + e.city;
                    if (!seen.has(key)) { seen.add(key); entries.push(e); }
                }
                if (callId) currentCallId = callId;
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

    // Track which tab the user is currently active on
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
                sendResponse({ ok: false, error: 'No group call ID detected yet. Navigate to a group call page first.' });
                return;
            }
            if (!activeTabId) {
                sendResponse({ ok: false, error: 'No active Hilokal tab found. Make sure the Hilokal tab is open.' });
                return;
            }
            // Delegate the actual fetch to content.js, which runs inside
            // www.hilokal.com and carries the page's full cookie context.
            chrome.tabs.sendMessage(
                activeTabId,
                { action: 'do_seat_request', callId: currentCallId },
                (result) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ ok: false, error: 'Could not reach Hilokal tab — try refreshing it.' });
                    } else {
                        sendResponse(result ? { ...result, callId: currentCallId } : { ok: false, error: 'No response from page.' });
                    }
                }
            );
        });
        return true;
    }
});
