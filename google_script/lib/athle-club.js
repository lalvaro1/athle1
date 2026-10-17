/**
 * Recherche club ↔ compétitions (athle.fr).
 */

import {
  getCompetitionsForDateRange,
  isoLocalDate,
  parseDateInput,
  startOfLocalDay,
} from './athle-calendar.js';
import {
  buildResultsUrl,
  parseClubsFromResultsHtml,
  parseCompetitionTitle,
  parseResultsPageUrls,
} from './athle-results.js';
import { filterYouthCompetitions } from './athle-youth-filter.js';

/** @typedef {'U14' | 'U16'} YouthCategory */

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

/**
 * @param {string | Date} input YYYY-MM-DD, JJ/MM/AAAA ou Date
 * @returns {Date}
 */
export function parseDateArg(input) {
  if (input instanceof Date) {
    return startOfLocalDay(input);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return parseDateInput(input);
  }
  const fr = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) {
    const day = Number(fr[1]);
    const month = Number(fr[2]);
    const year = Number(fr[3]);
    return startOfLocalDay(new Date(year, month - 1, day));
  }
  throw new Error(`Date invalide "${input}" — YYYY-MM-DD ou JJ/MM/AAAA`);
}

export function normalizeClubName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} foundName nom tel qu’affiché sur athle.fr
 * @param {string} query nom recherché
 */
export function clubNamesMatch(foundName, query) {
  const a = normalizeClubName(foundName);
  const b = normalizeClubName(query);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = a.split(' ').filter((t) => t.length > 2);
  const bTokens = b.split(' ').filter((t) => t.length > 2);
  return bTokens.length > 0 && bTokens.every((t) => a.includes(t));
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
 * @param {Map<string, string>} clubs
 * @param {string} clubName
 * @returns {{ id: string; name: string } | null}
 */
export function findClubInMap(clubs, clubName) {
  for (const [id, name] of clubs) {
    if (clubNamesMatch(name, clubName)) {
      return { id, name };
    }
  }
  return null;
}

/**
 * Vérifie si un club a au moins un résultat dans une compétition (frmcompetition).
 *
 * @param {string | number} competitionId
 * @param {string} clubName
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [options]
 * @returns {Promise<{ club: { id: string; name: string }; resultsTitle: string | null } | null>}
 */
export async function findClubInCompetition(competitionId, clubName, options = {}) {
  const id = String(competitionId).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`ID compétition invalide : "${competitionId}"`);
  }

  const fetchHtml = createFetchHtml(options);
  const entryUrl = buildResultsUrl(id);
  const firstHtml = await fetchHtml(entryUrl);
  const resultsTitle = parseCompetitionTitle(firstHtml);

  let hit = findClubInMap(parseClubsFromResultsHtml(firstHtml), clubName);
  if (hit) {
    return { club: hit, resultsTitle };
  }

  const pageUrls = parseResultsPageUrls(firstHtml).filter((u) => u !== entryUrl);
  for (const pageUrl of pageUrls) {
    const html = await fetchHtml(pageUrl);
    hit = findClubInMap(parseClubsFromResultsHtml(html), clubName);
    if (hit) {
      return { club: hit, resultsTitle };
    }
  }

  return null;
}

/**
 * Compétitions du calendrier à une date donnée où le club a des résultats publiés.
 * Seules les épreuves avec lien « Résultats » (resultsId) sont vérifiées.
 *
 * @param {string | Date} date YYYY-MM-DD ou JJ/MM/AAAA
 * @param {string} clubName
 * @param {{
 *   fetchHtml?: (url: string) => Promise<string>;
 *   youthCategories?: YouthCategory[] | false;
 * }} [options] youthCategories : false désactive le filtre ; défaut ['U14','U16']
 */
export async function getCompetitionsForClubOnDate(date, clubName, options = {}) {
  const day = parseDateArg(date);
  const iso = isoLocalDate(day);
  const query = clubName.trim();
  if (!query) {
    throw new Error('Nom de club requis');
  }

  const fetchHtml = createFetchHtml(options);
  const sharedOptions = { ...options, fetchHtml };

  const dayList = await getCompetitionsForDateRange(iso, iso, sharedOptions);
  let candidates = dayList.competitions.filter((c) => c.resultsId);

  const youthCategories =
    options.youthCategories === undefined ? ['U14', 'U16'] : options.youthCategories;
  const youthFilterActive = youthCategories !== false && youthCategories.length > 0;
  const beforeYouthFilter = candidates.length;
  if (youthFilterActive) {
    candidates = filterYouthCompetitions(candidates, youthCategories);
  }

  /** @type {Array<{
   *   resultsId: string;
   *   ficheId: string | null;
   *   calendarDateLabel: string;
   *   calendarLabel: string;
   *   place: string;
   *   type: string;
   *   level: string;
   *   resultsTitle: string | null;
   *   club: { id: string; name: string };
   * }>} */
  const competitions = [];

  for (const comp of candidates) {
    const found = await findClubInCompetition(comp.resultsId, query, sharedOptions);
    if (!found) continue;
    competitions.push({
      resultsId: comp.resultsId,
      ficheId: comp.ficheId,
      calendarDateLabel: comp.dateLabel,
      calendarLabel: comp.label,
      place: comp.place,
      type: comp.type,
      level: comp.level,
      resultsTitle: found.resultsTitle,
      club: found.club,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    date: iso,
    clubQuery: query,
    youthCategories: youthFilterActive ? youthCategories : null,
    calendarCompetitions: dayList.count,
    withResultsBeforeYouthFilter: beforeYouthFilter,
    checkedWithResults: candidates.length,
    count: competitions.length,
    competitions,
  };
}
