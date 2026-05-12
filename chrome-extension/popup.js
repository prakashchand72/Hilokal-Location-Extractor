const list       = document.getElementById('list');
const empty      = document.getElementById('empty');
const count      = document.getElementById('count');
const callIdSpan = document.getElementById('call-id');
const btnSeat    = document.getElementById('btn-seat');
const seatStatus = document.getElementById('seat-status');
const btnCopy    = document.getElementById('btn-copy');
const btnClear   = document.getElementById('btn-clear');
const searchBar  = document.getElementById('search-bar');
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
    allEntries = entries;
    searchBar.classList.toggle('visible', entries.length > 0);
    applyFilter();
}

searchInput.addEventListener('input', applyFilter);

// Load on open
chrome.runtime.sendMessage({ action: 'get_entries' }, render);

// Seat request — each click fires independently, count shown in status
let seatSent = 0, seatOk = 0;
btnSeat.addEventListener('click', () => {
    seatSent++;
    seatStatus.textContent = `Sending… (×${seatSent})`;
    seatStatus.className = '';

    chrome.runtime.sendMessage({ action: 'seat_request' }, ({ ok, error }) => {
        if (ok) {
            seatOk++;
            seatStatus.textContent = `✓ ${seatOk} sent`;
            seatStatus.className = 'ok';
        } else {
            seatStatus.textContent = `✗ ${error}`;
            seatStatus.className = 'err';
        }
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

// Clear
btnClear.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_entries' });
    searchInput.value = '';
    seatSent = 0; seatOk = 0;
    render({ entries: [], callId: callIdSpan.textContent !== '—' ? callIdSpan.textContent : null });
    seatStatus.textContent = '';
});
