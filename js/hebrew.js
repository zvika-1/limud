// כלים לעברית: מספרים באותיות, תאריכים, חגים

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש'];

/** ממיר מספר לאותיות עבריות (למשל 15 → ט״ו). marks=false מחזיר בלי גרש/גרשיים */
export function gematria(n, marks = true) {
  if (!Number.isInteger(n) || n <= 0 || n >= 1000) return String(n);
  let r = n;
  let s = '';
  while (r >= 400) { s += 'ת'; r -= 400; }
  if (r >= 100) { s += HUNDREDS[Math.floor(r / 100)]; r %= 100; }
  if (r === 15) s += 'טו';
  else if (r === 16) s += 'טז';
  else s += TENS[Math.floor(r / 10)] + ONES[r % 10];
  if (!marks) return s;
  return s.length === 1 ? s + '׳' : s.slice(0, -1) + '״' + s.slice(-1);
}

// ---- תאריכים בפורמט YYYY-MM-DD לפי שעון מקומי (היום מתחלף בחצות) ----

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // צהריים, כדי להימנע מבעיות שעון קיץ
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(ds, n) {
  const d = parseDate(ds);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function weekday(ds) {
  return parseDate(ds).getDay(); // 0 = ראשון
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const gregFmt = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'long', year: 'numeric' });
const gregShortFmt = new Intl.DateTimeFormat('he', { day: 'numeric', month: 'numeric' });
const hebFmt = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });
const hebEnFmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long' });

export function formatGreg(ds) {
  return gregFmt.format(parseDate(ds));
}

export function formatShort(ds) {
  return `${WEEKDAY_SHORT[weekday(ds)]} ${gregShortFmt.format(parseDate(ds))}`;
}

/** תאריך עברי, למשל: ו׳ בכסלו תשפ״ז */
export function formatHebrew(ds) {
  try {
    const parts = hebFmt.formatToParts(parseDate(ds));
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const month = parts.find((p) => p.type === 'month')?.value || '';
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    return `${gematria(day)} ב${month} ${gematria(year % 1000)}`;
  } catch {
    return '';
  }
}

// ---- חגים (ימים טובים שבהם לא לומדים לפי בחירה) ----

const HOLIDAYS_ISRAEL = {
  'Tishri 1': 'ראש השנה', 'Tishri 2': 'ראש השנה', 'Tishri 10': 'יום הכיפורים',
  'Tishri 15': 'סוכות', 'Tishri 22': 'שמיני עצרת', 'Nisan 15': 'פסח',
  'Nisan 21': 'שביעי של פסח', 'Sivan 6': 'שבועות',
};
const HOLIDAYS_DIASPORA_EXTRA = {
  'Tishri 16': 'סוכות (יו״ט שני)', 'Tishri 23': 'שמחת תורה', 'Nisan 16': 'פסח (יו״ט שני)',
  'Nisan 22': 'אחרון של פסח', 'Sivan 7': 'שבועות (יו״ט שני)',
};

const holidayCache = new Map();

/** מחזיר שם חג אם התאריך הוא יום טוב, אחרת null. region: 'israel' | 'diaspora' | 'none' */
export function holidayName(ds, region) {
  if (!region || region === 'none') return null;
  let key = holidayCache.get(ds);
  if (key === undefined) {
    const parts = hebEnFmt.formatToParts(parseDate(ds));
    key = `${parts.find((p) => p.type === 'month')?.value} ${parts.find((p) => p.type === 'day')?.value}`;
    holidayCache.set(ds, key);
  }
  return HOLIDAYS_ISRAEL[key] || (region === 'diaspora' ? HOLIDAYS_DIASPORA_EXTRA[key] : null) || null;
}
