// Contrail: pick a destination about as far as you want to focus, board, and the
// flight is your timer. Land and you've done the work.
import { call, native } from './api.js';
import { distanceKm, along, flightMinutes, destinationsFor, nearestAirport, flightNumber, fmtDuration } from './geo.js';
import { loadWorld, drawFlight, drawLog } from './map.js';
import * as log from './logbook.js';
import { cabin, chime, setVolume } from './sound.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let AIRPORTS = [];
let BY = {};
let COUNTRIES = {};
let prefs = log.prefs();
let duration = 45;
let draft = null; // the flight on the boarding pass
let flight = log.active();
let timer = 0;

// ---------- Data
async function loadAirports() {
  const d = await (await fetch(new URL('../data/airports.json', import.meta.url))).json();
  COUNTRIES = d.countries;
  AIRPORTS = d.airports.map(([iata, name, city, country, lat, lon]) => ({ iata, name, city, country, lat, lon }));
  BY = Object.fromEntries(AIRPORTS.map((a) => [a.iata, a]));
  $('airports').innerHTML = AIRPORTS.map((a) => `<option value="${a.iata} · ${esc(a.city)}">${esc(a.name)}, ${esc(COUNTRIES[a.country] || a.country)}</option>`).join('');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pick = (text) => {
  const code = String(text).trim().slice(0, 3).toUpperCase();
  if (BY[code]) return BY[code];
  const q = String(text).trim().toLowerCase();
  return AIRPORTS.find((a) => a.city.toLowerCase() === q) || AIRPORTS.find((a) => a.city.toLowerCase().startsWith(q) || a.name.toLowerCase().includes(q));
};

/** A first guess at where you are, from your time zone ("Europe/Paris" -> Paris). */
function guessHome() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const city = tz.split('/').pop().replace(/_/g, ' ').toLowerCase();
    const hits = AIRPORTS.filter((a) => a.city.toLowerCase() === city);
    if (hits.length) return hits[0];
  } catch {}
  return BY.LHR || AIRPORTS[0];
}
const home = () => BY[prefs.home] || guessHome();

// ---------- Views
function show(view) {
  document.body.dataset.view = view;
  if (view === 'log') renderLog();
}

// ---------- Departures board
const DURATIONS = [25, 45, 60, 90, 120, 180, 300];
function renderDurations() {
  $('durations').innerHTML =
    DURATIONS.map((m) => `<button data-min="${m}" class="${m === duration ? 'on' : ''}">${fmtDuration(m)}</button>`).join('') +
    `<label class="custom">Other <input type="number" id="custom-min" min="10" max="900" step="5" value="${DURATIONS.includes(duration) ? '' : duration}" placeholder="min"></label>`;
}
$('durations').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  duration = Number(b.dataset.min);
  renderDurations();
  renderBoard();
});
$('durations').addEventListener('change', (e) => {
  if (e.target.id !== 'custom-min') return;
  const v = Math.round(Number(e.target.value));
  if (v >= 10) {
    duration = Math.min(900, v);
    renderDurations();
    renderBoard();
  }
});

function gateFor(code) {
  let h = 0;
  for (const c of code) h = (h * 17 + c.charCodeAt(0)) % 997;
  return `${'ABCDE'[h % 5]}${(h % 38) + 1}`;
}

