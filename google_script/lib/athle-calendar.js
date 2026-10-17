/**
 * Calendrier FFA (athle.fr) — extraction des compétitions par date.
 * Compatible Node local ; en GAS : remplacer fetchHtml par UrlFetchApp.fetch.
 */

const CALENDAR_BASE = 'https://www.athle.fr/bases/liste.aspx';

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

/**
 * @param {Date} from
 * @param {Date} to
 */
export function buildCalendarUrl(from, to) {
  const params = new URLSearchParams({
    frmbase: 'calendrier',
    frmdate_a1: String(from.getFullYear()),
    frmdate_a2: String(to.getFullYear()),
    frmdate_m1: String(from.getMonth() + 1),
    frmdate_m2: String(to.getMonth() + 1),
    frmdate_j1: String(from.getDate()),
    frmdate_j2: String(to.getDate()),
    frmespace: '0',
    frmligue: '',
    frmmode: '1',
  });
  return `${CALENDAR_BASE}?${params}`;
}

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} html
 * @returns {import('./athle-calendar.js').AthleCompetition[]}
 */
export function parseCalendarListHtml(html) {
  /** @type {import('./athle-calendar.js').AthleCompetition[]} */
  const rows = [];
  const trRe = /<tr class="(?!detail-row)[^"]*">([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const chunk = trMatch[1];
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 6) continue;

    const dateLabel = stripHtml(tds[0]);
    const label = stripHtml(tds[1]);
    const place = stripHtml(tds[2]);
    const type = stripHtml(tds[3]);
    const level = stripHtml(tds[4]);

    const ficheMatch = chunk.match(/href="\/competitions\/(\d+)"/i);
    const resultsMatch = chunk.match(/frmbase=resultats[^"]*frmcompetition=(\d+)/i);

    rows.push({
      dateLabel,
      label,
      place,
      type,
      level,
      ficheId: ficheMatch?.[1] ?? null,
      /** ID bases résultats (frmcompetition) — celui utilisé pour scraper les résultats */
      resultsId: resultsMatch?.[1] ?? null,
    });
  }
  return rows;
}

const MONTHS = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
};

/**
 * @param {string} dateLabel ex. "16 octobre", "16-17 octobre"
 * @param {number} refYear
 */
export function parseFrenchDateLabel(dateLabel, refYear) {
  const m = dateLabel.match(
    /(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)/i,
  );
  if (!m) return null;
  const month = MONTHS[m[3].toLowerCase()];
  const dayStart = Number(m[1]);
  const dayEnd = m[2] ? Number(m[2]) : dayStart;
  return { month, dayStart, dayEnd, year: refYear };
}

/**
 * @param {string} isoDate YYYY-MM-DD
 * @param {string} dateLabel
 * @param {number} refYear
 */
export function competitionTouchesDate(isoDate, dateLabel, refYear) {
  const parsed = parseFrenchDateLabel(dateLabel, refYear);
  if (!parsed) return true;
  const target = new Date(`${isoDate}T12:00:00`);
  for (let d = parsed.dayStart; d <= parsed.dayEnd; d++) {
    const cur = new Date(parsed.year, parsed.month - 1, d, 12);
    if (
      cur.getFullYear() === target.getFullYear() &&
      cur.getMonth() === target.getMonth() &&
      cur.getDate() === target.getDate()
    ) {
      return true;
    }
  }
  return false;
}

export function isoLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${j}`;
}

/**
 * @typedef {{
 *   dateLabel: string;
 *   label: string;
 *   place: string;
 *   type: string;
 *   level: string;
 *   ficheId: string | null;
 *   resultsId: string | null;
 * }} AthleCompetition
 */

/**
 * @param {Date} from
 * @param {Date} to
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [options]
 */
async function fetchCalendarHtml(url, fetchHtml) {
  const html = await fetchHtml(url);
  if (html.length < 500 && html.includes('supprimée')) {
    throw new Error('Page calendrier refusée (User-Agent ?) — réponse trop courte');
  }
  return html;
}

function mergeCompetitions(lists) {
  const byKey = new Map();
  for (const row of lists.flat()) {
    const key = row.ficheId ?? `${row.label}|${row.dateLabel}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/**
 * @param {string | Date} input
 * @returns {Date}
 */
export function parseDateInput(input) {
  if (input instanceof Date) {
    return startOfLocalDay(input);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Date invalide "${input}" — format attendu : YYYY-MM-DD`);
  }
  return startOfLocalDay(new Date(`${input}T12:00:00`));
}

/**
 * Récupère toutes les compétitions athle.fr sur une plage de dates (incluses).
 *
 * @param {string | Date} dateFrom
 * @param {string | Date} dateTo
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [options]
 * @returns {Promise<{
 *   fetchedAt: string;
 *   dateFrom: string;
 *   dateTo: string;
 *   sourceUrls: string[];
 *   count: number;
 *   resultsIds: string[];
 *   ficheIds: string[];
 *   competitions: AthleCompetition[];
 * }>}
 */
export async function getCompetitionsForDateRange(dateFrom, dateTo, options = {}) {
  let from = parseDateInput(dateFrom);
  let to = parseDateInput(dateTo);
  if (from > to) {
    [from, to] = [to, from];
  }

  const { url, competitions } = await fetchCompetitionsForDateRange(from, to, options);
  const sourceUrls = Array.isArray(url) ? url : [url];

  const resultsIds = [
    ...new Set(competitions.map((c) => c.resultsId).filter(Boolean)),
  ].sort((a, b) => Number(a) - Number(b));

  const ficheIds = [...new Set(competitions.map((c) => c.ficheId).filter(Boolean))];

  return {
    fetchedAt: new Date().toISOString(),
    dateFrom: isoLocalDate(from),
    dateTo: isoLocalDate(to),
    sourceUrls,
    count: competitions.length,
    resultsIds,
    ficheIds,
    competitions,
  };
}

export async function fetchCompetitionsForDateRange(from, to, options = {}) {
  const fetchHtml =
    options.fetchHtml ??
    (async (u) => {
      const res = await fetch(u, { headers: DEFAULT_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${u}`);
      return res.text();
    });

  const start = startOfLocalDay(from);
  const end = startOfLocalDay(to);
  const urls = [];
  const chunks = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = startOfLocalDay(d);
    const url = buildCalendarUrl(day, day);
    urls.push(url);
    const html = await fetchCalendarHtml(url, fetchHtml);
    const dayRows = parseCalendarListHtml(html);
    const refYear = day.getFullYear();
    const iso = isoLocalDate(day);
    chunks.push(dayRows.filter((row) => competitionTouchesDate(iso, row.dateLabel, refYear)));
  }

  return {
    url: urls.length === 1 ? urls[0] : urls,
    competitions: mergeCompetitions(chunks),
  };
}

export function startOfLocalDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function yesterdayAndTodayRange(now = new Date()) {
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return { from: yesterday, to: today };
}
