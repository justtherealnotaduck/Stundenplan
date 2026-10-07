// Verschlüsselung für die GitHub-Version.
//
// Anmeldecode (vom Browser erzeugt, nur von GitHub Actions lesbar):
//   "SP1." + base64url(JSON { k: RSA-OAEP(AES-Schlüssel), iv, d: AES-256-GCM(JSON Anmeldedaten) })
// Datendatei pro Nutzer (von GitHub Actions erzeugt, nur mit dem App-Passwort lesbar):
//   { v, kdf, iter, salt, iv, gzip, data: AES-256-GCM(gzip(JSON)) }

const zlib = require('zlib');
const crypto = require('crypto');

// hoch angesetzt, weil Untis-Passwörter oft kurz sind (erschwert Durchprobieren)
const PBKDF2_ITERATIONS = 600000;
const CODE_PREFIX = 'SP1.';

// Dateiname der Daten eines Nutzers: aus dem Benutzernamen abgeleitet, verrät ihn aber nicht
function userId(username) {
  return crypto.createHash('sha256').update(String(username).trim().toLowerCase()).digest('hex').slice(0, 20);
}

function encryptBundle(bundle, password) {
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

// Sucht den Anmeldecode in einem Text (z. B. dem Text eines GitHub-Issues)
function findCode(text) {
  const m = /SP1\.[A-Za-z0-9_-]+/.exec(String(text || ''));
  return m ? m[0] : null;
}

function decryptRegistration(code, privateKeyPem) {
  if (!code || !code.startsWith(CODE_PREFIX)) throw new Error('Kein gültiger Anmeldecode.');
  const box = JSON.parse(Buffer.from(code.slice(CODE_PREFIX.length), 'base64url').toString('utf8'));
  const aesKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(box.k, 'base64'),
  );
  const raw = Buffer.from(box.d, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const plain = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);
  const p = JSON.parse(plain.toString('utf8'));
  p.action ||= 'register';
  const required = p.action === 'delete' ? ['user', 'appPassword'] : ['school', 'user', 'password', 'appPassword'];
  for (const field of required) {
    if (typeof p[field] !== 'string' || !p[field].trim()) throw new Error(`Im Anmeldecode fehlt: ${field}`);
  }
  return p;
}

module.exports = { userId, encryptBundle, findCode, decryptRegistration, PBKDF2_ITERATIONS };