let boardList = [];
function renderBoard(shuffle = false) {
  const from = home();
  $('here-city').textContent = from.city;
  $('here-code').textContent = from.iata;
  if (!boardList.length || shuffle || boardList.duration !== duration || boardList.from !== from.iata) {
    boardList = destinationsFor(from, AIRPORTS, duration, 8);
    boardList.duration = duration;
    boardList.from = from.iata;
  }
  $('dep-empty').hidden = boardList.length > 0;
  $('departures').innerHTML = boardList
    .map((a, i) => {
      const m = flightMinutes(distanceKm(from, a));
      return `<button class="dep" data-iata="${a.iata}" style="--i:${i}">
        <span class="flap">${flightNumber(from.iata, a.iata)}</span>
        <span class="flap dest"><b>${esc(a.city)}</b> <small>${a.iata} · ${esc(COUNTRIES[a.country] || a.country)}</small></span>
        <span class="flap">${fmtDuration(m)}</span>
        <span class="flap">${gateFor(a.iata)}</span>
        <span class="status">Boarding</span>
      </button>`;
    })
    .join('');
}
$('departures').addEventListener('click', (e) => {
  const b = e.target.closest('.dep');
  if (b) openPass(BY[b.dataset.iata]);
});
$('shuffle').addEventListener('click', () => renderBoard(true));
$('dest').addEventListener('change', (e) => {
  const a = pick(e.target.value);
  if (a && a.iata !== home().iata) {
    e.target.value = '';
    openPass(a);
  }
});

// ---------- Boarding pass
function seatNumber(kind) {
  const row = 8 + Math.floor(Math.random() * 30);
  const letter = kind === 'window' ? (Math.random() < 0.5 ? 'A' : 'F') : Math.random() < 0.5 ? 'C' : 'D';
  return `${row}${letter}`;
}
function openPass(to) {
  const from = home();
  const km = distanceKm(from, to);
  const minutes = flightMinutes(km);
  draft = { from, to, km, minutes, number: flightNumber(from.iata, to.iata), gate: gateFor(to.iata), seat: seatNumber(prefs.seat) };
  renderPass();
  show('pass');
}
function renderPass() {
  const d = draft;
  const now = new Date();
  $('p-from').textContent = d.from.iata;
  $('p-from-city').textContent = d.from.city;
  $('p-to').textContent = d.to.iata;
  $('p-to-city').textContent = d.to.city;
  $('p-name').textContent = (prefs.name || 'Passenger').toUpperCase();
  $('p-flight').textContent = d.number;
  $('p-date').textContent = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase();
  $('p-dur').textContent = fmtDuration(d.minutes);
  $('p-gate').textContent = d.gate;
  $('p-seat').textContent = d.seat;
  $('p-arrive').textContent = new Date(now.getTime() + d.minutes * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('p-km').textContent = `${Math.round(d.km).toLocaleString()} km`;
  for (const b of $('seat-pick').children) b.classList.toggle('on', b.dataset.seat === prefs.seat);
  barcode($('barcode'), d.number + d.seat);
}
$('seat-pick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  prefs = { ...prefs, seat: b.dataset.seat };
  log.savePrefs(prefs);
  draft.seat = seatNumber(prefs.seat);
  renderPass();
});
function barcode(cv, text) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1c2230';
  let x = 4;
  let seed = 0;
  for (const c of text) seed = (Math.imul(seed, 33) + c.charCodeAt(0)) >>> 0;
  while (x < cv.width - 4) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const w = 1 + (seed >> 16) % 3;
    if ((seed >> 8) & 1) g.fillRect(x, 4, w, cv.height - 8);
    x += w + 1;
  }
}
$('pass-back').addEventListener('click', () => show('board'));
$('board-btn').addEventListener('click', () => takeOff());

// ---------- Flight
const PHASES = [
  [0, 'Taxiing'],
  [0.04, 'Taking off'],
  [0.08, 'Climbing'],
  [0.18, 'Cruising'],
  [0.86, 'Descending'],
  [0.97, 'Landing'],
];
const ANNOUNCE = [
  [0.0, (f) => `Welcome aboard ${f.number} to ${f.to.city}. Phones on airplane mode, please. Time to focus.`],
  [0.18, () => "We've reached cruising altitude. Settle in, it's a calm flight."],
  [0.5, (f) => `We're halfway to ${f.to.city}. You're doing great.`],
  [0.86, (f) => `We've started our descent into ${f.to.city}. Start wrapping up what you're on.`],
];
const phase = (t) => PHASES.filter(([at]) => t >= at).pop()[1];
function altitudeFt(t) {
  if (t < 0.04) return 0;
  if (t < 0.18) return Math.round((((t - 0.04) / 0.14) * 36000) / 100) * 100;
  if (t < 0.86) return 36000;
  if (t < 0.99) return Math.round(((1 - (t - 0.86) / 0.13) * 36000) / 100) * 100;
  return 0;
}
function speedKmh(t) {
  if (t < 0.04) return Math.round(30 + t * 2000);
  if (t < 0.18) return Math.round(280 + ((t - 0.04) / 0.14) * 560);
  if (t < 0.86) return 840 + Math.round(Math.sin(t * 60) * 12);
  return Math.round(840 - ((t - 0.86) / 0.14) * 590);
}
const progress = (f, now = Date.now()) => Math.min(1, Math.max(0, (now - f.start) / (f.minutes * 60000)));

