import { firebaseConfig } from './config.js';
import { LocalStore, initFirebase } from './store.js';
import { PRESETS, UNIT_TYPES, findPreset } from './books.js';
import {
  todayStr, addDays, formatGreg, formatHebrew, formatShort, weekday, WEEKDAY_NAMES, WEEKDAY_SHORT,
} from './hebrew.js';
import {
  totalUnits, rangeName, allUnitNames, portionFor, progressPos, isFinished, missedDays, streak,
  estimatedFinish, dayStatus, newTrack, noLearningReason,
} from './schedule.js';

const $app = document.getElementById('app');

const state = {
  demo: !firebaseConfig,
  fb: null,
  user: null,
  authReady: false,
  store: null,
  unsubscribe: null,
  tracks: [],
  loaded: false,
  view: 'today',
  date: todayStr(),
  today: todayStr(),
  draft: null,
  pending: {}, // כמות שנבחרה לפני סימון: { 'id|date': n }
  showMissed: false,
};

// ---------------- עזרים ----------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast('שגיאה: ' + (e?.message || e));
  }
}

const sortedTracks = () => [...state.tracks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const unitWord = (t, n) => (n === 1 ? t.unitLabel : (t.unitPlural || t.unitLabel)) + (t.amud ? '' : '');
const amountText = (t, n) => (t.amud ? `${n} ${n === 1 ? 'עמוד' : 'עמודים'}` : `${n} ${unitWord(t, n)}`);

// ---------------- התחלה ----------------

async function start() {
  if (state.demo) {
    state.authReady = true;
    connectStore(new LocalStore());
  } else {
    render();
    try {
      state.fb = await initFirebase(firebaseConfig);
    } catch (e) {
      console.error(e);
      $app.innerHTML = `<div class="center-box"><h2>לא הצלחתי להתחבר לשרת</h2>
        <p>בדוק את החיבור לאינטרנט ונסה לרענן את הדף.</p></div>`;
      return;
    }
    state.fb.onUser((user) => {
      state.user = user;
      state.authReady = true;
      state.unsubscribe?.();
      state.tracks = [];
      state.loaded = false;
      if (user) connectStore(state.fb.storeFor(user.uid));
      else render();
    });
  }
  // מעבר יום בחצות
  setInterval(checkNewDay, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function connectStore(store) {
  state.store = store;
  state.unsubscribe = store.subscribe(
    (tracks) => { state.tracks = tracks; state.loaded = true; render(); },
    (err) => toast('שגיאה בטעינת הנתונים: ' + err.message),
  );
}

function checkNewDay() {
  const now = todayStr();
  if (now !== state.today) {
    if (state.date === state.today) state.date = now;
    state.today = now;
    render();
  }
}

// ---------------- ציור המסך ----------------

function render() {
  if (!state.authReady) {
    $app.innerHTML = '<div class="center-box"><div class="spinner"></div></div>';
    return;
  }
  if (!state.demo && !state.user) {
    $app.innerHTML = loginView();
    return;
  }
  const views = { today: todayView, books: booksView, edit: editView, stats: statsView, settings: settingsView };
  const tab = (id, label, icon) =>
    `<button class="tab ${state.view === id || (id === 'books' && state.view === 'edit') ? 'active' : ''}" data-act="view" data-view="${id}">
      <span class="tab-icon">${icon}</span><span>${label}</span></button>`;
  $app.innerHTML = `
    <header class="topbar">
      <h1>📖 הלימוד היומי שלי</h1>
      ${state.user?.photoURL ? `<img class="avatar" src="${esc(state.user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ''}
    </header>
    ${state.demo ? '<div class="demo-banner">מצב הדגמה: הנתונים נשמרים רק בדפדפן הזה (Firebase עוד לא הוגדר)</div>' : ''}
    <main>${state.loaded ? views[state.view]() : '<div class="center-box"><div class="spinner"></div></div>'}</main>
    <nav class="tabs">
      ${tab('today', 'היום', '✅')}
      ${tab('books', 'הספרים שלי', '📚')}
      ${tab('stats', 'סטטיסטיקה', '📊')}
      ${tab('settings', 'הגדרות', '⚙️')}
    </nav>`;
}

function loginView() {
  return `<div class="login">
    <div class="login-card">
      <div class="login-icon">📖</div>
      <h1>הלימוד היומי שלי</h1>
      <p>מעקב אחרי הלימוד היומי: מוסיפים ספרים, מסמנים כל יום מה למדת, ועוקבים אחרי ההתקדמות.</p>
      <button class="btn primary big" data-act="login">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
        כניסה עם חשבון Google
      </button>
    </div>
  </div>`;
}

// ---------- מסך "היום" ----------

function todayView() {
  const ds = state.date;
  const isToday = ds === state.today;
  const tracks = sortedTracks();

  if (!tracks.length) {
    return `<div class="empty">
      <div class="empty-icon">📚</div>
      <h2>עוד לא הוספת ספרים</h2>
      <p>הוסף ספר או לימוד יומי כדי להתחיל.</p>
      <button class="btn primary" data-act="add">+ הוספת ספר</button>
    </div>`;
  }

  const active = [];
  const off = [];
  const finished = [];
  for (const t of tracks) {
    const p = portionFor(t, ds);
    if (p) active.push([t, p]);
    else if (isToday && isFinished(t)) finished.push(t);
    else off.push(t);
  }
  const doneCount = active.filter(([, p]) => p.done).length;

  let html = `
    <section class="daybar">
      <button class="icon-btn" data-act="day" data-delta="-1" title="יום קודם" aria-label="יום קודם">→</button>
      <div class="daybar-title">
        <strong>יום ${WEEKDAY_NAMES[weekday(ds)]}${isToday ? ' (היום)' : ''}</strong>
        <span>${formatGreg(ds)} · ${formatHebrew(ds)}</span>
      </div>
      <button class="icon-btn" data-act="day" data-delta="1" ${isToday ? 'disabled' : ''} title="יום הבא" aria-label="יום הבא">←</button>
    </section>`;

  if (!isToday) {
    html += `<div class="past-note">אתה צופה ביום שעבר, ואפשר להשלים כאן סימון.
      <button class="link" data-act="goto-today">חזרה להיום</button></div>`;
  }

  if (active.length) {
    const all = doneCount === active.length;
    html += `<div class="summary ${all ? 'all-done' : ''}">
      ${all ? '🎉 כל הכבוד! סיימת את כל הלימוד של ' + (isToday ? 'היום' : 'יום זה') : `סימנת ${doneCount} מתוך ${active.length}`}
      <div class="bar"><div style="width:${(doneCount / active.length) * 100}%"></div></div>
    </div>`;
  }

  html += '<div class="cards">';
  for (const [t, p] of active) html += portionCard(t, p, ds);
  html += '</div>';

  for (const t of finished) {
    html += `<div class="card finished">
      <div class="info"><div class="tname">🎉 סיימת את ${esc(t.name)}!</div>
      <div class="meta">${t.cycles ? `מחזור ${t.cycles + 1} הושלם` : 'מזל טוב על הסיום'}</div></div>
      <button class="btn" data-act="restart" data-id="${t.id}">התחל מחזור חדש</button>
    </div>`;
  }

  if (off.length) {
    html += `<div class="off-list"><strong>אין לימוד ${isToday ? 'היום' : 'ביום זה'}:</strong> ${off
      .map((t) => `${esc(t.name)} <span class="muted">(${esc(noLearningReason(t, ds) || (isFinished(t) ? 'הושלם' : '—'))})</span>`)
      .join(' · ')}</div>`;
  }

  if (isToday) html += missedSection(tracks);
  return html;
}

function portionCard(t, p, ds) {
  const key = `${t.id}|${ds}`;
  const total = totalUnits(t);
  const pct = Math.round((progressPos(t) / total) * 100);
  let amount = p.count;
  let rangeFrom = p.from;
  if (!p.done && t.mode !== 'calendar' && state.pending[key]) {
    amount = Math.min(state.pending[key], total - p.from);
  }
  const stepper = t.mode === 'calendar' ? '' : `
    <div class="stepper" title="אפשר לשנות כמה למדת בפועל">
      <button data-act="amt" data-id="${t.id}" data-delta="-1" ${amount <= 1 ? 'disabled' : ''} aria-label="פחות">−</button>
      <span>${amountText(t, amount)}</span>
      <button data-act="amt" data-id="${t.id}" data-delta="1" ${rangeFrom + amount >= total ? 'disabled' : ''} aria-label="יותר">+</button>
    </div>`;
  return `<div class="card portion ${p.done ? 'done' : ''}">
    <div class="info">
      <div class="tname">${esc(t.name)}</div>
      <div class="range">${esc(rangeName(t, rangeFrom, amount))}</div>
      <div class="mini"><div class="bar thin"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>
    </div>
    <div class="actions">
      ${stepper}
      <button class="check ${p.done ? 'on' : ''}" data-act="toggle" data-id="${t.id}" aria-pressed="${p.done}">
        ${p.done ? '✓ למדתי' : 'סמן שלמדתי'}
      </button>
    </div>
  </div>`;
}

function missedSection(tracks) {
  const rows = [];
  for (const t of tracks) {
    for (const d of missedDays(t, state.today)) rows.push([d, t]);
  }
  if (!rows.length) return '';
  rows.sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const shown = state.showMissed ? rows : rows.slice(0, 5);
  return `<section class="missed">
    <h3>ימים שלא סומנו (${rows.length})</h3>
    <p class="muted">לימודים בלוח קבוע שלא סימנת. אם למדת, אפשר לסמן כאן.</p>
    ${shown.map(([d, t]) => {
      const p = portionFor(t, d);
      return `<div class="missed-row">
        <button class="link" data-act="goto" data-date="${d}">${formatShort(d)}</button>
        <span class="grow"><b>${esc(t.name)}</b>: ${esc(rangeName(t, p.from, p.count))}</span>
        <button class="btn small" data-act="mark-past" data-id="${t.id}" data-date="${d}">✓ למדתי</button>
      </div>`;
    }).join('')}
    ${rows.length > 5 ? `<button class="link" data-act="toggle-missed">${state.showMissed ? 'הצג פחות' : `הצג את כולם (${rows.length})`}</button>` : ''}
  </section>`;
}

// ---------- מסך "הספרים שלי" ----------

function booksView() {
  const tracks = sortedTracks();
  return `<div class="page-head"><h2>הספרים שלי</h2>
    <button class="btn primary" data-act="add">+ הוספת ספר</button></div>
    ${tracks.length ? '' : '<p class="muted">עוד אין ספרים. לחץ על "הוספת ספר".</p>'}
    <div class="cards">
    ${tracks.map((t) => {
      const total = totalUnits(t);
      const pos = progressPos(t);
      const days = t.days.every(Boolean) ? 'כל יום' : t.days.map((v, i) => (v ? WEEKDAY_SHORT[i] : '')).filter(Boolean).join(' ');
      return `<div class="card book">
        <div class="info">
          <div class="tname">${esc(t.name)}</div>
          <div class="meta">${amountText(t, t.perDay)} ביום · ${t.mode === 'calendar' ? 'לוח קבוע' : 'לפי הקצב שלי'} · ${days}</div>
          <div class="mini"><div class="bar thin"><div style="width:${(pos / total) * 100}%"></div></div>
            <span>${pos}/${total}</span></div>
        </div>
        <div class="actions row">
          <button class="btn small" data-act="edit" data-id="${t.id}">עריכה</button>
          <button class="btn small danger" data-act="delete" data-id="${t.id}">מחיקה</button>
        </div>
      </div>`;
    }).join('')}
    </div>`;
}

// ---------- טופס הוספה/עריכה ----------

function startDraft(t) {
  state.draft = t ? JSON.parse(JSON.stringify(t)) : newTrack({ presetId: '', unitType: 'perek', name: '' });
  state.draft._isNew = !t;
  state.view = 'edit';
}

function editView() {
  const d = state.draft;
  if (!d) { state.view = 'books'; return booksView(); }
  const preset = d.presetId ? findPreset(d.presetId) : null;
  const custom = !preset;
  const total = totalUnits(d);
  const names = total > 0 && total <= 20000 ? allUnitNames(d) : [];
  const allowAmud = custom ? d.unitType === 'daf' : preset.allowAmud;

  const presetOptions = PRESETS.map((g) => `<optgroup label="${esc(g.title)}">${g.items
    .map((it) => `<option value="${esc(it.id)}" ${it.id === d.presetId ? 'selected' : ''}>${esc(it.name)}</option>`)
    .join('')}</optgroup>`).join('');

  return `<div class="page-head"><h2>${d._isNew ? 'הוספת ספר / לימוד' : 'עריכת ' + esc(d.name)}</h2></div>
  <form class="form" id="track-form" autocomplete="off">
    <label class="field">
      <span>בחירת ספר</span>
      <select data-field="presetId">
        <option value="" ${custom ? 'selected' : ''}>✏️ ספר אחר (הגדרה ידנית)</option>
        ${presetOptions}
      </select>
    </label>

    <label class="field">
      <span>שם הלימוד</span>
      <input type="text" data-field="name" value="${esc(d.name)}" placeholder="למשל: רמב״ם הלכות תשובה" required>
    </label>

    ${custom ? `
      <div class="field-row">
        <label class="field">
          <span>יחידת לימוד</span>
          <select data-field="unitType">
            ${Object.entries(UNIT_TYPES).map(([k, u]) => `<option value="${k}" ${d.unitType === k ? 'selected' : ''}>${u.label || 'אחר…'}</option>`).join('')}
          </select>
        </label>
        ${d.unitType === 'other' ? `
          <label class="field"><span>שם היחידה (יחיד)</span>
            <input type="text" data-field="unitLabel" value="${esc(d.unitLabel)}" placeholder="למשל: אות"></label>
          <label class="field"><span>שם היחידה (רבים)</span>
            <input type="text" data-field="unitPlural" value="${esc(d.unitPlural)}" placeholder="למשל: אותיות"></label>` : ''}
      </div>
      <div class="field-row">
        <label class="field"><span>מ${esc(d.unitLabel || 'יחידה')} מספר</span>
          <input type="number" min="1" data-field="partStart" value="${d.parts[0].start}"></label>
        <label class="field"><span>עד ${esc(d.unitLabel || 'יחידה')} מספר</span>
          <input type="number" min="1" data-field="partEnd" value="${d.parts[0].end}"></label>
        <label class="field"><span>מספור</span>
          <select data-field="hebNums">
            <option value="1" ${d.hebNums ? 'selected' : ''}>באותיות (א׳, ב׳…)</option>
            <option value="0" ${!d.hebNums ? 'selected' : ''}>במספרים (1, 2…)</option>
          </select></label>
      </div>` : `<p class="muted">${esc(preset.name)}: ${total} ${esc(d.amud ? 'עמודים' : d.unitPlural)} בסך הכול</p>`}

    ${allowAmud ? `<label class="check-field"><input type="checkbox" data-field="amud" ${d.amud ? 'checked' : ''}>
      לימוד לפי עמודים (ע״א / ע״ב) במקום דפים שלמים</label>` : ''}

    <label class="field narrow">
      <span>כמה ${esc(d.amud ? 'עמודים' : d.unitPlural || d.unitLabel)} בכל יום</span>
      <input type="number" min="1" data-field="perDay" value="${d.perDay}">
    </label>

    <fieldset class="field">
      <legend>איך הלימוד מתקדם?</legend>
      <label class="radio"><input type="radio" name="mode" data-field="mode" value="pace" ${d.mode !== 'calendar' ? 'checked' : ''}>
        <span><b>לפי הקצב שלי</b>: כל יום ממשיכים מהמקום שבו עצרתי. אם דילגתי על יום, לא "מפגרים". אפשר לשנות בכל יום את הכמות שלמדתי בפועל.</span></label>
      <label class="radio"><input type="radio" name="mode" data-field="mode" value="calendar" ${d.mode === 'calendar' ? 'checked' : ''}>
        <span><b>לוח קבוע</b> (כמו הדף היומי): לכל תאריך יש מנה קבועה, והלוח ממשיך גם אם לא למדתי. ימים שלא סומנו יופיעו להשלמה.</span></label>
    </fieldset>

    <div class="field-row">
      <label class="field"><span>תאריך התחלה</span>
        <input type="date" data-field="startDate" value="${d.startDate}"></label>
      <label class="field grow"><span>מתחילים מ-</span>
        <select data-field="startPos">${names.map((n, i) => `<option value="${i}" ${i === d.startPos ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    </div>

    <fieldset class="field">
      <legend>ימי לימוד</legend>
      <div class="days">
        ${WEEKDAY_NAMES.map((n, i) => `<label class="day-chip"><input type="checkbox" data-field="day" data-day="${i}" ${d.days[i] ? 'checked' : ''}><span>${n}</span></label>`).join('')}
      </div>
      <label class="field narrow"><span>חגים</span>
        <select data-field="holidays">
          <option value="israel" ${d.holidays === 'israel' ? 'selected' : ''}>לא לומדים בחגים (ארץ ישראל)</option>
          <option value="diaspora" ${d.holidays === 'diaspora' ? 'selected' : ''}>לא לומדים בחגים (חוץ לארץ)</option>
          <option value="none" ${d.holidays === 'none' ? 'selected' : ''}>לומדים גם בחגים</option>
        </select></label>
    </fieldset>

    <div class="form-actions">
      <button type="submit" class="btn primary">שמירה</button>
      <button type="button" class="btn" data-act="cancel-edit">ביטול</button>
    </div>
  </form>`;
}

function applyPreset(d, id) {
  d.presetId = id;
  d.startPos = 0;
  d.amud = false;
  const p = findPreset(id);
  if (!p) {
    d.unitType = 'perek';
    Object.assign(d, { unitLabel: 'פרק', unitPlural: 'פרקים', hebNums: true, parts: [{ name: '', start: 1, end: 10 }] });
    return;
  }
  const u = UNIT_TYPES[p.unit];
  Object.assign(d, {
    name: p.name, unitType: p.unit, unitLabel: u.label, unitPlural: u.plural, hebNums: true,
    parts: JSON.parse(JSON.stringify(p.parts)),
  });
}

/** קורא שדה מהטופס לתוך הטיוטה. מחזיר true אם צריך לצייר מחדש */
function updateDraftField(el) {
  const d = state.draft;
  const f = el.dataset.field;
  const v = el.value;
  const int = (x, min = 1) => Math.max(min, parseInt(x, 10) || min);
  switch (f) {
    case 'presetId': applyPreset(d, v); return true;
    case 'name': d.name = v; return false;
    case 'unitType': {
      d.unitType = v;
      const u = UNIT_TYPES[v];
      d.unitLabel = u.label; d.unitPlural = u.plural;
      if (v !== 'daf') d.amud = false;
      d.hebNums = v !== 'page';
      if (v === 'daf' && d.parts[0].start === 1) d.parts[0].start = 2;
      return true;
    }
    case 'unitLabel': d.unitLabel = v; return false;
    case 'unitPlural': d.unitPlural = v; return false;
    case 'partStart': d.parts[0].start = int(v); return 'change';
    case 'partEnd': d.parts[0].end = int(v); return 'change';
    case 'hebNums': d.hebNums = v === '1'; return true;
    case 'amud': {
      // שמירה על אותה נקודת התחלה בערך
      d.startPos = el.checked ? d.startPos * 2 : Math.floor(d.startPos / 2);
      d.amud = el.checked;
      return true;
    }
    case 'perDay': d.perDay = int(v); return 'change';
    case 'mode': d.mode = v; return false;
    case 'startDate': d.startDate = v || todayStr(); return false;
    case 'startPos': d.startPos = parseInt(v, 10) || 0; return false;
    case 'day': d.days[Number(el.dataset.day)] = el.checked; return false;
    case 'holidays': d.holidays = v; return false;
    default: return false;
  }
}

async function saveDraft() {
  const d = state.draft;
  if (!d.name.trim()) return toast('צריך לתת שם ללימוד');
  if (!d.unitLabel.trim()) return toast('צריך לכתוב את שם יחידת הלימוד');
  if (d.parts.some((p) => p.end < p.start)) return toast('מספר הסיום קטן ממספר ההתחלה');
  if (!d.days.some(Boolean)) return toast('צריך לבחור לפחות יום לימוד אחד');
  const total = totalUnits(d);
  if (d.startPos >= total) d.startPos = 0;
  const t = { ...d, name: d.name.trim() };
  if (!t.unitPlural) t.unitPlural = t.unitLabel;
  delete t._isNew;
  await state.store.saveTrack(t);
  toast(d._isNew ? 'הספר נוסף ✓' : 'השינויים נשמרו ✓');
  state.draft = null;
  state.view = d._isNew ? 'today' : 'books';
  render();
}

// ---------- סטטיסטיקה ----------

function statsView() {
  const tracks = sortedTracks();
  if (!tracks.length) return '<div class="empty"><p>אין עדיין נתונים. הוסף ספר כדי להתחיל.</p></div>';

  // 30 הימים האחרונים
  let fullDays = 0;
  let dueDays = 0;
  for (let i = 1; i <= 30; i++) {
    const s = dayStatus(tracks, addDays(state.today, -i));
    if (s.due) { dueDays++; if (s.done === s.due) fullDays++; }
  }
  const finishedCount = tracks.filter(isFinished).length;

  let html = `<div class="page-head"><h2>סטטיסטיקה</h2></div>
  <div class="tiles">
    <div class="tile"><div class="tile-num">${fullDays}<small>/${dueDays}</small></div><div class="tile-label">ימים שהושלמו במלואם (30 הימים האחרונים)</div></div>
    <div class="tile"><div class="tile-num">${tracks.length - finishedCount}</div><div class="tile-label">לימודים פעילים</div></div>
    <div class="tile"><div class="tile-num">${finishedCount + tracks.reduce((s, t) => s + (t.cycles || 0), 0)}</div><div class="tile-label">סיומים</div></div>
  </div>
  ${heatmap(tracks)}
  <h3 class="section-title">לפי ספר</h3>
  <div class="cards">`;

  for (const t of tracks) {
    const total = totalUnits(t);
    const pos = progressPos(t);
    const pct = Math.round((pos / total) * 100);
    const fin = estimatedFinish(t, state.today);
    const missed = missedDays(t, state.today, 100000).length;
    const daysLearned = Object.keys(t.log || {}).length;
    const st = streak(t, state.today);
    const unitsWord = t.amud ? 'עמודים' : (t.unitPlural || t.unitLabel);
    html += `<div class="card stat">
      <div class="tname">${esc(t.name)}</div>
      <div class="mini"><div class="bar"><div style="width:${pct}%"></div></div><span><b>${pct}%</b></span></div>
      <div class="stat-grid">
        <div><b>${pos}</b> מתוך ${total} ${esc(unitsWord)}</div>
        <div>🔥 רצף: <b>${st}</b> ${st === 1 ? 'יום' : 'ימים'}</div>
        <div>📅 ימים שלמדת: <b>${daysLearned}</b></div>
        <div>${pos >= total ? '🎉 הושלם' : fin ? `🏁 סיום משוער: <b>${formatGreg(fin)}</b>` : ''}</div>
        ${t.mode === 'calendar' ? `<div>${missed ? `⚠️ ימים שלא סומנו: <b>${missed}</b>` : '✓ אין ימים חסרים'}</div>` : ''}
        ${t.cycles ? `<div>🔁 מחזורים שהושלמו: <b>${t.cycles}</b></div>` : ''}
      </div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function heatmap(tracks) {
  const WEEKS = 16;
  // מתחילים מיום ראשון לפני 15 שבועות
  const endSunday = addDays(state.today, -weekday(state.today));
  const start = addDays(endSunday, -7 * (WEEKS - 1));
  let cols = '';
  for (let w = 0; w < WEEKS; w++) {
    let cells = '';
    for (let dIdx = 0; dIdx < 7; dIdx++) {
      const ds = addDays(start, w * 7 + dIdx);
      if (ds > state.today) { cells += '<span class="cell future"></span>'; continue; }
      const s = dayStatus(tracks, ds);
      let cls = 'none';
      let tip = 'אין לימוד מתוכנן';
      if (s.due) {
        const r = s.done / s.due;
        cls = r === 1 ? 'l3' : r >= 0.5 ? 'l2' : r > 0 ? 'l1' : 'l0';
        tip = `סומנו ${s.done} מתוך ${s.due}`;
      }
      cells += `<button class="cell ${cls}" data-act="goto" data-date="${ds}" title="${formatShort(ds)}: ${tip}" aria-label="${formatShort(ds)}: ${tip}"></button>`;
    }
    cols += `<div class="hm-col">${cells}</div>`;
  }
  return `<section class="heatmap-box">
    <h3 class="section-title">16 השבועות האחרונים</h3>
    <div class="heatmap">
      <div class="hm-col hm-labels">${WEEKDAY_SHORT.map((n) => `<span>${n}</span>`).join('')}</div>
      ${cols}
    </div>
    <div class="legend">
      <span><i class="cell l0"></i>לא סומן</span>
      <span><i class="cell l1"></i>חלקי</span>
      <span><i class="cell l2"></i>רוב</span>
      <span><i class="cell l3"></i>הכול</span>
      <span><i class="cell none"></i>אין לימוד</span>
    </div>
    <p class="muted small">לחיצה על משבצת פותחת את היום הזה לסימון.</p>
  </section>`;
}

// ---------- הגדרות וגיבוי ----------

function settingsView() {
  return `<div class="page-head"><h2>הגדרות</h2></div>
  <section class="card col">
    <h3>חשבון</h3>
    ${state.demo
      ? '<p>מצב הדגמה: אין כניסה עם Google. הנתונים נשמרים רק בדפדפן הזה.</p>'
      : `<p>מחובר בתור <b>${esc(state.user.displayName || '')}</b> (${esc(state.user.email || '')})</p>
         <p class="muted">הנתונים נשמרים בענן, ומופיעים בכל מכשיר שבו תתחבר עם אותו חשבון.</p>
         <button class="btn" data-act="logout">התנתקות</button>`}
  </section>
  <section class="card col">
    <h3>גיבוי</h3>
    <p class="muted">שמירת כל הספרים והסימונים לקובץ במחשב או בטלפון, ושחזור מקובץ כזה.</p>
    <div class="row">
      <button class="btn primary" data-act="export">⬇️ הורדת קובץ גיבוי</button>
      <label class="btn">⬆️ שחזור מגיבוי<input type="file" accept=".json,application/json" id="import-file" hidden></label>
    </div>
    <p class="muted small">שימו לב: שחזור מחליף את כל הנתונים הנוכחיים בנתונים שבקובץ.</p>
  </section>
  <section class="card col">
    <h3>התקנה בטלפון</h3>
    <p><b>אנדרואיד (Chrome):</b> תפריט ⋮ ← "הוספה למסך הבית" / "התקנת אפליקציה".</p>
    <p><b>אייפון (Safari):</b> כפתור השיתוף ⬆️ ← "הוסף למסך הבית".</p>
  </section>`;
}

function exportBackup() {
  const data = { app: 'limud-yomi', version: 1, exportedAt: new Date().toISOString(), tracks: state.tracks };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `limud-backup-${state.today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data?.tracks)) throw new Error('הקובץ אינו קובץ גיבוי תקין');
  if (!confirm(`לשחזר ${data.tracks.length} לימודים מהגיבוי? הנתונים הנוכחיים יוחלפו.`)) return;
  await state.store.replaceAll(data.tracks);
  toast('הגיבוי שוחזר ✓');
}

// ---------------- אירועים ----------------

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const t = state.tracks.find((x) => x.id === id);

  switch (act) {
    case 'login': safe(() => state.fb.signIn()); break;
    case 'logout': safe(() => state.fb.signOut()); break;
    case 'view': state.view = el.dataset.view; state.draft = null; if (state.view === 'today') state.date = state.today; render(); window.scrollTo(0, 0); break;
    case 'day': {
      const nd = addDays(state.date, Number(el.dataset.delta));
      if (nd <= state.today) { state.date = nd; render(); }
      break;
    }
    case 'goto-today': state.date = state.today; render(); break;
    case 'goto': state.date = el.dataset.date; state.view = 'today'; render(); window.scrollTo(0, 0); break;
    case 'toggle-missed': state.showMissed = !state.showMissed; render(); break;
    case 'toggle': {
      const p = portionFor(t, state.date);
      if (!p) break;
      const key = `${t.id}|${state.date}`;
      const amount = p.done ? null : (t.mode === 'calendar' ? p.count : (state.pending[key] || p.count));
      delete state.pending[key];
      safe(() => state.store.setLog(t.id, state.date, amount));
      break;
    }
    case 'amt': {
      const p = portionFor(t, state.date);
      if (!p) break;
      const key = `${t.id}|${state.date}`;
      const max = totalUnits(t) - p.from;
      const cur = p.done ? p.count : (state.pending[key] || p.count);
      const next = Math.max(1, Math.min(max, cur + Number(el.dataset.delta)));
      if (p.done) safe(() => state.store.setLog(t.id, state.date, next));
      else { state.pending[key] = next; render(); }
      break;
    }
    case 'mark-past': safe(() => state.store.setLog(t.id, el.dataset.date, portionFor(t, el.dataset.date).count)); break;
    case 'restart': {
      const startDate = t.log?.[state.today] ? addDays(state.today, 1) : state.today;
      safe(() => state.store.saveTrack({ ...t, startPos: 0, startDate, cycles: (t.cycles || 0) + 1 }));
      break;
    }
    case 'add': startDraft(null); render(); window.scrollTo(0, 0); break;
    case 'edit': startDraft(t); render(); window.scrollTo(0, 0); break;
    case 'delete':
      if (confirm(`למחוק את "${t.name}" וכל הסימונים שלו? אי אפשר לבטל.`)) safe(() => state.store.deleteTrack(id));
      break;
    case 'cancel-edit': state.draft = null; state.view = 'books'; render(); break;
    case 'export': exportBackup(); break;
    default: break;
  }
});

$app.addEventListener('input', (e) => {
  const el = e.target;
  if (state.view === 'edit' && el.dataset.field && el.type !== 'checkbox' && el.type !== 'radio' && el.tagName !== 'SELECT') {
    updateDraftField(el);
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file' && el.files[0]) {
    safe(() => importBackup(el.files[0]));
    el.value = '';
    return;
  }
  if (state.view === 'edit' && el.dataset.field) {
    if (updateDraftField(el)) render();
  }
});

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  safe(saveDraft);
});

start();
