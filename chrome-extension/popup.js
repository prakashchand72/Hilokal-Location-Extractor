const list        = document.getElementById('list');
const empty       = document.getElementById('empty');
const count       = document.getElementById('count');
const callIdSpan  = document.getElementById('call-id');
const btnSeat     = document.getElementById('btn-seat');
const seatStatus  = document.getElementById('seat-status');
const btnCopy     = document.getElementById('btn-copy');
const btnClear    = document.getElementById('btn-clear');
const searchBar   = document.getElementById('search-bar');
const searchInput = document.getElementById('search');

let allEntries = [];

function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q
        ? allEntries.filter(e => e.name.toLowerCase().includes(q))
        : allEntries;

    list.innerHTML = '';

    if (!allEntries.length) {
        empty.textContent = 'No entries yet. Join a group call on Hilokal.';
        empty.style.display = 'block';
        count.textContent = '';
        return;
    }

    if (!filtered.length) {
        empty.textContent = `No match for "${searchInput.value}"`;
        empty.style.display = 'block';
        count.textContent = `0 of ${allEntries.length}`;
        return;
    }

    empty.style.display = 'none';
    count.textContent = q
        ? `${filtered.length} of ${allEntries.length}`
        : `${allEntries.length} participant${allEntries.length !== 1 ? 's' : ''}`;

    filtered.forEach(({ name, city, ts }) => {
        const li = document.createElement('li');
        li.innerHTML =
            `<span class="name">${esc(name)}</span>` +
            `<span class="city">🌍 ${esc(city)}</span>` +
            `<span class="time">${new Date(ts).toLocaleTimeString()}</span>`;
        list.appendChild(li);
    });
}

function render({ entries = [], callId = null }) {
    callIdSpan.textContent = callId || '—';
    btnSeat.disabled = !callId;
    document.querySelectorAll('.btn-burst').forEach(b => b.disabled = !callId);
    allEntries = entries;
    searchBar.classList.toggle('visible', entries.length > 0);
    applyFilter();
}

searchInput.addEventListener('input', applyFilter);

// Load on open
chrome.runtime.sendMessage({ action: 'get_entries' }, render);

// ── Seat spam (loop runs in background SW, survives popup closing) ─────────

let pollTimer = null;

function setSpamUI(running, count) {
    if (running) {
        btnSeat.textContent = 'Stop';
        btnSeat.style.background = '#c00';
        btnSeat.style.borderColor = '#c00';
        seatStatus.textContent = `Spamming… ✓ ${count} sent`;
        seatStatus.className = 'ok';
    } else {
        btnSeat.textContent = 'Request Seat';
        btnSeat.style.background = '';
        btnSeat.style.borderColor = '';
    }
}

function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'spam_status' }, ({ running, count }) => {
            setSpamUI(running, count);
            if (!running) stopPoll();
        });
    }, 600);
}

function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Sync button state when popup opens
chrome.runtime.sendMessage({ action: 'spam_status' }, ({ running, count }) => {
    setSpamUI(running, count);
    if (running) startPoll();
});

btnSeat.addEventListener('click', () => {
    if (pollTimer) {
        stopPoll();
        chrome.runtime.sendMessage({ action: 'stop_spam' }, ({ count }) => {
            setSpamUI(false, 0);
            seatStatus.textContent = `Stopped — ${count} sent`;
            seatStatus.className = '';
        });
    } else {
        chrome.runtime.sendMessage({ action: 'start_spam' }, ({ ok, error }) => {
            if (!ok) { seatStatus.textContent = `✗ ${error}`; seatStatus.className = 'err'; return; }
            setSpamUI(true, 0);
            startPoll();
        });
    }
});

// Burst buttons — send exactly N requests then stop
document.querySelectorAll('.btn-burst').forEach(btn => {
    btn.addEventListener('click', () => {
        const n = parseInt(btn.dataset.n);
        document.querySelectorAll('.btn-burst').forEach(b => b.disabled = true);
        seatStatus.textContent = `Sending ${n}×…`;
        seatStatus.className = '';
        chrome.runtime.sendMessage({ action: 'send_burst', count: n }, ({ ok, sent, error }) => {
            document.querySelectorAll('.btn-burst').forEach(b => b.disabled = false);
            if (ok) {
                seatStatus.textContent = `✓ Sent ${sent} of ${n}`;
                seatStatus.className = 'ok';
            } else {
                seatStatus.textContent = `✗ ${error}`;
                seatStatus.className = 'err';
            }
        });
    });
});

