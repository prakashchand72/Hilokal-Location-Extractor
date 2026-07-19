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
    return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Deterministic pastel colour from a name, for the avatar fallback circle.
function hue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
}

// Hilokal name-colour themes → readable hex (both light & dark).
const NAME_COLORS = {
    BLUE: '#3b82f6', PURPLE: '#8b5cf6', RED: '#ef4444', GREEN: '#10b981',
    YELLOW: '#ca8a04', GOLD: '#ca8a04', PINK: '#ec4899', ORANGE: '#f97316', CYAN: '#0891b2',
};
function nameColor(c) { return NAME_COLORS[(c || '').toUpperCase()] || ''; }

// Hilokal genders are German-coded: M = male, W = weiblich (female), O = other.
// (We also accept 'F' just in case.) Normalise to M / F / O.
function genderKey(g) {
    g = (g || '').toUpperCase();
    if (g === 'M') return 'M';
    if (g === 'W' || g === 'F') return 'F';
    if (g === 'O') return 'O';
    return '';
}

// On-demand "locate" — scan active lobby tables once, cache the index 30s, and
// look a single person up in it (keyed by user id, falling back to name).
let _locCache = null; // { byId, byName, ts }
function ensureLocate(cb) {
    if (_locCache && Date.now() - _locCache.ts < 30000) { cb(_locCache); return; }
    chrome.runtime.sendMessage({ action: 'locate' }, (res) => {
        if (res && res.ok) { _locCache = { byId: res.byId || {}, byName: res.byName || {}, ts: Date.now() }; cb(_locCache); }
        else cb({ byId: {}, byName: {} });
    });
}
function locateFrom(idx, e) {
    if (e.uid != null && idx.byId[e.uid]) return idx.byId[e.uid];
    const n = (e.name || '').trim().toLowerCase();
    return (n && idx.byName[n]) || null;
}
function copyEntry(e) {
    const g = { M: 'Male', F: 'Female', O: 'Other' }[genderKey(e.gender)] || '';
    const parts = [
        e.name, g && `(${g})`, e.level != null && `Lv${e.level}`, langLine(e),
        e.city, e.role === 'host' && 'host', e.premium && 'premium', e.newUser && 'new',
    ].filter(Boolean).join(' · ');
    return navigator.clipboard.writeText(parts);
}

// ISO-3166 alpha-2 → flag emoji (falls back to globe).
function flag(cc) {
    if (!cc || cc.length !== 2 || !/^[a-z]{2}$/i.test(cc)) return '🌍';
    const A = 0x1F1E6;
    return String.fromCodePoint(...[...cc.toUpperCase()].map(c => A + c.charCodeAt(0) - 65));
}

function chips(e) {
    let out = '';
    const g = genderKey(e.gender);
    if (g === 'M') out += `<span class="chip g-m">♂</span>`;
    else if (g === 'F') out += `<span class="chip g-f">♀</span>`;
    else if (g === 'O') out += `<span class="chip g-o">⚧</span>`;
    if (e.level != null) out += `<span class="chip lvl">Lv${esc(e.level)}</span>`;
    if (e.role === 'host') out += `<span class="chip host">HOST</span>`;
    if (e.teacher) out += `<span class="chip tchr">🎓</span>`;
    if (e.newUser) out += `<span class="chip new">NEW</span>`;
    if (e.badge === 'birthday') out += `<span class="chip bday">🎂</span>`;
    if (e.premium) out += `<span class="chip prem">★</span>`;
    return out;
}

function langLine(e) {
    const n = (e.native || '').trim(), t = (e.target || '').trim();
    if (n && t) return `${esc(n)}→${esc(t)}`;
    if (n) return esc(n);
    if (t) return `→${esc(t)}`;
    return '';
}

