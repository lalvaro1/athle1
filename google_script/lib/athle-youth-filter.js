/**
 * Filtre compétitions jeunes (U14 / U16) à partir des libellés calendrier athle.fr.
 */

/**
 * @param {import('./athle-calendar.js').AthleCompetition | {
 *   label?: string;
 *   dateLabel?: string;
 *   type?: string;
 *   level?: string;
 *   resultsTitle?: string | null;
 * }} comp
 */
function competitionHaystack(comp) {
  return [comp.label, comp.dateLabel, comp.type, comp.level, comp.resultsTitle]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** @param {string} text */
function hasU14(text) {
  if (/\bu\s*[-/]?\s*14\b/.test(text)) return true;
  if (/\bu14\b/.test(text)) return true;
  if (/\bbenjamin?s?\b/.test(text)) return true;
  if (/\bbef\b/.test(text)) return true;
  if (/\bequip[\s'’-]?athle\b/.test(text) && /\b(u\s*14|14\s*[-/]\s*16|benjamin)/.test(text)) {
    return true;
  }
  return false;
}

/** @param {string} text */
function hasU16(text) {
  if (/\bu\s*[-/]?\s*16\b/.test(text)) return true;
  if (/\bu16\b/.test(text)) return true;
  if (/\bminimes?\b/.test(text)) return true;
  if (/\bbem\b/.test(text)) return true;
  if (/\bequip[\s'’-]?athle\b/.test(text) && /\b(u\s*16|14\s*[-/]\s*16|minime)/.test(text)) {
    return true;
  }
  return false;
}

const CATEGORY_CHECKS = {
  U14: hasU14,
  U16: hasU16,
};

/** @typedef {'U14' | 'U16'} YouthCategory */

/**
 * @param {import('./athle-calendar.js').AthleCompetition} comp
 * @param {YouthCategory[]} [categories]
 */
export function isYouthCompetition(comp, categories = ['U14', 'U16']) {
  const text = competitionHaystack(comp);
  return categories.some((cat) => CATEGORY_CHECKS[cat]?.(text));
}

/**
 * @param {import('./athle-calendar.js').AthleCompetition[]} list
 * @param {YouthCategory[]} [categories]
 */
export function filterYouthCompetitions(list, categories = ['U14', 'U16']) {
  return list.filter((c) => isYouthCompetition(c, categories));
}
