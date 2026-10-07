const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAY_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

const state = {
  school: null,      // { name, school, server }
  me: null,
  weekStart: mondayOf(new Date()),
  activeDay: null,   // Index der Tagesspalte (mobil)
  other: null,       // gewählter fremder Stundenplan { type, id, name }
  cache: new Map(),  // Schlüssel -> Promise
};

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const untisDate = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const fromUntis = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
const fmtTime = (t) => `${pad(Math.floor(t / 100))}:${pad(t % 100)}`;
const minutes = (t) => Math.floor(t / 100) * 60 + (t % 100);
const nowTime = () => { const n = new Date(); return n.getHours() * 100 + n.getMinutes(); };
const fmtDate = (n) => { const d = fromUntis(n); return `${DAY_NAMES[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`; };
const fmtDateLong = (n) => fromUntis(n).toLocaleDateString('de', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function relDay(n) {
  const diff = Math.round((fromUntis(n) - fromUntis(untisDate(new Date()))) / 86400000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === -1) return 'gestern';
  return diff > 0 ? `in ${diff} Tagen` : `vor ${-diff} Tagen`;
}

function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}

// Jedes Fach bekommt anhand seines Namens immer dieselbe Farbe.
function hue(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Nachrichten von Untis enthalten HTML. Wir zeigen sie nur als Text an.
function htmlToText(html) {
  const prepared = String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  const doc = new DOMParser().parseFromString(prepared, 'text/html');
  return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

async function api(path, options = {}) {
  if (state.static) return staticApi(path);
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/me')) showLogin();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Fehler'), { status: res.status });
  return data;
}

// Antworten zwischenspeichern, damit Blättern und Seitenwechsel schnell gehen.
function load(key, path) {
  if (!state.cache.has(key)) {
    state.cache.set(key, api(path).catch((e) => { state.cache.delete(key); throw e; }));
  }
  return state.cache.get(key);
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

const spinner = (text = 'Wird geladen…') => `<div class="status"><div class="spinner"></div>${esc(text)}</div>`;
const notice = (text, figure = '') => `<div class="status">${figure}${esc(text)}</div>`;

// ---------- Theme ----------

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(store('theme'));
$('#theme-btn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  store('theme', next);
});

// ---------- Login ----------

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  state.cache.clear();
  if (state.static) {
    $('#login-form').hidden = true;
    $('#register-form').hidden = true;
    $('#register-done').hidden = true;
    $('#unlock-form').hidden = false;
    const last = store('lastUser');
    if (last && !$('#unlock-user').value) $('#unlock-user').value = last;
    ($('#unlock-user').value ? $('#unlock-password') : $('#unlock-user')).focus();
    return;
  }
  const last = store('school');
  if (last) {
    state.school = last;
    $('#school-input').value = last.name;
    $('#user-input').focus();
  } else {
    $('#school-input').focus();
  }
}

let searchTimer, searchResults = [], activeResult = -1;

$('#school-input').addEventListener('input', (e) => {
  state.school = null;
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) return ($('#school-results').hidden = true);
  searchTimer = setTimeout(() => searchSchools(q), 300);
});

$('#school-input').addEventListener('keydown', (e) => {
  const list = $('#school-results');
  if (list.hidden || !searchResults.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + searchResults.length) % searchResults.length;
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === activeResult));
  } else if (e.key === 'Enter' && activeResult >= 0) {
    e.preventDefault();
    pickSchool(searchResults[activeResult]);
  } else if (e.key === 'Escape') {
    list.hidden = true;
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.field')) $('#school-results').hidden = true;
});

async function searchSchools(q) {
  const list = $('#school-results');
  try {
    const r = await api('/api/schools?q=' + encodeURIComponent(q));
    if (r.tooMany) {
      searchResults = [];
      list.innerHTML = '<li class="empty">Zu viele Treffer, bitte genauer suchen.</li>';
    } else {
      searchResults = r;
      list.innerHTML = r.length
        ? r.map((s, i) => `<li data-i="${i}">${esc(s.name)}<small>${esc(s.address)}</small></li>`).join('')
        : '<li class="empty">Keine Schule gefunden.</li>';
    }
  } catch {
    searchResults = [];
    list.innerHTML = '<li class="empty">Suche gerade nicht möglich.</li>';
  }
  activeResult = -1;
  list.hidden = false;
}

$('#school-results').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]');
  if (li) pickSchool(searchResults[li.dataset.i]);
});

function pickSchool(s) {
  state.school = s;
  $('#school-input').value = s.name;
  $('#school-results').hidden = true;
  $('#user-input').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  if (!state.school) {
    err.textContent = 'Bitte wähle deine Schule aus der Liste aus.';
    err.hidden = false;
    return;
  }
  const btn = $('#login-btn');
  btn.disabled = true;
  btn.textContent = 'Anmelden…';
  try {
    await api('/api/login', {
      method: 'POST',
      body: {
        school: state.school.school,
        schoolName: state.school.name,
        server: state.school.server,
        user: $('#user-input').value.trim(),
        password: $('#password-input').value,
      },
    });
    store('school', state.school);
    $('#password-input').value = '';
    await showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Anmelden';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

// ---------- App-Rahmen & Navigation ----------

const ICONS = {
  heute: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  uebersicht: 'M5 20V11M11 20V5M17 20v-6M3 20h18',
  mitteilungen: 'M3 6h18v12H3zM3 7l9 6 9-6',
  stundenplan: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3v3H8z',
  weitere: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M12 13v5M9.5 15.5h5',
  abwesenheiten: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 21v-2a5 5 0 0 1 9-3M16 16l5 5M21 16l-5 5',
  hausaufgaben: 'M6 3h9l4 4v14H6zM9 9h7M9 13h7M9 17h4',
  klassenbuch: 'M5 4a1 1 0 0 1 1-1h13v15H6a1 1 0 0 0-1 1zM5 19a2 2 0 0 0 2 2h12v-3M9 7h6',
  dienste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 14l2 2 4-4',
  pruefungen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3',
  noten: 'M12 3l2.6 5.5 6 .8-4.4 4.2 1 6L12 16.6l-5.2 2.9 1-6-4.4-4.2 6-.8z',
  sprechstunden: 'M4 5h16v11H10l-6 4z',
};

const VIEWS = [
  { id: 'heute', title: 'Heute', render: viewToday },
  { id: 'uebersicht', title: 'Übersicht', render: viewOverview },
  { id: 'mitteilungen', title: 'Mitteilungen', render: viewMessages },
  { id: 'stundenplan', title: 'Mein Stundenplan', render: viewTimetable },
  { id: 'weitere', title: 'Weitere Stundenpläne', render: viewOther },
  { id: 'abwesenheiten', title: 'Abwesenheiten', render: viewAbsences },
  { id: 'hausaufgaben', title: 'Hausaufgaben', render: viewHomework },
  { id: 'klassenbuch', title: 'Klassenbucheinträge', short: 'Klassenbuch', render: (el) => viewSection(el, 'classreg') },
  { id: 'dienste', title: 'Dienste', render: (el) => viewSection(el, 'services') },
  { id: 'pruefungen', title: 'Prüfungen', render: viewExams },
  { id: 'noten', title: 'Noten', render: (el) => viewSection(el, 'grades') },
  { id: 'sprechstunden', title: 'Sprechstunden', render: (el) => viewSection(el, 'officehours') },
];

$('#nav').innerHTML = '<span class="nav-blob" aria-hidden="true"></span>' + VIEWS.map((v) => `
  <a href="#${v.id}" data-view="${v.id}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[v.id]}"/></svg>${v.title}
  </a>`).join('');

// ---------- Handy-Modus ----------
// Wird automatisch erkannt: schmales Fenster oder Touch-Gerät im Querformat mit wenig Höhe.

const MOBILE_Q = matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 500px)');
const isMobile = () => MOBILE_Q.matches;
const haptic = () => navigator.vibrate?.(8);

const TABS = [
  { id: 'heute', label: 'Heute' },
  { id: 'stundenplan', label: 'Plan' },
  { id: 'pruefungen', label: 'Tests' },
  { id: 'hausaufgaben', label: 'Aufgaben' },
];
const MORE_ICON = 'M5 12h.01M12 12h.01M19 12h.01';

$('#tabbar').innerHTML = '<span class="tab-blob" aria-hidden="true"></span>'
  + TABS.map((t) => `<a class="tab" href="#${t.id}" data-view="${t.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[t.id]}"/></svg>${t.label}</a>`).join('')
  + `<button class="tab" id="more-tab" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${MORE_ICON}" style="stroke-width:3.2"/></svg>Mehr</button>`;

$('#sheet-nav').innerHTML = VIEWS.filter((v) => !TABS.some((t) => t.id === v.id)).map((v) => `
  <a href="#${v.id}" data-view="${v.id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[v.id]}"/></svg>${v.short || v.title}</a>`).join('');

function applyDevice() {
  document.documentElement.classList.toggle('mobile', isMobile());
  if (!isMobile()) closeSheet();
  requestAnimationFrame(() => { moveTabBlob(); moveNavBlob(); });
}
MOBILE_Q.addEventListener('change', applyDevice);

function moveTabBlob() {
  const blob = $('.tab-blob'), tab = $('#tabbar .tab.active');
  if (!blob || !tab || !tab.offsetWidth) return;
  const first = !blob.style.width;
  blob.style.width = tab.offsetWidth + 'px';
  blob.style.transform = `translateX(${tab.offsetLeft}px)`;
  if (!first && blob.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    blob.animate([{ scale: '1 1' }, { scale: '1.3 0.86' }, { scale: '0.95 1.05' }, { scale: '1 1' }],
      { duration: 600, easing: 'ease-out' });
  }
}

function openSheet() {
  $('#sheet').classList.add('open');
  $('#sheet').setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  haptic();
}
function closeSheet() {
  $('#sheet').classList.remove('open');
  $('#sheet').setAttribute('aria-hidden', 'true');
  if (!$('#sidebar').classList.contains('open')) $('#scrim').hidden = true;
}

$('#more-tab').addEventListener('click', () => ($('#sheet').classList.contains('open') ? closeSheet() : openSheet()));
$('#me-btn').addEventListener('click', openSheet);
$('#tabbar').addEventListener('click', (e) => { if (e.target.closest('a.tab')) haptic(); });
$('#sheet').addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'theme') $('#theme-btn').click();
  if (action === 'logout') { closeSheet(); $('#logout-btn').click(); }
});

