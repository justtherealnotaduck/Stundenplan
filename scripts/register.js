// Läuft in GitHub Actions, wenn jemand ein Issue „Anmeldung“ oder „Löschen“ eröffnet.
//  - Anmeldung: Code prüfen, Einwilligung prüfen, Untis-Login testen, users/<id>.json anlegen
//  - Löschen:   App-Passwort mit dem gespeicherten Zugang vergleichen, users/<id>.json entfernen
// Das Ergebnis geht über GITHUB_OUTPUT an den Workflow, der dann antwortet und das Issue schließt.
// Es werden keine persönlichen Daten ausgegeben (öffentliche Logs!).

const fs = require('fs');
const path = require('path');
const u = require('../lib/untis');
const { userId, findCode, decryptRegistration } = require('../lib/secure');
const { resolveSchool } = require('./fetch-data');

const USERS_DIR = path.join(__dirname, '..', 'users');

function output(result, message) {
  console.log(`${result}: ${message}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\nmessage=${message.replace(/\n/g, ' ')}\n`);
  }
}

async function register(creds, code) {
  if (!creds.consent?.at) {
    return output('error', 'Ohne Zustimmung zur Datenschutzerklärung kann kein Zugang angelegt werden.');
  }

  // Login testen, damit nur funktionierende Zugänge aufgenommen werden
  try {
    const school = await resolveSchool(creds);
    const s = { school: school.school, server: school.server, user: creds.user, password: creds.password };
    await u.authenticate(s);
    await u.rpc(u.apiUrl(s), 'logout', {}, u.untisCookie(s)).catch(() => {});
  } catch (e) {
    const msg = e.code === -8504 ? 'Untis-Benutzername oder -Passwort ist falsch.' : e.message;
    return output('error', `Die Anmeldung bei WebUntis hat nicht geklappt: ${msg}`);
  }

  fs.mkdirSync(USERS_DIR, { recursive: true });
  const file = path.join(USERS_DIR, `${userId(creds.user)}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, JSON.stringify({ code, updated: new Date().toISOString() }, null, 2) + '\n');
  output('ok', existed
    ? 'Dein Zugang wurde aktualisiert. Die neuen Daten sind in wenigen Minuten da.'
    : 'Du bist angemeldet! In wenigen Minuten kannst du dich mit deinem Untis-Benutzernamen und App-Passwort einloggen.');
}

function remove(request, key) {
  const file = path.join(USERS_DIR, `${userId(request.user)}.json`);
  if (!fs.existsSync(file)) return output('error', 'Für diesen Benutzernamen gibt es keinen Zugang (mehr).');
  // Nur wer das App-Passwort kennt, darf den Zugang löschen
  let stored;
  try {
    stored = decryptRegistration(JSON.parse(fs.readFileSync(file, 'utf8')).code, key);
  } catch {
    stored = null; // gespeicherter Zugang unlesbar: darf vom Eigentümer trotzdem entfernt werden
  }
  if (stored && stored.appPassword !== request.appPassword) {
    return output('error', 'Das App-Passwort stimmt nicht – der Zugang wurde nicht gelöscht.');
  }
  fs.unlinkSync(file);
  output('ok', 'Dein Zugang wurde gelöscht. Ab jetzt werden keine Daten mehr für dich abgeholt.');
}

async function main() {
  const key = (process.env.REGISTER_PRIVATE_KEY || '').trim();
  if (!key) return output('error', 'Die Anmeldung ist auf dieser Seite noch nicht eingerichtet (Secret REGISTER_PRIVATE_KEY fehlt).');

  const code = findCode(process.env.ISSUE_BODY);
  if (!code) return output('error', 'Im Issue wurde kein Code (beginnt mit SP1.) gefunden.');

  let payload;
  try {
    payload = decryptRegistration(code, key);
  } catch (e) {
    return output('error', `Der Code ist ungültig oder beschädigt (${e.message}).`);
  }

  if (payload.action === 'delete') return remove(payload, key);
  if (payload.action === 'register') return register(payload, code);
  return output('error', 'Unbekannte Art von Code.');
}

main().catch((e) => {
  output('error', `Unerwarteter Fehler: ${e.message}`);
  process.exitCode = 1;
});
