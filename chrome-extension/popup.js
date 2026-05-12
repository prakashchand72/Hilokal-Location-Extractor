const list       = document.getElementById('list');
const empty      = document.getElementById('empty');
const count      = document.getElementById('count');
const callIdSpan = document.getElementById('call-id');
const btnSeat    = document.getElementById('btn-seat');
const seatStatus = document.getElementById('seat-status');
const btnCopy    = document.getElementById('btn-copy');
const btnClear   = document.getElementById('btn-clear');

function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function render({ entries = [], callId = null }) {
    // Call ID bar
    callIdSpan.textContent = callId || '—';
    btnSeat.disabled = !callId;

    // Participants list
    list.innerHTML = '';
    if (!entries.length) {
        empty.style.display = 'block';
        count.textContent = '';
        return;
    }
    empty.style.display = 'none';
    count.textContent = `${entries.length} participant${entries.length !== 1 ? 's' : ''}`;
    entries.forEach(({ name, city, ts }) => {
        const li = document.createElement('li');
        li.innerHTML =
            `<span class="name">${esc(name)}</span>` +
            `<span class="city">🌍 ${esc(city)}</span>` +
            `<span class="time">${new Date(ts).toLocaleTimeString()}</span>`;
        list.appendChild(li);
    });
}

// Load on open
chrome.runtime.sendMessage({ action: 'get_entries' }, render);

// Seat request
btnSeat.addEventListener('click', () => {
    btnSeat.disabled = true;
    seatStatus.textContent = 'Sending…';
    seatStatus.className = '';

    chrome.runtime.sendMessage({ action: 'seat_request' }, ({ ok, callId, error }) => {
        btnSeat.disabled = false;
        if (ok) {
            seatStatus.textContent = `✓ Seat requested for call ${callId}`;
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
    render({ entries: [], callId: callIdSpan.textContent !== '—' ? callIdSpan.textContent : null });
    seatStatus.textContent = '';
});