// Fenster nach unten wegziehen schließt es
let sheetDrag = null;
$('#sheet').addEventListener('touchstart', (e) => {
  if ($('#sheet').scrollTop > 0) return;
  sheetDrag = { y: e.touches[0].clientY, dy: 0 };
}, { passive: true });
$('#sheet').addEventListener('touchmove', (e) => {
  if (!sheetDrag) return;
  sheetDrag.dy = Math.max(0, e.touches[0].clientY - sheetDrag.y);
  $('#sheet').style.transition = 'none';
  $('#sheet').style.transform = `translateY(${sheetDrag.dy}px)`;
}, { passive: true });
$('#sheet').addEventListener('touchend', () => {
  if (!sheetDrag) return;
  $('#sheet').style.transition = '';
  $('#sheet').style.transform = '';
  if (sheetDrag.dy > 90) closeSheet();
  sheetDrag = null;
});

async function showApp() {
  state.me = await api('/api/me');
  const me = state.me;
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#who').textContent = me.displayName;
  $('#avatar').textContent = (me.displayName || '?').trim()[0].toUpperCase();
  $('#school-name').textContent = me.schoolName || '';
  $('#school-year').textContent = me.schoolYear?.name || '';
  $('#school-year').hidden = !me.schoolYear?.name;
  if (state.data) {
    // GitHub-Version: zeigen, wie aktuell die Daten sind
    const stand = 'Stand ' + new Date(state.data.generated).toLocaleString('de', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    $('#school-year').textContent = [me.schoolYear?.name, stand].filter(Boolean).join(' · ');
    $('#school-year').hidden = false;
  }
  const letter = (me.displayName || '?').trim()[0].toUpperCase();
  $('#me-btn').textContent = letter;
  $('#sheet-avatar').textContent = letter;
  $('#sheet-name').textContent = me.displayName;
  $('#sheet-school').textContent = [me.schoolName, me.schoolYear?.name].filter(Boolean).join(' · ');
  state.weekStart = mondayOf(new Date());
  state.activeDay = null;
  applyDevice();
  route();
  updateExamBadge();
}

// Kleiner Limetten-Punkt am „Tests“-Tab, wenn in den nächsten 7 Tagen ein Test ansteht
async function updateExamBadge() {
  try {
    const key = untisDate(new Date());
    const d = await load('day:' + key, '/api/day');
    const soon = (d.exams || []).filter((x) => x.date >= key && x.date <= untisDate(addDays(new Date(), 7))).length;
    const tab = $('#tabbar [data-view="pruefungen"]');
    $('.tab-badge', tab)?.remove();
    if (soon) tab.insertAdjacentHTML('beforeend', `<span class="tab-badge">${soon}</span>`);
  } catch { /* nicht wichtig */ }
}

let routeToken = 0;

function route() {
  if ($('#app-view').hidden) return;
  const view = VIEWS.find((v) => '#' + v.id === location.hash) || VIEWS[0];
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view.id));
  moveNavBlob();
  const tabId = TABS.some((t) => t.id === view.id) ? view.id : null;
  $$('#tabbar .tab').forEach((t) => t.classList.toggle('active', tabId ? t.dataset.view === tabId : t.id === 'more-tab'));
  $$('#sheet-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view.id));
  moveTabBlob();
  closeSheet();
  $('#view-title').textContent = view.title;
  document.title = `${view.title} · Mein Stundenplan`;
  $('#view-tools').innerHTML = '';
  closeMenu();
  const el = $('#view');
  el.innerHTML = spinner();
  el.dataset.view = view.id;
  const token = ++routeToken;
  lastSad = -1;
  // Jede Ansicht bekommt ein eigenes Element, damit späte Antworten keine neuere Ansicht überschreiben.
  const box = document.createElement('div');
  box.className = 'view-box enter';
  Promise.resolve(view.render(box, () => token !== routeToken))
    .catch((e) => (box.innerHTML = notice('Fehler: ' + e.message)))
    .finally(() => { if (token === routeToken) el.replaceChildren(box); });
}

addEventListener('hashchange', route);

// Die dunkle „Pille“ im Menü gleitet zum aktiven Punkt und dehnt sich dabei wie ein Tropfen.
function moveNavBlob() {
  const blob = $('.nav-blob'), a = $('#nav a.active');
  if (!blob || !a) return;
  const first = !blob.style.height;
  blob.style.height = a.offsetHeight + 'px';
  blob.style.transform = `translateY(${a.offsetTop}px)`;
  if (!first && blob.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    blob.animate([{ scale: '1 1' }, { scale: '0.92 1.35' }, { scale: '1.03 0.94' }, { scale: '1 1' }],
      { duration: 650, easing: 'ease-out' });
  }
}

// Lichtreflex folgt dem Zeiger über Glasflächen
const GLOSSY = '.card, .lesson, .btn, .mini, .chip, .nav a, .day-tabs button, .msg';
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest?.(GLOSSY);
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', e.clientX - r.left + 'px');
  el.style.setProperty('--my', e.clientY - r.top + 'px');
}, { passive: true });

function openMenu() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; }
function closeMenu() {
  $('#sidebar').classList.remove('open');
  if (!$('#sheet').classList.contains('open')) $('#scrim').hidden = true;
}
$('#menu-btn').addEventListener('click', openMenu);
$('#scrim').addEventListener('click', () => { closeMenu(); closeSheet(); });

// ---------- Stundenplan-Logik ----------

const names = (arr, key = 'name') => (arr || []).map((x) => x[key] || x.name).filter(Boolean);
const signature = (p) =>
  [p.code, names(p.su), names(p.te), names(p.ro), p.substText, p.info, p.lstext, p._exam?.id].join('|');
const subjectOf = (p) => names(p.su, 'longname')[0] || p.lstext || p.activityType || 'Unterricht';
const shortOf = (p) => names(p.su)[0] || subjectOf(p);

// Auch zusammengesetzte Wörter wie „Vokabeltest“ oder „Mathe-Schularbeit“ erkennen
const EXAM_WORDS = /(test|schularbeit|klausur|prüfung|lzk|lernzielkontrolle|stundenwiederholung)/i;

// Markiert Stunden, in denen ein Test ist. Tests ohne passende Stunde werden als eigene Einträge angezeigt.
function attachExams(periods, exams = []) {
  const all = periods.map((p) => ({ ...p, _exam: null }));
  for (const ex of exams || []) {
    const overlaps = all.filter((p) =>
      p.date === ex.date && p.startTime < ex.endTime && ex.startTime < p.endTime && p.code !== 'cancelled');
    const bySubject = overlaps.filter((p) => names(p.su).some((n) => n === ex.subject));
    const hits = bySubject.length ? bySubject : overlaps;
    if (hits.length) hits.forEach((p) => (p._exam = ex));
    else {
      all.push({
        id: 'exam-' + ex.id,
        date: ex.date,
        startTime: ex.startTime,
        endTime: ex.endTime,
        su: ex.subject ? [{ name: ex.subject }] : [],
        te: ex.teachers.map((t) => (typeof t === 'string' ? { name: t } : t)),
        ro: ex.rooms.map((r) => (typeof r === 'string' ? { name: r } : r)),
        _exam: ex,
      });
    }
  }
  for (const p of all) {
    const source = [p.lstext, p.info, p.substText].find((x) => EXAM_WORDS.test(x || ''));
    if (!p._exam && p.code !== 'cancelled' && source) {
      p._exam = { id: 'text-' + p.id, name: source.length > 30 ? 'Test' : source, text: '' };
    }
  }
  return all;
}

// Unterrichtseinheiten (Zeilen) aus dem Zeitraster, sonst aus den Stunden selbst ableiten.
function buildUnits(timegrid, periods) {
  const best = [...(timegrid || [])].sort((a, b) => b.timeUnits.length - a.timeUnits.length)[0];
  if (best && best.timeUnits.length) {
    return best.timeUnits.map((u) => ({ name: u.name, start: u.startTime, end: u.endTime }));
  }
  const seen = new Map();
  for (const p of periods) seen.set(p.startTime, Math.max(seen.get(p.startTime) || 0, p.endTime));
  return [...seen].sort((a, b) => a[0] - b[0]).map(([start, end], i) => ({ name: String(i + 1), start, end }));
}

