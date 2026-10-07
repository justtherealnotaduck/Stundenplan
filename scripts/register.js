// Läuft in GitHub Actions, wenn jemand ein Issue „Anmeldung“ eröffnet.
// Prüft den Anmeldecode, testet den Untis-Login und legt users/<id>.json an.
// Das Ergebnis geht über GITHUB_OUTPUT an den Workflow, der dann antwortet und das Issue schließt.
// Es werden keine persönlichen Daten ausgegeben (öffentliche Logs!).

const fs = require('fs');
const path = require('path');
const u = require('../lib/untis');
const { userId, findCode, decryptRegistration } = require('../lib/secure');
const { findSchool } = require('./fetch-data');

function output(result, message) {
  console.log(`${result}: ${message}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\nmessage=${message.replace(/\n/g, ' ')}\n`);
  }
}

async function main() {
  const key = (process.env.REGISTER_PRIVATE_KEY || '').trim();
  if (!key) return output('error', 'Die Anmeldung ist auf dieser Seite noch nicht eingerichtet (Secret REGISTER_PRIVATE_KEY fehlt).');

  const code = findCode(process.env.ISSUE_BODY);
  if (!code) return output('error', 'Im Issue wurde kein Anmeldecode (beginnt mit SP1.) gefunden.');

  let creds;
  try {
    creds = decryptRegistration(code, key);
  } catch (e) {
    return output('error', `Der Anmeldecode ist ungültig oder beschädigt (${e.message}).`);
  }

  // Login testen, damit nur funktionierende Zugänge aufgenommen werden
  try {
    const school = await findSchool(creds.school);
    const s = { school: school.school, server: school.server, user: creds.user, password: creds.password };
    await u.authenticate(s);
    await u.rpc(u.apiUrl(s), 'logout', {}, u.untisCookie(s)).catch(() => {});
  } catch (e) {
    const msg = e.code === -8504 ? 'Untis-Benutzername oder -Passwort ist falsch.' : e.message;
    return output('error', `Die Anmeldung bei WebUntis hat nicht geklappt: ${msg}`);
  }

  const dir = path.join(__dirname, '..', 'users');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${userId(creds.user)}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, JSON.stringify({ code, updated: new Date().toISOString() }, null, 2) + '\n');
  output('ok', existed
    ? 'Dein Zugang wurde aktualisiert. Die neuen Daten sind in wenigen Minuten da.'
    : 'Du bist angemeldet! In wenigen Minuten kannst du dich mit deinem Untis-Benutzernamen und App-Passwort einloggen.');
}

main().catch((e) => {
  output('error', `Unerwarteter Fehler: ${e.message}`);
  process.exitCode = 1;
});