function buildRow(e) {
    const li = document.createElement('li');
    const initial = esc((e.name || '?').trim().charAt(0).toUpperCase() || '?');

    // Avatar: photo if we have one (fallback to coloured initial on load error).
    const av = document.createElement(e.avatar ? 'img' : 'div');
    av.className = 'avatar';
    if (e.avatar) {
        av.src = e.avatar;
        av.alt = '';
        av.addEventListener('error', () => {
            const d = document.createElement('div');
            d.className = 'avatar';
            d.style.background = `hsl(${hue(e.name || '')} 55% 55%)`;
            d.textContent = initial;
            av.replaceWith(d);
        });
    } else {
        av.style.background = `hsl(${hue(e.name || '')} 55% 55%)`;
        av.textContent = initial;
    }

    const info = document.createElement('div');
    info.className = 'pinfo';
    const langs = langLine(e);
    const col = nameColor(e.color);
    info.innerHTML =
        `<div class="prow1"><span class="name"${col ? ` style="color:${col}"` : ''}>${esc(e.name)}</span>${chips(e)}</div>` +
        `<div class="prow2"><span class="city">${flag(e.country)} ${esc(e.city)}</span>` +
        (langs ? `<span class="langs">${langs}</span>` : '') +
        `</div>`;

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const main = document.createElement('div');
    main.className = 'rowmain';
    main.append(av, info, time);

    const tray = document.createElement('div');
    tray.className = 'tray';

    li.append(main, tray);
    main.title = 'Click for actions (locate · join · copy)';
    let built = false;
    main.addEventListener('click', () => {
        const opening = !tray.classList.contains('open');
        tray.classList.toggle('open');
        if (opening && !built) { built = true; buildTray(tray, e); }
    });
    return li;
}

// The per-person action tray: 📍 Locate, 📋 Copy — and Join once located.
function buildTray(tray, e) {
    tray.innerHTML = '';
    const status = document.createElement('span'); status.className = 'tray-status';
    const bLoc = document.createElement('button'); bLoc.className = 'tbtn'; bLoc.textContent = '📍 Locate';
    const bCopy = document.createElement('button'); bCopy.className = 'tbtn'; bCopy.textContent = '📋 Copy';
    tray.append(bLoc, bCopy, status);

    bCopy.addEventListener('click', () => {
        copyEntry(e).then(() => { bCopy.textContent = '✓ Copied'; setTimeout(() => { bCopy.textContent = '📋 Copy'; }, 1200); });
    });

    bLoc.addEventListener('click', () => {
        bLoc.disabled = true; status.textContent = 'Scanning lobby…';
        ensureLocate((idx) => {
            bLoc.disabled = false;
            const info = locateFrom(idx, e);
            if (!info) { status.textContent = 'Not on stage in any active table'; return; }
            tray.innerHTML = '';
            const cap = (info.count != null && info.limit != null) ? ` (${info.count}/${info.limit})` : '';
            const label = document.createElement('span'); label.className = 'ploc';
            label.textContent = `📍 ${info.topic}${cap}`;
            const isPublic = (info.visibility || 'public') === 'public';
            const jb = document.createElement('button');
            jb.className = 'tbtn join' + (isPublic ? '' : ' priv');
            jb.textContent = isPublic ? 'Join ↗' : 'Private';
            if (isPublic) {
                jb.addEventListener('click', () => {
                    jb.textContent = 'Joining…';
                    chrome.runtime.sendMessage({ action: 'join_table', callId: info.callId, topic: info.topic }, (res) => {
                        jb.textContent = (res && res.ok) ? 'Opening ↗' : 'Join ↗';
                        if (res && !res.ok) jb.title = res.error || 'Failed';
                    });
                });
            }
            tray.append(label, jb, bCopy);
        });
    });
}

// ── Stats + filters ─────────────────────────────────────────────────────────
let activeFilter = 'all';

function matchesFilter(e) {
    switch (activeFilter) {
        case 'host':    return e.role === 'host';
        case 'new':     return !!e.newUser;
        case 'premium': return !!e.premium;
        case 'teacher': return !!e.teacher;
        case 'male':    return genderKey(e.gender) === 'M';
        case 'female':  return genderKey(e.gender) === 'F';
        default:        return true;
    }
}

