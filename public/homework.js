// ---------- Eigene Hausübungen ----------
// Werden nur auf diesem Gerät gespeichert (Browser-Speicher) – passend zu „es wird nichts gespeichert“.
// Nutzt Hilfsfunktionen aus app.js ($, esc, store, untisDate, fromUntis, …).

const MY_HW_KEY = 'myHomework';

const myHomework = () => store(MY_HW_KEY) || [];
const saveMyHomework = (list) => store(MY_HW_KEY, list);
const openMyHomework = (from) => myHomework().filter((h) => !h.done && h.due >= from);

function addMyHomework({ subject, text, due }) {
  const list = myHomework();
  list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject, text, due, created: untisDate(new Date()), done: false });
  saveMyHomework(list);
}

function updateMyHomework(id, change) {
  saveMyHomework(myHomework().map((h) => (h.id === id ? { ...h, ...change } : h)));
}

function deleteMyHomework(id) {
  saveMyHomework(myHomework().filter((h) => h.id !== id));
}

const isoToUntis = (iso) => Number(String(iso).replace(/-/g, '')) || null;

// Fächer eines Tages aus dem Stundenplan (für die Auswahl im Formular)
function subjectsOfDay(data, dk) {
  const seen = new Map();
  for (const p of data?.periods || []) {
    if (p.date !== dk || p.code === 'cancelled') continue;
    const name = subjectOf(p);
    if (name && !seen.has(name)) seen.set(name, shortOf(p));
  }
  return [...seen.keys()];
}

// Ansicht neu zeichnen, nachdem sich Hausübungen geändert haben (Dialog bleibt offen)
function refreshAfterHomework() {
  const view = $('#view').dataset.view;
  if (view === 'stundenplan' || view === 'weitere') $$('.tt-wrap').forEach((w) => w._data && renderTimetable(w, w._data));
  else if (view === 'hausaufgaben' || view === 'heute') route();
}

// Dialog: Hausübungen eines Tages ansehen und neue eintragen
async function openDayHomework(dk, subjects = [], preset = '') {
  let untis = [];
  try {
    untis = (await load('homework', '/api/homework')).filter((h) => h.dueDate === dk);
  } catch { /* Schule gibt Hausaufgaben nicht frei – dann nur eigene */ }

  const draw = () => {
    const d = fromUntis(dk);
    const own = myHomework().filter((h) => h.due === dk);
    const options = [...new Set([preset, ...subjects].filter(Boolean)), 'Sonstiges'];
    $('#details-body').innerHTML = `
      <h2>📝 Hausübungen</h2>
      <p class="muted">fällig ${DAY_LONG[d.getDay()]}, ${d.toLocaleDateString('de')}</p>
      <div class="hw-day-list">
        ${untis.map((h) => `
          <div class="hw-item" style="--h:${hue(h.subject)}">
            <span class="hw-check static">${h.completed ? '✓' : ''}</span>
            <span class="hw-item-main"><b><i class="sdot"></i>${esc(h.subject)} <span class="tag">Untis</span></b><span>${esc(h.text)}</span></span>
          </div>`).join('')}
        ${own.map((h) => `
          <div class="hw-item${h.done ? ' done' : ''}" style="--h:${hue(h.subject)}" data-id="${h.id}">
            <button class="hw-check" type="button" data-act="toggle" aria-label="Erledigt">${h.done ? '✓' : ''}</button>
            <span class="hw-item-main"><b><i class="sdot"></i>${esc(h.subject)}</b><span>${esc(h.text)}</span></span>
            <button class="hw-del" type="button" data-act="delete" aria-label="Löschen">✕</button>
          </div>`).join('')}
        ${!untis.length && !own.length ? '<p class="muted">Noch nichts eingetragen.</p>' : ''}
      </div>
      <form id="hw-add" class="hw-add">
        <div class="hw-add-row">
          <select id="hw-subject" aria-label="Fach">${options.map((o) => `<option${o === preset ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <input id="hw-due" type="date" value="${isoDate(d)}" aria-label="Fällig am">
        </div>
        <textarea id="hw-text" rows="2" placeholder="Was ist zu tun? z. B. Buch S. 42, Nr. 3–5" required></textarea>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>`;

    $('#hw-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('#hw-text').value.trim();
      const due = isoToUntis($('#hw-due').value) || dk;
      if (!text) return;
      addMyHomework({ subject: $('#hw-subject').value, text, due });
      haptic();
      if (due !== dk) dk = due; // in den Tag springen, für den eingetragen wurde
      draw();
      refreshAfterHomework();
    });
    $$('.hw-item[data-id]', $('#details-body')).forEach((row) => row.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'toggle') updateMyHomework(row.dataset.id, { done: !row.classList.contains('done') });
      if (act === 'delete') deleteMyHomework(row.dataset.id);
      if (act) { haptic(); draw(); refreshAfterHomework(); }
    }));
  };

  draw();
  if (!$('#details').open) $('#details').showModal();
  if (!preset) $('#hw-text').focus();
}

// Karte für die Hausaufgaben-Ansicht
function myHomeworkCard(h, key) {
  return `
    <div class="card hw mine${h.done ? ' done' : ''}" style="--h:${hue(h.subject)}" data-my-hw="${h.id}">
      <div class="hw-top">
        <b>${esc(h.subject)}</b>
        <span class="tag ${h.done ? 'ok' : h.due < key ? 'cancelled' : ''}">fällig ${fmtDate(h.due)} · ${relDay(h.due)}</span>
      </div>
      <p>${esc(h.text)}</p>
      <div class="hw-actions">
        <button class="btn" type="button" data-act="toggle">${h.done ? 'Wieder offen' : '✓ Erledigt'}</button>
        <button class="btn ghost" type="button" data-act="delete">Löschen</button>
        <span class="tag">eigene</span>
      </div>
    </div>`;
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('[data-my-hw]');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!card || !act) return;
  if (act === 'toggle') updateMyHomework(card.dataset.myHw, { done: !card.classList.contains('done') });
  if (act === 'delete') deleteMyHomework(card.dataset.myHw);
  haptic();
  route();
});
