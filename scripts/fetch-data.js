// Läuft in GitHub Actions: holt für jeden angemeldeten Nutzer die Daten von WebUntis,
// verschlüsselt sie mit seinem App-Passwort und legt sie als public/data/<id>.enc.json ab.
// GitHub Pages liefert sie dann zusammen mit der App aus.
//
// Nutzer kommen aus zwei Quellen:
//  1. users/<id>.json – Anmeldecodes, die über die App erzeugt wurden (nur mit REGISTER_PRIVATE_KEY lesbar)
//  2. optional die Secrets UNTIS_SCHOOL / UNTIS_USER / UNTIS_PASSWORD / APP_PASSWORD
//
// Wichtig: Die Logs eines öffentlichen Repositories kann jeder lesen.
// Darum werden hier nur Nummern und Anzahlen ausgegeben, nie Namen, Schulen oder Inhalte.

const fs = require('fs');
const path = require('path');
const u = require('../lib/untis');
const { userId, encryptBundle, decryptRegistration } = require('../lib/secure');

const ROOT = path.join(__dirname, '..');
const USERS_DIR = path.join(ROOT, 'users');
const WEEKS_BACK = 2;
const WEEKS_AHEAD = 5;
const MAX_MESSAGES = 30;
const MAX_CLASSES = 80;

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d) => u.addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));

// Fehler einzelner Bereiche brechen nicht alles ab (manche Schulen geben z. B. Noten nicht frei).
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`    ${label}: nicht verfügbar (${e.message})`);
    return null;
  }
}

const schoolCache = new Map(); // Schulname -> Treffer der Schulsuche

async function findSchool(name) {
  const key = name.trim().toLowerCase();
  if (schoolCache.has(key)) return schoolCache.get(key);
  const r = await u.searchSchools(name);
  if (r.tooMany) throw new Error('Zu viele Schulen gefunden – der Schulname muss genauer sein.');
  if (!r.length) throw new Error('Schule nicht gefunden – bitte den Namen wie in der WebUntis-Schulsuche angeben.');
  const exact = r.find((x) => x.name.toLowerCase() === key || x.school.toLowerCase() === key);
  if (!exact && r.length > 1) console.log(`    Hinweis: ${r.length} Schulen passen zum Namen, nehme die erste.`);
  schoolCache.set(key, exact || r[0]);
  return exact || r[0];
}

// Klassen-Stundenpläne sind für alle Schüler einer Schule gleich: nur einmal pro Lauf holen
const classCache = new Map(); // "server|school" -> { classes, classWeeks }

async function classTimetables(s, monday) {
  const key = `${s.server}|${s.school}`;
  if (classCache.has(key)) return classCache.get(key);
  const classes = await attempt('Klassenliste', () => u.elements(s, 1));
  const classWeeks = {};
  for (const k of (classes || []).slice(0, MAX_CLASSES)) {
    for (const start of [monday, u.addDays(monday, 7)]) {
      const tt = await attempt('Klasse', () => u.timetable(s, start, { type: 1, id: k.id }));
      if (tt) classWeeks[`${k.id}:${isoDate(start)}`] = tt;
    }
  }
  const result = { classes, classWeeks };
  classCache.set(key, result);
  return result;
}

