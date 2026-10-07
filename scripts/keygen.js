// Einmalig ausführen: erzeugt das Schlüsselpaar für die Anmeldung neuer Nutzer.
//  - public/register-key.json  → öffentlicher Schlüssel, damit verschlüsselt der Browser die Anmeldedaten
//  - private-key.txt           → geheimer Schlüssel, gehört als Secret REGISTER_PRIVATE_KEY zu GitHub
//                                 (danach diese Datei löschen; sie ist in .gitignore eingetragen)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const pubFile = path.join(root, 'public', 'register-key.json');
const privFile = path.join(root, 'private-key.txt');

if (fs.existsSync(pubFile) && !process.argv.includes('--force')) {
  console.error('Es gibt schon einen Schlüssel. Ein neuer macht alle bisherigen Anmeldungen ungültig.');
  console.error('Wenn du das wirklich willst: node scripts/keygen.js --force');
  process.exitCode = 1;
} else {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  fs.writeFileSync(pubFile, JSON.stringify({ v: 1, alg: 'RSA-OAEP-256', spki }, null, 2) + '\n');
  fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('Öffentlicher Schlüssel: public/register-key.json');
  console.log('Geheimer Schlüssel:     private-key.txt  → Inhalt als Secret REGISTER_PRIVATE_KEY eintragen, dann Datei löschen');
}