function unitRange(units, p) {
  let s = 0;
  units.forEach((u, i) => { if (u.start <= p.startTime) s = i; });
  let e = units.findIndex((u) => u.end >= p.endTime);
  if (e < s) e = s;
  if (e === -1) e = units.length - 1;
  return [s, e];
}

// Doppelstunden eines Tages zusammenfassen
function mergeDay(dayPeriods, units) {
  const merged = [];
  for (const p of [...dayPeriods].sort((a, b) => a.startTime - b.startTime)) {
    const [s, e] = unitRange(units, p);
    const prev = merged.find((m) => m.e + 1 === s && signature(m.p) === signature(p));
    if (prev) { prev.e = e; prev.end = p.endTime; }
    else merged.push({ p, s, e, start: p.startTime, end: p.endTime });
  }
  return merged;
}

let currentLessons = {};

function statusOf(p) {
  if (p.code === 'cancelled') return { cls: ' cancelled', badge: 'Entfall' };
  if (p.code === 'irregular') {
    return { cls: ' irregular', badge: (p.te || []).some((t) => t.orgid) ? 'Vertretung' : 'Geändert' };
  }
  return { cls: '', badge: '' };
}

function lessonHtml(m, dk, todayKey) {
  const p = m.p;
  const subject = subjectOf(p);
  const short = shortOf(p);
  const teachers = (p.te || []).map((t) => (t.orgid ? `<span class="changed">${esc(t.name)}</span>` : esc(t.name)));
  const rooms = (p.ro || []).map((r) => (r.orgid ? `<span class="changed">${esc(r.name)}</span>` : esc(r.name)));
  const meta = [teachers.join(', '), rooms.join(', ')].filter(Boolean).join(' · ');
  const note = p.substText || p.info || '';

  let { cls, badge } = statusOf(p);
  if (p._exam) { cls += ' exam'; badge = esc(p._exam.name || 'Test'); }
  const t = nowTime();
  if (dk === todayKey && m.start <= t && t < m.end && p.code !== 'cancelled') cls += ' now';

  const id = `${p.id}-${dk}`;
  currentLessons[id] = m;
  return `<button class="lesson${cls}" data-id="${id}" style="--h:${hue(short)}" title="${esc(subject)}">
    ${badge ? `<span class="badge">${badge}</span>` : ''}
    <span class="subject"><i class="sdot"></i>${esc(subject.length > 18 ? short : subject)}</span>
    ${meta ? `<span class="meta">${meta}</span>` : ''}
    ${note ? `<span class="note">${esc(note)}</span>` : ''}
    ${p._exam ? figureHtml('sad', '', p._exam.id + ':' + p.date) : ''}
  </button>`;
}

// Zeichnet eine Woche in ein Element (mit .day-tabs und .timetable darin).
function renderTimetable(wrap, data) {
  wrap._data = data;
  const periods = attachExams(data.periods, data.exams);
  const { timegrid, holidays } = data;
  const units = buildUnits(timegrid, periods);
  const weekStart = state.weekStart;

  // Tage: Mo–Fr, Wochenende nur, wenn dort Unterricht ist
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (i < 5 || periods.some((p) => p.date === untisDate(d))) days.push(d);
  }
  const todayKey = untisDate(new Date());
  if (state.activeDay === 'last') state.activeDay = days.length - 1;
  if (state.activeDay === null || state.activeDay >= days.length) {
    const t = days.findIndex((d) => untisDate(d) === todayKey);
    state.activeDay = t >= 0 ? t : 0;
  }

  currentLessons = {};
  lastSad = -1;
  const tt = $('.timetable', wrap);
  tt.style.gridTemplateColumns = `56px repeat(${days.length}, minmax(0, 1fr))`;
  tt.style.gridTemplateRows = `auto repeat(${units.length}, minmax(62px, auto))`;

  let html = '<div></div>';
  days.forEach((d, i) => {
    const today = untisDate(d) === todayKey ? ' today' : '';
    html += `<div class="day-head${today}" style="--c:${i};grid-column:${i + 2};grid-row:1" title="${DAY_LONG[d.getDay()]}"><small>${DAY_NAMES[d.getDay()]}</small><b>${pad(d.getDate())}</b></div>`;
  });
  units.forEach((u, r) => {
    html += `<div class="time-cell" style="grid-column:1;grid-row:${r + 2}"><b>${esc(u.name)}</b>${fmtTime(u.start)}<br>${fmtTime(u.end)}</div>`;
  });

  days.forEach((d, col) => {
    const dk = untisDate(d);
    const active = col === state.activeDay ? ' active-day' : '';
    const place = `data-day="${col}" style="--c:${col};grid-column:${col + 2};grid-row:`;
    const dayPeriods = periods.filter((p) => p.date === dk);

    const holiday = (holidays || []).find((h) => h.startDate <= dk && h.endDate >= dk);
    if (holiday && !dayPeriods.length) {
      html += `<div class="holiday${active}" ${place}2 / ${units.length + 2}">🌴<br>${esc(holiday.longName || holiday.name)}</div>`;
      return;
    }

    // Stunden, die zur gleichen Zeit beginnen, nebeneinander anzeigen
    const slots = new Map();
    for (const m of mergeDay(dayPeriods, units)) {
      const slot = slots.get(m.s) || { s: m.s, e: m.e, items: [] };
      slot.e = Math.max(slot.e, m.e);
      slot.items.push(m);
      slots.set(m.s, slot);
    }

    const covered = new Set();
    for (const slot of slots.values()) {
      for (let r = slot.s; r <= slot.e; r++) covered.add(r);
      html += `<div class="slot${active}" ${place}${slot.s + 2} / ${slot.e + 3}">${slot.items.map((m) => lessonHtml(m, dk, todayKey)).join('')}</div>`;
    }
    units.forEach((_, r) => {
      if (!covered.has(r)) html += `<div class="empty-slot${active}" ${place}${r + 2}"></div>`;
    });

    if (dk === todayKey) html += nowLineHtml(units, col, active);
  });

  tt.innerHTML = html;
  renderTabs(wrap, days, todayKey);
}

// Rote Linie mit Uhrzeit an der aktuellen Stelle im heutigen Tag
function nowLineHtml(units, col, active) {
  if (!units.length) return '';
  const t = nowTime(), now = minutes(t);
  if (now < minutes(units[0].start) || now > minutes(units[units.length - 1].end)) return '';
  let r = units.findIndex((u) => now < minutes(u.end));
  if (r === -1) r = units.length - 1;
  const u = units[r];
  const pct = Math.min(100, Math.max(0, ((now - minutes(u.start)) / (minutes(u.end) - minutes(u.start))) * 100));
  return `<div class="now-line${active}" data-day="${col}" style="grid-column:${col + 2};grid-row:${r + 2}">
      <span style="top:${pct}%"></span></div>
    <div class="now-time" style="grid-column:1;grid-row:${r + 2}"><span style="top:${pct}%">${fmtTime(t)}</span></div>`;
}

function renderTabs(wrap, days, todayKey) {
  $('.day-tabs', wrap).innerHTML = days
    .map((d, i) => {
      const cls = [i === state.activeDay && 'active', untisDate(d) === todayKey && 'today'].filter(Boolean).join(' ');
      return `<button class="${cls}" data-i="${i}">${DAY_NAMES[d.getDay()]}<small>${pad(d.getDate())}</small></button>`;
    })
    .join('');
}

function selectDay(wrap, i) {
  const anim = i > state.activeDay ? 'next' : i < state.activeDay ? 'prev' : 'fade';
  state.activeDay = i;
  wrap.dataset.anim = anim;
  clearTimeout(wrap._animTimer);
  wrap._animTimer = setTimeout(() => delete wrap.dataset.anim, 700);
  $$('.day-tabs button', wrap).forEach((x, j) => x.classList.toggle('active', j === i));
  $$('.timetable [data-day]', wrap).forEach((el) => el.classList.toggle('active-day', Number(el.dataset.day) === i));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.day-tabs button');
  if (!b) return;
  haptic();
  selectDay(b.closest('.tt-wrap'), Number(b.dataset.i));
});

// Wischen im Handy-Modus: nächster/vorheriger Tag, am Wochenrand in die nächste/vorige Woche
function stepDay(wrap, dir) {
  const count = $$('.day-tabs button', wrap).length;
  const next = state.activeDay + dir;
  haptic();
  if (next >= 0 && next < count) return selectDay(wrap, next);
  state.weekStart = addDays(state.weekStart, dir * 7);
  state.activeDay = dir > 0 ? 0 : 'last';
  const label = $('.week-label');
  if (label) label.textContent = weekLabel();
  wrap._reload?.(dir > 0 ? 'next' : 'prev');
}

let swipe = null;
document.addEventListener('touchstart', (e) => {
  const wrap = e.target.closest('.tt-wrap');
  if (!wrap || !isMobile() || e.touches.length > 1) return;
  swipe = { wrap, x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const wrap = swipe.wrap;
  swipe = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.7) return; // eher gescrollt als gewischt
  stepDay(wrap, dx < 0 ? 1 : -1);
}, { passive: true });