// Copy CSV
btnCopy.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'get_entries' }, ({ entries = [] }) => {
        if (!entries.length) return;
        const csv = 'Name,City,Timestamp\n' + entries
            .map(e => `"${e.name.replace(/"/g,'""')}","${e.city.replace(/"/g,'""')}","${new Date(e.ts).toISOString()}"`)
            .join('\n');
        navigator.clipboard.writeText(csv).then(() => {
            btnCopy.textContent = 'Copied!';
            setTimeout(() => { btnCopy.textContent = 'Copy CSV'; }, 1500);
        });
    });
});

// ── Birthday ───────────────────────────────────────────────────────────────────

const bdayInput  = document.getElementById('bday-input');
const btnBdaySet = document.getElementById('btn-bday-set');
const btnBdayRem = document.getElementById('btn-bday-remove');
const bdayStatus = document.getElementById('bday-status');

// Default the date picker to today
bdayInput.value = new Date().toISOString().slice(0, 10);

function setBdayUI(ok, msg) {
    bdayStatus.textContent = msg;
    bdayStatus.className = ok ? 'ok' : 'err';
    setTimeout(() => { bdayStatus.textContent = ''; bdayStatus.className = ''; }, 3000);
}

btnBdaySet.addEventListener('click', () => {
    const date = bdayInput.value;
    if (!date) { setBdayUI(false, 'Pick a date first.'); return; }
    btnBdaySet.disabled = true;
    chrome.runtime.sendMessage({ action: 'set_birthday', birthday: date }, ({ ok, error }) => {
        btnBdaySet.disabled = false;
        setBdayUI(ok, ok ? `Birthday set to ${date}` : `✗ ${error}`);
    });
});

btnBdayRem.addEventListener('click', () => {
    btnBdayRem.disabled = true;
    chrome.runtime.sendMessage({ action: 'remove_birthday' }, ({ ok, error }) => {
        btnBdayRem.disabled = false;
        setBdayUI(ok, ok ? 'Birthday removed' : `✗ ${error}`);
    });
});

// ── Birthday flicker ──────────────────────────────────────────────────────────

const btnFlicker = document.getElementById('btn-bday-flicker');
let flickerPollTimer = null;

function setFlickerUI(running, count) {
    if (running) {
        btnFlicker.textContent = `Stop Flicker (${count} toggles)`;
        btnFlicker.classList.add('active');
        bdayStatus.textContent = `Flickering… ${count} toggles`;
        bdayStatus.className = 'ok';
    } else {
        btnFlicker.textContent = 'Flicker (Set ↔ Unset)';
        btnFlicker.classList.remove('active');
    }
}

function startFlickerPoll() {
    if (flickerPollTimer) return;
    flickerPollTimer = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'flicker_status' }, ({ running, count }) => {
            setFlickerUI(running, count);
            if (!running) stopFlickerPoll();
        });
    }, 600);
}

function stopFlickerPoll() {
    if (flickerPollTimer) { clearInterval(flickerPollTimer); flickerPollTimer = null; }
}

// Sync flicker state when popup opens
chrome.runtime.sendMessage({ action: 'flicker_status' }, ({ running, count }) => {
    setFlickerUI(running, count);
    if (running) startFlickerPoll();
});

btnFlicker.addEventListener('click', () => {
    if (flickerPollTimer) {
        stopFlickerPoll();
        chrome.runtime.sendMessage({ action: 'stop_flicker' }, ({ count }) => {
            setFlickerUI(false, 0);
            bdayStatus.textContent = `Flicker stopped — ${count} toggles`;
            bdayStatus.className = '';
        });
    } else {
        chrome.runtime.sendMessage({ action: 'start_flicker' }, ({ ok, error }) => {
            if (!ok) { setBdayUI(false, `✗ ${error}`); return; }
            setFlickerUI(true, 0);
            startFlickerPoll();
        });
    }
});

// Clear
btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_entries' });
    stopPoll();
    chrome.runtime.sendMessage({ action: 'stop_spam' }, () => {});
    searchInput.value = '';
    btnSeat.textContent = 'Request Seat';
    btnSeat.style.background = '';
    btnSeat.style.borderColor = '';
    render({ entries: [], callId: callIdSpan.textContent !== '—' ? callIdSpan.textContent : null });
    seatStatus.textContent = '';
});
