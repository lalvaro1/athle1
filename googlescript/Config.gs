/**
 * Configuration — à adapter avant déploiement.
 * Ne mettez JAMAIS de secrets ici (token R2, access keys) : utilisez
 * setR2ApiTokenFromEditor() → Script Properties.
 */
var ATHLE_CONFIG = {
  /** Nom du club tel qu’affiché sur athle.fr (ex. "Ca Beglais") */
  CLUB_NAME: 'Ca Beglais',

  /** Fuseau pour « aujourd’hui » */
  TIMEZONE: 'Europe/Paris',

  /** Filtre calendrier U14 / U16 (mettre [] pour tout prendre) */
  YOUTH_CATEGORIES: ['U14', 'U16'],

  /** Pause entre requêtes athle.fr (ms) */
  PAUSE_MS: 400,

  /**
   * Cloudflare R2 — API REST Bearer (voir R2SSStorage.gss).
   * Token : My Profile → API Tokens → R2 Edit → setR2ApiTokenFromEditor()
   */
  R2: {
    ACCOUNT_ID: 'dfd48543f9c093cbe41d57e584be0fcc',
    BUCKET: 'athle',
    KEY_PREFIX: 'data',
    API_TOKEN: '',
  },
};