// Holt alles für einen Nutzer und gibt das (unverschlüsselte) Datenpaket zurück.
async function buildBundle(creds) {
  const school = await findSchool(creds.school);
  const s = {
    school: school.school,
    schoolName: school.name,
    server: school.server,
    user: creds.user,
    password: creds.password,
    cache: {},
  };
  try {
    await u.authenticate(s);
  } catch (e) {
    throw new Error(e.code === -8504 ? 'Untis-Benutzername oder -Passwort falsch.' : `Anmeldung fehlgeschlagen: ${e.message}`);
  }
  await u.loadProfile(s);

  const today = new Date();
  const monday = mondayOf(today);
  const todayKey = u.ymd(today);

  const weeks = {};
  for (let w = -WEEKS_BACK; w <= WEEKS_AHEAD; w++) {
    const start = u.addDays(monday, w * 7);
    const tt = await attempt(`Woche ${w}`, () => u.timetable(s, start));
    if (tt) weeks[isoDate(start)] = tt;
  }

  const exams = await attempt('Prüfungen', () => u.exams(s, s.schoolYear.start, s.schoolYear.end));
  const homework = await attempt('Hausaufgaben', () =>
    u.homework(s, u.ymd(u.addDays(today, -21)), u.ymd(u.addDays(today, 42))));
  const absences = await attempt('Abwesenheiten', () => u.absences(s));
  const messages = await attempt('Mitteilungen', () => u.messages(s));
  const messageDetails = {};
  for (const m of (messages || []).slice(0, MAX_MESSAGES)) {
    const d = await attempt('Mitteilung', () => u.message(s, m.id));
    if (d) messageDetails[m.id] = d;
  }
  const news = (await attempt('Nachrichten des Tages', () => u.news(s, todayKey))) || [];
  const { classes, classWeeks } = await classTimetables(s, monday);

  const sections = {};
  for (const name of ['grades', 'classreg', 'services', 'officehours']) {
    const r = await attempt(name, () => u.section(s, name));
    if (r) sections[name] = r;
  }

  await u.rpc(u.apiUrl(s), 'logout', {}, u.untisCookie(s)).catch(() => {});

  return {
    v: 1,
    generated: new Date().toISOString(),
    me: {
      user: s.user,
      displayName: s.displayName || s.user,
      schoolName: s.schoolName,
      schoolYear: s.schoolYear,
      personType: s.untis.personType,
    },
    weeks, exams, homework, absences, messages, messageDetails,
    news, newsDate: todayKey,
    classes, classWeeks, sections,
  };
}

// Alle Nutzer einsammeln: angemeldete Codes + optional die eigenen Secrets
function loadUsers() {
  const users = [];
  const key = (process.env.REGISTER_PRIVATE_KEY || '').trim();
  const files = fs.existsSync(USERS_DIR) ? fs.readdirSync(USERS_DIR).filter((f) => f.endsWith('.json')) : [];
  if (files.length && !key) console.log('Hinweis: Secret REGISTER_PRIVATE_KEY fehlt – angemeldete Nutzer werden übersprungen.');
  if (key) {
    for (const f of files) {
      try {
        const { code } = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf8'));
        const p = decryptRegistration(code, key);
        if (p.action === 'register') users.push(p);
      } catch (e) {
        console.log(`Anmeldung ${f.slice(0, 6)}… kann nicht gelesen werden (${e.message})`);
      }
    }
  }
  const env = (k) => (process.env[k] || '').trim();
  if (env('UNTIS_USER') && env('UNTIS_PASSWORD') && env('UNTIS_SCHOOL') && env('APP_PASSWORD')) {
    users.push({ school: env('UNTIS_SCHOOL'), user: env('UNTIS_USER'), password: env('UNTIS_PASSWORD'), appPassword: env('APP_PASSWORD') });
  }
  // Gleicher Benutzername doppelt: der letzte Eintrag gewinnt
  return [...new Map(users.map((x) => [userId(x.user), x])).values()];
}

async function main() {
  const outDir = process.argv[2] || path.join(ROOT, 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const users = loadUsers();
  console.log(`${users.length} Nutzer`);
  let ok = 0;
  for (const [i, creds] of users.entries()) {
    console.log(`Nutzer ${i + 1}:`);
    try {
      if (creds.appPassword.length < 10) throw new Error('App-Passwort zu kurz (mind. 10 Zeichen).');
      const bundle = await buildBundle(creds);
      fs.writeFileSync(path.join(outDir, `${userId(creds.user)}.enc.json`), JSON.stringify(encryptBundle(bundle, creds.appPassword)));
      console.log(`    fertig: ${Object.keys(bundle.weeks).length} Wochen, ${bundle.exams?.length ?? 0} Prüfungen, ` +
        `${bundle.homework?.length ?? 0} Hausaufgaben, ${bundle.messages?.length ?? 0} Mitteilungen`);
      ok++;
    } catch (e) {
      console.log(`    Fehler: ${e.message}`);
    }
  }
  console.log(`${ok} von ${users.length} Nutzern aktualisiert.`);
  if (users.length && !ok) process.exitCode = 1; // alle fehlgeschlagen → Lauf rot markieren
}

module.exports = { buildBundle, findSchool };

if (require.main === module) {
  // exitCode statt process.exit(): so werden offene Verbindungen sauber geschlossen
  main().catch((e) => {
    console.error(`Fehler: ${e.message}`);
    process.exitCode = 1;
  });
}
