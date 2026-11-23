import { firebaseConfig, googleWebClientId, adminUid } from './config.js';
import { LocalStore, initFirebase, isNative, authErrorText } from './store.js';
import { PRESETS, UNIT_TYPES, findPreset, pickAll, pickParts, migratePresetId } from './books.js';
import {
  todayStr, addDays, formatGreg, formatHebrew, formatShort, weekday, WEEKDAY_NAMES, WEEKDAY_SHORT,
  toDateStr, hebrewMonthYear, formatGregMonth,
} from './hebrew.js';
import {
  totalUnits, rangeName, portionText, allUnitNames, portionFor, progressPos, isFinished, missedDays, streak,
  estimatedFinish, dayStatus, newTrack, noLearningReason,
} from './schedule.js';

const $app = document.getElementById('app');

const MAX_AHEAD = 30; // אפשר לסמן עד חודש קדימה

const state = {
  online: navigator.onLine,
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
  calStart: null, // החודש הראשון שמוצג בלוח (YYYY-MM-01)
  openStats: new Set(), // ספרים שפתוחים בסטטיסטיקה בתצוגה מוקטנת
};

// ---------------- ערכות צבע ----------------

const THEMES = [
  ['blue', 'כחול בהיר', '#2f6fb5', '#dcebfa'],
  ['sky', 'תכלת', '#127a97', '#d4f0f7'],
  ['green', 'ירוק בהיר', '#2a7f50', '#d9f1e1'],
  ['purple', 'סגול בהיר', '#7556c0', '#ebe3fa'],
  ['red', 'אדום בהיר', '#c4443b', '#fbe1de'],
  ['pink', 'ורוד בהיר', '#bd447c', '#fae0ed'],
];

function currentTheme() {
  return localStorage.getItem('limud-theme') || 'blue';
}

function applyTheme(id) {
  const th = THEMES.find((x) => x[0] === id) || THEMES[0];
  if (th[0] === 'blue') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th[0];
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th[3]);
}
applyTheme(currentTheme());

