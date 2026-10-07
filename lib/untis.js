// Zugriff auf WebUntis (JSON-RPC und die neuere REST-Schnittstelle).
// Wird vom lokalen Server (server.js) und von der GitHub-Automatik (scripts/fetch-data.js) genutzt.

const TOKEN_TTL = 10 * 60 * 1000;
const CLIENT_NAME = 'untis-app';

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// ---------- Datumshilfen (Untis rechnet mit Zahlen wie 20261006) ----------

const ymd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const fromYmd = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseIso = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const isoToYmd = (s) => Number(String(s).slice(0, 10).replace(/-/g, '')) || null;

// ---------- WebUntis: JSON-RPC ----------

async function rpc(url, method, params, cookie) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ id: String(Date.now()), method, params, jsonrpc: '2.0' }),
  });
  if (!res.ok) throw httpError(502, `WebUntis antwortet mit HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw httpError(400, data.error.message || 'WebUntis-Fehler', { code: data.error.code });
  return data.result;
}

const apiUrl = (s) => `https://${s.server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(s.school)}`;
const untisCookie = (s) =>
  `JSESSIONID=${s.untis.sessionId}; schoolname="_${Buffer.from(s.school).toString('base64')}"`;

async function authenticate(s) {
  const r = await rpc(apiUrl(s), 'authenticate', { user: s.user, password: s.password, client: CLIENT_NAME });
  s.untis = r; // { sessionId, personType, personId, klasseId }
  s.token = null;
}

// Ruft eine Methode auf und meldet sich bei abgelaufener Untis-Sitzung einmal neu an.
async function call(s, method, params = {}) {
  try {
    return await rpc(apiUrl(s), method, params, untisCookie(s));
  } catch (e) {
    if (e.code !== -8520) throw e; // -8520 = nicht angemeldet
    await authenticate(s);
    return rpc(apiUrl(s), method, params, untisCookie(s));
  }
}

// ---------- WebUntis: REST (neuere Web-Oberfläche) ----------

async function bearerToken(s) {
  if (s.token && Date.now() - s.tokenAt < TOKEN_TTL) return s.token;
  const res = await fetch(`https://${s.server}/WebUntis/api/token/new`, { headers: { Cookie: untisCookie(s) } });
  if (!res.ok) throw httpError(502, `Token nicht erhalten (HTTP ${res.status})`);
  s.token = (await res.text()).trim();
  s.tokenAt = Date.now();
  return s.token;
}

async function rest(s, p, params = {}, { bearer = false } = {}, retry = true) {
  const url = new URL(`https://${s.server}${p}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const headers = { Cookie: untisCookie(s), Accept: 'application/json' };
  if (bearer) {
    headers.Authorization = 'Bearer ' + (await bearerToken(s));
    if (s.tenantId) headers['Tenant-Id'] = s.tenantId;
    if (s.schoolYear?.id) headers['X-Webuntis-Api-School-Year-Id'] = s.schoolYear.id;
  }
  const res = await fetch(url, { headers, redirect: 'manual' });
  const expired = res.status === 401 || (res.status >= 300 && res.status < 400);
  if (expired && retry) {
    await authenticate(s);
    return rest(s, p, params, { bearer }, false);
  }
  if (!res.ok) throw httpError(res.status === 403 ? 403 : 502, `WebUntis antwortet mit HTTP ${res.status}`);
  if (!(res.headers.get('content-type') || '').includes('json')) throw httpError(502, 'Keine JSON-Antwort');
  return res.json();
}

// ---------- Schule & Profil ----------

async function searchSchools(query) {
  try {
    const r = await rpc('https://mobile.webuntis.com/ms/schoolquery2', 'searchSchool', [{ search: query }]);
    return (r.schools || []).map((x) => ({
      name: x.displayName,
      address: x.address,
      school: x.loginName,
      server: x.server,
    }));
  } catch (e) {
    if (e.code === -6003) return { tooMany: true }; // zu viele Treffer
    throw e;
  }
}

// Lädt Schuljahr, Anzeigename usw. nach dem Login.
async function loadProfile(s) {
  try {
    const d = await rest(s, '/WebUntis/api/rest/view/v1/app/data', {}, { bearer: true });
    s.tenantId = d.tenant?.id;
    s.displayName = d.user?.person?.displayName || d.user?.name;
    if (d.currentSchoolYear) {
      const y = d.currentSchoolYear;
      s.schoolYear = { id: y.id, name: y.name, start: isoToYmd(y.dateRange?.start), end: isoToYmd(y.dateRange?.end) };
    }
  } catch { /* ältere Untis-Versionen */ }
  if (!s.schoolYear?.start) {
    try {
      const y = await call(s, 'getCurrentSchoolyear');
      s.schoolYear = { id: y.id, name: y.name, start: y.startDate, end: y.endDate };
    } catch {
      const now = new Date();
      const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
      s.schoolYear = { name: `${y}/${y + 1}`, start: y * 10000 + 901, end: (y + 1) * 10000 + 731 };
    }
  }
}

// ---------- Stundenplan ----------

async function timetable(s, start, element) {
  const from = ymd(start), to = ymd(addDays(start, 6));
  const own = !element;
  const { personType, personId, klasseId } = s.untis;
  element ||= personId ? { id: personId, type: personType } : { id: klasseId, type: 1 };
  const fields = ['id', 'name', 'longname'];
  // Stundenplan zuerst, damit die Untis-Sitzung danach sicher gültig ist
  const periods = await call(s, 'getTimetable', {
    options: {
      element,
      startDate: from,
      endDate: to,
      showInfo: true,
      showSubstText: true,
      showLsText: true,
      showStudentgroup: true,
      klasseFields: fields,
      roomFields: fields,
      subjectFields: fields,
      teacherFields: fields,
    },
  });
  const [grid, holidays, examList] = await Promise.all([
    timegrid(s),
    holidayList(s),
    own ? exams(s, from, to).catch(() => []) : [],
  ]);
  return {
    periods,
    timegrid: grid,
    holidays: holidays.filter((h) => h.endDate >= from && h.startDate <= to),
    exams: examList,
  };
}

async function timegrid(s) {
  s.cache.timegrid ||= await call(s, 'getTimegridUnits').catch(() => []);
  return s.cache.timegrid;
}

async function holidayList(s) {
  s.cache.holidays ||= await call(s, 'getHolidays').catch(() => []);
  return s.cache.holidays;
}

const ELEMENT_METHODS = { 1: 'getKlassen', 2: 'getTeachers', 3: 'getSubjects', 4: 'getRooms' };

async function elements(s, type) {
  const method = ELEMENT_METHODS[type];
  if (!method) throw httpError(400, 'Unbekannter Typ');
  const list = await call(s, method, type === 1 && s.schoolYear?.id ? { schoolyearId: s.schoolYear.id } : {});
  return list
    .filter((x) => x.active !== false)
    .map((x) => ({
      id: x.id,
      name: x.name,
      long: type === 2 ? [x.foreName, x.longName].filter(Boolean).join(' ') : x.longName || x.longname || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- Prüfungen, Hausaufgaben, Abwesenheiten, Mitteilungen ----------

async function exams(s, from, to) {
  const { personType, personId, klasseId } = s.untis;
  const d = await rest(s, '/WebUntis/api/exams', {
    startDate: from,
    endDate: to,
    withGrades: 'true',
    klasseId: klasseId || undefined,
    studentId: personType === 5 ? personId : undefined,
  });
  return (d?.data?.exams || [])
    .filter((e) => {
      if (personType !== 5) return true;
      if (e.studentId && e.studentId !== personId) return false;
      const assigned = e.assignedStudents || [];
      return !assigned.length || assigned.some((a) => a.id === personId);
    })
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.examType,
      date: e.examDate,
      startTime: e.startTime,
      endTime: e.endTime,
      subject: e.subject,
      teachers: e.teachers || [],
      rooms: e.rooms || [],
      text: e.text,
      grade: e.grade,
    }))
    .sort((a, b) => a.date - b.date || a.startTime - b.startTime);
}

async function homework(s, from, to) {
  const d = (await rest(s, '/WebUntis/api/homeworks/lessons', { startDate: from, endDate: to }))?.data || {};
  const lessons = new Map((d.lessons || []).map((l) => [l.id, l]));
  const teachers = new Map((d.teachers || []).map((t) => [t.id, t.name]));
  const records = new Map((d.records || []).map((r) => [r.homeworkId, r]));
  return (d.homeworks || [])
    .map((h) => ({
      id: h.id,
      date: h.date,
      dueDate: h.dueDate,
      text: h.text,
      remark: h.remark,
      completed: !!h.completed,
      subject: lessons.get(h.lessonId)?.subject || '',
      teacher: teachers.get(records.get(h.id)?.teacherId) || '',
    }))
    .sort((a, b) => a.dueDate - b.dueDate);
}

async function absences(s) {
  const { start, end } = s.schoolYear;
  const d = await rest(s, '/WebUntis/api/classreg/absences/students', {
    startDate: start,
    endDate: Math.min(end, ymd(new Date())),
    studentId: s.untis.personId,
    excuseStatusId: -1,
  });
  return (d?.data?.absences || [])
    .map((a) => ({
      id: a.id,
      startDate: a.startDate,
      startTime: a.startTime,
      endDate: a.endDate,
      endTime: a.endTime,
      reason: a.reason,
      text: a.text,
      excused: !!a.isExcused,
      status: a.excuseStatus || a.excuse?.excuseStatus || '',
    }))
    .sort((a, b) => b.startDate - a.startDate || b.startTime - a.startTime);
}

async function messages(s) {
  const d = await rest(s, '/WebUntis/api/rest/view/v1/messages', {}, { bearer: true });
  return (d.incomingMessages || []).map((m) => ({
    id: m.id,
    subject: m.subject,
    preview: m.contentPreview,
    sender: m.sender?.displayName || '',
    sent: m.sentDateTime,
    read: !!m.isMessageRead,
    attachments: !!m.hasAttachments,
  }));
}

async function message(s, id) {
  const m = await rest(s, `/WebUntis/api/rest/view/v1/messages/${encodeURIComponent(id)}`, {}, { bearer: true });
  return {
    id: m.id,
    subject: m.subject,
    content: m.content || m.contentPreview || '',
    sender: m.sender?.displayName || '',
    sent: m.sentDateTime,
    attachments: (m.storageAttachments || m.attachments || []).map((a) => a.name),
  };
}

async function news(s, date) {
  const d = await rest(s, '/WebUntis/api/public/news/newsWidgetData', { date });
  return (d?.data?.messagesOfDay || []).map((m) => ({ id: m.id, subject: m.subject, text: m.text }));
}

// ---------- Bereiche ohne offizielle Doku ----------
// Für diese Bereiche gibt es keine dokumentierte Schnittstelle. Wir probieren mehrere bekannte Varianten.

function sectionCandidates(s, name) {
  const { start, end } = s.schoolYear;
  const today = ymd(new Date());
  const { personId, klasseId } = s.untis;
  return {
    grades: [
      { rest: '/WebUntis/api/classreg/grade/gradeList', params: { personId, startDate: start, endDate: end } },
      { rest: '/WebUntis/api/rest/view/v1/grades', params: {}, bearer: true },
    ],
    services: [
      { rest: '/WebUntis/api/classreg/classservices', params: { startDate: start, endDate: end, klasseId } },
    ],
    officehours: [
      { rest: '/WebUntis/api/officehours', params: { date: today } },
      { rest: '/WebUntis/api/rest/view/v1/officehours', params: { date: today }, bearer: true },
    ],
  }[name];
}

async function runCandidate(s, c) {
  if (c.rpc) return call(s, c.rpc, c.params);
  const d = await rest(s, c.rest, c.params, { bearer: c.bearer });
  return d?.data ?? d;
}

async function section(s, name) {
  const list = sectionCandidates(s, name);
  if (!list) throw httpError(404, 'Unbekannter Bereich');
  let last;
  for (const c of list) {
    try {
      return { data: await runCandidate(s, c) };
    } catch (e) {
      last = e;
    }
  }
  throw httpError(403, 'Diesen Bereich gibt deine Schule für die App nicht frei.', { detail: last?.message });
}

// ---------- Klassenbucheinträge ----------
// Gleiche Abfrage wie die WebUntis-Webseite: /api/classreg/classregevents, monatsweise.

// Erster sinnvoller Wert aus mehreren möglichen Feldern (Untis benennt Felder je nach Version anders)
function pick(o, ...keys) {
  for (const k of keys) {
    const v = k.split('.').reduce((x, part) => x?.[part], o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}
const label = (v) => (v && typeof v === 'object' ? v.longName || v.longname || v.displayName || v.name || '' : v ?? '');

function findList(d) {
  const data = d?.data ?? d;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return data.classRegEvents || data.classregEvents || data.events
    || Object.values(data).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object') || [];
}

async function classregEvents(s) {
  const today = new Date();
  const first = fromYmd(s.schoolYear.start);
  const months = [];
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    months.push([ymd(d < first ? first : d), ymd(last > today ? today : last)]);
  }
  const answers = await Promise.all(months.map(([from, to]) =>
    rest(s, '/WebUntis/api/classreg/classregevents', { startDate: from, endDate: to, studentId: s.untis.personId })));
  // nur die Struktur protokollieren (Feldnamen), nie Inhalte
  console.log('[classreg]', shape(answers.find((a) => findList(a).length) || answers[0]).slice(0, 900));
  const seen = new Set();
  return answers.flatMap(findList)
    .filter((e) => {
      // Einträge an Monatsgrenzen können doppelt kommen
      if (e.id === undefined) return true;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    })
    .map((e) => ({
      date: pick(e, 'date', 'eventDate', 'startDate', 'dateTime', 'createDate'),
      time: pick(e, 'startTime', 'time'),
      subject: label(pick(e, 'subject', 'subjectName', 'lesson.subject', 'su')),
      teacher: label(pick(e, 'teacher', 'teacherName', 'creator', 'createdBy', 'author', 'person')),
      category: label(pick(e, 'category', 'categoryName', 'eventReason', 'reason', 'type', 'eventType')),
      text: label(pick(e, 'text', 'remark', 'comment', 'note', 'description', 'content')),
      raw: e,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.time).localeCompare(String(a.time)));
}

// Gibt nur die Struktur einer Antwort aus (Feldnamen, Listenlängen), keine Inhalte.
function shape(v, depth = 0) {
  if (Array.isArray(v)) return `[${v.length}]` + (v.length && depth < 3 ? shape(v[0], depth + 1) : '');
  if (v && typeof v === 'object') {
    if (depth >= 3) return '{…}';
    return '{' + Object.keys(v).map((k) => `${k}:${shape(v[k], depth + 1)}`).join(', ') + '}';
  }
  return typeof v;
}

// Prüft nach dem Login, welche Bereiche bei dieser Schule antworten, und schreibt das ins Server-Log.
async function probe(s) {
  const { start, end } = s.schoolYear;
  const today = ymd(new Date());
  const checks = {
    'app/data': () => rest(s, '/WebUntis/api/rest/view/v1/app/data', {}, { bearer: true }),
    exams: () => rest(s, '/WebUntis/api/exams', { startDate: start, endDate: end, klasseId: s.untis.klasseId, withGrades: 'true' }),
    homework: () => rest(s, '/WebUntis/api/homeworks/lessons', { startDate: today, endDate: ymd(addDays(new Date(), 14)) }),
    absences: () => rest(s, '/WebUntis/api/classreg/absences/students', { startDate: start, endDate: today, studentId: s.untis.personId, excuseStatusId: -1 }),
    messages: () => rest(s, '/WebUntis/api/rest/view/v1/messages', {}, { bearer: true }),
    news: () => rest(s, '/WebUntis/api/public/news/newsWidgetData', { date: today }),
  };
  for (const name of ['grades', 'services', 'officehours']) {
    sectionCandidates(s, name).forEach((c, i) => (checks[`${name}#${i} ${c.rpc || c.rest}`] = () => runCandidate(s, c)));
  }
  console.log(`\n[Probe] Schule ${s.school}, personType ${s.untis.personType}, Schuljahr ${s.schoolYear.name}`);
  for (const [name, fn] of Object.entries(checks)) {
    try {
      console.log(`[Probe] OK   ${name} → ${shape(await fn()).slice(0, 600)}`);
    } catch (e) {
      console.log(`[Probe] FAIL ${name} → ${e.message}`);
    }
  }
}

module.exports = {
  httpError, ymd, fromYmd, addDays, parseIso,
  rpc, apiUrl, untisCookie, authenticate, call, rest,
  searchSchools, loadProfile,
  timetable, elements, exams, homework, absences, messages, message, news,
  sectionCandidates, section, probe, classregEvents,
};
