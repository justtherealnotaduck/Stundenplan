// ---------- Lernen: Sketchpad + Lern-KI ----------
// Zeichnungen und Chatverlauf bleiben nur auf diesem Gerät (Browser-Speicher).
// Nutzt Hilfsfunktionen aus app.js ($, $$, esc, api, store, haptic, isMobile …).

const SKETCH_KEY = 'sketchPages';
const CHAT_KEY = 'tutorChat';
const INKS = ['#1b1d29', '#2f6fdb', '#d9473b', '#2f8f5b'];
const SIZES = [2.5, 5, 10];
const MAX_PAGES = 20;
const STARTERS = [
  'Erklär mir, wie Bruchrechnen funktioniert',
  'Hilf mir bei meiner Hausübung',
  'Frag mich Englisch-Vokabeln ab',
  'Schau dir meine Skizze an',
];

const learn = { pages: [[]], page: 0, tool: 'pen', color: INKS[0], size: 0, attach: null, busy: false, chat: [] };

function loadLearnState() {
  const pages = store(SKETCH_KEY);
  learn.pages = Array.isArray(pages) && pages.length ? pages : [[]];
  learn.page = Math.min(learn.page, learn.pages.length - 1);
  learn.chat = store(CHAT_KEY) || [];
}
const savePages = () => store(SKETCH_KEY, learn.pages);
const saveChat = () => store(CHAT_KEY, learn.chat.slice(-40));

function viewLearn(el) {
  loadLearnState();
  el.innerHTML = `
    <div class="learn" data-pane="${learn.pane || 'sketch'}">
      <div class="seg learn-switch">
        <button type="button" data-show="sketch">✏️ Zeichnen</button>
        <button type="button" data-show="chat">🧠 Lerncoach</button>
      </div>

      <section class="card sketch-card">
        <div class="sketch-tools">
          <div class="tool-group">
            ${INKS.map((c) => `<button type="button" class="ink" data-ink="${c}" style="--ink:${c}" aria-label="Farbe"></button>`).join('')}
            <button type="button" class="tool" data-tool="eraser" title="Radierer" aria-label="Radierer">⌫</button>
          </div>
          <div class="tool-group">
            ${SIZES.map((s, i) => `<button type="button" class="size" data-size="${i}" aria-label="Stiftgröße"><i style="--s:${4 + i * 4}px"></i></button>`).join('')}
          </div>
          <div class="tool-group">
            <button type="button" class="tool" data-act="undo" title="Rückgängig" aria-label="Rückgängig">↶</button>
            <button type="button" class="tool" data-act="clear" title="Seite leeren" aria-label="Seite leeren">🗑</button>
          </div>
          <div class="tool-group pages">
            <button type="button" class="tool" data-act="prev" aria-label="Vorige Seite">‹</button>
            <span class="page-no"></span>
            <button type="button" class="tool" data-act="next" aria-label="Nächste Seite">›</button>
            <button type="button" class="tool" data-act="add" title="Neue Seite" aria-label="Neue Seite">＋</button>
          </div>
          <button type="button" class="btn primary send-sketch" data-act="send">🧠 An Lerncoach</button>
        </div>
        <div class="paper"><canvas></canvas></div>
      </section>

      <section class="card chat-card">
        <div class="chat-head">
          <span class="coach-avatar">🧠</span>
          <div><b>Lerncoach</b><small>sagt dir keine Lösungen vor – hilft dir, selbst draufzukommen</small></div>
          <button type="button" class="btn ghost" data-act="new-chat" title="Neues Gespräch">Neu</button>
        </div>
        <div class="chat-log"></div>
        <div class="chat-attach" hidden><img alt="Skizze"><span>Skizze angehängt</span><button type="button" data-act="drop-attach" aria-label="Entfernen">✕</button></div>
        <form class="chat-form">
          <textarea rows="1" placeholder="Frag mich etwas …" maxlength="2000"></textarea>
          <button class="btn primary" type="submit" aria-label="Senden">➤</button>
        </form>
        <p class="chat-note">KI kann sich irren. Bitte keine persönlichen Daten eingeben.</p>
      </section>
    </div>`;

  setupSketch(el);
  setupChat(el);
  el.querySelector('.learn-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (b) showPane(el, b.dataset.show);
  });
  showPane(el, learn.pane || 'sketch');
}

function showPane(el, pane) {
  learn.pane = pane;
  $('.learn', el).dataset.pane = pane;
  $$('.learn-switch button', el).forEach((b) => b.classList.toggle('active', b.dataset.show === pane));
}