// תצוגה מוקטנת (למסכים קטנים)
const isCompact = () => localStorage.getItem('limud-compact') === '1';
function applyCompact() {
  if (isCompact()) document.documentElement.dataset.compact = '1';
  else delete document.documentElement.dataset.compact;
}
applyCompact();

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
    toast(e?.code?.startsWith?.('auth/') ? authErrorText(e) : 'שגיאה: ' + (e?.message || e));
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
      state.fb = await initFirebase(firebaseConfig, googleWebClientId);
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
      if (user) {
        connectStore(state.fb.storeFor(user.uid));
        state.fb.recordMember(user);
      }
      else render();
    });
  }
  // מצב חיבור לאינטרנט
  window.addEventListener('online', () => { state.online = true; render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });
  // מעבר יום בחצות
  setInterval(checkNewDay, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });
  // מספר הגרסה של אפליקציית האנדרואיד (נכתב בזמן הבנייה ב-GitHub)
  if (isNative) {
    fetch('version.txt').then((r) => (r.ok ? r.text() : '')).then((v) => { state.appVersion = v.trim(); }).catch(() => {});
  }
  if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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
    ${!state.online && !state.demo ? '<div class="offline-banner">📴 אין חיבור לאינטרנט. אפשר להמשיך לסמן, והסימונים יסונכרנו כשהחיבור יחזור.</div>' : ''}
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
      <div class="or"><span>או</span></div>
      <form class="email-login" id="email-form" autocomplete="on">
        <input type="email" id="login-email" placeholder="כתובת מייל" autocomplete="email" dir="ltr" required>
        <input type="password" id="login-password" placeholder="סיסמה" autocomplete="current-password" dir="ltr">
        <button type="submit" class="btn primary">כניסה עם מייל וסיסמה</button>
        <div class="row center">
          <button type="button" class="link" data-act="signup-email">יצירת חשבון חדש</button>
          <span class="muted">·</span>
          <button type="button" class="link" data-act="reset-pw">שכחתי סיסמה</button>
        </div>
      </form>
      <p class="muted small">נכנסת עד עכשיו עם גוגל ורוצה גם סיסמה? היכנס עם גוגל, ואז קבע סיסמה במסך "הגדרות".</p>
    </div>
  </div>`;
}

// ---------- מסך "היום" ----------

function todayView() {
  const ds = state.date;
  const isToday = ds === state.today;
  const isFuture = ds > state.today;
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
  // סדר: קודם מה שעוד לא סומן, אחר כך מה שסומן. בתוך כל קבוצה — לפי מה שבדרך כלל מסמנים ראשון
  const habit = habitRank(tracks);
  const pos = new Map(tracks.map((t, i) => [t.id, i]));
  const score = (t) => (habit.has(t.id) ? habit.get(t.id) : 1000 + pos.get(t.id));
  active.sort(([ta, pa], [tb, pb]) => (pa.done - pb.done) || (score(ta) - score(tb)));

  let html = `
    <section class="daybar">
      <button class="icon-btn" data-act="day" data-delta="-1" title="יום קודם" aria-label="יום קודם">→</button>
      <div class="daybar-title">
        <strong>יום ${WEEKDAY_NAMES[weekday(ds)]}${isToday ? ' (היום)' : ''}</strong>
        <span>${formatGreg(ds)} · ${formatHebrew(ds)}</span>
      </div>
      <button class="icon-btn" data-act="day" data-delta="1" ${ds >= addDays(state.today, MAX_AHEAD) ? 'disabled' : ''} title="יום הבא" aria-label="יום הבא">←</button>
    </section>`;

  if (isFuture) {
    html += `<div class="past-note future">📅 לימוד מראש: אפשר לסמן כאן לימוד ליום עתידי (עד חודש קדימה), למשל לפני חופשה.
      <button class="link" data-act="goto-today">חזרה להיום</button></div>`;
  } else if (!isToday) {
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

/**
 * הסדר הרגיל של הסימונים ב-10 הימים האחרונים: לכל ספר — הממוצע של המקום שלו
 * בסדר הסימון של כל יום (0 = סומן ראשון, 1 = סומן אחרון). ספר בלי נתונים לא מופיע.
 */
function habitRank(tracks) {
  const sums = new Map();
  for (let i = 0; i < 10; i++) {
    const d = addDays(state.today, -i);
    const marked = tracks.filter((t) => t.markedAt?.[d]).sort((a, b) => a.markedAt[d] - b.markedAt[d]);
    if (marked.length < 2) continue; // יום עם סימון אחד בלבד לא מלמד על הסדר
    marked.forEach((t, idx) => {
      const r = idx / (marked.length - 1);
      const cur = sums.get(t.id) || [0, 0];
      sums.set(t.id, [cur[0] + r, cur[1] + 1]);
    });
  }
  return new Map([...sums].map(([id, [sum, n]]) => [id, sum / n]));
}

function portionCard(t, p, ds) {
  const key = `${t.id}|${ds}`;
  const total = totalUnits(t);
  const pct = t.fixed ? 0 : Math.round((progressPos(t) / total) * 100);
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
      <div class="range">${esc(p.fixed ? p.label : rangeName(t, rangeFrom, amount))}</div>
      ${t.fixed
        ? `<div class="mini">🔥 רצף: ${streak(t, state.today)} · ימים שלמדת: ${progressPos(t)}</div>`
        : `<div class="mini"><div class="bar thin"><div style="width:${pct}%"></div></div><span>${pct}%</span></div>`}
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
        <span class="grow"><b>${esc(t.name)}</b>: ${esc(portionText(t, p))}</span>
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
          ${t.fixed
            ? `<div class="meta">לימוד קבוע לפי התאריך · ${days}</div>
               <div class="mini">ימים שלמדת: ${pos}</div>`
            : `<div class="meta">${amountText(t, t.perDay)} ביום · ${t.mode === 'calendar' ? 'לוח קבוע' : 'לפי הקצב שלי'} · ${days}</div>
          <div class="mini"><div class="bar thin"><div style="width:${(pos / total) * 100}%"></div></div>
            <span>${pos}/${total}</span></div>`}
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
  const d = t ? JSON.parse(JSON.stringify(t)) : newTrack({ presetId: '', unitType: 'perek', name: '' });
  d._isNew = !t;
  d._autoName = !t;
  if (t) {
    // לימודים שנוצרו לפני שהיתה בחירת ספרים
    const old = migratePresetId(d.presetId);
    if (old) {
      d.presetId = old[0];
      d.parts = pickParts(findPreset(old[0]), old[1]);
    }
    if (findPreset(d.presetId)?.pick) d.picked = d.parts.map((p) => p.name);
  }
  state.draft = d;
  state.view = 'edit';
}

/** עדכון החלקים והשם אחרי שינוי בבחירת ספרים/מסכתות */
function applyPick(d, names) {
  const preset = findPreset(d.presetId);
  d.picked = names;
  d.parts = pickParts(preset, names);
  d.startPos = 0;
  if (d._autoName) {
    const all = names.length === pickAll(preset).length;
    // בחירה של קבוצה שלמה בדיוק (למשל "סדר מועד" או "תורה") מקבלת את שם הקבוצה
    const exact = preset.pick.groups.find((g) => g.items.length === names.length
      && g.items.every((it) => names.includes(it.name)) && g.items.length > 1);
    d.name = !names.length ? ''
      : !all && exact ? preset.pick.prefix + exact.title
        : preset.pick.nameFor(d.parts.map((p) => p.name), all);
  }
}

function pickView(d, preset) {
  const picked = new Set(d.picked || []);
  const total = pickAll(preset).length;
  return `<fieldset class="field">
    <legend>${esc(preset.pick.label)} <span class="muted">(נבחרו ${picked.size} מתוך ${total})</span></legend>
    <div class="row pick-actions">
      <button type="button" class="btn small" data-act="pick-all">בחר הכול</button>
      <button type="button" class="btn small" data-act="pick-none">נקה הכול</button>
    </div>
    ${preset.pick.groups.map((g, gi) => `
      <div class="pick-group">
        <button type="button" class="link pick-title" data-act="pick-group" data-group="${gi}" title="בחירה או ביטול של כל הקבוצה">${esc(g.title)}</button>
        <div class="days">
          ${g.items.map((it) => `<label class="day-chip"><input type="checkbox" data-field="pick" data-name="${esc(it.name)}" ${picked.has(it.name) ? 'checked' : ''}><span>${esc(it.name)}</span></label>`).join('')}
        </div>
      </div>`).join('')}
  </fieldset>`;
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
  if (d.fixed) return fixedFormView(d, presetOptions);

  return `<div class="page-head"><h2>${d._isNew ? 'הוספת ספר / לימוד' : 'עריכת ' + esc(d.name)}</h2></div>
  <form class="form" id="track-form" autocomplete="off">
    <label class="field">
      <span>בחירת ספר</span>
      <select data-field="presetId">
        <option value="" ${custom ? 'selected' : ''}>✏️ ספר אחר (הגדרה ידנית)</option>
        ${presetOptions}
      </select>
    </label>

    ${preset?.pick ? pickView(d, preset) : ''}

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
      </div>` : `<p class="muted">${total ? `${total} ${esc(d.amud ? 'עמודים' : d.unitPlural)} בסך הכול` : 'עוד לא נבחר כלום'}</p>`}

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

const FIXED_HELP = {
  'tehillim-month': 'כל יום לפי היום בחודש העברי (א׳: פרקים א׳–ט׳ … ל׳: פרקים קמ״ה–ק״נ). בחודש של 29 יום, ביום כ״ט אומרים גם את של ל׳.',
  'tehillim-week': 'כל יום לפי היום בשבוע: ראשון א׳–כ״ט, שני ל׳–נ׳, שלישי נ״א–ע״ב, רביעי ע״ג–פ״ט, חמישי צ׳–ק״ו, שישי ק״ז–קי״ט, שבת ק״כ–ק״נ.',
  'ohr-hachaim': 'כל יום עליה אחת מפרשת השבוע: ראשון בראשון, שני בשני … ושביעי בשבת. בשבוע שהשבת שלו חג, לומדים את הפרשה הבאה.',
  chok: 'כל יום לפי פרשת השבוע ויום השבוע, כמו שמסודר בספר חוק לישראל. למשל: וישלח – יום א׳, וישלח – יום ב׳ … וישלח – יום שבת.',
};

function fixedFormView(d, presetOptions) {
  const usesParsha = d.fixed === 'ohr-hachaim' || d.fixed === 'chok';
  return `<div class="page-head"><h2>${d._isNew ? 'הוספת ספר / לימוד' : 'עריכת ' + esc(d.name)}</h2></div>
  <form class="form" id="track-form" autocomplete="off">
    <label class="field"><span>בחירת ספר</span>
      <select data-field="presetId"><option value="">✏️ ספר אחר (הגדרה ידנית)</option>${presetOptions}</select></label>
    <p class="muted">${esc(FIXED_HELP[d.fixed] || '')}</p>
    <label class="field"><span>שם הלימוד</span>
      <input type="text" data-field="name" value="${esc(d.name)}" required></label>
    ${usesParsha ? `<label class="field narrow"><span>פרשות השבוע לפי</span>
      <select data-field="region">
        <option value="israel" ${d.region !== 'diaspora' ? 'selected' : ''}>ארץ ישראל</option>
        <option value="diaspora" ${d.region === 'diaspora' ? 'selected' : ''}>חוץ לארץ</option>
      </select></label>` : ''}
    <label class="field narrow"><span>תאריך התחלה</span>
      <input type="date" data-field="startDate" value="${d.startDate}"></label>
    <fieldset class="field">
      <legend>ימי לימוד</legend>
      <div class="days">
        ${WEEKDAY_NAMES.map((n, i) => `<label class="day-chip"><input type="checkbox" data-field="day" data-day="${i}" ${d.days[i] ? 'checked' : ''}><span>${n}</span></label>`).join('')}
      </div>
      <label class="field narrow"><span>חגים</span>
        <select data-field="holidays">
          <option value="none" ${d.holidays === 'none' ? 'selected' : ''}>לומדים גם בחגים</option>
          <option value="israel" ${d.holidays === 'israel' ? 'selected' : ''}>לא לומדים בחגים (ארץ ישראל)</option>
          <option value="diaspora" ${d.holidays === 'diaspora' ? 'selected' : ''}>לא לומדים בחגים (חוץ לארץ)</option>
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
  delete d.fixed;
  if (p?.fixed) {
    Object.assign(d, {
      name: p.name, fixed: p.fixed, mode: 'calendar', parts: [], unitType: 'other', unitLabel: 'יום', unitPlural: 'ימים',
      perDay: 1, days: [true, true, true, true, true, true, true], holidays: 'none', region: d.region || 'israel',
    });
    delete d.picked;
    return;
  }
  if (d.parts.length === 0) d.parts = [{ name: '', start: 1, end: 10 }];
  if (!p) {
    d.unitType = 'perek';
    Object.assign(d, { unitLabel: 'פרק', unitPlural: 'פרקים', hebNums: true, parts: [{ name: '', start: 1, end: 10 }] });
    return;
  }
  const u = UNIT_TYPES[p.unit];
  Object.assign(d, {
    name: p.name, unitType: p.unit, unitLabel: u.label, unitPlural: u.plural, hebNums: true,
    perDay: p.perDay || d.perDay,
  });
  if (p.pick) {
    d._autoName = true;
    applyPick(d, pickAll(p).map((x) => x.name)); // ברירת מחדל: הכול מסומן
  } else {
    d.parts = JSON.parse(JSON.stringify(p.parts));
    delete d.picked;
  }
}

