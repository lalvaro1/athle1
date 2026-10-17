/**
 * Résultats FFA (athle.fr) — clubs présents dans une compétition.
 * ID = frmcompetition (ex. 319050).
 */

const SITE_ORIGIN = 'https://www.athle.fr';

export const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'fr-FR,fr;q=0.9',
};

/**
 * @param {string | number} competitionId
 * @param {{ frmposition?: number }} [params]
 */
export function buildResultsUrl(competitionId, params = {}) {
  const q = new URLSearchParams({
    frmbase: 'resultats',
    frmmode: '1',
    frmespace: '0',
    frmcompetition: String(competitionId),
  });
  if (params.frmclub) {
    q.set('frmclub', String(params.frmclub));
  }
  if (params.frmepreuve) {
    q.set('frmepreuve', params.frmepreuve);
  }
  if (params.frmposition != null) {
    q.set('frmposition', String(params.frmposition));
  }
  return `${SITE_ORIGIN}/bases/liste.aspx?${q}`;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function parseResultsPageUrls(html) {
  const block = html.match(/id="optionsPagination"[\s\S]*?<\/div>\s*<\/div>/i)?.[0] ?? '';
  const urls = [...block.matchAll(/data-url="([^"]+)"/gi)].map((m) => m[1]);
  if (urls.length > 0) {
    return [...new Set(urls.map((u) => (u.startsWith('http') ? u : `${SITE_ORIGIN}${u}`)))];
  }
  return [];
}

/**
 * @param {string} html
 */
export function parseCompetitionTitle(html) {
  const m = html.match(/class="mainheaders heading-4">([\s\S]*?)<\/div>/i);
  if (!m) return null;
  return m[1]
    .replace(/<br\s*\/?>/gi, ' — ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} html
 * @returns {Map<string, string>} clubId → name
 */
export function parseClubsFromResultsHtml(html) {
  const clubs = new Map();
  const re =
    /<a href="\/bases\/liste\.aspx\?[^"]*frmclub=(\d+)[^"]*">([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[2]
      .replace(/<[^>]+>/g, '')
      .trim()
      .replace(/\*+$/, '')
      .trim();
    if (name && !clubs.has(m[1])) {
      clubs.set(m[1], name);
    }
  }
  return clubs;
}

function mergeClubMaps(maps) {
  const out = new Map();
  for (const map of maps) {
    for (const [id, name] of map) {
      if (!out.has(id)) out.set(id, name);
    }
  }
  return out;
}

/**
 * @typedef {{ id: string; name: string }} AthleClub
 */

/**
 * Liste les clubs présents (au moins un résultat) pour une compétition.
 *
 * @param {string | number} competitionId frmcompetition (ex. 319050)
 * @param {{ fetchHtml?: (url: string) => Promise<string> }} [options]
 * @returns {Promise<{
 *   competitionId: string;
 *   title: string | null;
 *   fetchedAt: string;
 *   sourceUrls: string[];
 *   count: number;
 *   clubs: AthleClub[];
 * }>}
 */
export async function getClubsForCompetition(competitionId, options = {}) {
  const id = String(competitionId).trim();
  if (!/^\d+$/.test(id)) {
    throw new Error(`ID compétition invalide : "${competitionId}"`);
  }

  const fetchHtml =
    options.fetchHtml ??
    (async (url) => {
      const res = await fetch(url, { headers: DEFAULT_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
      const text = await res.text();
      if (text.length < 500 && text.includes('supprimée')) {
        throw new Error('Page résultats refusée (User-Agent ?)');
      }
      return text;
    });

  const entryUrl = buildResultsUrl(id);
  const firstHtml = await fetchHtml(entryUrl);
  const title = parseCompetitionTitle(firstHtml);

  let pageUrls = parseResultsPageUrls(firstHtml);
  if (pageUrls.length === 0) {
    pageUrls = [entryUrl];
  }

  const clubMaps = [];
  for (const pageUrl of pageUrls) {
    const html = pageUrl === entryUrl ? firstHtml : await fetchHtml(pageUrl);
    clubMaps.push(parseClubsFromResultsHtml(html));
  }

  const merged = mergeClubMaps(clubMaps);
  const clubs = [...merged.entries()]
    .map(([clubId, name]) => ({ id: clubId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    competitionId: id,
    title,
    fetchedAt: new Date().toISOString(),
    sourceUrls: pageUrls,
    count: clubs.length,
    clubs,
  };
}