function renderStats(entries) {
    const statsEl = document.getElementById('stats');
    if (!entries.length) { statsEl.textContent = ''; return; }
    let m = 0, f = 0, o = 0, host = 0, nw = 0, prem = 0, tchr = 0, lvlSum = 0, lvlN = 0;
    const countries = {};
    for (const e of entries) {
        const g = genderKey(e.gender);
        if (g === 'M') m++; else if (g === 'F') f++; else if (g === 'O') o++;
        if (e.role === 'host') host++;
        if (e.newUser) nw++;
        if (e.premium) prem++;
        if (e.teacher) tchr++;
        if (e.level != null) { lvlSum += Number(e.level); lvlN++; }
        if (e.country) countries[e.country] = (countries[e.country] || 0) + 1;
    }
    const avg = lvlN ? (lvlSum / lvlN).toFixed(1) : '—';
    const topC = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([c, n]) => `${flag(c)}${n}`).join(' ');
    const bits = [
        `👥<b>${entries.length}</b>`,
        (m || f || o) ? `♂${m} ♀${f}${o ? ' ⚧' + o : ''}` : '',
        host ? `👑<b>${host}</b>` : '',
        nw ? `🆕${nw}` : '',
        prem ? `⭐${prem}` : '',
        tchr ? `🎓${tchr}` : '',
        `avg <b>Lv${avg}</b>`,
    ].filter(Boolean);
    statsEl.innerHTML = bits.join(' · ') + (topC ? `<br>${topC}` : '');
}

// Level-distribution "Room DNA" bar. Colours ramp green→blue→purple by level.
const LVL_COLORS = ['#64748b', '#10b981', '#22c55e', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7'];
function renderDNA(entries) {
    const bar = document.getElementById('dna');
    const legend = document.getElementById('dna-legend');
    if (!bar) return;
    const buckets = {};
    let withLvl = 0;
    for (const e of entries) {
        if (e.level == null) continue;
        const lv = Math.min(6, Math.max(0, Number(e.level)));
        buckets[lv] = (buckets[lv] || 0) + 1;
        withLvl++;
    }
    bar.innerHTML = ''; legend.innerHTML = '';
    if (!withLvl) { document.getElementById('dna-wrap').style.display = 'none'; return; }
    document.getElementById('dna-wrap').style.display = 'block';
    for (let lv = 0; lv <= 6; lv++) {
        const n = buckets[lv] || 0;
        if (!n) continue;
        const seg = document.createElement('div');
        seg.className = 'seg';
        seg.style.width = (n / withLvl * 100) + '%';
        seg.style.background = LVL_COLORS[lv];
        seg.title = `Lv${lv}: ${n}`;
        bar.appendChild(seg);
        const lg = document.createElement('span');
        lg.innerHTML = `<i style="background:${LVL_COLORS[lv]}"></i>Lv${lv} ${n}`;
        legend.appendChild(lg);
    }
}

const SORTS = {
    recent:       (a, b) => b.ts - a.ts,
    'level-desc': (a, b) => (b.level ?? -1) - (a.level ?? -1),
    'level-asc':  (a, b) => (a.level ?? 99) - (b.level ?? 99),
    name:         (a, b) => (a.name || '').localeCompare(b.name || ''),
    country:      (a, b) => (a.country || 'zz').localeCompare(b.country || 'zz'),
};
let sortBy = 'recent';

function applyFilter() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = allEntries.filter(e => {
        if (!matchesFilter(e)) return false;
        if (!q) return true;
        return (e.name || '').toLowerCase().includes(q) ||
               (e.city || '').toLowerCase().includes(q) ||
               (e.country || '').toLowerCase().includes(q);
    });
    filtered.sort(SORTS[sortBy] || SORTS.recent);

    renderStats(allEntries);
    renderDNA(allEntries);
    list.innerHTML = '';

    if (!allEntries.length) {
        empty.textContent = 'No participants yet. Join a group call on Hilokal.';
        empty.style.display = 'block';
        count.textContent = '';
        return;
    }

    if (!filtered.length) {
        empty.textContent = q ? `No match for "${searchInput.value}"` : 'None match this filter.';
        empty.style.display = 'block';
        count.textContent = `0 / ${allEntries.length}`;
        return;
    }

    empty.style.display = 'none';
    count.textContent = (q || activeFilter !== 'all')
        ? `${filtered.length} / ${allEntries.length}`
        : `${allEntries.length} participant${allEntries.length !== 1 ? 's' : ''}`;

    const frag = document.createDocumentFragment();
    filtered.forEach(e => frag.appendChild(buildRow(e)));
    list.appendChild(frag);
}

// Filter-chip clicks
document.querySelectorAll('.fchip').forEach(btn => {
    btn.addEventListener('click', () => {
        activeFilter = btn.dataset.f;
        document.querySelectorAll('.fchip').forEach(b => b.classList.toggle('active', b === btn));
        applyFilter();
    });
});