// Linie und „jetzt“-Markierung jede Minute aktualisieren
setInterval(() => $$('.tt-wrap').forEach((w) => w._data && renderTimetable(w, w._data)), 60000);

function weekLabel() {
  const start = state.weekStart, end = addDays(start, 4);
  const sameMonth = start.getMonth() === end.getMonth();
  return `KW ${isoWeek(start)} · ${start.getDate()}.${sameMonth ? '' : ' ' + start.toLocaleDateString('de', { month: 'short' })} – ` +
    end.toLocaleDateString('de', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Wochen-Navigation in der Kopfzeile; onChange lädt die neue Woche.
function weekTools(onChange) {
  const tools = $('#view-tools');
  tools.insertAdjacentHTML('beforeend', `
    <div class="week-nav">
      <button class="btn icon" data-w="-1" aria-label="Vorherige Woche">‹</button>
      <button class="btn ghost" data-w="0">Heute</button>
      <button class="btn icon" data-w="1" aria-label="Nächste Woche">›</button>
      <span class="week-label">${weekLabel()}</span>
    </div>`);
  $('.week-nav', tools).addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const delta = Number(b.dataset.w);
    state.weekStart = delta ? addDays(state.weekStart, delta * 7) : mondayOf(new Date());
    state.activeDay = null;
    $('.week-label', tools).textContent = weekLabel();
    onChange(delta > 0 ? 'next' : delta < 0 ? 'prev' : 'fade');
  });
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || $('#details').open) return;
  if (!$('.week-nav')) return;
  if (e.key === 'ArrowLeft') $('.week-nav [data-w="-1"]').click();
  if (e.key === 'ArrowRight') $('.week-nav [data-w="1"]').click();
});

async function loadWeekInto(wrap, element, anim = 'fade') {
  const start = isoDate(state.weekStart);
  const key = `tt:${element ? element.type + ':' + element.id : 'own'}:${start}`;
  const path = `/api/timetable?start=${start}` + (element ? `&type=${element.type}&id=${element.id}` : '');
  const status = $('.tt-status', wrap);
  if (!state.cache.has(key)) {
    $('.timetable', wrap).innerHTML = '';
    $('.day-tabs', wrap).innerHTML = '';
    status.innerHTML = spinner('Stundenplan wird geladen…');
    status.hidden = false;
  }
  try {
    const data = await load(key, path);
    if (start !== isoDate(state.weekStart)) return; // inzwischen weitergeblättert
    status.hidden = true;
    // Animation nur beim Laden einer Woche, nicht beim minütlichen Aktualisieren
    wrap.dataset.anim = anim;
    clearTimeout(wrap._animTimer);
    wrap._animTimer = setTimeout(() => delete wrap.dataset.anim, 900);
    renderTimetable(wrap, data);
    if (!data.periods.length && !data.holidays.length) {
      status.innerHTML = notice('Für diese Woche sind keine Stunden eingetragen.', figureHtml('relax', 'big'));
      status.hidden = false;
    }
  } catch (e) {
    status.innerHTML = notice('Fehler: ' + e.message);
    status.hidden = false;
  }
}

const ttShell = () => '<div class="tt-wrap"><div class="day-tabs"></div><div class="timetable"></div><div class="tt-status" hidden></div></div>';

// ---------- Ansicht: Mein Stundenplan ----------

function viewTimetable(el) {
  el.innerHTML = ttShell();
  const wrap = $('.tt-wrap', el);
  wrap._reload = (anim) => loadWeekInto(wrap, null, anim);
  weekTools(wrap._reload);
  return loadWeekInto(wrap);
}

// ---------- Ansicht: Weitere Stundenpläne ----------

const ELEMENT_TYPES = [
  { type: 1, label: 'Klassen' },
  { type: 2, label: 'Lehrkräfte' },
  { type: 4, label: 'Räume' },
  { type: 3, label: 'Fächer' },
];

async function viewOther(el, stale) {
  const type = state.other?.type || 1;
  el.innerHTML = `
    <div class="picker card">
      <div class="seg">${ELEMENT_TYPES.map((t) => `<button data-type="${t.type}" class="${t.type === type ? 'active' : ''}">${t.label}</button>`).join('')}</div>
      <input class="search" type="search" placeholder="Suchen…" aria-label="Suchen">
      <div class="chips"></div>
    </div>
    <h2 class="sub-title"></h2>
    ${ttShell()}`;
  const wrap = $('.tt-wrap', el);
  wrap._reload = (anim) => state.other && loadWeekInto(wrap, state.other, anim);
  weekTools(wrap._reload);

  let list = [];
  const chips = $('.chips', el);
  const drawChips = () => {
    const q = $('.search', el).value.trim().toLowerCase();
    const hits = list.filter((x) => !q || x.name.toLowerCase().includes(q) || x.long.toLowerCase().includes(q));
    chips.innerHTML = hits.length
      ? hits.slice(0, 120).map((x) => `<button class="chip ${state.other?.id === x.id && state.other?.type === currentType ? 'active' : ''}" data-id="${x.id}" title="${esc(x.long)}">${esc(x.name)}</button>`).join('')
      : '<span class="muted">Nichts gefunden.</span>';
  };
  let currentType = type;
  const loadType = async (t) => {
    currentType = t;
    $$('.seg button', el).forEach((b) => b.classList.toggle('active', Number(b.dataset.type) === t));
    chips.innerHTML = '<span class="muted">Wird geladen…</span>';
    try {
      list = await load('el:' + t, '/api/elements?type=' + t);
      drawChips();
    } catch (e) {
      list = [];
      chips.innerHTML = `<span class="muted">${(e.status === 400 || e.status === 403) && !state.data ? 'Diese Liste gibt deine Schule nicht frei.' : esc(e.message)}</span>`;
    }
  };

  $('.seg', el).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) loadType(Number(b.dataset.type));
  });
  $('.search', el).addEventListener('input', drawChips);
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const x = list.find((i) => i.id === Number(b.dataset.id));
    state.other = { type: currentType, id: x.id, name: x.name, long: x.long };
    state.activeDay = null;
    drawChips();
    $('.sub-title', el).textContent = x.long ? `${x.name} – ${x.long}` : x.name;
    loadWeekInto(wrap, state.other);
  });

  await loadType(type);
  if (stale()) return;
  if (state.other) {
    $('.sub-title', el).textContent = state.other.long ? `${state.other.name} – ${state.other.long}` : state.other.name;
    loadWeekInto(wrap, state.other);
  } else {
    $('.tt-status', wrap).innerHTML = notice('Wähle oben eine Klasse, Lehrkraft, einen Raum oder ein Fach.');
    $('.tt-status', wrap).hidden = false;
  }
}

// ---------- Ansicht: Heute ----------

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
}

function lessonRow(m) {
  const p = m.p;
  let { cls, badge } = statusOf(p);
  if (p._exam) { cls += ' exam'; badge = esc(p._exam.name || 'Test'); }
  const t = nowTime();
  const now = m.start <= t && t < m.end && p.code !== 'cancelled' && p.date === untisDate(new Date());
  const id = `${p.id}-${p.date}`;
  currentLessons[id] = m;
  return `<button class="row-lesson lesson${cls}${now ? ' now' : ''}" data-id="${id}" style="--h:${hue(shortOf(p))}">
    <span class="row-time">${fmtTime(m.start)}<br><small>${fmtTime(m.end)}</small></span>
    <span class="row-main">
      ${badge ? `<span class="badge">${badge}</span>` : ''}
      <span class="subject"><i class="sdot"></i>${esc(subjectOf(p))}</span>
      <span class="meta">${esc([names(p.te).join(', '), names(p.ro).join(', ')].filter(Boolean).join(' · '))}</span>
      ${p.substText || p.info ? `<span class="note">${esc(p.substText || p.info)}</span>` : ''}
    </span>
    ${p._exam ? figureHtml('sad', '', p._exam.id + ':row') : ''}
  </button>`;
}