function takeOff() {
  const t = params.has('fast') ? 0.02 : 1; // ?fast speeds things up in the preview
  flight = { ...draft, from: pickFields(draft.from), to: pickFields(draft.to), start: Date.now(), minutes: draft.minutes * t, said: [] };
  log.setActive(flight);
  enterFlight();
}
const pickFields = (a) => ({ iata: a.iata, city: a.city, name: a.name, country: a.country, lat: a.lat, lon: a.lon });

function enterFlight() {
  show('flight');
  $('f-number').textContent = `${flight.number} · Seat ${flight.seat}`;
  $('f-from').textContent = flight.from.iata;
  $('f-to').textContent = flight.to.iata;
  $('f-cities').textContent = `${flight.from.city} to ${flight.to.city}`;
  $('f-tzcity').textContent = flight.to.city;
  if (prefs.sound) cabin(true, prefs.volume);
  $('sound').textContent = prefs.sound ? '🔊' : '🔈';
  if (prefs.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  clearInterval(timer);
  tick();
  timer = setInterval(tick, 1000);
}

// The destination's local time, from its longitude: close enough for a seatback screen.
function localTimeAt(lon) {
  const d = new Date(Date.now() + Math.round(lon / 15) * 3600000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

// How much of the map the panels cover, so the route is drawn in the clear part.
function hudInset() {
  const h = $('flight').clientHeight;
  const top = document.querySelector('.hud.top-left');
  const bottom = document.querySelector('.hud.bottom');
  return {
    top: top.offsetParent ? top.offsetTop + top.offsetHeight : 40,
    bottom: h - bottom.offsetTop,
  };
}

function tick() {
  if (!flight) return;
  const t = progress(flight);
  const leftMs = Math.max(0, flight.start + flight.minutes * 60000 - Date.now());
  const s = Math.ceil(leftMs / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  $('f-left').textContent = hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  $('f-phase').textContent = phase(t);
  $('f-bar').style.width = `${t * 100}%`;
  $('f-dot').style.left = `${t * 100}%`;
  $('f-alt').textContent = `${altitudeFt(t).toLocaleString()} ft`;
  $('f-speed').textContent = `${speedKmh(t)} km/h`;
  $('f-km').textContent = `${Math.round(flight.km * (1 - t)).toLocaleString()} km`;
  $('f-local').textContent = localTimeAt(flight.to.lon);
  document.title = `${$('f-left').textContent} to ${flight.to.city} · Contrail`;
  drawFlight($('map'), flight.from, flight.to, t, hudInset());
  if (prefs.announce) {
    for (const [at, text] of ANNOUNCE) {
      if (t >= at && !flight.said.includes(at) && t - at < 0.05) {
        flight.said.push(at);
        log.setActive(flight);
        announce(text(flight));
      } else if (t - at >= 0.05 && !flight.said.includes(at)) flight.said.push(at); // missed while closed
    }
  }
  if (t >= 1) land('landed');
}

let announceTimer = 0;
function announce(text) {
  if (prefs.sound) chime(prefs.volume);
  const el = $('announce');
  el.innerHTML = `<small>From the flight deck</small>${esc(text)}`;
  el.hidden = false;
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => (el.hidden = true), 9000);
}

function land(status) {
  clearInterval(timer);
  const f = flight;
  const t = progress(f);
  let to = f.to;
  if (status === 'diverted') {
    const here = along(f.from, f.to, t);
    to = pickFields(nearestAirport(here, AIRPORTS.filter((a) => a.iata !== f.from.iata)) || f.from);
  }
  const flownMin = Math.round(((Date.now() - f.start) / 60000) * 10) / 10;
  const entry = { from: f.from, to, plannedTo: f.to, number: f.number, seat: f.seat, start: f.start, end: Date.now(), minutes: f.minutes, flownMin: Math.min(flownMin, f.minutes), flownKm: Math.round(f.km * t), status };
  log.record(entry);
  log.setActive(null);
  flight = null;
  prefs = { ...prefs, home: to.iata };
  log.savePrefs(prefs);
  cabin(false);
  if (native && document.body.classList.contains('mini')) toggleMini(false);
  document.title = 'Contrail';
  showArrival(entry);
  if (status === 'landed' && prefs.notify && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`Welcome to ${to.city}`, { body: `You focused for ${fmtDuration(entry.flownMin)}. Nice flying.` });
    } catch {}
  }
}

$('divert').addEventListener('click', () => {
  $('divert').hidden = true;
  $('divert-confirm').hidden = false;
});
$('divert-no').addEventListener('click', () => {
  $('divert').hidden = false;
  $('divert-confirm').hidden = true;
});
$('divert-yes').addEventListener('click', () => {
  $('divert').hidden = false;
  $('divert-confirm').hidden = true;
  land('diverted');
});
$('sound').addEventListener('click', () => {
  prefs = { ...prefs, sound: !prefs.sound };
  log.savePrefs(prefs);
  cabin(prefs.sound, prefs.volume);
  $('sound').textContent = prefs.sound ? '🔊' : '🔈';
});

async function toggleMini(on = !document.body.classList.contains('mini')) {
  document.body.classList.toggle('mini', on);
  if (native) await call('set_mini', { on });
  if (flight) tick();
}
$('mini').addEventListener('click', () => toggleMini());
$('map').addEventListener('dblclick', () => document.body.classList.contains('mini') && toggleMini(false));

// ---------- Arrival
function stamp(svg, entry) {
  const ok = entry.status === 'landed';
  const color = ok ? '#c2413b' : '#4a5ea8';
  const date = new Date(entry.end).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const tilt = (Math.random() * 16 - 8).toFixed(1);
  svg.innerHTML = `<g transform="rotate(${tilt} 110 110)" fill="none" stroke="${color}" stroke-width="4" opacity="0.88">
    <circle cx="110" cy="110" r="96"/><circle cx="110" cy="110" r="84" stroke-width="2"/>
    <path id="arc" d="M 40 110 A 70 70 0 0 1 180 110" stroke="none"/>
    <text fill="${color}" stroke="none" font-size="17" font-weight="800" letter-spacing="3"><textPath href="#arc" startOffset="50%" text-anchor="middle">${esc(entry.to.city.toUpperCase().slice(0, 18))}</textPath></text>
    <text x="110" y="122" fill="${color}" stroke="none" font-size="40" font-weight="900" text-anchor="middle" letter-spacing="2">${entry.to.iata}</text>
    <text x="110" y="150" fill="${color}" stroke="none" font-size="13" font-weight="700" text-anchor="middle">${date}</text>
    <text x="110" y="172" fill="${color}" stroke="none" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="2">${ok ? 'ARRIVED' : 'DIVERTED'}</text>
  </g>`;
}
function showArrival(entry) {
  stamp($('stamp'), entry);
  const ok = entry.status === 'landed';
  $('a-title').textContent = ok ? `Welcome to ${entry.to.city}` : `Diverted to ${entry.to.city}`;
  $('a-sub').textContent = ok
    ? `You focused for ${fmtDuration(entry.flownMin)} and flew ${entry.flownKm.toLocaleString()} km to ${entry.to.city}${COUNTRIES[entry.to.country] ? `, ${COUNTRIES[entry.to.country]}` : ''}.`
    : `You landed early after ${fmtDuration(entry.flownMin)}. It still counts in your logbook, in a different colour.`;
  $('a-again').textContent = `Fly on from ${entry.to.city}`;
  show('arrived');
}
$('a-again').addEventListener('click', () => {
  renderBoard(true);
  show('board');
});
$('a-log').addEventListener('click', () => show('log'));

// ---------- Logbook
function renderLog() {
  const list = log.flights();
  const s = log.stats(list);
  const tiles = [
    [s.flights, 'flights'],
    [fmtDuration(s.minutes), 'focused'],
    [`${s.km.toLocaleString()} km`, 'flown'],
    [s.countries, s.countries === 1 ? 'country' : 'countries'],
    [s.streak, s.streak === 1 ? 'day streak' : 'day streak'],
  ];
  $('tiles').innerHTML = tiles.map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join('');
  requestAnimationFrame(() => drawLog($('logmap'), list));
  $('log-list').innerHTML = list.length
    ? list
        .slice(0, 60)
        .map(
          (f) => `<div class="row ${f.status}"><span>${new Date(f.end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <b>${f.from.iata} → ${f.to.iata}</b><span>${esc(f.from.city)} to ${esc(f.to.city)}${f.status === 'diverted' ? ` <em>diverted, planned ${esc(f.plannedTo.city)}</em>` : ''}</span><span>${fmtDuration(f.flownMin)}</span></div>`,
        )
        .join('')
    : '<p class="muted">No flights yet. Your first one is on the departures board.</p>';
}
$('open-log').addEventListener('click', () => show('log'));
$('log-back').addEventListener('click', () => show('board'));
let clearArmed = false;
$('log-clear').addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true;
    $('log-clear').textContent = 'Click again to clear';
    setTimeout(() => ((clearArmed = false), ($('log-clear').textContent = 'Clear')), 3000);
    return;
  }
  log.clearLog();
  clearArmed = false;
  $('log-clear').textContent = 'Clear';
  renderLog();
});

