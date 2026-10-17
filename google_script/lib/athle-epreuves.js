/**
 * Épreuves et participants d’un club dans une compétition (via résultats athle.fr).
 *
 * Source : page résultats filtrée par club (frmclub). Correspond aux athlètes
 * engagés / présents une fois les listes ou résultats publiés — pas à la base « qualifies ».
 */

import { clubNamesMatch, findClubInCompetition } from './athle-club.js';
import {
  buildResultsUrl,
  parseCompetitionTitle,
  DEFAULT_HEADERS,
} from './athle-results.js';

const SITE_ORIGIN = 'https://www.athle.fr';

export { DEFAULT_HEADERS };

function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

function normalizeSeriesLabel(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEpreuveName(s) {
  return normalizeSeriesLabel(s).replace(/\s*\/\s*/g, ' / ');
}

/**
 * @param {string} html
 * @returns {{ id: string; name: string; url: string }[]}
 */
export function parseEpreuveOptions(html) {
  const block = html.match(/id="optionsEpreuve"[\s\S]*?<\/div>\s*<\/div>/i)?.[0] ?? '';
  /** @type {{ id: string; name: string; url: string }[]} */
  const opts = [];
  for (const m of block.matchAll(/data-url="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const path = m[1];
    const idMatch = path.match(/frmepreuve=([^&]+)/);
    if (!idMatch) continue;
    let name = decodeHtmlEntities(stripHtml(m[2]));
    name = name.replace(/^>\s*|\s*<$/g, '').trim();
    const url = path.startsWith('http') ? path : `${SITE_ORIGIN}${path}`;
    opts.push({
      id: decodeURIComponent(idMatch[1].replace(/\+/g, ' ')),
      name,
      url,
    });
  }
  return opts;
}

/**
 * Lignes « par athlète » affichées quand frmclub est actif.
 * @param {string} html
 */
export function parseClubParticipantRows(html) {
  /** @type {import('./athle-epreuves.js').ClubParticipantRow[]} */
  const rows = [];
  for (const tr of html.matchAll(/<tr class="">([\s\S]*?)<\/tr>/gi)) {
    const chunk = tr[1];
    const athleteMatch = chunk.match(/\/athletes\/(\d+)\//);
    if (!athleteMatch) continue;
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length < 8) continue;
    rows.push({
      athleteId: athleteMatch[1],
      athleteName: stripHtml(tds[0]),
      epreuveName: stripHtml(tds[1]),
      performance: stripHtml(tds[2]) || null,
      series: stripHtml(tds[3]) || null,
      dossard: stripHtml(tds[4]) || null,
      category: stripHtml(tds[6]) || null,
      date: stripHtml(tds[7]) || null,
    });
  }
  return rows;
}

/**
 * @param {string} html
 * @returns {Map<string, string>} série normalisée → horaire HH:MM
 */
export function parseSeriesSchedule(html) {
  const schedule = new Map();

  function addSeries(series, time) {
    if (!series || !time) return;
    schedule.set(normalizeSeriesLabel(series), time);
    const tail = series.match(/finale[\s-]*(.+)/i)?.[1]?.trim();
    if (tail) {
      schedule.set(normalizeSeriesLabel(tail), time);
      schedule.set(normalizeSeriesLabel(`finale- ${tail}`), time);
    }
  }

  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const chunk = tr[1];
    const text = stripHtml(chunk);
    if (!text.match(/\d{1,2}:\d{2}/)) continue;

    if (chunk.includes('Chr :')) {
      const timeMatch = text.match(/(\d{1,2}:\d{2})\s*$/);
      if (!timeMatch) continue;
      const beforeChr = text.split('Chr :')[0].trim();
      const seriesMatch = beforeChr.match(/(Série \d+|Finale[\w\s\d-]*)/i);
      addSeries(seriesMatch?.[1]?.trim() ?? beforeChr, timeMatch[1]);
      continue;
    }

    const pipeMatch = text.match(/(Finale[^|]*|Série \d+)\s*\|\s*(\d{1,2}:\d{2})/i);
    if (pipeMatch) {
      addSeries(pipeMatch[1].trim(), pipeMatch[2]);
    }
  }
  return schedule;
}

/**
 * @param {Map<string, string>} schedule
 * @param {string | null} series
 */
export function lookupSeriesTime(schedule, series) {
  if (!series) return null;
  const key = normalizeSeriesLabel(series);
  if (schedule.has(key)) return schedule.get(key);
  const tail = key.replace(/^finale[\s-]*/i, '').trim();
  if (tail && schedule.has(tail)) return schedule.get(tail);
  for (const [k, time] of schedule) {
    if (k.includes(key) || key.includes(k)) return time;
    if (tail && (k.includes(tail) || tail.includes(k))) return time;
  }
  return null;
}

/**
 * @param {string} epreuveName
 * @param {{ id: string; name: string }[]} options
 */
export function matchEpreuveId(epreuveName, options) {
  const target = normalizeEpreuveName(epreuveName);
  for (const opt of options) {
    if (normalizeEpreuveName(opt.name) === target) return opt.id;
  }
  for (const opt of options) {
    const n = normalizeEpreuveName(opt.name);
    if (n.includes(target) || target.includes(n)) return opt.id;
  }
  return null;
}

/**
 * @typedef {{
 *   athleteId: string;
 *   athleteName: string;
 *   epreuveName: string;
 *   performance: string | null;
 *   series: string | null;
 *   dossard: string | null;
 *   category: string | null;
 *   date: string | null;
 * }} ClubParticipantRow
 *
 * @typedef {{
 *   id: string | null;
 *   name: string;
 *   horaire: string | null;
 *   seriesSchedule: Record<string, string>;
 *   participants: Array<ClubParticipantRow & { horaire: string | null }>;
 * }} ClubEpreuveEntry
 */

async function resolveClub(competitionId, clubQuery, fetchHtml) {
  const q = String(clubQuery).trim();
  if (/^\d{5,6}$/.test(q)) {
    return { id: q, name: q };
  }
  const found = await findClubInCompetition(competitionId, q, { fetchHtml });
  if (!found) {
    throw new Error(`Club introuvable dans la compétition ${competitionId} : "${clubQuery}"`);
  }
  return found.club;
}

function createFetchHtml(options) {
  return (
    options.fetchHtml ??
    (async (url) => {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      const text = await res.text();
      if (text.length < 500 && text.includes('supprimée')) {
        throw new Error('Page athle.fr refusée (User-Agent ?)');
      }
      return text;
    })
  );
}

/**
 * Épreuves où le club a au moins un participant inscrit / présent (données résultats FFA).
 *
 * @param {string | number} competitionId frmcompetition
 * @param {string} clubNameOrId nom ou frmclub (ex. Ca Beglais, 033011)
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [options]
 */
export async function getClubEpreuvesInCompetition(competitionId, clubNameOrId, options = {}) {
  const compId = String(competitionId).trim();
  const fetchHtml = createFetchHtml(options);

  const club = await resolveClub(compId, clubNameOrId, fetchHtml);
  const clubUrl = buildResultsUrl(compId, { frmclub: club.id });
  const clubHtml = await fetchHtml(clubUrl);
  const title = parseCompetitionTitle(clubHtml);
  const epreuveOptions = parseEpreuveOptions(clubHtml);
  const participantRows = parseClubParticipantRows(clubHtml);

  /** @type {Map<string, ClubEpreuveEntry>} */
  const byEpreuve = new Map();

  for (const row of participantRows) {
    const key = normalizeEpreuveName(row.epreuveName);
    if (!byEpreuve.has(key)) {
      byEpreuve.set(key, {
        id: matchEpreuveId(row.epreuveName, epreuveOptions),
        name: row.epreuveName,
        horaire: null,
        seriesSchedule: {},
        participants: [],
      });
    }
    byEpreuve.get(key).participants.push({ ...row, horaire: null });
  }

  const scheduleCache = new Map();

  for (const entry of byEpreuve.values()) {
    if (!entry.id) continue;
    const epreuveUrl = buildResultsUrl(compId, { frmepreuve: entry.id });
    let schedule = scheduleCache.get(entry.id);
    if (!schedule) {
      const html = await fetchHtml(epreuveUrl);
      schedule = parseSeriesSchedule(html);
      scheduleCache.set(entry.id, schedule);
    }
    entry.seriesSchedule = Object.fromEntries(schedule);
    const times = new Set();
    for (const p of entry.participants) {
      p.horaire = lookupSeriesTime(schedule, p.series);
      if (p.horaire) times.add(p.horaire);
    }
    entry.horaire = times.size === 1 ? [...times][0] : times.size > 1 ? [...times].sort().join(', ') : null;
  }

  const epreuves = [...byEpreuve.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    fetchedAt: new Date().toISOString(),
    competitionId: compId,
    title,
    club,
    sourceUrl: clubUrl,
    count: epreuves.length,
    participantRows: participantRows.length,
    epreuves,
  };
}