// ---------- Sketchpad ----------
// Striche werden als Vektoren gespeichert (Koordinaten relativ zur Papierbreite),
// so passen sie sich jeder Bildschirmgröße an und „Rückgängig“ ist einfach.

function setupSketch(el) {
  const paper = $('.paper', el), canvas = $('canvas', paper), ctx = canvas.getContext('2d');
  let width = 0, drawing = null;

  const drawStroke = (c, st, w) => {
    const pts = st.points;
    if (!pts.length) return;
    c.save();
    c.globalCompositeOperation = st.eraser ? 'destination-out' : 'source-over';
    c.strokeStyle = st.color;
    c.fillStyle = st.color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0][0] * w, pts[0][1] * w, (st.size * w / 1000) / 2, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0, p0] = pts[i - 1], [x1, y1, p1] = pts[i];
      c.lineWidth = st.size * w / 1000 * ((p0 + p1) / 2);
      c.beginPath();
      c.moveTo(x0 * w, y0 * w);
      c.lineTo(x1 * w, y1 * w);
      c.stroke();
    }
    c.restore();
  };

  const redraw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = canvas.width / width || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const st of learn.pages[learn.page]) drawStroke(ctx, st, width);
    $('.page-no', el).textContent = `${learn.page + 1} / ${learn.pages.length}`;
  };

  const resize = () => {
    const r = paper.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = r.width;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    redraw();
  };
  new ResizeObserver(resize).observe(paper);

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' ? 0.4 + e.pressure * 1.2 : 1;
    return [(e.clientX - r.left) / width, (e.clientY - r.top) / width, pressure];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    canvas.setPointerCapture(e.pointerId);
    // Stiftbreite in Tausendstel der Papierbreite
    const base = [2.5, 5, 10][learn.size];
    drawing = { color: learn.color, size: learn.tool === 'eraser' ? base * 5 : base, eraser: learn.tool === 'eraser', points: [point(e)] };
    learn.pages[learn.page].push(drawing);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) drawing.points.push(point(ev));
    const dpr = canvas.width / width || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, { ...drawing, points: drawing.points.slice(-3) }, width);
  });
  const end = () => {
    if (!drawing) return;
    // Punkte runden, damit der Speicher klein bleibt
    drawing.points = drawing.points.map(([x, y, p]) => [+x.toFixed(4), +y.toFixed(4), +p.toFixed(2)]);
    drawing = null;
    savePages();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const tools = $('.sketch-tools', el);
  const markTools = () => {
    $$('.ink', tools).forEach((b) => b.classList.toggle('active', learn.tool === 'pen' && b.dataset.ink === learn.color));
    $$('[data-tool="eraser"]', tools).forEach((b) => b.classList.toggle('active', learn.tool === 'eraser'));
    $$('.size', tools).forEach((b) => b.classList.toggle('active', Number(b.dataset.size) === learn.size));
  };
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    haptic();
    if (b.dataset.ink) { learn.color = b.dataset.ink; learn.tool = 'pen'; }
    if (b.dataset.tool === 'eraser') learn.tool = learn.tool === 'eraser' ? 'pen' : 'eraser';
    if (b.dataset.size) learn.size = Number(b.dataset.size);
    const act = b.dataset.act;
    if (act === 'undo') { learn.pages[learn.page].pop(); savePages(); }
    if (act === 'clear' && learn.pages[learn.page].length && confirm('Diese Seite wirklich leeren?')) { learn.pages[learn.page] = []; savePages(); }
    if (act === 'prev') learn.page = Math.max(0, learn.page - 1);
    if (act === 'next') learn.page = Math.min(learn.pages.length - 1, learn.page + 1);
    if (act === 'add' && learn.pages.length < MAX_PAGES) { learn.pages.push([]); learn.page = learn.pages.length - 1; savePages(); }
    if (act === 'send') attachSketch(el);
    markTools();
    redraw();
  });
  markTools();
}

// Aktuelle Seite als Bild für die KI: weißer Hintergrund, max. 1024 px breit
function exportSketch() {
  const strokes = learn.pages[learn.page];
  if (!strokes.length) return null;
  let maxY = 0;
  for (const st of strokes) for (const [, y] of st.points) maxY = Math.max(maxY, y);
  const w = 1024, h = Math.min(Math.max(Math.ceil((maxY + 0.05) * w), 300), 1400);
  const layer = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const lc = layer.getContext('2d');
  lc.lineCap = 'round';
  lc.lineJoin = 'round';
  for (const st of strokes) {
    lc.save();
    lc.globalCompositeOperation = st.eraser ? 'destination-out' : 'source-over';
    lc.strokeStyle = lc.fillStyle = st.color;
    const pts = st.points;
    if (pts.length === 1) { lc.beginPath(); lc.arc(pts[0][0] * w, pts[0][1] * w, st.size * w / 2000, 0, Math.PI * 2); lc.fill(); }
    for (let i = 1; i < pts.length; i++) {
      lc.lineWidth = st.size * w / 1000 * ((pts[i - 1][2] + pts[i][2]) / 2);
      lc.beginPath();
      lc.moveTo(pts[i - 1][0] * w, pts[i - 1][1] * w);
      lc.lineTo(pts[i][0] * w, pts[i][1] * w);
      lc.stroke();
    }
    lc.restore();
  }
  const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const oc = out.getContext('2d');
  oc.fillStyle = '#ffffff';
  oc.fillRect(0, 0, w, h);
  oc.drawImage(layer, 0, 0);
  return out.toDataURL('image/jpeg', 0.85);
}