/** קורא שדה מהטופס לתוך הטיוטה. מחזיר true אם צריך לצייר מחדש */
function updateDraftField(el) {
  const d = state.draft;
  const f = el.dataset.field;
  const v = el.value;
  const int = (x, min = 1) => Math.max(min, parseInt(x, 10) || min);
  switch (f) {
    case 'presetId': applyPreset(d, v); return true;
    case 'name': d.name = v; d._autoName = false; return false;
    case 'pick': {
      const set = new Set(d.picked || []);
      if (el.checked) set.add(el.dataset.name); else set.delete(el.dataset.name);
      applyPick(d, [...set]);
      return true;
    }
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
    case 'region': d.region = v; return false;
    default: return false;
  }
}

async function saveDraft() {
  const d = state.draft;
  if (!d.fixed && !d.parts.length) return toast('צריך לבחור לפחות ספר או מסכת אחת');
  if (!d.name.trim()) return toast('צריך לתת שם ללימוד');
  if (!d.unitLabel.trim()) return toast('צריך לכתוב את שם יחידת הלימוד');
  if (d.parts.some((p) => p.end < p.start)) return toast('מספר הסיום קטן ממספר ההתחלה');
  if (!d.days.some(Boolean)) return toast('צריך לבחור לפחות יום לימוד אחד');
  const total = totalUnits(d);
  if (d.startPos >= total) d.startPos = 0;
  const t = { ...d, name: d.name.trim() };
  if (!t.unitPlural) t.unitPlural = t.unitLabel;
  delete t._isNew;
  delete t._autoName;
  delete t.picked;
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
  ${calendarView(tracks)}
  <h3 class="section-title">לפי ספר${isCompact() ? ' <small class="muted">(לחיצה על ספר מציגה את הפרטים)</small>' : ''}</h3>
  <div class="cards">`;

  for (const t of tracks) {
    const total = totalUnits(t);
    const pos = progressPos(t);
    const pct = t.fixed ? 0 : Math.round((pos / total) * 100);
    const fin = estimatedFinish(t, state.today);
    const missed = missedDays(t, state.today, 100000).length;
    const daysLearned = Object.keys(t.log || {}).length;
    const st = streak(t, state.today);
    const unitsWord = t.amud ? 'עמודים' : (t.unitPlural || t.unitLabel);
    const compact = isCompact();
    const open = !compact || state.openStats.has(t.id);
    const head = `<div class="tname">${esc(t.name)}</div>
      ${t.fixed ? '<div class="mini">לימוד קבוע לפי התאריך</div>' : `<div class="mini"><div class="bar"><div style="width:${pct}%"></div></div><span><b>${pct}%</b></span></div>`}`;
    html += `<div class="card stat ${compact ? 'collapsible' : ''}">
      ${compact
        ? `<button class="stat-head" data-act="stat-toggle" data-id="${t.id}" aria-expanded="${open}">${head}<span class="chev">${open ? '▲' : '▼'}</span></button>`
        : head}
      ${open ? `<div class="stat-grid">
        ${t.fixed ? '' : `<div><b>${pos}</b> מתוך ${total} ${esc(unitsWord)}</div>`}
        <div>🔥 רצף: <b>${st}</b> ${st === 1 ? 'יום' : 'ימים'}</div>
        <div>📅 ימים שלמדת: <b>${daysLearned}</b></div>
        <div>${t.fixed ? '' : pos >= total ? '🎉 הושלם' : fin ? `🏁 סיום משוער: <b>${formatGreg(fin)}</b>` : ''}</div>
        ${t.mode === 'calendar' || t.fixed ? `<div>${missed ? `⚠️ ימים שלא סומנו: <b>${missed}</b>` : '✓ אין ימים חסרים'}</div>` : ''}
        ${t.cycles ? `<div>🔁 מחזורים שהושלמו: <b>${t.cycles}</b></div>` : ''}
      </div>` : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

const monthStart = (ds) => ds.slice(0, 8) + '01';
function addMonths(ms, n) {
  const [y, m] = ms.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return toDateStr(d);
}

/** היום שבו המשתמש נרשם (או הספר הראשון שהוסיף) — מכאן מתחיל הלוח */
function signupDate(tracks) {
  const created = state.user?.metadata?.creationTime;
  let d = created ? toDateStr(new Date(created)) : null;
  for (const t of tracks) {
    const c = t.createdAt ? toDateStr(new Date(t.createdAt)) : null;
    if (c && (!d || c < d)) d = c;
  }
  return d && d < state.today ? d : state.today;
}

function dayClass(tracks, ds, signup) {
  if (ds < signup) return ['before', ''];
  const s = dayStatus(tracks, ds);
  const future = ds > state.today;
  if (!s.due) return [future ? 'future' : 'off', 'אין לימוד מתוכנן'];
  if (future && !s.done) return ['future', 'יום עתידי'];
  if (ds === state.today && !s.done) return ['future', 'עוד לא סומן היום'];
  const r = s.done / s.due;
  const cls = r === 1 ? 'done' : r >= 0.5 ? 'most' : r > 0 ? 'partial' : 'missed';
  return [cls, `סומנו ${s.done} מתוך ${s.due}`];
}

function monthView(tracks, ms, signup) {
  const { month: hm1, year: hy1 } = hebrewMonthYear(ms);
  const last = addDays(addMonths(ms, 1), -1);
  const { month: hm2, year: hy2 } = hebrewMonthYear(last);
  const hebTitle = hy1 === hy2 ? `${hm1 === hm2 ? hm1 : `${hm1}–${hm2}`} ${hy1}` : `${hm1} ${hy1} – ${hm2} ${hy2}`;
  const maxClick = addDays(state.today, 30);
  let cells = WEEKDAY_SHORT.map((n) => `<span class="cal-wd">${n}</span>`).join('');
  for (let i = 0; i < weekday(ms); i++) cells += '<span class="cal-day blank"></span>';
  for (let ds = ms; ds <= last; ds = addDays(ds, 1)) {
    const [cls, tip] = dayClass(tracks, ds, signup);
    const day = Number(ds.slice(8));
    const today = ds === state.today ? ' today' : '';
    const label = `${formatShort(ds)} · ${formatHebrew(ds)}${tip ? ': ' + tip : ''}`;
    cells += cls === 'before' || ds > maxClick
      ? `<span class="cal-day ${cls}${today}" title="${esc(label)}">${day}</span>`
      : `<button class="cal-day ${cls}${today}" data-act="goto" data-date="${ds}" title="${esc(label)}" aria-label="${esc(label)}">${day}</button>`;
  }
  return `<div class="cal-month"><h4>${formatGregMonth(ms)}<small>${esc(hebTitle)}</small></h4>
    <div class="cal-grid">${cells}</div></div>`;
}

function calendarView(tracks) {
  const signup = signupDate(tracks);
  const first = monthStart(signup);
  const cur = monthStart(state.today);
  if (!state.calStart) state.calStart = cur;
  const ms = state.calStart;
  return `<section class="cal-box">
    <div class="cal-head">
      <button class="icon-btn" data-act="cal" data-delta="-1" ${ms <= first ? 'disabled' : ''} title="חודשים קודמים" aria-label="חודשים קודמים">→</button>
      <h3 class="section-title" style="margin:8px 0">לוח מעקב</h3>
      <button class="icon-btn" data-act="cal" data-delta="1" ${ms >= (isCompact() ? addMonths(cur, 1) : cur) ? 'disabled' : ''} title="חודשים הבאים" aria-label="חודשים הבאים">←</button>
    </div>
    <div class="cal-months">
      ${monthView(tracks, ms, signup)}
      ${isCompact() ? '' : monthView(tracks, addMonths(ms, 1), signup)}
    </div>
    <div class="legend">
      <span><i class="cal-day done"></i>הושלם</span>
      <span><i class="cal-day most"></i>רוב</span>
      <span><i class="cal-day partial"></i>חלקי</span>
      <span><i class="cal-day missed"></i>לא סומן</span>
      <span><i class="cal-day future"></i>עתידי</span>
      <span><i class="cal-day off"></i>אין לימוד</span>
    </div>
    <p class="muted small">לחיצה על יום פותחת אותו לסימון (עד חודש קדימה).</p>
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
  ${!state.demo && adminUid && state.user?.uid === adminUid ? membersSection() : ''}
  ${state.demo ? '' : `<section class="card col">
    <h3>כניסה עם מייל וסיסמה</h3>
    <p class="muted">${state.fb.hasPassword()
      ? 'כבר קבעת סיסמה. אפשר להיכנס גם עם המייל והסיסמה (למשל באפליקציה בטאבלט). כאן אפשר לשנות אותה.'
      : 'קביעת סיסמה מאפשרת להיכנס לאותו חשבון ולאותם נתונים גם עם המייל והסיסמה (למשל באפליקציה בטאבלט).'}</p>
    <form class="row" id="password-form">
      <input type="password" id="new-password" placeholder="סיסמה חדשה (לפחות 6 תווים)" autocomplete="new-password" dir="ltr" minlength="6" required style="max-width:260px">
      <button type="submit" class="btn primary">${state.fb.hasPassword() ? 'שינוי סיסמה' : 'קביעת סיסמה'}</button>
    </form>
  </section>`}
  <section class="card col">
    <h3>צבע האפליקציה</h3>
    <div class="themes">
      ${THEMES.map(([id, name, c1, c2]) => `<button class="theme-btn ${currentTheme() === id ? 'active' : ''}" data-act="theme" data-theme="${id}">
        <i style="background:linear-gradient(135deg, ${c2} 50%, ${c1} 50%)"></i>${name}</button>`).join('')}
    </div>
  </section>
  <section class="card col">
    <h3>תצוגה</h3>
    <label class="check-field"><input type="checkbox" data-act-change="compact" ${isCompact() ? 'checked' : ''}>
      <span><b>תצוגה מוקטנת</b>: כתב וכפתורים קטנים יותר, ולוח מעקב של חודש אחד, כדי שיותר ייכנס במסך.</span></label>
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
    ${state.appVersion ? `<p>גרסת האפליקציה המותקנת: <b>${esc(state.appVersion)}</b></p>` : ''}
    <p><b>אנדרואיד (Chrome):</b> תפריט ⋮ ← "הוספה למסך הבית" / "התקנת אפליקציה".</p>
    <p><b>אייפון (Safari):</b> כפתור השיתוף ⬆️ ← "הוסף למסך הבית".</p>
  </section>`;
}

function membersSection() {
  const m = state.members;
  let body;
  if (!m) body = '<button class="btn" data-act="load-members">הצגת המשתמשים</button>';
  else if (m.error) body = `<p class="muted">לא הצלחתי לטעון: ${esc(m.error)}</p>`;
  else {
    const rows = [...m.list].sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
    const fmt = (d) => (d ? d.toLocaleDateString('he-IL') : '—');
    body = `<p class="muted">${rows.length} משתמשים. מוצגים רק מייל, שם ותאריכים, בלי שום מידע על הלימוד.</p>
      <div class="members">${rows.map((r) => `<div class="member">
        <div><b dir="ltr">${esc(r.email)}</b>${r.name ? ` <span class="muted">· ${esc(r.name)}</span>` : ''}</div>
        <div class="muted small">נרשם: ${fmt(r.createdAt ? new Date(r.createdAt) : null)} · כניסה אחרונה: ${fmt(r.lastLogin)}${r.app === 'android' ? ' · אנדרואיד' : ''}</div>
      </div>`).join('')}</div>
      <button class="link" data-act="load-members">רענון</button>`;
  }
  return `<section class="card col"><h3>👤 משתמשים רשומים (מנהל)</h3>${body}</section>`;
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
    case 'signup-email': {
      const [email, pw] = loginFields();
      if (!email || pw.length < 6) { toast('כדי ליצור חשבון, כתוב מייל וסיסמה של לפחות 6 תווים'); break; }
      safe(() => state.fb.signUpEmail(email, pw));
      break;
    }
    case 'reset-pw': {
      const [email] = loginFields();
      if (!email) { toast('כתוב קודם את כתובת המייל'); break; }
      safe(async () => { await state.fb.resetPassword(email); toast('נשלח מייל לאיפוס סיסמה (בדוק גם בספאם)'); });
      break;
    }
    case 'view': state.view = el.dataset.view; state.draft = null; if (state.view === 'today') state.date = state.today; render(); window.scrollTo(0, 0); break;
    case 'day': {
      const nd = addDays(state.date, Number(el.dataset.delta));
      if (nd <= addDays(state.today, MAX_AHEAD)) { state.date = nd; render(); }
      break;
    }
    case 'goto-today': state.date = state.today; render(); break;
    case 'goto': state.date = el.dataset.date; state.view = 'today'; render(); window.scrollTo(0, 0); break;
    case 'load-members':
      state.fb.listMembers()
        .then((list) => { state.members = { list }; render(); })
        .catch((e) => { state.members = { error: e.code === 'permission-denied' ? 'אין הרשאה (צריך לעדכן את חוקי האבטחה ב-Firebase)' : e.message }; render(); });
      break;
    case 'theme':
      localStorage.setItem('limud-theme', el.dataset.theme);
      applyTheme(el.dataset.theme);
      render();
      break;
    case 'stat-toggle':
      if (state.openStats.has(id)) state.openStats.delete(id); else state.openStats.add(id);
      render();
      break;
    case 'cal':
      state.calStart = addMonths(state.calStart, Number(el.dataset.delta));
      render();
      break;
    case 'toggle-missed': state.showMissed = !state.showMissed; render(); break;
    case 'toggle': {
      const p = portionFor(t, state.date);
      if (!p) break;
      const key = `${t.id}|${state.date}`;
      const amount = p.done ? null : (t.mode === 'calendar' ? p.count : (state.pending[key] || p.count));
      delete state.pending[key];
      // שומרים גם את שעת הסימון (רק כשמסמנים את היום עצמו), כדי לסדר את הרשימה לפי ההרגל
      const markTime = amount ? (state.date === state.today ? Date.now() : undefined) : null;
      safe(() => state.store.setLog(t.id, state.date, amount, markTime));
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
    case 'pick-all':
    case 'pick-none':
    case 'pick-group': {
      const d = state.draft;
      const preset = findPreset(d.presetId);
      let names;
      if (act === 'pick-all') names = pickAll(preset).map((x) => x.name);
      else if (act === 'pick-none') names = [];
      else {
        const g = preset.pick.groups[Number(el.dataset.group)].items.map((x) => x.name);
        const cur = new Set(d.picked || []);
        const allIn = g.every((n) => cur.has(n));
        g.forEach((n) => (allIn ? cur.delete(n) : cur.add(n)));
        names = [...cur];
      }
      applyPick(d, names);
      render();
      break;
    }
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
  if (el.dataset.actChange === 'compact') {
    localStorage.setItem('limud-compact', el.checked ? '1' : '0');
    applyCompact();
    state.calStart = null;
    render();
    return;
  }
  if (el.id === 'import-file' && el.files[0]) {
    safe(() => importBackup(el.files[0]));
    el.value = '';
    return;
  }
  if (state.view === 'edit' && el.dataset.field) {
    if (updateDraftField(el)) render();
  }
});

const loginFields = () => [document.getElementById('login-email')?.value || '', document.getElementById('login-password')?.value || ''];

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'email-form') {
    const [email, pw] = loginFields();
    safe(() => state.fb.signInEmail(email, pw));
  } else if (e.target.id === 'password-form') {
    const pw = document.getElementById('new-password').value;
    safe(async () => { await state.fb.setPassword(pw); toast('הסיסמה נשמרה ✓'); render(); });
  } else {
    safe(saveDraft);
  }
});

start();
