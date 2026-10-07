# stundenplan.

Eine eigene, moderne Ansicht für den WebUntis-Stundenplan – mit Tests, Hausaufgaben, Mitteilungen,
Abwesenheiten und mehr. Anmelden direkt mit dem Untis-Konto, kostenlos, ohne eigenen Server.

> **Inoffiziell** – dieses Projekt ist nicht mit Untis GmbH verbunden.

## Aufbau

| Teil | Wo | Aufgabe |
|---|---|---|
| `public/` | Cloudflare Pages (mein-stundenplan.pages.dev) und GitHub Pages | die App (HTML, CSS, JS) |
| `worker/` | Cloudflare Workers (kostenlos) | reicht Anfragen an WebUntis weiter – der Browser darf das wegen CORS nicht selbst |
| `lib/` | beide | Zugriff auf WebUntis und die API-Routen, gemeinsam für Worker und lokalen Server |
| `server.js` | dein PC | lokale Version (`npm start`) |

Es wird **nichts gespeichert**. Nach dem Login bekommt der Browser ein verschlüsseltes Token (AES-256),
das nur der Worker öffnen kann.

## Einrichten

1. Kostenloses Konto auf [cloudflare.com](https://dash.cloudflare.com/sign-up) anlegen.
2. Im Projektordner einmalig anmelden: `npx wrangler login`
3. Schlüssel für die Tokens setzen (beliebiger zufälliger Wert, nur einmal):
   `npx wrangler secret put TOKEN_KEY` – Wert z. B. mit
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` erzeugen.
4. Worker veröffentlichen: `npx wrangler deploy` – die angezeigte Adresse (`https://….workers.dev`)
   in `public/config.js` bei `apiBase` eintragen.
5. In `wrangler.toml` bei `ALLOWED_ORIGINS` die Adresse der GitHub-Pages-Seite eintragen.
6. Auf GitHub: *Settings → Pages → Source:* **GitHub Actions**.
7. Für automatisches Veröffentlichen zu Cloudflare: API-Token mit den Rechten *Cloudflare Pages: Edit* und
   *Workers Scripts: Edit* erstellen und als GitHub-Secret **`CLOUDFLARE_API_TOKEN`** eintragen.
   Danach wird jede Änderung automatisch zu GitHub Pages **und** Cloudflare veröffentlicht.

**Am Handy:** Seite öffnen → „Teilen → Zum Home-Bildschirm“ (iPhone) bzw. „App installieren“ (Android).

## Rechtliches

Betreiber-Angaben in `public/config.js` eintragen. Sie erscheinen auf `rechtliches.html`
(Datenschutzerklärung und Offenlegung nach § 25 Mediengesetz).

## Lokale Version

```
npm start
```

Dann im Browser `http://localhost:3000` öffnen (`apiBase` in `config.js` leer lassen).
