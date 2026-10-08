// Kleiner Proxy-Server für WebUntis (lokale Version).
// Der Browser darf die WebUntis-API wegen CORS nicht direkt aufrufen, darum läuft alles über diesen Server.
// Zugangsdaten werden nur im Arbeitsspeicher gehalten (für automatisches Neu-Anmelden) und nie gespeichert.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { probe } = require('./lib/untis');
const api = require('./lib/routes');

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
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
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

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL('http://x' + req.url); // so wird auch ein Pfad wie "//" nicht als Hostname gelesen
  } catch {
    return send(res, 400, { error: 'Ungültige Adresse' });
  }
  try {
    if (url.pathname === '/api/schools' && req.method === 'GET') return send(res, 200, await api.schools(url));

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const s = await api.login(await readBody(req));
      s.created = Date.now();
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
        api.logout(sess.s);
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (url.pathname === '/api/tutor') return send(res, 501, { error: 'Die Lern-KI gibt es nur in der Online-Version.' });

    if (url.pathname.startsWith('/api/')) {
      const sess = getSession(req);
      if (!sess) return send(res, 401, { error: 'Nicht angemeldet' });
      return send(res, 200, await api.handle(sess.s, url));
    }

    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    send(res, e.status || 500, { error: e.message || 'Serverfehler' });
  }
});

server.listen(PORT, () => console.log(`Stundenplan läuft auf http://localhost:${PORT}`));
