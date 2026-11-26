// חישוב יחידות הלימוד, המנה היומית והסטטיסטיקה

import { gematria, addDays, weekday, holidayName, todayStr } from './hebrew.js';
import { fixedLabel } from './fixed.js';

/*
 מבנה "לימוד" (track):
 {
   id, name,
   unitLabel: 'פרק', unitPlural: 'פרקים', hebNums: true, amud: false,
   parts: [{ name: 'ברכות', start: 2, end: 64 }, ...],
   perDay: 1,
   mode: 'pace' | 'calendar',   // pace = לפי הקצב שלי, calendar = לפי לוח קבוע
   startDate: 'YYYY-MM-DD', startPos: 0,
   days: [true x7],              // ימי לימוד, 0 = ראשון
   holidays: 'israel' | 'diaspora' | 'none',
   log: { 'YYYY-MM-DD': amount },
   cycles: 0, createdAt
 }
*/

// חלק יכול להיות טווח פשוט {name, start, end}
// או חלק עם פרקים {name, chapters: [מספר יחידות בכל פרק], chapterLabel: 'פרק'}
const partSize = (t, p) => (p.chapters
  ? p.chapters.reduce((a, b) => a + b, 0)
  : (p.end - p.start + 1) * (t.amud ? 2 : 1));

export function totalUnits(t) {
  return t.parts.reduce((s, p) => s + partSize(t, p), 0);
}

function locate(t, i) {
  let idx = i;
  for (const p of t.parts) {
    const size = partSize(t, p);
    if (idx < size) {
      if (p.chapters) {
        let c = 0;
        while (idx >= p.chapters[c]) { idx -= p.chapters[c]; c++; }
        return { part: p, chap: c + 1, num: idx + 1, side: 0 };
      }
      return t.amud
        ? { part: p, num: p.start + Math.floor(idx / 2), side: idx % 2 }
        : { part: p, num: p.start + idx, side: 0 };
    }
    idx -= size;
  }
  const n = totalUnits(t);
  return n > 0 && i !== n - 1 ? locate(t, n - 1) : { part: { name: '' }, num: 0, side: 0 };
}

const heb = (t, n, marks = true) => (t.hebNums ? gematria(n, marks) : String(n));

function numText(t, loc) {
  if (!t.amud || loc.chap) return heb(t, loc.num);
  return `${heb(t, loc.num, false)} ${loc.side ? 'ע״ב' : 'ע״א'}`;
}

const chapText = (t, loc) => (loc.chap ? `${loc.part.chapterLabel || 'פרק'} ${heb(t, loc.chap)}` : '');

/** שם של יחידה אחת, למשל "ברכות דף ב ע״א" או "ברכות פרק א׳ משנה ב׳" */
export function unitName(t, i) {
  const loc = locate(t, i);
  return [loc.part.name, chapText(t, loc), t.unitLabel, numText(t, loc)].filter(Boolean).join(' ');
}

const EPS = 1e-9;

/**
 * טקסט לטווח יחידות, למשל "בראשית פרקים א׳–ב׳".
 * תומך גם בחצאים: "פרק ג׳ (חצי ראשון)", "פרק ג׳ (חצי שני) – פרק ד׳".
 */
export function rangeName(t, from, count) {
  const end = from + count;
  const a = Math.floor(from + EPS);
  const b = Math.ceil(end - EPS) - 1;
  const startFrac = from - a; // מתחילים מאמצע היחידה (0 = מההתחלה)
  const endFrac = end - b; // מסיימים באמצע היחידה (1 = עד הסוף)
  const startMid = startFrac > EPS;
  const endMid = endFrac < 1 - EPS;
  if (!startMid && !endMid) return rangeNameInt(t, a, b - a + 1);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const half = (x) => Math.abs(x - 0.5) < EPS;
  if (a === b) {
    if (half(startFrac) && !endMid) return `${unitName(t, a)} (חצי שני)`;
    if (!startMid && half(endFrac)) return `${unitName(t, a)} (חצי ראשון)`;
    if (!startMid) return `${unitName(t, a)} (עד ${pct(endFrac)})`;
    if (!endMid) return `${unitName(t, a)} (מ-${pct(startFrac)} עד הסוף)`;
    return `${unitName(t, a)} (${pct(startFrac)}–${pct(endFrac)})`;
  }
  const s1 = !startMid ? '' : half(startFrac) ? ' (חצי שני)' : ` (מ-${pct(startFrac)})`;
  const s2 = !endMid ? '' : half(endFrac) ? ' (חצי ראשון)' : ` (עד ${pct(endFrac)})`;
  return `${unitName(t, a)}${s1} – ${unitName(t, b)}${s2}`;
}

