// Die API der App – gemeinsam genutzt vom lokalen Server (server.js) und vom Cloudflare Worker (worker/index.js).

const u = require('./untis');

const UNTIS_HOST = /^[a-z0-9.-]+\.webuntis\.com$/i;

// Neue Sitzung: bei WebUntis anmelden und Profil (Name, Schuljahr …) laden
async function login({ school, schoolName, server, user, password }) {
  if (!school || !server || !user || !password) throw u.httpError(400, 'Bitte alle Felder ausfüllen.');
  if (!UNTIS_HOST.test(server)) throw u.httpError(400, 'Ungültiger Server.');
  const s = { school, schoolName: schoolName || school, server, user, password, cache: {} };
  try {
    await u.authenticate(s);
  } catch (e) {
    throw u.httpError(401, e.code === -8504 ? 'Benutzername oder Passwort falsch.' : e.message);
  }
  await u.loadProfile(s);
  return s;
}

// Schulsuche (ohne Anmeldung)
async function schools(url) {
  const q = (url.searchParams.get('q') || '').trim();
  return q.length < 3 ? [] : u.searchSchools(q);
}

// Routen, die eine Anmeldung brauchen: Pfad -> (Sitzung, URL) => Antwort
const routes = {
  '/api/me': async (s) => ({
    user: s.user,
    displayName: s.displayName || s.user,
    schoolName: s.schoolName,
    schoolYear: s.schoolYear,
    personType: s.untis.personType,
  }),
  '/api/timetable': async (s, url) => {
    const start = u.parseIso(url.searchParams.get('start'));
    if (!start) throw u.httpError(400, 'Ungültiges Datum');
    const type = Number(url.searchParams.get('type')), id = Number(url.searchParams.get('id'));
    return u.timetable(s, start, type && id ? { type, id } : null);
  },
  '/api/elements': (s, url) => u.elements(s, Number(url.searchParams.get('type'))),
  '/api/exams': (s) => u.exams(s, s.schoolYear.start, s.schoolYear.end),
  '/api/homework': (s) => u.homework(s, u.ymd(u.addDays(new Date(), -21)), u.ymd(u.addDays(new Date(), 42))),
  '/api/absences': (s) => u.absences(s),
  '/api/messages': (s) => u.messages(s),
  '/api/news': (s, url) => u.news(s, Number(url.searchParams.get('date')) || u.ymd(new Date())),
  '/api/day': async (s) => {
    // Alles für die „Heute“-Seite in einer Anfrage
    const today = new Date();
    const monday = u.addDays(today, -((today.getDay() + 6) % 7));
    const [tt, hw, ex, nw] = await Promise.all([
      u.timetable(s, monday),
      u.homework(s, u.ymd(today), u.ymd(u.addDays(today, 14))).catch(() => null),
      u.exams(s, u.ymd(today), u.ymd(u.addDays(today, 28))).catch(() => null),
      u.news(s, u.ymd(today)).catch(() => []),
    ]);
    return { timetable: tt, homework: hw, exams: ex, news: nw };
  },
};

// Beantwortet eine angemeldete Anfrage unter /api/…
function handle(s, url) {
  const msg = /^\/api\/messages\/([\w-]+)$/.exec(url.pathname);
  if (msg) return u.message(s, msg[1]);
  const sec = /^\/api\/section\/(\w+)$/.exec(url.pathname);
  if (sec) return u.section(s, sec[1]);
  const route = routes[url.pathname];
  if (!route) throw u.httpError(404, 'Nicht gefunden');
  return route(s, url);
}

// Untis-Sitzung beenden (Fehler sind egal)
function logout(s) {
  return u.rpc(u.apiUrl(s), 'logout', {}, u.untisCookie(s)).catch(() => {});
}

module.exports = { login, schools, handle, logout };
