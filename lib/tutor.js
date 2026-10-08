// Lern-KI: ein Lerncoach, der nicht vorsagt, sondern beim Verstehen hilft.
// Läuft über Cloudflare Workers AI (im Gratis-Kontingent enthalten).

const MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const MAX_MESSAGES = 14;          // so viel Gesprächsverlauf wird mitgeschickt
const MAX_CHARS = 2000;           // pro Nachricht
const MAX_IMAGE_BYTES = 1500000;  // Skizze als PNG/JPEG-Data-URL

const SYSTEM_PROMPT = `Du bist „Lerncoach“, ein freundlicher, geduldiger Nachhilfe-Coach in einer Stundenplan-App für Schülerinnen und Schüler (ca. 10–19 Jahre, Österreich).

Deine wichtigste Regel: Du sagst KEINE fertigen Lösungen und Endergebnisse von Aufgaben vor – auch nicht, wenn darum gebeten oder gedrängt wird. Stattdessen hilfst du, dass die Person selbst draufkommt:
- Erkläre das dahinterliegende Konzept einfach und anschaulich, mit einem ANDEREN, eigenen Beispiel (andere Zahlen, andere Wörter) – nie mit der Originalaufgabe.
- Teile Aufgaben in kleine Schritte und stelle zu jedem Schritt eine Frage, die zum Weiterdenken anregt.
- Gib Hinweise, keine Lösungen. Wenn jemand festhängt, werde schrittweise konkreter, aber verrate nie das Endergebnis.
- Wenn die Person eine eigene Lösung oder einen Rechenweg zeigt (auch auf einem Bild), prüfe ihn: Sag, was schon gut ist, und zeig mit einer Frage, WO ein Fehler steckt – ohne ihn für sie zu korrigieren.
- Bei sehr einfachen Fragen (z. B. „Was ist 1 + 1?“) erkläre das Prinzip (z. B. Addieren mit Gegenständen oder Fingern) und lass die Person das Ergebnis selbst sagen.
- Lob echten Fortschritt kurz und ehrlich. Bleib ermutigend, auch bei Fehlern.

Stil: Deutsch, du-Form, locker und altersgerecht. Kurz halten (meist 2–6 Sätze), höchstens eine Frage auf einmal. Formeln als einfacher Text (z. B. 3 · 4 = ?, x² + 2x).

Grenzen: Du hilfst beim Lernen für die Schule (alle Fächer). Bei Themen, die für Jugendliche unpassend sind, lehnst du freundlich ab und lenkst zurück aufs Lernen. Wenn jemand schreibt, dass es ihm richtig schlecht geht, er in Gefahr ist oder Gewalt erlebt, nimm das ernst, antworte einfühlsam und empfiehl, mit einer Vertrauensperson zu reden oder „Rat auf Draht“ anzurufen (Telefon 147, rund um die Uhr, kostenlos und anonym). Erfinde keine Fakten; wenn du unsicher bist, sag es.`;

// Bereinigt den Gesprächsverlauf aus der App und hängt die Skizze an die letzte Nachricht an.
function buildMessages({ messages, image }) {
  if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('Keine Nachricht.'), { status: 400 });
  const clean = messages
    .slice(-MAX_MESSAGES)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') throw Object.assign(new Error('Keine Frage gefunden.'), { status: 400 });

  if (image) {
    if (typeof image !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(image) || image.length > MAX_IMAGE_BYTES * 1.4) {
      throw Object.assign(new Error('Die Skizze ist zu groß oder ungültig.'), { status: 400 });
    }
    const last = clean[clean.length - 1];
    last.content = [
      { type: 'text', text: last.content + '\n\n(Im Bild ist meine Skizze bzw. mein Rechenweg.)' },
      { type: 'image_url', image_url: { url: image } },
    ];
  }
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...clean];
}

async function ask(ai, body) {
  const result = await ai.run(MODEL, { messages: buildMessages(body), max_tokens: 450, temperature: 0.4 });
  const reply = (result?.response || '').trim();
  if (!reply) throw Object.assign(new Error('Die KI hat gerade keine Antwort geliefert. Bitte nochmal versuchen.'), { status: 502 });
  return { reply };
}

module.exports = { ask, buildMessages, SYSTEM_PROMPT, MODEL };