/** לכמה חלקים מחלקים יחידה בסימון חלקי (ברירת מחדל: חצאים) */
export const splitOf = (t) => t.split || 2;

/** עיגול לרשת של החלקים, כדי למנוע שגיאות עיגול של מספרים עשרוניים */
export const snap = (x, n) => Math.round(x * n * 1000) / (n * 1000);

function rangeNameInt(t, from, count) {
  if (count <= 1) return unitName(t, from);
  const a = locate(t, from);
  const b = locate(t, from + count - 1);
  const plural = t.unitPlural || t.unitLabel;
  if (a.part === b.part && a.chap === b.chap) {
    const word = t.amud && !a.chap ? t.unitLabel : plural;
    return [a.part.name, chapText(t, a), word, `${numText(t, a)} – ${numText(t, b)}`].filter(Boolean).join(' ');
  }
  if (a.part === b.part && a.chap) {
    return `${a.part.name} ${chapText(t, a)} ${t.unitLabel} ${numText(t, a)} – ${chapText(t, b)} ${t.unitLabel} ${numText(t, b)}`;
  }
  return `${unitName(t, from)} – ${unitName(t, from + count - 1)}`;
}

/** רשימת כל היחידות (לבחירת נקודת התחלה) */
export function allUnitNames(t) {
  const n = totalUnits(t);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = unitName(t, i);
  return out;
}

// ---- ימי לימוד ----

export function isLearningDay(t, ds) {
  if (!t.days[weekday(ds)]) return false;
  return !holidayName(ds, t.holidays);
}

/** הסבר למה אין לימוד ביום מסוים */
export function noLearningReason(t, ds) {
  if (ds < t.startDate) return 'לפני תאריך ההתחלה';
  if (!t.days[weekday(ds)]) return weekday(ds) === 6 ? 'שבת' : 'יום ללא לימוד';
  const h = holidayName(ds, t.holidays);
  if (h) return h;
  return null;
}

const loggedDates = (t) => Object.keys(t.log || {}).filter((d) => d >= t.startDate).sort();

/** מיקום (מספר יחידות שנלמדו) לפני תחילת יום ds — במצב "לפי הקצב שלי" */
function pacePosBefore(t, ds) {
  let pos = t.startPos;
  for (const d of loggedDates(t)) if (d < ds) pos += t.log[d];
  return Math.min(pos, totalUnits(t));
}

// מטמון לספירת ימי לימוד במצב לוח קבוע
const calCache = new Map();
function calendarIndex(t, ds) {
  // כמה ימי לימוד יש מתאריך ההתחלה ועד ds (לא כולל)
  const key = `${t.id}|${t.startDate}|${t.days.join('')}|${t.holidays}`;
  let c = calCache.get(key);
  if (!c) { c = { date: t.startDate, count: 0 }; calCache.set(key, c); }
  if (ds < c.date) { c.date = t.startDate; c.count = 0; }
  let { date, count } = c;
  while (date < ds) {
    if (isLearningDay(t, date)) count++;
    date = addDays(date, 1);
  }
  c.date = date; c.count = count;
  return count;
}

/**
 * המנה של יום מסוים. מחזיר null אם אין לימוד באותו יום.
 * { from, count, done, scheduled }
 */
export function portionFor(t, ds) {
  if (ds < t.startDate) return null;
  // לימוד קבוע לפי התאריך (תהילים יומי, אור החיים, חוק לישראל)
  if (t.fixed) {
    if (!isLearningDay(t, ds)) return null;
    const label = fixedLabel(t, ds);
    return label ? { fixed: true, label, from: 0, count: 1, done: !!t.log?.[ds] } : null;
  }
  const total = totalUnits(t);
  const logged = t.log?.[ds];
  if (t.mode === 'calendar') {
    if (!isLearningDay(t, ds)) return null;
    const from = t.startPos + calendarIndex(t, ds) * t.perDay;
    if (from >= total) return null;
    return { from, count: Math.min(t.perDay, total - from), done: !!logged };
  }
  const from = pacePosBefore(t, ds);
  if (logged) return { from, count: Math.min(logged, Math.max(total - from, 0)), done: true };
  if (!isLearningDay(t, ds) || from >= total - EPS) return null;
  // אם אתמול נלמד רק חלק — המנה של היום משלימה עד סוף היחידה
  let count = snap(Math.floor(from + t.perDay + EPS) - from, splitOf(t));
  if (count < EPS) count = t.perDay;
  return { from, count: Math.min(count, total - from), done: false };
}