async function viewToday(el) {
  const today = new Date();
  const key = untisDate(today);
  const d = await load('day:' + key, '/api/day');
  const periods = attachExams(d.timetable.periods, d.timetable.exams).filter((p) => p.date === key);
  const units = buildUnits(d.timetable.timegrid, periods);
  currentLessons = {};
  const merged = mergeDay(periods, units);
  const t = nowTime();
  const next = merged.find((m) => m.end > t && m.p.code !== 'cancelled');
  const holiday = (d.timetable.holidays || []).find((h) => h.startDate <= key && h.endDate >= key);

  const exams = d.exams || [];
  const soon = exams.filter((x) => x.date >= key);
  const hw = (d.homework || []).filter((h) => !h.completed && h.dueDate >= key);
  const first = state.me.displayName !== state.me.user ? state.me.displayName : '';

  let nextHtml;
  if (holiday && !periods.length) nextHtml = `<p class="big-note">🌴 ${esc(holiday.longName || holiday.name)}</p>`;
  else if (!merged.length) nextHtml = `<p class="big-note">Heute kein Unterricht 🎉</p>`;
  else if (!next) nextHtml = `<p class="big-note">Für heute geschafft! 🎉</p>${figureHtml('happy', 'big')}`;
  else {
    const isNow = next.start <= t;
    nextHtml = `<p class="eyebrow">${isNow ? 'Jetzt' : 'Als Nächstes'} · ${fmtTime(next.start)}–${fmtTime(next.end)}</p>
      <p class="big-subject" style="--h:${hue(shortOf(next.p))}"><i class="sdot"></i>${esc(subjectOf(next.p))}</p>
      <p class="muted">${esc([names(next.p.te).join(', '), names(next.p.ro).join(', ')].filter(Boolean).join(' · '))}</p>`;
  }

  el.innerHTML = `
    <section class="hero">
      <h2>${greeting()}${first ? ', ' + esc(first) : ''}!</h2>
      <p class="muted">${fmtDateLong(key)}</p>
    </section>
    <div class="dash">
      <section class="card panel next-card">${nextHtml}</section>

      <section class="card panel">
        <h3>Tests bald</h3>
        ${soon.length ? `<div class="mini-list">${soon.slice(0, 5).map(examMini).join('')}</div>`
          : `<div class="empty-mini">${figureHtml('relax')}<span>Keine Tests in den nächsten 4 Wochen.</span></div>`}
        <a class="more" href="#pruefungen">Alle Prüfungen →</a>
      </section>

      <section class="card panel wide">
        <h3>Dein Tag</h3>
        ${merged.length ? `<div class="day-list">${merged.map(lessonRow).join('')}</div>` : '<p class="muted">Keine Stunden.</p>'}
      </section>

      <section class="card panel">
        <h3>Hausaufgaben</h3>
        ${d.homework === null ? '<p class="muted">Von deiner Schule nicht freigegeben.</p>'
          : hw.length ? `<div class="mini-list">${hw.slice(0, 6).map(homeworkMini).join('')}</div>`
          : '<p class="muted">Nichts offen. 👌</p>'}
        <a class="more" href="#hausaufgaben">Alle Hausaufgaben →</a>
      </section>

      ${d.news?.length ? `<section class="card panel">
        <h3>Nachrichten des Tages</h3>
        ${d.news.map((n) => `<div class="news"><b>${esc(n.subject)}</b><p>${esc(htmlToText(n.text))}</p></div>`).join('')}
      </section>` : ''}
    </div>`;
}

function examMini(x) {
  const days = Math.round((fromUntis(x.date) - fromUntis(untisDate(new Date()))) / 86400000);
  return `<div class="mini exam-mini${days <= 7 ? ' urgent' : ''}" style="--h:${hue(x.subject || x.name)}">
    <span class="mini-date"><b>${fromUntis(x.date).getDate()}.${fromUntis(x.date).getMonth() + 1}.</b><small>${relDay(x.date)}</small></span>
    <span class="mini-main"><b>${esc(x.subject || '')} ${esc(x.name || 'Test')}</b>${x.text ? `<small>${esc(x.text)}</small>` : ''}</span>
    ${days <= 7 ? figureHtml('sad', '', x.id + ':mini') : ''}
  </div>`;
}

function homeworkMini(h) {
  return `<div class="mini" style="--h:${hue(h.subject)}">
    <span class="mini-date"><b>${fromUntis(h.dueDate).getDate()}.${fromUntis(h.dueDate).getMonth() + 1}.</b><small>${relDay(h.dueDate)}</small></span>
    <span class="mini-main"><b>${esc(h.subject)}</b><small>${esc(h.text)}</small></span>
  </div>`;
}

// ---------- Ansicht: Übersicht ----------

async function viewOverview(el) {
  const key = untisDate(new Date());
  const [d, abs] = await Promise.all([
    load('day:' + key, '/api/day'),
    load('absences', '/api/absences').catch(() => null),
  ]);
  const periods = d.timetable.periods;
  const lessons = periods.filter((p) => p.code !== 'cancelled').length;
  const cancelled = periods.filter((p) => p.code === 'cancelled');
  const irregular = periods.filter((p) => p.code === 'irregular');
  const hwOpen = (d.homework || []).filter((h) => !h.completed && h.dueDate >= key);
  const exams = (d.exams || []).filter((x) => x.date >= key);
  const unexcused = abs ? abs.filter((a) => !a.excused) : [];

  const stat = (label, value, tone = '', href = '') =>
    `<${href ? `a href="${href}"` : 'div'} class="card stat ${tone}"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></${href ? 'a' : 'div'}>`;

  const changes = [...cancelled, ...irregular].sort((a, b) => a.date - b.date || a.startTime - b.startTime);

  el.innerHTML = `
    <div class="stats">
      ${stat('Stunden diese Woche', lessons, '', '#stundenplan')}
      ${stat('Entfälle', cancelled.length, cancelled.length ? 'danger' : '', '#stundenplan')}
      ${stat('Vertretungen / Änderungen', irregular.length, irregular.length ? 'warn' : '', '#stundenplan')}
      ${stat('Tests (4 Wochen)', exams.length, exams.length ? 'exam' : '', '#pruefungen')}
      ${stat('Offene Hausaufgaben', d.homework === null ? '–' : hwOpen.length, '', '#hausaufgaben')}
      ${stat('Abwesenheiten offen', abs === null ? '–' : unexcused.length, unexcused.length ? 'danger' : '', '#abwesenheiten')}
    </div>
    <section class="card panel">
      <h3>Änderungen diese Woche</h3>
      ${changes.length ? `<div class="mini-list">${changes.map((p) => {
        const { badge } = statusOf(p);
        return `<div class="mini" style="--h:${hue(shortOf(p))}">
          <span class="mini-date"><b>${DAY_NAMES[fromUntis(p.date).getDay()]}</b><small>${fmtTime(p.startTime)}</small></span>
          <span class="mini-main"><b>${esc(subjectOf(p))} <span class="tag ${p.code}">${badge}</span></b>
          <small>${esc([names(p.te).join(', '), names(p.ro).join(', '), p.substText].filter(Boolean).join(' · '))}</small></span>
        </div>`;
      }).join('')}</div>` : '<p class="muted">Keine Änderungen – alles nach Plan.</p>'}
    </section>`;
}

// ---------- Ansicht: Mitteilungen ----------

async function viewMessages(el) {
  const key = untisDate(new Date());
  const [msgs, news] = await Promise.all([
    load('messages', '/api/messages').catch((e) => ({ error: e.message })),
    load('news:' + key, '/api/news?date=' + key).catch(() => []),
  ]);
  const list = Array.isArray(msgs) ? msgs : [];
  el.innerHTML = `
    ${news.length ? `<section class="card panel"><h3>Nachrichten des Tages</h3>
      ${news.map((n) => `<div class="news"><b>${esc(n.subject)}</b><p>${esc(htmlToText(n.text))}</p></div>`).join('')}</section>` : ''}
    <section class="card panel">
      <h3>Posteingang</h3>
      ${msgs.error ? `<p class="muted">Mitteilungen konnten nicht geladen werden (${esc(msgs.error)}).</p>`
        : list.length ? `<div class="msg-list">${list.map((m) => `
          <button class="msg${m.read ? '' : ' unread'}" data-id="${esc(m.id)}">
            <span class="avatar">${esc((m.sender || '?')[0])}</span>
            <span class="msg-main">
              <span class="msg-top"><b>${esc(m.sender)}</b><small>${m.sent ? new Date(m.sent).toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' }) : ''}</small></span>
              <span class="msg-subject">${esc(m.subject)}${m.attachments ? ' 📎' : ''}</span>
              <span class="msg-preview">${esc(htmlToText(m.preview))}</span>
            </span>
          </button>`).join('')}</div>`
        : '<p class="muted">Keine Mitteilungen.</p>'}
    </section>`;

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('.msg');
    if (!b) return;
    b.classList.remove('unread');
    $('#details-body').innerHTML = spinner();
    $('#details').showModal();
    try {
      const m = await load('msg:' + b.dataset.id, '/api/messages/' + encodeURIComponent(b.dataset.id));
      $('#details-body').innerHTML = `
        <h2>${esc(m.subject)}</h2>
        <p class="muted">${esc(m.sender)} · ${m.sent ? new Date(m.sent).toLocaleString('de') : ''}</p>
        <div class="msg-body">${esc(htmlToText(m.content))}</div>
        ${m.attachments.length ? `<p class="muted">📎 ${m.attachments.map(esc).join(', ')} (in WebUntis öffnen)</p>` : ''}`;
    } catch (ex) {
      $('#details-body').innerHTML = notice('Fehler: ' + ex.message);
    }
  });
}

// ---------- Ansicht: Abwesenheiten ----------

