/**
 * Synchronisation web → feuille (dev local, migration Google Apps Script).
 *
 * Local : node sync-from-web.js [--dry-run]
 * GAS   : copier syncFromWeb + parse + mapRow ; remplacer gas/local par UrlFetchApp / SpreadsheetApp.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ——— Couche compatible GAS (local) ———

/** @type {import('./config.example.js').config extends infer C ? C : never} */
let config;

try {
  config = (await import('./config.js')).config;
} catch {
  console.warn('config.js introuvable → config.example.js (copiez config.example.js → config.js)');
  config = (await import('./config.example.js')).config;
}

const isDryRun = process.argv.includes('--dry-run');

const LocalGas = {
  fetch(url, options = {}) {
    const { method = 'GET', headers = {}, payload, muteHttpExceptions } = options;
    return fetch(url, {
      method,
      headers,
      body: payload ?? undefined,
    }).then(async (res) => {
      const text = await res.text();
      if (!muteHttpExceptions && !res.ok) {
        throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 500)}`);
      }
      return {
        getResponseCode: () => res.status,
        getContentText: () => text,
      };
    });
  },

  log(...args) {
    console.log(...args);
  },

  async writeSheet(rows) {
    const outDir = join(__dirname, 'output');
    await mkdir(outDir, { recursive: true });
    const path = join(outDir, 'sync-result.json');
    await writeFile(path, JSON.stringify(rows, null, 2), 'utf8');
    LocalGas.log(`[local] ${rows.length} ligne(s) → ${path}`);
    return path;
  },
};

// En Google Apps Script, remplacer par :
// function gasFetch(url, options) {
//   return UrlFetchApp.fetch(url, {
//     method: options.method,
//     headers: options.headers,
//     payload: options.payload,
//     muteHttpExceptions: options.muteHttpExceptions,
//   });
// }

// ——— Parsing ———

/**
 * @typedef {Record<string, string>} SyncRow
 * @typedef {{
 *   sourceUrl: string;
 *   spreadsheetId: string;
 *   sheetName: string;
 *   columns: string[];
 *   fetch: { method?: string; headers?: Record<string, string>; muteHttpExceptions?: boolean };
 *   parse: {
 *     type: 'html' | 'json';
 *     html?: { rowSelector: string; fields: Record<string, { selector: string; attr: 'text' | 'href' }> };
 *     jsonPath?: string;
 *     fieldMap?: Record<string, string>;
 *   };
 * }} SyncConfig
 */

/**
 * @param {string} text
 * @param {SyncConfig['parse']} parseConfig
 * @returns {SyncRow[]}
 */
export function parseResponse(text, parseConfig) {
  if (parseConfig.type === 'json') {
    return parseJson(text, parseConfig);
  }
  return parseHtmlLocal(text, parseConfig);
}

function parseJson(text, parseConfig) {
  const data = JSON.parse(text);
  const list = getByPath(data, parseConfig.jsonPath ?? '');
  if (!Array.isArray(list)) {
    throw new Error(`jsonPath "${parseConfig.jsonPath}" ne pointe pas vers un tableau`);
  }
  const map = parseConfig.fieldMap ?? {};
  return list.map((item) => {
    /** @type {SyncRow} */
    const row = {};
    for (const [col, key] of Object.entries(map)) {
      row[col] = String(item[key] ?? '').trim();
    }
    return row;
  });
}

function getByPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Parsing HTML en local via regex/DOM minimal.
 * Pour des pages complexes : npm i cheerio et remplacer le corps de parseHtmlLocal.
 */
function parseHtmlLocal(text, parseConfig) {
  const html = parseConfig.html;
  if (!html) throw new Error('parse.html requis pour type "html"');

  const { load } = awaitCheerioOptional();
  if (load) {
    const $ = load(text);
    const rows = [];
    $(html.rowSelector).each((_, el) => {
      const row = extractRowCheerio($, el, html.fields);
      if (Object.values(row).some((v) => v !== '')) rows.push(row);
    });
    return rows;
  }

  LocalGas.log('[local] cheerio absent → parsing HTML simplifié (tableaux basiques uniquement)');
  return parseHtmlSimpleTable(text, html);
}

function awaitCheerioOptional() {
  try {
    // eslint-disable-next-line no-undef -- chargement dynamique optionnel
    return { load: null };
  } catch {
    return { load: null };
  }
}

/** Charge cheerio si installé (npm i cheerio). */
async function loadCheerioIfPresent() {
  try {
    const mod = await import('cheerio');
    return mod.load;
  } catch {
    return null;
  }
}

function extractRowCheerio($, el, fields) {
  /** @type {SyncRow} */
  const row = {};
  const $row = $(el);
  for (const [col, spec] of Object.entries(fields)) {
    const $cell = $row.find(spec.selector).first();
    if (spec.attr === 'href') {
      row[col] = ($cell.attr('href') ?? '').trim();
    } else {
      row[col] = $cell.text().trim().replace(/\s+/g, ' ');
    }
  }
  return row;
}

/** Fallback sans dépendance : extrait <tr>...</tr> et texte des <td>. */
function parseHtmlSimpleTable(text, html) {
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const strip = (s) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();

  const rows = [];
  let trMatch;
  while ((trMatch = trRe.exec(text)) !== null) {
    const inner = trMatch[1];
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRe.exec(inner)) !== null) {
      cells.push(strip(tdMatch[1]));
    }
    if (cells.length === 0) continue;

    /** @type {SyncRow} */
    const row = {};
    const fieldKeys = Object.keys(html.fields);
    fieldKeys.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    if (Object.values(row).some((v) => v !== '')) rows.push(row);
  }
  return rows;
}

// Corriger parseHtmlLocal pour utiliser cheerio async — refactor needed

async function parseHtml(text, parseConfig) {
  const html = parseConfig.html;
  if (!html) throw new Error('parse.html requis pour type "html"');

  const load = await loadCheerioIfPresent();
  if (load) {
    const $ = load(text);
    const rows = [];
    $(html.rowSelector).each((_, el) => {
      const row = extractRowCheerio($, el, html.fields);
      if (Object.values(row).some((v) => v !== '')) rows.push(row);
    });
    return rows;
  }

  LocalGas.log('[local] cheerio absent → parsing HTML simplifié (tableaux basiques uniquement)');
  return parseHtmlSimpleTable(text, html);
}

/**
 * Normalise les lignes selon config.columns.
 * @param {SyncRow[]} raw
 * @param {string[]} columns
 */
export function normalizeRows(raw, columns) {
  return raw.map((r) => {
    /** @type {SyncRow} */
    const out = {};
    for (const col of columns) {
      out[col] = String(r[col] ?? '').trim();
    }
    return out;
  });
}

/**
 * Point d’entrée réutilisable en GAS : function syncFromWeb() { ... }
 * @param {SyncConfig} cfg
 * @param {{ fetchFn?: typeof LocalGas.fetch; writeFn?: typeof LocalGas.writeSheet }} adapters
 */
export async function syncFromWeb(cfg, adapters = {}) {
  const fetchFn = adapters.fetchFn ?? LocalGas.fetch.bind(LocalGas);
  const writeFn = adapters.writeFn ?? LocalGas.writeSheet.bind(LocalGas);

  LocalGas.log(`GET ${cfg.sourceUrl}`);
  const response = await fetchFn(cfg.sourceUrl, cfg.fetch);
  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Échec HTTP ${code} pour ${cfg.sourceUrl}`);
  }

  let raw;
  if (cfg.parse.type === 'json') {
    raw = parseJson(body, cfg.parse);
  } else {
    raw = await parseHtml(body, cfg.parse);
  }

  const rows = normalizeRows(raw, cfg.columns);
  LocalGas.log(`${rows.length} enregistrement(s) extrait(s)`);

  if (isDryRun) {
    LocalGas.log('[dry-run] échantillon:', rows.slice(0, 3));
    return rows;
  }

  await writeFn(rows, cfg);
  return rows;
}

/**
 * Écriture feuille Google — stub pour migration GAS.
 * @param {SyncRow[]} rows
 * @param {SyncConfig} cfg
 */
export function writeToGoogleSheet(rows, cfg) {
  // Coller dans Apps Script :
  // const ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  // const sheet = ss.getSheetByName(cfg.sheetName) || ss.insertSheet(cfg.sheetName);
  // sheet.clearContents();
  // sheet.getRange(1, 1, 1, cfg.columns.length).setValues([cfg.columns]);
  // if (rows.length) {
  //   const values = rows.map(r => cfg.columns.map(c => r[c]));
  //   sheet.getRange(2, 1, rows.length, cfg.columns.length).setValues(values);
  // }
  throw new Error('writeToGoogleSheet : implémenté uniquement dans Google Apps Script');
}

// ——— Exécution CLI ———

async function main() {
  const cheerioLoad = await loadCheerioIfPresent();
  if (cheerioLoad) {
    // Réassigner pour parseHtml — déjà async path OK
  }

  await syncFromWeb(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
