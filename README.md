# stundenplan.

Eine eigene, moderne Ansicht für den WebUntis-Stundenplan – mit Tests, Hausaufgaben, Mitteilungen,
Abwesenheiten und mehr. Läuft komplett kostenlos über GitHub, ohne eigenen Server, für beliebig viele Nutzer.

> **Inoffiziell** – dieses Projekt ist nicht mit Untis GmbH verbunden.

## So funktioniert's

1. **Anmelden:** Einfach mit Schule, Untis-Benutzername und Untis-Passwort anmelden. Beim **ersten Mal** wird der
   Zugang einmalig eingerichtet: Der Browser verschlüsselt die Zugangsdaten mit dem öffentlichen Schlüssel der Seite
   (RSA-4096 + AES-256). Öffnen kann das **nur die GitHub-Automatik** dieses Repositories. Der Betreiber sieht die
   Daten nicht im Klartext – er verwaltet aber die Automatik, deshalb sollten nur Leute mitmachen, die ihm vertrauen.
2. **Bestätigen (nur beim ersten Mal):** „Bei GitHub bestätigen“ erzeugt ein Issue mit dem Code. Die Automatik prüft
   den Login, nimmt den Zugang auf, entfernt den Code und schließt das Issue. Die Seite wartet und meldet danach
   automatisch an.
   Ohne GitHub-Konto: Code kopieren und dem Betreiber schicken, er reicht ihn ein.
3. **Aktualisieren:** Alle 30 Minuten (ca. 5–22 Uhr) holt **GitHub Actions** für jeden Nutzer die Daten und
   verschlüsselt sie mit seinem Untis-Passwort.
4. **Ab dann:** Anmelden geht sofort – der Browser entschlüsselt nur die eigenen Daten.

## Einrichten für den Betreiber (einmalig)

1. Schlüssel erzeugen (ist in diesem Repository schon passiert): `node scripts/keygen.js`
2. Inhalt von `private-key.txt` als Secret **`REGISTER_PRIVATE_KEY`** eintragen:
   *Settings → Secrets and variables → Actions → New repository secret*.
   Danach `private-key.txt` an einem sicheren Ort aufbewahren oder löschen – **niemals hochladen**.
3. *Settings → Pages → Source:* **GitHub Actions**
4. *Actions → „Stundenplan aktualisieren“ → Run workflow*
5. Die App ist unter `https://NAME.github.io/REPOSITORY/` erreichbar.

**Am Handy:** Seite öffnen → „Teilen → Zum Home-Bildschirm“ (iPhone) bzw. „App installieren“ (Android).

## Gut zu wissen

- Die Daten sind höchstens ca. 30 Minuten alt. In der Seitenleiste steht, von wann sie sind.
- Gespeichert werden 2 Wochen zurück bis 5 Wochen voraus, für andere Klassen diese und nächste Woche.
- **Untis-Passwort geändert?** Beim Anmelden auf „Zugang neu einrichten“ tippen – das ersetzt den alten Zugang.
- **Zugang löschen:** In der App „Zugang löschen“ – oder als Betreiber die Datei im Ordner `users/` löschen.
- **Rechtliches:** Betreiber-Angaben in `public/config.js` eintragen. Sie erscheinen auf `rechtliches.html`
  (Datenschutzerklärung und Offenlegung nach § 25 Mediengesetz).
- Geht der geheime Schlüssel verloren, muss jeder seinen Zugang neu anlegen.
- Die Protokolle unter *Actions* enthalten absichtlich keine Namen oder Inhalte – sie sind öffentlich.
- Die verschlüsselten Dateien sind öffentlich abrufbar – ein **starkes Untis-Passwort** schützt sie am besten.

## Lokale Version (mit Live-Login)

Wer Node.js hat, kann die App auch lokal mit direktem Untis-Login starten:

```
npm start
```

Dann im Browser `http://localhost:3000` öffnen.
