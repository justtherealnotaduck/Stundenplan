# stundenplan.

Eine eigene, moderne Ansicht für deinen WebUntis-Stundenplan – mit Tests, Hausaufgaben, Mitteilungen,
Abwesenheiten und mehr. Läuft komplett kostenlos über GitHub, ohne eigenen Server.

> **Inoffiziell** – dieses Projekt ist nicht mit Untis GmbH verbunden.

## So funktioniert's

1. **GitHub Actions** meldet sich alle 30 Minuten (ca. 5–22 Uhr) mit deinem Untis-Konto an und holt deine Daten.
2. Die Daten werden mit deinem **App-Passwort verschlüsselt** (AES-256-GCM).
3. **GitHub Pages** veröffentlicht die App. Du öffnest sie, gibst dein App-Passwort ein,
   und dein Browser entschlüsselt die Daten. Ohne das Passwort kann niemand etwas lesen.

Deine Untis-Zugangsdaten liegen nur in den verschlüsselten GitHub-Secrets und sind nirgends sichtbar.

## Einrichten (ca. 5 Minuten)

1. **Repository anlegen:** Dieses Repository forken (oben rechts „Fork“) oder den Code in ein eigenes,
   **öffentliches** Repository hochladen.
2. **Secrets eintragen:** *Settings → Secrets and variables → Actions → New repository secret*

   | Name | Inhalt |
   |---|---|
   | `UNTIS_SCHOOL` | Name deiner Schule, so wie er in der WebUntis-Schulsuche erscheint |
   | `UNTIS_USER` | dein WebUntis-Benutzername |
   | `UNTIS_PASSWORD` | dein WebUntis-Passwort |
   | `APP_PASSWORD` | ein **neues** Passwort für die App (mind. 10 Zeichen, nicht dein Untis-Passwort) |

3. **Pages aktivieren:** *Settings → Pages → Source:* **GitHub Actions**
4. **Starten:** *Actions → „Stundenplan aktualisieren“ → Run workflow*
   (bei einem Fork vorher im Tab *Actions* die Workflows aktivieren).
5. Nach ca. 2 Minuten ist die App unter `https://DEIN-NAME.github.io/REPOSITORY-NAME/` erreichbar.

**Am Handy:** Seite öffnen → „Teilen → Zum Home-Bildschirm“ (iPhone) bzw. „App installieren“ (Android).

## Gut zu wissen

- Die Daten sind höchstens ca. 30 Minuten alt. Oben links steht, von wann sie sind.
- Gespeichert werden 2 Wochen zurück bis 5 Wochen voraus, für andere Klassen diese und nächste Woche.
- Ist ein Lauf fehlgeschlagen, steht unter *Actions* der Grund (z. B. falsches Passwort).
  Die Protokolle enthalten absichtlich keine persönlichen Daten.
- Wähle ein **starkes App-Passwort** – die verschlüsselte Datei ist öffentlich abrufbar.

## Lokale Version (mit Live-Login)

Wer Node.js hat, kann die App auch lokal mit direktem Untis-Login starten:

```
npm start
```

Dann im Browser `http://localhost:3000` öffnen.
