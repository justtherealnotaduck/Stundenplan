// Läuft in GitHub Actions: holt alle Daten von WebUntis, verschlüsselt sie mit dem App-Passwort
// und legt sie als public/data.enc.json ab. GitHub Pages liefert sie dann zusammen mit der App aus.
//
// Wichtig: Die Logs eines öffentlichen Repositories kann jeder lesen.
// Darum werden hier nur Anzahlen ausgegeben, nie Namen, Fächer oder Inhalte.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const u = require('../lib/untis');

const WEEKS_BACK = 2;
const WEEKS_AHEAD = 5;
const MAX_MESSAGES = 30;
const MAX_CLASSES = 80;
const PBKDF2_ITERATIONS = 250000;

// Fehler, die wir selbst erklären (ohne Stacktrace ausgeben)
const fail = (message) => Object.assign(new Error(message), { expected: true });

function env(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw fail(`Das Secret ${name} fehlt. Bitte unter Settings → Secrets and variables → Actions anlegen.`);
  return v;
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d) => u.addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));

// Fehler einzelner Bereiche brechen nicht alles ab (manche Schulen geben z. B. Noten nicht frei).
async function attempt(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.log(`  ${label}: nicht verfügbar (${e.message})`);
    return null;
  }
}

async function findSchool(name) {
  const r = await u.searchSchools(name);
  if (r.tooMany) throw fail('Zu viele Schulen gefunden. Bitte UNTIS_SCHOOL genauer angeben (voller Name).');
  if (!r.length) throw fail('Keine Schule gefunden. Bitte UNTIS_SCHOOL prüfen.');
  const lower = name.toLowerCase();
  const exact = r.find((x) => x.name.toLowerCase() === lower || x.school.toLowerCase() === lower);
  if (!exact && r.length > 1) console.log(`  Hinweis: ${r.length} Schulen passen, nehme die erste. Für Sicherheit den vollen Namen angeben.`);
  return exact || r[0];
}

function encrypt(bundle, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = zlib.gzipSync(JSON.stringify(bundle));
  // WebCrypto erwartet den Auth-Tag direkt hinter dem Geheimtext
  const data = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    gzip: true,
    data: data.toString('base64'),
  };
}

async function main() {
  const out = process.argv[2] || path.join(__dirname, '..', 'public', 'data.enc.json');
  const appPassword = env('APP_PASSWORD');
  if (appPassword.length < 10) throw fail('APP_PASSWORD ist zu kurz. Bitte mindestens 10 Zeichen verwenden.');

  console.log('Schule suchen …');
  const school = await findSchool(env('UNTIS_SCHOOL'));
  const s = {
    school: school.school,
    schoolName: school.name,
    server: school.server,
    user: env('UNTIS_USER'),
    password: env('UNTIS_PASSWORD'),
    cache: {},
  };

  console.log('Anmelden …');
  try {
    await u.authenticate(s);
  } catch (e) {
    throw fail(e.code === -8504 ? 'Benutzername oder Passwort falsch.' : `Anmeldung fehlgeschlagen: ${e.message}`);
  }
  await u.loadProfile(s);

  const today = new Date();
  const monday = mondayOf(today);
  const todayKey = u.ymd(today);

  console.log('Stundenplan …');
  const weeks = {};
  for (let w = -WEEKS_BACK; w <= WEEKS_AHEAD; w++) {
    const start = u.addDays(monday, w * 7);
    const tt = await attempt(`Woche ${w}`, () => u.timetable(s, start));
    if (tt) weeks[isoDate(start)] = tt;
  }

  console.log('Prüfungen, Hausaufgaben, Abwesenheiten, Mitteilungen …');
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

  console.log('Klassen-Stundenpläne …');
  const classes = await attempt('Klassenliste', () => u.elements(s, 1));
  const classWeeks = {};
  for (const k of (classes || []).slice(0, MAX_CLASSES)) {
    for (const start of [monday, u.addDays(monday, 7)]) {
      const tt = await attempt('Klasse', () => u.timetable(s, start, { type: 1, id: k.id }));
      if (tt) classWeeks[`${k.id}:${isoDate(start)}`] = tt;
    }
  }

  console.log('Weitere Bereiche …');
  const sections = {};
  for (const name of ['grades', 'classreg', 'services', 'officehours']) {
    const r = await attempt(name, () => u.section(s, name));
    if (r) sections[name] = r;
  }

  await u.rpc(u.apiUrl(s), 'logout', {}, u.untisCookie(s)).catch(() => {});

  const bundle = {
    v: 1,
    generated: new Date().toISOString(),
    me: {
      user: s.user,
      displayName: s.displayName || s.user,
      schoolName: s.schoolName,
      schoolYear: s.schoolYear,
      personType: s.untis.personType,
    },
    weeks,
    exams,
    homework,
    absences,
    messages,
    messageDetails,
    news,
    newsDate: todayKey,
    classes,
    classWeeks,
    sections,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(encrypt(bundle, appPassword)));

  console.log(
    `Fertig: ${Object.keys(weeks).length} Wochen, ${exams?.length ?? 0} Prüfungen, ${homework?.length ?? 0} Hausaufgaben, ` +
    `${messages?.length ?? 0} Mitteilungen, ${Object.keys(classWeeks).length} Klassen-Wochen, ${Object.keys(sections).length} Zusatzbereiche.`,
  );
}

// exitCode statt process.exit(): so werden offene Verbindungen sauber geschlossen
main().catch((e) => {
  console.error(e.expected ? e.message : `Fehler: ${e.message}`);
  process.exitCode = 1;
});
