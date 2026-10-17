/**
 * Copiez ce fichier en config.js et adaptez les valeurs.
 * config.js est ignoré par git (.gitignore).
 */

/** @type {import('./sync-from-web.js').SyncConfig} */
export const config = {
  /** URL de la page ou de l’API à interroger */
  sourceUrl: 'https://example.com/donnees',

  /** Identifiant de la feuille Google (vide en local → sortie JSON) */
  spreadsheetId: '',

  /** Nom de l’onglet cible */
  sheetName: 'Sync',

  /** En-têtes des colonnes dans la feuille (ordre = ordre d’écriture) */
  columns: ['id', 'label', 'date', 'url'],

  /** Requête HTTP (équivalent UrlFetchApp.fetch options) */
  fetch: {
    method: 'GET',
    headers: {
      'User-Agent': 'athle-sync/0.1 (local dev)',
    },
    muteHttpExceptions: true,
  },

  /**
   * Sélecteurs / parsing — à adapter au site cible.
   * - jsonPath : si la réponse est du JSON, clé du tableau (ex. "data.items")
   * - html : sélecteurs CSS-like pour cheerio (local) ; en GAS → XmlService / regex
   */
  parse: {
    type: 'html',
    html: {
      rowSelector: 'table tbody tr',
      fields: {
        id: { selector: 'td:nth-child(1)', attr: 'text' },
        label: { selector: 'td:nth-child(2)', attr: 'text' },
        date: { selector: 'td:nth-child(3)', attr: 'text' },
        url: { selector: 'a', attr: 'href' },
      },
    },
    // Exemple JSON :
    // type: 'json',
    // jsonPath: 'results',
    // fieldMap: { id: 'id', label: 'name', date: 'updated_at', url: 'link' },
  },
};