// ---------- Settings
function openSettings() {
  $('s-name').value = prefs.name;
  $('s-home').value = `${home().iata} · ${home().city}`;
  $('s-sound').checked = prefs.sound;
  $('s-volume').value = prefs.volume;
  $('s-announce').checked = prefs.announce;
  $('s-notify').checked = prefs.notify;
  $('settings').showModal();
}
$('open-settings').addEventListener('click', openSettings);
$('here').addEventListener('click', openSettings);
$('settings').addEventListener('close', () => {
  const h = pick($('s-home').value);
  prefs = {
    ...prefs,
    name: $('s-name').value.trim(),
    home: h ? h.iata : prefs.home,
    sound: $('s-sound').checked,
    volume: Number($('s-volume').value),
    announce: $('s-announce').checked,
    notify: $('s-notify').checked,
  };
  log.savePrefs(prefs);
  if (prefs.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  renderBoard(true);
});
$('s-volume').addEventListener('input', (e) => setVolume(Number(e.target.value)));

addEventListener('resize', () => {
  if (flight) drawFlight($('map'), flight.from, flight.to, progress(flight), hudInset());
  if (document.body.dataset.view === 'log') drawLog($('logmap'), log.flights());
});

// ---------- Start
await Promise.all([loadAirports(), loadWorld()]);
if (!prefs.home) {
  prefs = { ...prefs, home: guessHome().iata };
  log.savePrefs(prefs);
}
renderDurations();
renderBoard();
if (flight) {
  if (progress(flight) >= 1) land('landed'); // landed while the app was closed
  else enterFlight();
}
window.contrail = { openPass: (code) => openPass(BY[code]), takeOff, show, land, get flight() { return flight; }, BY };