/** כמה יחידות נלמדו (מתחילת המחזור הנוכחי, כולל נקודת ההתחלה) */
export function progressPos(t) {
  if (t.fixed) return Object.keys(t.log || {}).length;
  const total = totalUnits(t);
  if (t.mode === 'calendar') {
    let pos = t.startPos;
    for (const d of loggedDates(t)) {
      const p = portionFor(t, d);
      if (p) pos += p.count;
    }
    return Math.min(pos, total);
  }
  return pacePosBefore(t, '9999-12-31');
}

export function isFinished(t) {
  if (t.fixed) return false;
  return totalUnits(t) - progressPos(t) < EPS || progressPos(t) >= totalUnits(t);
}

/** ימים שהיה בהם לימוד מתוכנן ולא סומנו (רק במצב לוח קבוע), מהחדש לישן */
export function missedDays(t, today = todayStr(), limit = 60) {
  if ((t.mode !== 'calendar' && !t.fixed) || !isRequired(t)) return [];
  const out = [];
  for (let d = t.startDate; d < today; d = addDays(d, 1)) {
    const p = portionFor(t, d);
    if (p && !p.done) out.push(d);
  }
  return out.reverse().slice(0, limit);
}

/** רצף ימי לימוד ברציפות (ימים בלי לימוד מתוכנן לא שוברים את הרצף) */
export function streak(t, today = todayStr()) {
  let count = 0;
  let d = today;
  if (!t.log?.[today]) d = addDays(today, -1); // היום עוד לא נגמר
  let guard = 0;
  while (guard++ < 4000) {
    if (t.log?.[d]) count++;
    else if (isLearningDay(t, d) && d >= t.startDate) break;
    else if (d < t.startDate) break;
    d = addDays(d, -1);
  }
  return count;
}

/** תאריך סיום משוער */
export function estimatedFinish(t, today = todayStr()) {
  if (t.fixed) return null;
  const total = totalUnits(t);
  if (t.mode === 'calendar') {
    if (t.startPos >= total) return null;
    const lastIdx = Math.ceil((total - t.startPos) / t.perDay) - 1;
    let d = t.startDate;
    let k = 0;
    for (let guard = 0; guard < 20000; guard++) {
      if (isLearningDay(t, d)) {
        if (k === lastIdx) return d;
        k++;
      }
      d = addDays(d, 1);
    }
    return null;
  }
  let remaining = total - progressPos(t);
  if (remaining <= 0) return null;
  // מתחילים אחרי היום האחרון שסומן (כולל סימונים מראש לימים עתידיים)
  const last = Object.keys(t.log || {}).sort().pop();
  let d = last && last >= today ? addDays(last, 1) : today;
  for (let guard = 0; guard < 20000; guard++) {
    if (isLearningDay(t, d)) {
      remaining -= t.perDay;
      if (remaining <= 0) return d;
    }
    d = addDays(d, 1);
  }
  return null;
}

/** מצב כללי של יום: כמה לימודים היו מתוכננים וכמה סומנו */
/** האם הלימוד חובה (ברירת מחדל) או רשות */
export const isRequired = (t) => t.required !== false;

/**
 * מצב של יום: due/done — רק לימודי החובה. optDue/optDone — לימודי הרשות.
 * לימוד רשות שלא סומן לא נחשב "חסר".
 */
export function dayStatus(tracks, ds) {
  let due = 0;
  let done = 0;
  let optDue = 0;
  let optDone = 0;
  for (const t of tracks) {
    const p = portionFor(t, ds);
    if (!p) continue;
    if (isRequired(t)) { due++; if (p.done) done++; } else { optDue++; if (p.done) optDone++; }
  }
  return { due, done, optDue, optDone };
}

/** יוצר לימוד חדש עם ערכי ברירת מחדל */
export function newTrack(fields) {
  return {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: '',
    unitLabel: 'פרק',
    unitPlural: 'פרקים',
    hebNums: true,
    amud: false,
    parts: [{ name: '', start: 1, end: 10 }],
    perDay: 1,
    mode: 'pace',
    startDate: todayStr(),
    startPos: 0,
    days: [true, true, true, true, true, true, false],
    holidays: 'israel',
    log: {},
    cycles: 0,
    createdAt: Date.now(),
    ...fields,
  };
}

/** הטקסט של מנה (רגילה או קבועה לפי תאריך) */
export function portionText(t, p) {
  return p.fixed ? p.label : rangeName(t, p.from, p.count);
}
