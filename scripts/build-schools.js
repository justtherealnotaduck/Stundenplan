// Baut public/schools.json: alle WebUntis-Schulen mit österreichischer Postleitzahl.
// Die Untis-Schulsuche erlaubt keinen Zugriff direkt aus dem Browser (CORS),
// darum sammelt GitHub Actions die Liste ab und legt sie zur App. Die App schlägt daraus Schulen vor.
//
// Die Suche liefert bei 4-stelligen Postleitzahlen eine genaue Trefferliste.
// Wir fragen 1000–9999 ab – langsam, damit Untis nicht belastet wird (ca. 15 Minuten).

const fs = require('fs');
const path = require('path');
const { searchSchools } = require('../lib/untis');

const OUT = path.join(__dirname, '..', 'public', 'schools.json');
const FROM = Number(process.env.PLZ_FROM || 1000);
const TO = Number(process.env.PLZ_TO || 9999);
const PARALLEL = 3;
const PAUSE_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await searchSchools(term);
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1000 * i);
    }
  }
}

async function main() {
  const schools = new Map(); // "server|login" -> [Name, Adresse, Login, Server]
  const tooMany = [];
  let failed = 0, next = FROM;

  async function worker() {
    while (next <= TO) {
      const plz = String(next++);
      try {
        const r = await search(plz);
        if (r.tooMany) tooMany.push(plz);
        else {
          for (const s of r) {
            // nur Treffer, deren Adresse wirklich mit dieser Postleitzahl beginnt
            if (s.address?.startsWith(plz)) schools.set(`${s.server}|${s.school}`, [s.name, s.address, s.school, s.server]);
          }
        }
      } catch {
        failed++;
      }
      if (Number(plz) % 500 === 0) console.log(`${plz} … ${schools.size} Schulen`);
      await sleep(PAUSE_MS);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  if (tooMany.length) console.log(`Zu viele Treffer bei: ${tooMany.join(', ')}`);
  if (failed > (TO - FROM) / 10) throw new Error(`${failed} Abfragen fehlgeschlagen – Liste wird nicht überschrieben.`);

  const list = [...schools.values()].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, updated: new Date().toISOString(), schools: list }));
  console.log(`Fertig: ${list.length} Schulen, ${failed} fehlgeschlagene Abfragen → public/schools.json`);
}

main().catch((e) => {
  console.error(`Fehler: ${e.message}`);
  process.exitCode = 1;
});