async function viewAbsences(el) {
  let list;
  try {
    list = await load('absences', '/api/absences');
  } catch (e) {
    el.innerHTML = notice(e.status === 403 ? 'Abwesenheiten gibt deine Schule für die App nicht frei.' : 'Fehler: ' + e.message);
    return;
  }
  const open = list.filter((a) => !a.excused);
  el.innerHTML = `
    <div class="stats">
      <div class="card stat"><span class="stat-value">${list.length}</span><span class="stat-label">Abwesenheiten im Schuljahr</span></div>
      <div class="card stat ${open.length ? 'danger' : ''}"><span class="stat-value">${open.length}</span><span class="stat-label">nicht entschuldigt</span></div>
    </div>
    <section class="card panel">
      ${list.length ? `<div class="mini-list">${list.map((a) => `
        <div class="mini">
          <span class="mini-date"><b>${fromUntis(a.startDate).getDate()}.${fromUntis(a.startDate).getMonth() + 1}.</b><small>${DAY_NAMES[fromUntis(a.startDate).getDay()]}</small></span>
          <span class="mini-main">
            <b>${a.startDate === a.endDate ? `${fmtTime(a.startTime)}–${fmtTime(a.endTime)}` : `bis ${fmtDate(a.endDate)} ${fmtTime(a.endTime)}`}
              <span class="tag ${a.excused ? 'ok' : 'cancelled'}">${a.excused ? 'entschuldigt' : esc(a.status || 'offen')}</span></b>
            <small>${esc([a.reason, a.text].filter(Boolean).join(' · '))}</small>
          </span>
        </div>`).join('')}</div>` : `<div class="empty-mini">${figureHtml('happy')}<span>Keine Abwesenheiten – super!</span></div>`}
    </section>`;
}

// ---------- Ansicht: Hausaufgaben ----------

async function viewHomework(el) {
  let list;
  try {
    list = await load('homework', '/api/homework');
  } catch (e) {
    el.innerHTML = notice(e.status === 403 ? 'Hausaufgaben gibt deine Schule für die App nicht frei.' : 'Fehler: ' + e.message);
    return;
  }
  const key = untisDate(new Date());
  const open = list.filter((h) => !h.completed && h.dueDate >= key);
  const late = list.filter((h) => !h.completed && h.dueDate < key);
  const done = list.filter((h) => h.completed);
  const card = (h) => `
    <div class="card hw" style="--h:${hue(h.subject)}">
      <div class="hw-top"><b>${esc(h.subject)}</b><span class="tag ${h.completed ? 'ok' : h.dueDate < key ? 'cancelled' : ''}">fällig ${fmtDate(h.dueDate)} · ${relDay(h.dueDate)}</span></div>
      <p>${esc(h.text)}</p>
      ${h.remark ? `<p class="muted">${esc(h.remark)}</p>` : ''}
      <small class="muted">aufgegeben ${fmtDate(h.date)}${h.teacher ? ' · ' + esc(h.teacher) : ''}</small>
    </div>`;
  const group = (title, items) => items.length ? `<h3 class="group">${title} <span class="count">${items.length}</span></h3><div class="hw-grid">${items.map(card).join('')}</div>` : '';
  el.innerHTML = list.length
    ? group('Offen', open) + group('Überfällig', late) + group('Erledigt', done)
    : notice('Keine Hausaufgaben eingetragen.', figureHtml('relax', 'big'));
}

// ---------- Ansicht: Prüfungen ----------

async function viewExams(el) {
  let list;
  try {
    list = await load('exams', '/api/exams');
  } catch (e) {
    el.innerHTML = notice(e.status === 403 ? 'Prüfungen gibt deine Schule für die App nicht frei.' : 'Fehler: ' + e.message);
    return;
  }
  const key = untisDate(new Date());
  const upcoming = list.filter((x) => x.date >= key);
  const past = list.filter((x) => x.date < key).reverse();
  const card = (x, future) => `
    <div class="card exam-card${future ? '' : ' past'}" style="--h:${hue(x.subject || x.name)}">
      <div class="exam-date"><b>${fromUntis(x.date).getDate()}</b><span>${fromUntis(x.date).toLocaleDateString('de', { month: 'short' })}</span></div>
      <div class="exam-main">
        <span class="badge">${esc(x.name || 'Test')}</span>
        <b>${esc(x.subject || '')}</b>
        <small class="muted">${fmtDate(x.date)} · ${fmtTime(x.startTime)}–${fmtTime(x.endTime)}${x.rooms?.length ? ' · ' + esc(x.rooms.join(', ')) : ''} · ${relDay(x.date)}</small>
        ${x.text ? `<small>${esc(x.text)}</small>` : ''}
        ${x.grade ? `<small>Note: <b>${esc(x.grade)}</b></small>` : ''}
      </div>
      ${future ? figureHtml('sad', 'mid', x.id) : ''}
    </div>`;
  el.innerHTML = `
    <h3 class="group">Kommende Prüfungen <span class="count">${upcoming.length}</span></h3>
    ${upcoming.length ? `<div class="exam-list">${upcoming.map((x) => card(x, true)).join('')}</div>`
      : `<div class="card panel empty-mini">${figureHtml('relax')}<span>Keine Prüfungen geplant – entspann dich!</span></div>`}
    ${past.length ? `<h3 class="group">Vergangene Prüfungen <span class="count">${past.length}</span></h3>
      <div class="exam-list">${past.map((x) => card(x, false)).join('')}</div>` : ''}`;
}

// ---------- Bereiche ohne feste Struktur (Noten, Klassenbuch, Dienste, Sprechstunden) ----------

