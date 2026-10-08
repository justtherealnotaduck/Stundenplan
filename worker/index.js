// Cloudflare Worker: die Online-Version des lokalen Servers.
// Die App auf GitHub Pages darf WebUntis nicht direkt aufrufen (CORS) – dieser Worker reicht die Anfragen weiter.
//
// Es wird nichts gespeichert. Nach dem Login bekommt der Browser ein Token: die Zugangsdaten,
// verschlüsselt mit TOKEN_KEY (Worker-Secret). Nur dieser Worker kann es öffnen. Bei jeder Anfrage
// schickt die App das Token mit; abgelaufene Untis-Sitzungen werden damit automatisch erneuert.

import u from '../lib/untis.js';
import api from '../lib/routes.js';
import tutor from '../lib/tutor.js';

const HOUR = 60 * 60 * 1000;
const TOKEN_TTL = { short: 12 * HOUR, remember: 60 * 24 * HOUR };

// ---------- Token (AES-256-GCM) ----------

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let keyPromise = null;
function tokenKey(env) {
  if (!env.TOKEN_KEY) throw u.httpError(500, 'Der Worker ist noch nicht eingerichtet (TOKEN_KEY fehlt).');
  keyPromise ||= crypto.subtle.importKey('raw', fromB64url(env.TOKEN_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return keyPromise;
}

async function makeToken(env, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await tokenKey(env), new TextEncoder().encode(JSON.stringify(payload)));
  return `${b64url(iv)}.${b64url(data)}`;
}

async function readToken(env, token) {
  try {
    const [iv, data] = token.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await tokenKey(env), fromB64url(data));
    const p = JSON.parse(new TextDecoder().decode(plain));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

// ---------- Sitzungen ----------
// Untis-Sitzungen werden kurz im Speicher dieser Worker-Instanz gehalten, damit nicht jede Anfrage neu anmeldet.
// Geht der Speicher verloren, meldet sich der Worker mit den Daten aus dem Token einfach neu an.

const sessions = new Map(); // Token -> Sitzung
const MAX_SESSIONS = 300;

async function sessionFor(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const cached = sessions.get(token);
  if (cached) return cached;
  const p = await readToken(env, token);
  if (!p) return null;
  const s = { ...p.s, cache: {} };
  try {
    await u.authenticate(s);
  } catch (e) {
    // z. B. Untis-Passwort inzwischen geändert → neu anmelden lassen
    if (e.code === -8504) return null;
    throw e;
  }
  sessions.set(token, s);
  if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  return s;
}

// ---------- Lern-KI: Limit pro Nutzer ----------
// Das Gratis-Kontingent gilt für alle zusammen – darum höchstens 40 Fragen pro Stunde und Anmeldung.

const tutorUse = new Map(); // Token -> Zeitpunkte der letzten Fragen
const TUTOR_PER_HOUR = 40;

function limitTutor(request) {
  const token = (request.headers.get('Authorization') || '').slice(7);
  const hourAgo = Date.now() - HOUR;
  const times = (tutorUse.get(token) || []).filter((t) => t > hourAgo);
  if (times.length >= TUTOR_PER_HOUR) throw u.httpError(429, 'Du hast in der letzten Stunde schon sehr viel gefragt – mach kurz Pause und versuch es gleich wieder. 🙂');
  times.push(Date.now());
  tutorUse.set(token, times);
  if (tutorUse.size > MAX_SESSIONS) tutorUse.delete(tutorUse.keys().next().value);
}

// ---------- HTTP ----------

function cors(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const headers = { Vary: 'Origin' };
  if (allowed.includes(origin)) {
    Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
  }
  return headers;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function route(request, env, url) {
  if (url.pathname === '/api/schools' && request.method === 'GET') return api.schools(url);

  if (url.pathname === '/api/login' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const s = await api.login(body);
    const { school, schoolName, server, user, password, displayName, schoolYear, tenantId } = s;
    const exp = Date.now() + (body.remember ? TOKEN_TTL.remember : TOKEN_TTL.short);
    const token = await makeToken(env, { exp, s: { school, schoolName, server, user, password, displayName, schoolYear, tenantId } });
    sessions.set(token, s);
    return { token, exp };
  }

  const s = await sessionFor(env, request);
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    if (s) api.logout(s);
    sessions.forEach((v, k) => v === s && sessions.delete(k));
    return { ok: true };
  }
  if (!s) throw u.httpError(401, 'Nicht angemeldet');
  if (url.pathname === '/api/tutor' && request.method === 'POST') {
    limitTutor(request);
    return tutor.ask(env.AI, await request.json().catch(() => ({})));
  }
  return api.handle(s, url);
}

export default {
  async fetch(request, env) {
    const headers = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return json({ ok: true, info: 'stundenplan API' }, 200, headers);
    try {
      return json(await route(request, env, url), 200, headers);
    } catch (e) {
      const status = e.status && e.status < 600 ? e.status : 500;
      if (status >= 500) console.error(e.message);
      return json({ error: e.message || 'Serverfehler' }, status, headers);
    }
  },
};