// Sort control
document.getElementById('sort').addEventListener('change', (e) => {
    sortBy = e.target.value;
    applyFilter();
});


// ── Live auto-refresh: poll the background for new participants while open ────
setInterval(() => {
    chrome.runtime.sendMessage({ action: 'get_entries' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        callIdSpan.textContent = res.callId || '—';
        callIdSpan.classList.toggle('live', !!res.callId);
        btnSeat.disabled = !res.callId;
        document.querySelectorAll('.btn-burst').forEach(b => b.disabled = !res.callId);
        const changed = (res.entries || []).length !== allEntries.length;
        allEntries = res.entries || [];
        searchBar.classList.toggle('visible', allEntries.length > 0);
        // Always refresh stats/DNA; only rebuild the list when the set changed
        if (changed) applyFilter();
        else { renderStats(allEntries); renderDNA(allEntries); }
    });
}, 2500);

function render({ entries = [], callId = null }) {
    callIdSpan.textContent = callId || '—';
    callIdSpan.classList.toggle('live', !!callId);
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
        const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const header = 'Name,Gender,Level,Native,Target,Country,City,Role,Teacher,NewUser,Serious,Premium,Bio,Timestamp';
        const csv = header + '\n' + entries.map(e => [
            e.name, e.gender, e.level, e.native, e.target, e.country, e.city, e.role,
            e.teacher ? 'yes' : '', e.newUser ? 'yes' : '', e.serious ? 'yes' : '',
            e.premium ? 'yes' : '', e.bio, new Date(e.ts).toISOString(),
        ].map(q).join(',')).join('\n');
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

// ── Image upload ──────────────────────────────────────────────────────────────

const imgFileInput = document.getElementById('img-file');
const btnImgUpload = document.getElementById('btn-img-upload');
const imgStatus    = document.getElementById('img-status');

function setImgStatus(ok, msg) {
    imgStatus.textContent = msg;
    imgStatus.className = ok ? 'ok' : 'err';
    if (ok) setTimeout(() => { imgStatus.textContent = ''; imgStatus.className = ''; }, 4000);
}

btnImgUpload.addEventListener('click', async () => {
    const file   = imgFileInput.files[0];
    const callId = callIdSpan.textContent;

    if (!file)                    { setImgStatus(false, 'Pick an image first.'); return; }
    if (!callId || callId === '—') { setImgStatus(false, 'No call ID — join a table first.'); return; }

    btnImgUpload.disabled = true;
    setImgStatus(true, 'Getting upload credentials…');

    try {
        // Step 1: get S3 presigned credentials
        const authRes = await fetch('https://elb.hilokal.com/s3-upload-auth', {
            method: 'POST',
            credentials: 'include',
            headers: { 'accept': 'application/json', 'content-type': 'application/json' },
            referrer: 'https://www.hilokal.com/',
            body: JSON.stringify({ pathname: file.name, contentType: file.type }),
        });
        if (!authRes.ok) throw new Error(`Auth failed: ${authRes.status}`);
        const auth = await authRes.json();

        // Step 2: upload file to S3
        setImgStatus(true, 'Uploading image…');
        const form = new FormData();
        Object.entries(auth.fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);

        const s3Res = await fetch(auth.url, { method: 'POST', body: form });
        if (s3Res.status !== 204) throw new Error(`S3 upload failed: ${s3Res.status}`);

        const imageUrl = `${auth.url}/${auth.fields.key}`;

        // Step 3: post image message to table chat
        setImgStatus(true, 'Sending to chat…');
        const msgRes = await fetch(`https://elb.hilokal.com/group-call/${callId}/messages`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'accept': 'application/json', 'content-type': 'application/json' },
            referrer: 'https://www.hilokal.com/',
            body: JSON.stringify({ body: '', type: 'image', parentId: null, image: imageUrl, imageWidth: 1200, imageHeight: 1800 }),
        });
        if (!msgRes.ok) throw new Error(`Message failed: ${msgRes.status}`);

        setImgStatus(true, '✓ Image sent to chat!');
        imgFileInput.value = '';
    } catch (err) {
        setImgStatus(false, `✗ ${err.message}`);
    } finally {
        btnImgUpload.disabled = false;
    }
});

// ── Clear ─────────────────────────────────────────────────────────────────────

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
