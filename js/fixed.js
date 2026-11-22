// לימודים שנקבעים לפי התאריך (ולא ברצף): תהילים יומי, אור החיים ועליות הפרשה, חוק לישראל
import { FIRST_SHABBAT, PARSHIOT, WEEKS_IL, WEEKS_DL } from './parsha-data.js';
import { addDays, weekday, daysBetween, gematria, hebrewDay, WEEKDAY_NAMES } from './hebrew.js';

const ORD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי'];

/** הפרשה של השבוע שבו נמצא התאריך. בשבוע שהשבת שלו חג — הפרשה של השבוע הבא */
export function parshaForDate(ds, region) {
  const sat = addDays(ds, 6 - weekday(ds));
  const weeks = region === 'diaspora' ? WEEKS_DL : WEEKS_IL;
  let i = Math.round(daysBetween(FIRST_SHABBAT, sat) / 7);
  while (i >= 0 && i < weeks.length && weeks[i] === -1) i++;
  if (i < 0 || i >= weeks.length) return null;
  const [name, aliyot] = PARSHIOT[weeks[i]];
  return { name, aliyot };
}

const cv = (v) => v.split(':').map(Number);
/** טווח פסוקים, למשל: בראשית ל״ב:ד׳ – ל״ב:י״ג */
function aliyaRef([book, b, e]) {
  const [c1, v1] = cv(b);
  const [c2, v2] = cv(e);
  if (c1 === c2) return `${book} ${gematria(c1)} ${gematria(v1)}–${gematria(v2)}`;
  return `${book} ${gematria(c1)} ${gematria(v1)} – ${gematria(c2)} ${gematria(v2)}`;
}

const TEHILLIM_MONTH = [null, [1, 9], [10, 17], [18, 22], [23, 28], [29, 34], [35, 38], [39, 43], [44, 48], [49, 54],
  [55, 59], [60, 65], [66, 68], [69, 71], [72, 76], [77, 78], [79, 82], [83, 87], [88, 89], [90, 96], [97, 103],
  [104, 105], [106, 107], [108, 112], [113, 118], 'קי״ט פסוקים א׳–צ״ו', 'קי״ט פסוקים צ״ז–קע״ו', [120, 134],
  [135, 139], [140, 144], [145, 150]];
const TEHILLIM_WEEK = [[1, 29], [30, 50], [51, 72], [73, 89], [90, 106], [107, 119], [120, 150]];
const chapters = ([a, b]) => `פרקים ${gematria(a)}–${gematria(b)}`;

export const FIXED_TYPES = {
  'tehillim-month': { usesParsha: false },
  'tehillim-week': { usesParsha: false },
  'ohr-hachaim': { usesParsha: true },
  chok: { usesParsha: true },
};

/** מה לומדים ביום מסוים בלימוד קבוע. מחזיר טקסט, או null אם אין */
export function fixedLabel(t, ds) {
  const w = weekday(ds);
  switch (t.fixed) {
    case 'tehillim-month': {
      const d = hebrewDay(ds);
      // בחודש של 29 יום, ביום כ״ט אומרים גם את של יום ל׳
      const lastDay = hebrewDay(addDays(ds, 1)) === 1;
      const part = d === 29 && lastDay ? [140, 150] : TEHILLIM_MONTH[d];
      return `יום ${gematria(d)} לחודש: ${typeof part === 'string' ? part : chapters(part)}`;
    }
    case 'tehillim-week':
      return `יום ${WEEKDAY_NAMES[w]}: ${chapters(TEHILLIM_WEEK[w])}`;
    case 'ohr-hachaim': {
      const p = parshaForDate(ds, t.region);
      return p && `פרשת ${p.name} – ${ORD[w]} (${aliyaRef(p.aliyot[w])})`;
    }
    case 'chok': {
      const p = parshaForDate(ds, t.region);
      return p && `${p.name} – יום ${w === 6 ? 'שבת' : gematria(w + 1)}`;
    }
    default:
      return null;
  }
}