const label = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function fmtValue(k, v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'ja' : 'nein';
  if (typeof v === 'number' && /date/i.test(k) && v > 19000000) return fmtDate(v);
  if (typeof v === 'number' && /time/i.test(k) && v <= 2400) return fmtTime(v);
  if (Array.isArray(v)) return v.map((x) => fmtValue(k, x)).filter(Boolean).join(', ');
  if (typeof v === 'object') return v.displayName || v.longName || v.longname || v.name || v.text || '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('de', { dateStyle: 'short', timeStyle: 'short' });
  const s = htmlToText(String(v));
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

function genericHtml(data) {
  let list = data;
  if (list && !Array.isArray(list) && typeof list === 'object') {
    list = Object.values(list).find((v) => Array.isArray(v) && v.length) || [list];
  }
  if (!Array.isArray(list) || !list.length) return notice('Keine Einträge.', figureHtml('relax', 'big'));
  return `<div class="generic">${list.slice(0, 300).map((item) => {
    if (typeof item !== 'object') return `<div class="card panel">${esc(item)}</div>`;
    const rows = Object.entries(item)
      .filter(([k]) => !/^id$|Id$|^ids?$/i.test(k))
      .map(([k, v]) => [label(k), fmtValue(k, v)])
      .filter(([, v]) => v !== '');
    return `<div class="card panel"><dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`;
  }).join('')}</div>`;
}

async function viewSection(el, name) {
  try {
    const r = await load('section:' + name, '/api/section/' + name);
    el.innerHTML = genericHtml(r.data);
  } catch (e) {
    el.innerHTML = notice(e.message);
  }
}

// ---------- Details zu einer Stunde ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('.lesson');
  if (!el) return;
  const m = currentLessons[el.dataset.id];
  if (!m) return;
  const p = m.p;
  const d = fromUntis(p.date);
  const subject = subjectOf(p);
  const person = (list) => (list || [])
    .map((x) => esc(x.longname || x.name) + (x.orgname ? ` <span class="muted">(statt ${esc(x.orgname)})</span>` : ''))
    .join(', ');

  const ex = p._exam;
  const rows = [
    ['Test', ex ? `<b class="exam-text">📝 ${esc(ex.name || 'Test')}</b>${ex.text ? '<br>' + esc(ex.text) : ''}` : ''],
    ['Zeit', `${DAY_LONG[d.getDay()]}, ${d.toLocaleDateString('de')}<br>${fmtTime(m.start)} – ${fmtTime(m.end)}`],
    ['Status', p.code === 'cancelled' ? '<span style="color:var(--danger)">Entfällt</span>'
      : p.code === 'irregular' ? '<span class="changed">Geändert / Vertretung</span>' : 'Normal'],
    ['Lehrkraft', person(p.te)],
    ['Raum', person(p.ro)],
    ['Klasse', person(p.kl)],
    ['Vertretungstext', esc(p.substText)],
    ['Info', esc(p.info)],
    ['Stundentext', esc(p.lstext)],
  ].filter(([, v]) => v);

  $('#details-body').innerHTML = `
    <h2 style="--h:${hue(shortOf(p))}"><span class="dot"></span>${esc(subject)}</h2>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  $('#details').showModal();
});

// ---------- Strichmännchen ----------
// Alle Posen im gleichen Stil: dicke Linien, gefüllter Kopf, Boden-Linie. viewBox 40×40, Boden bei y=34.

const FLOOR = '<path class="floor" d="M5 34H35"/>';
const pose = (cls, inner) => `<svg class="pose ${cls}" viewBox="0 0 40 40" aria-hidden="true">${inner}${FLOOR}</svg>`;

// Verzweifelt (vor einem Test)
const SAD_POSES = [
  // sitzt zusammengekauert unter einer Regenwolke
  `<g class="cloud"><circle cx="17" cy="4.6" r="2.4"/><circle cx="20.5" cy="3.4" r="3"/><circle cx="24" cy="4.8" r="2.2"/><rect x="16" y="4.6" width="9" height="2.4" rx="1.2"/></g>
   <path class="rain" d="M17.5 9l-.7 1.8M20.7 9l-.7 1.8M23.8 9l-.7 1.8"/>
   <circle cx="21" cy="16.5" r="3.4" class="head"/>
   <path d="M14 33Q11.5 24 17.5 19.5M14 33L24.5 24.5L28.5 33M17.5 20.5Q21 27 25.5 23.5"/>`,
  // rauft sich die Haare
  `<path class="scribble" d="M13 4.5c1.2-1.8 2.4 1.8 3.6 0s2.4 1.8 3.6 0 2.4 1.8 3.6 0 2.4 1.8 3.4 0"/>
   <circle cx="20" cy="12" r="3.4" class="head"/>
   <path d="M20 15.5V24.5M20 24.5L16.5 33.5M20 24.5L23.5 33.5M20 17.5L13.5 10L16.2 10.8M20 17.5L26.5 10L23.8 10.8"/>`,
  // Kopf auf dem Tisch, Bücherstapel
  `<path class="prop" d="M21 22.5H36M33.5 22.5V34M10.5 27.5H17M12 27.5V34M28.5 18.5h6v4h-6zM29.5 15h5v3.5h-5z"/>
   <circle cx="23" cy="18.2" r="3.4" class="head"/>
   <path d="M14 27L19.5 20.5M19.5 21.5L27 21.8M14 27L21 27.5L21 34"/>
   <path class="drops" d="M17 12.5q-1 1.8 0 2.3q1-.5 0-2.3M20 10q-.8 1.5 0 1.9q.8-.4 0-1.9"/>`,
  // kniet und lässt den Kopf zu Boden hängen
  `<circle cx="26" cy="30.2" r="3.2" class="head"/>
   <path d="M9 33.5H18M18 33.5L11.5 27.5M11.5 27.5L22.5 28.5M22 29.5L33.5 33.5"/>
   <path class="scribble" d="M25 21.5l1.2-2.2M28.5 22l2-1.6M21.5 22.2l-.6-2.4"/>`,
  // versteckt sich hinter einem Riesenbuch
  `<circle cx="14" cy="11" r="3.4" class="head"/>
   <path d="M14 14.5V24.5M14 24.5L10.5 33.5M14 24.5L17.5 33.5M14 16.5L20.5 14.5M14 18.5L20.5 19.5"/>
   <path class="prop book" d="M20 10l7-2v14l-7 2zM27 8l7 2v14l-7-2z"/>
   <path class="drops" d="M9.5 7q-1 1.8 0 2.3q1-.5 0-2.3"/>`,
].map((p) => pose('sad', p));

// Jubelnd (nach dem Antippen)
const HAPPY_POSES = [
  // Freudensprung
  `<circle cx="20" cy="8.5" r="3.4" class="head"/>
   <path d="M20 12V23.5M20 23.5L15.5 33.5M20 23.5L24.5 33.5M20 15L13.5 7.5M20 15L26.5 7.5"/>
   <path class="spark" d="M9 4.5h3M10.5 3v3M28.5 4.5h3M30 3v3"/>`,
  // Siegerfaust
  `<circle cx="18" cy="9" r="3.4" class="head"/>
   <path d="M18 12.5V23.5M18 23.5L13.5 33.5M18 23.5L23 33.5M18 15L23.5 12L25 6.5M18 15L13.5 18.5L16.5 21.5"/>
   <circle cx="25.2" cy="5.3" r="1.6" class="head"/>
   <path class="spark" d="M29 4l2.5-1.5M29.5 7.5h3M28.5 10.5l2.5 1.2"/>`,
  // Tanz
  `<circle cx="18.5" cy="8.5" r="3.4" class="head"/>
   <path d="M19 12L21 23M21 23L15 28.5L17 33.5M21 23L27 33.5M19.6 15L12.5 11.5M19.6 15L26 18.5L28.5 22.5"/>
   <path class="spark" d="M31 4v5M31 4l3.5-1v5"/><circle class="note" cx="30" cy="9.3" r="1.3"/><circle class="note" cx="33.5" cy="8.3" r="1.3"/>`,
  // zeigt die Muskeln
  `<circle cx="20" cy="9" r="3.4" class="head"/>
   <path d="M20 12.5V23.5M20 23.5L14.5 33.5M20 23.5L25.5 33.5M20 15.5H13.5V10M20 15.5H26.5V10"/>
   <circle cx="13.5" cy="9" r="1.6" class="head"/><circle cx="26.5" cy="9" r="1.6" class="head"/>
   <path class="spark" d="M8 6l-2-1.5M7.5 10H5M32 6l2-1.5M32.5 10H35"/>`,
].map((p) => pose('happy', p));

// Entspannt (nichts steht an)
const RELAX_POSES = [
  // liegt mit verschränkten Armen und schläft
  `<circle cx="9" cy="28.5" r="3.4" class="head"/>
   <path d="M12.5 30.5L25 31.5M25 31.5L30 24.5L34 32M25 31.5L32 26M14 29.5L10 23.5L6.5 26"/>
   <path class="zzz" d="M15 13h4l-4 4h4M21 7h3l-3 3h3"/>`,
  // lehnt sich zurück und hört Musik
  `<circle cx="12" cy="17.5" r="3.4" class="head"/>
   <path d="M13 21L17 32.5M13.5 23L8.5 33.5M17 32.5L24 26L29 33.5M17 33L31 33.5"/>
   <path class="spark" d="M21 8v5M21 8l4-1v5"/><circle class="note" cx="20" cy="13.3" r="1.3"/><circle class="note" cx="24" cy="12.3" r="1.3"/>`,
].map((p) => pose('relax', p));

// FNV-1a: streut auch ähnliche Kennungen (z. B. 12:20261006 und 13:20261006) gut über alle Posen
function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
let lastSad = -1; // wird bei jedem Neuzeichnen zurückgesetzt, damit die Reihenfolge stabil bleibt
const pickIndex = (list, seed) => hashStr(seed) % list.length;
const pick = (list, seed) => list[pickIndex(list, seed)];
const otherIndex = (list, current) => (current + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;

// kind: 'sad' (anklickbar, jubelt dann), 'happy' oder 'relax'; size: '' | 'mid' | 'big'
// seed sorgt dafür, dass verschiedene Tests verschiedene Männchen bekommen, ein Test aber immer dasselbe.
function figureHtml(kind = 'sad', size = '', seed = Math.random()) {
  if (kind === 'sad') {
    let sad = pickIndex(SAD_POSES, seed);
    if (sad === lastSad) sad = (sad + 1) % SAD_POSES.length; // Nachbarn sehen nie gleich aus
    lastSad = sad;
    const happy = pickIndex(HAPPY_POSES, seed + '!');
    return `<span class="figure ${size}" role="button" tabindex="0" aria-label="Aufmunterung" data-sad="${sad}" data-happy="${happy}">${SAD_POSES[sad]}${HAPPY_POSES[happy]}</span>`;
  }
  const svg = kind === 'happy' ? pick(HAPPY_POSES, seed).replace('pose happy', 'pose') : pick(RELAX_POSES, seed);
  return `<span class="figure static ${size}" aria-hidden="true">${svg}</span>`;
}

const CHEERS = [
  'Du kannst das schaffen! 💪',
  'Du hast schon Schwierigeres geschafft!',
  'Atme tief durch – du bist besser vorbereitet, als du denkst.',
  'Ein Test ist nur eine Momentaufnahme, nicht dein Wert.',
  'Schritt für Schritt, Aufgabe für Aufgabe. 🧩',
  'Glaub an dich – ich tu’s auch!',
  'Du rockst das! 🎸',
  'Egal wie’s ausgeht: Du hast dein Bestes gegeben.',
  'Fang mit der leichtesten Aufgabe an, dann läuft’s.',
  'Kopf hoch, du hast das drauf! 🌟',
  'Jede Minute Lernen zahlt sich jetzt aus.',
  'Nervosität heißt nur, dass es dir wichtig ist.',
  'Danach gibt’s eine Belohnung. 🍫',
  'Du bist klüger, als dein Lampenfieber dir erzählt.',
];
let lastCheer = -1, bubbleTimer;

function cheer(fig) {
  haptic();
  let i;
  do i = Math.floor(Math.random() * CHEERS.length); while (i === lastCheer && CHEERS.length > 1);
  lastCheer = i;

  // Jedes Antippen: neue Jubel-Pose. Danach setzt sich das Männchen in einer neuen traurigen Pose wieder hin.
  if (!fig.classList.contains('cheering')) {
    const happy = otherIndex(HAPPY_POSES, Number(fig.dataset.happy));
    $('.pose.happy', fig).outerHTML = HAPPY_POSES[happy];
    fig.dataset.happy = happy;
  }
  fig.classList.add('cheering');
  clearTimeout(fig._timer);
  fig._timer = setTimeout(() => {
    const sad = otherIndex(SAD_POSES, Number(fig.dataset.sad));
    $('.pose.sad', fig).outerHTML = SAD_POSES[sad];
    fig.dataset.sad = sad;
    fig.classList.remove('cheering');
  }, 3200);

  const bubble = $('#bubble');
  bubble.textContent = CHEERS[i];
  bubble.hidden = false;
  const r = fig.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  bubble.style.left = left + 'px';
  bubble.style.top = r.top + scrollY - bubble.offsetHeight - 10 + 'px';
  bubble.style.setProperty('--tail', r.left + r.width / 2 - left + 'px');
  bubble.classList.remove('pop');
  void bubble.offsetWidth; // Animation neu starten
  bubble.classList.add('pop');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (bubble.hidden = true), 3200);
}

document.addEventListener('click', (e) => {
  const fig = e.target.closest('.figure:not(.static)');
  if (!fig) return;
  e.stopPropagation(); // keine Details öffnen
  cheer(fig);
}, true);

document.addEventListener('keydown', (e) => {
  const fig = e.target.closest?.('.figure:not(.static)');
  if (fig && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation();
    cheer(fig);
  }
}, true);

addEventListener('scroll', () => ($('#bubble').hidden = true), { passive: true, capture: true });

// ---------- GitHub-Version (ohne Server) ----------
// GitHub Actions legt für jeden Nutzer verschlüsselte Daten als data/<id>.enc.json neben die App.
// Der Browser entschlüsselt sie mit dem App-Passwort; alle /api-Aufrufe werden dann daraus beantwortet.

const b64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function decryptBundle(enc, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

const staticError = (status, message) => Object.assign(new Error(message), { status });

function staticApi(path) {
  const d = state.data;
  const url = new URL(path, location.href);
  const p = url.pathname.slice(url.pathname.indexOf('/api/'));
  if (p === '/api/logout') {
    store('unlock', null);
    state.data = null;
    state.creds = null;
    return Promise.resolve({ ok: true });
  }
  if (!d) return Promise.reject(staticError(401, 'Gesperrt'));

  const today = new Date();
  const key = untisDate(today);
  const until = (days) => untisDate(addDays(today, days));
  const need = (v, msg = 'Diesen Bereich gibt deine Schule für die App nicht frei.') =>
    (v === null || v === undefined ? Promise.reject(staticError(403, msg)) : Promise.resolve(v));

  const msg = /^\/api\/messages\/(.+)$/.exec(p);
  if (msg) return need(d.messageDetails?.[decodeURIComponent(msg[1])], 'Nur die neuesten Mitteilungen sind gespeichert – bitte in WebUntis öffnen.');
  const sec = /^\/api\/section\/(\w+)$/.exec(p);
  if (sec) return need(d.sections?.[sec[1]]);

  switch (p) {
    case '/api/me': return Promise.resolve(d.me);
    case '/api/timetable': {
      const start = url.searchParams.get('start');
      const type = Number(url.searchParams.get('type')), id = Number(url.searchParams.get('id'));
      if (type === 1) return need(d.classWeeks?.[`${id}:${start}`], 'Für andere Klassen sind nur diese und nächste Woche gespeichert.');
      return need(d.weeks?.[start], 'Diese Woche ist nicht gespeichert (verfügbar: 2 Wochen zurück bis 5 Wochen voraus).');
    }
    case '/api/elements':
      return Number(url.searchParams.get('type')) === 1
        ? need(d.classes)
        : Promise.reject(staticError(403, 'In der GitHub-Version gibt es nur die Stundenpläne der Klassen.'));
    case '/api/exams': return need(d.exams);
    case '/api/homework': return need(d.homework);
    case '/api/absences': return need(d.absences);
    case '/api/messages': return need(d.messages);
    case '/api/news': return Promise.resolve(d.newsDate === key ? d.news : []);
    case '/api/day':
      return Promise.resolve({
        timetable: d.weeks?.[isoDate(mondayOf(today))] || { periods: [], timegrid: [], holidays: [], exams: [] },
        homework: d.homework && d.homework.filter((h) => h.dueDate >= key && h.dueDate <= until(14)),
        exams: d.exams && d.exams.filter((x) => x.date >= key && x.date <= until(28)),
        news: d.newsDate === key ? d.news : [],
      });
    default: return Promise.reject(staticError(404, 'Nicht gefunden'));
  }
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

// Gleiche Ableitung wie lib/secure.js userId(): Dateiname verrät den Benutzernamen nicht
async function userId(username) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username.trim().toLowerCase()));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

async function fetchUserData(user) {
  const res = await fetch(`data/${await userId(user)}.enc.json?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}

