/**
 * Configuration — à adapter avant déploiement.
 */
var ATHLE_CONFIG = {
  CLUB_NAME: 'Ca Beglais',
  TIMEZONE: 'Europe/Paris',
  YOUTH_CATEGORIES: ['U14', 'U16'],
  PAUSE_MS: 400,

  /**
   * R2 : ACCOUNT_ID (R2 → Overview).
   * Token : dash.cloudflare.com → My Profile → API Tokens → R2 Edit → setR2ApiTokenFromEditor()
   */
  R2: {
    ACCOUNT_ID: 'REMPLACER_ACCOUNT_ID',
    BUCKET: 'athle',
    KEY_PREFIX: '',
    API_TOKEN: '',
  },
};