function attachSketch(el) {
  const img = exportSketch();
  if (!img) {
    toast('Die Seite ist noch leer – zeichne zuerst etwas. ✏️');
    return false;
  }
  learn.attach = img;
  updateAttach(el);
  showPane(el, 'chat');
  $('.chat-form textarea', el).focus();
  return true;
}

function updateAttach(el) {
  const box = $('.chat-attach', el);
  box.hidden = !learn.attach;
  if (learn.attach) $('img', box).src = learn.attach;
}

// ---------- Lerncoach-Chat ----------

// Antworttext sicher darstellen: nur **fett** und Zeilenumbrüche
const formatReply = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

function renderChat(el) {
  const log = $('.chat-log', el);
  if (!learn.chat.length) {
    log.innerHTML = `
      <div class="msg-bubble coach">Hi! Ich bin dein Lerncoach. 👋<br>Ich sag dir keine Lösungen vor, aber ich helfe dir, selbst draufzukommen – Schritt für Schritt.
        Du kannst mir auch deine <b>Skizze</b> schicken, z. B. deinen Rechenweg.</div>
      <div class="starters">${STARTERS.map((s) => `<button type="button" class="chip" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  } else {
    log.innerHTML = learn.chat.map((m) => `
      <div class="msg-bubble ${m.role === 'user' ? 'me' : 'coach'}">${m.image ? '<span class="tag">Skizze</span> ' : ''}${m.role === 'user' ? esc(m.content).replace(/\n/g, '<br>') : formatReply(m.content)}</div>`).join('');
  }
  if (learn.busy) log.insertAdjacentHTML('beforeend', '<div class="msg-bubble coach typing"><i></i><i></i><i></i><span>denkt nach …</span></div>');
  if (learn.error) log.insertAdjacentHTML('beforeend', `<div class="msg-bubble error">${esc(learn.error)}</div>`);
  log.scrollTop = log.scrollHeight;
}

async function sendChat(el, text) {
  text = text.trim();
  if (!text || learn.busy) return;
  learn.error = null;
  learn.chat.push({ role: 'user', content: text, image: !!learn.attach });
  const image = learn.attach;
  learn.attach = null;
  updateAttach(el);
  learn.busy = true;
  renderChat(el);
  try {
    const r = await api('/api/tutor', {
      method: 'POST',
      body: { messages: learn.chat.map(({ role, content }) => ({ role, content })), image },
    });
    learn.chat.push({ role: 'assistant', content: r.reply });
    saveChat();
  } catch (e) {
    learn.error = e.message || 'Der Lerncoach ist gerade nicht erreichbar.';
    learn.chat.pop(); // Frage nicht verlieren: zurück ins Eingabefeld
    $('.chat-form textarea', el).value = text;
    learn.attach = image;
    updateAttach(el);
  } finally {
    learn.busy = false;
    renderChat(el);
  }
}

function setupChat(el) {
  const form = $('.chat-form', el), input = $('textarea', form);
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 160) + 'px'; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isMobile()) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    autosize();
    sendChat(el, text);
  });
  $('.chat-card', el).addEventListener('click', (e) => {
    const starter = e.target.closest('[data-starter]')?.dataset.starter;
    if (starter) {
      if (starter.includes('Skizze') && !attachSketch(el)) return;
      sendChat(el, starter);
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new-chat' && (!learn.chat.length || confirm('Neues Gespräch beginnen? Der bisherige Verlauf wird gelöscht.'))) {
      learn.chat = [];
      learn.error = null;
      saveChat();
      renderChat(el);
    }
    if (act === 'drop-attach') { learn.attach = null; updateAttach(el); }
  });
  updateAttach(el);
  renderChat(el);
}

// Kurzer Hinweis unten am Bildschirm
function toast(text) {
  let t = $('#toast');
  if (!t) {
    t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    document.body.append(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}