async function unlock(user, password, remember) {
  const enc = await fetchUserData(user);
  if (!enc) throw staticError(404, 'Für diesen Benutzernamen gibt es noch keinen Zugang. Nach dem Anlegen dauert es ein paar Minuten.');
  try {
    state.data = await decryptBundle(enc, password);
  } catch {
    throw staticError(401, 'Falsches App-Passwort.');
  }
  state.encrypted = enc;
  state.creds = { user, password };
  store('lastUser', user);
  store('unlock', remember ? { user, password } : null);
  state.cache.clear();
  $('#unlock-form').hidden = true;
  await showApp();
}

$('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#unlock-error'), btn = $('#unlock-btn');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Entschlüsseln…';
  try {
    await unlock($('#unlock-user').value.trim(), $('#unlock-password').value, $('#unlock-remember').checked);
    $('#unlock-password').value = '';
  } catch (ex) {
    err.textContent = ex.status ? ex.message : 'Die Daten konnten nicht geladen werden. Bitte später noch einmal versuchen.';
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Öffnen';
  }
});

// Wenn die App wieder in den Vordergrund kommt: neuere Daten holen (GitHub aktualisiert alle 30 Minuten)
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.data || !state.creds) return;
  const enc = await fetchUserData(state.creds.user).catch(() => null);
  if (!enc || enc.data === state.encrypted.data) return;
  try {
    state.data = await decryptBundle(enc, state.creds.password);
    state.encrypted = enc;
    state.cache.clear();
    showApp();
  } catch { /* App-Passwort wurde geändert: beim nächsten Öffnen neu eingeben */ }
});

// ---------- Zugang anlegen (GitHub-Version) ----------
// Die Anmeldedaten werden im Browser mit dem öffentlichen Schlüssel der Seite verschlüsselt.
// Lesen kann sie nur die GitHub-Automatik dieses Repositories – nicht der Besitzer, nicht andere Besucher.

async function makeRegistrationCode(payload) {
  const { spki } = await (await fetch('register-key.json', { cache: 'no-store' })).json();
  const pub = await crypto.subtle.importKey('spki', b64(spki), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(payload)));
  const k = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', aes));
  const json = JSON.stringify({ k: toB64(k), iv: toB64(iv), d: toB64(d) });
  const base64url = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'SP1.' + base64url;
}

// Auf GitHub Pages (name.github.io/repo/) lässt sich das Repository aus der Adresse ablesen
function repoFromLocation() {
  const owner = /^([^.]+)\.github\.io$/i.exec(location.hostname)?.[1];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return owner && repo ? `${owner}/${repo}` : null;
}

function showRegister() {
  $('#unlock-form').hidden = true;
  $('#register-done').hidden = true;
  $('#register-form').hidden = false;
  $('#reg-school').focus();
}

$('#to-register').addEventListener('click', showRegister);
$$('.to-unlock').forEach((b) => b.addEventListener('click', showLogin));

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#register-error');
  err.hidden = true;
  const v = (id) => $(id).value;
  if (v('#reg-app').length < 10) {
    err.textContent = 'Das App-Passwort braucht mindestens 10 Zeichen.';
    err.hidden = false;
    return;
  }
  if (v('#reg-app') !== v('#reg-app2')) {
    err.textContent = 'Die beiden App-Passwörter stimmen nicht überein.';
    err.hidden = false;
    return;
  }
  if (v('#reg-app') === v('#reg-password')) {
    err.textContent = 'Bitte nimm als App-Passwort nicht dein Untis-Passwort.';
    err.hidden = false;
    return;
  }
  try {
    const code = await makeRegistrationCode({
      school: v('#reg-school').trim(),
      user: v('#reg-user').trim(),
      password: v('#reg-password'),
      appPassword: v('#reg-app'),
      created: new Date().toISOString(),
    });
    store('lastUser', v('#reg-user').trim());
    $('#register-form').reset();
    $('#reg-code').value = code;
    const repo = repoFromLocation();
    const body = 'Bitte nichts ändern – der Code ist verschlüsselt und nur für die automatische Anmeldung lesbar.\n\n' + code;
    $('#reg-issue').hidden = !repo;
    if (repo) $('#reg-issue').href = `https://github.com/${repo}/issues/new?title=${encodeURIComponent('Anmeldung')}&body=${encodeURIComponent(body)}`;
    $('#register-form').hidden = true;
    $('#register-done').hidden = false;
  } catch {
    err.textContent = 'Der Code konnte nicht erstellt werden. Bitte die Seite neu laden und noch einmal versuchen.';
    err.hidden = false;
  }
});

$('#reg-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#reg-code').value);
    $('#reg-copy').textContent = 'Kopiert ✓';
  } catch {
    $('#reg-code').select();
    $('#reg-copy').textContent = 'Markiert – jetzt kopieren';
  }
  setTimeout(() => ($('#reg-copy').textContent = 'Code kopieren'), 2500);
});

// ---------- Start ----------

(async function start() {
  // Antwortet /api/me, läuft der lokale Server. Sonst (z. B. GitHub Pages) die GitHub-Version.
  const res = await fetch('/api/me').catch(() => null);
  if (res && (res.ok || res.status === 401)) {
    return res.ok ? showApp() : showLogin();
  }
  state.static = true;
  showLogin();
  const saved = store('unlock');
  if (saved?.user) {
    // Gemerkter Zugang: Sperrseite mit „Entschlüsseln…“ zeigen statt einer leeren Seite
    const btn = $('#unlock-btn');
    btn.disabled = true;
    btn.textContent = 'Entschlüsseln…';
    try { await unlock(saved.user, saved.password, true); } catch { store('unlock', null); }
    btn.disabled = false;
    btn.textContent = 'Öffnen';
  }
})();
