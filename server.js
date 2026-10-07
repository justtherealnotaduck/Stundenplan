// Kleiner Proxy-Server für WebUntis (lokale Version).
// Der Browser darf die WebUntis-API wegen CORS nicht direkt aufrufen, darum läuft alles über diesen Server.
// Zugangsdaten werden nur im Arbeitsspeicher gehalten (für automatisches Neu-Anmelden) und nie gespeichert.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  httpError, ymd, addDays, parseIso, rpc, apiUrl, untisCookie, authenticate,
  searchSchools, loadProfile, timetable, elements, exams, homework, absences, messages, message, news,
  section, probe,
} = require('./lib/untis');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 Stunden

const sessions = new Map(); // token -> Sitzung (siehe /api/login)

// ---------- HTTP ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error('Anfrage zu groß'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Ungültiges JSON')); }
    });
  });
}

function getSession(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  if (!s) return null;
  if (Date.now() - s.created > SESSION_TTL) {
    sessions.delete(m[1]);
    return null;
  }
  return { token: m[1], s };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL('http://x' + req.url).pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Verboten' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Nicht gefunden' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
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
    const start = parseIso(url.searchParams.get('start'));
    if (!start) throw httpError(400, 'Ungültiges Datum');
    const type = Number(url.searchParams.get('type')), id = Number(url.searchParams.get('id'));
    return timetable(s, start, type && id ? { type, id } : null);
  },
  '/api/elements': (s, url) => elements(s, Number(url.searchParams.get('type'))),
  '/api/exams': (s) => exams(s, s.schoolYear.start, s.schoolYear.end),
  '/api/homework': (s) => homework(s, ymd(addDays(new Date(), -21)), ymd(addDays(new Date(), 42))),
  '/api/absences': (s) => absences(s),
  '/api/messages': (s) => messages(s),
  '/api/news': (s, url) => news(s, Number(url.searchParams.get('date')) || ymd(new Date())),
  '/api/day': async (s) => {
    // Alles für die „Heute“-Seite in einer Anfrage
    const today = new Date();
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    const [tt, hw, ex, nw] = await Promise.all([
      timetable(s, monday),
      homework(s, ymd(today), ymd(addDays(today, 14))).catch(() => null),
      exams(s, ymd(today), ymd(addDays(today, 28))).catch(() => null),
      news(s, ymd(today)).catch(() => []),
    ]);
    return { timetable: tt, homework: hw, exams: ex, news: nw };
  },
};

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL('http://x' + req.url); // so wird auch ein Pfad wie "//" nicht als Hostname gelesen
  } catch {
    return send(res, 400, { error: 'Ungültige Adresse' });
  }
  try {
    if (url.pathname === '/api/schools' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 3) return send(res, 200, []);
      return send(res, 200, await searchSchools(q));
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const { school, schoolName, server: host, user, password } = await readBody(req);
      if (!school || !host || !user || !password) return send(res, 400, { error: 'Bitte alle Felder ausfüllen.' });
      if (!/^[a-z0-9.-]+\.webuntis\.com$/i.test(host)) return send(res, 400, { error: 'Ungültiger Server.' });
      const s = { school, schoolName: schoolName || school, server: host, user, password, created: Date.now(), cache: {} };
      try {
        await authenticate(s);
      } catch (e) {
        const msg = e.code === -8504 ? 'Benutzername oder Passwort falsch.' : e.message;
        return send(res, 401, { error: msg });
      }
      await loadProfile(s);
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, s);
      probe(s).catch(() => {});
      return send(res, 200, { ok: true }, {
        'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`,
      });
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const sess = getSession(req);
      if (sess) {
        sessions.delete(sess.token);
        rpc(apiUrl(sess.s), 'logout', {}, untisCookie(sess.s)).catch(() => {});
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (url.pathname.startsWith('/api/')) {
      const sess = getSession(req);
      if (!sess) return send(res, 401, { error: 'Nicht angemeldet' });
      const msg = /^\/api\/messages\/([\w-]+)$/.exec(url.pathname);
      if (msg) return send(res, 200, await message(sess.s, msg[1]));
      const sec = /^\/api\/section\/(\w+)$/.exec(url.pathname);
      if (sec) return send(res, 200, await section(sess.s, sec[1]));
      const route = routes[url.pathname];
      if (!route) return send(res, 404, { error: 'Nicht gefunden' });
      return send(res, 200, await route(sess.s, url));
    }

    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    send(res, e.status || 500, { error: e.message || 'Serverfehler' });
  }
});

server.listen(PORT, () => console.log(`Stundenplan läuft auf http://localhost:${PORT}`));
