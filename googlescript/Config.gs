/**
 * Configuration — à adapter avant déploiement.
 * Ne mettez JAMAIS de secrets ici (token R2, access keys) : utilisez
 * setR2ApiTokenFromEditor() → Script Properties.
 */
var ATHLE_CONFIG = {
  /** Nom du club tel qu’affiché sur athle.fr (ex. "Ca Beglais") */
  CLUB_NAME: 'Ca Beglais',

  /** Identifiants club pour les bilans athle.fr */
  CLUB_ID: '033011',
  CLUB_LIGUE: 'N-A',
  CLUB_DEPARTEMENT: '033',

  /** Fuseau pour « aujourd’hui » */
  TIMEZONE: 'Europe/Paris',

  /**
   * Filtre U14 / U16 : calendrier, participants compétition, base athlètes.
   * Mettre [] pour tout prendre.
   */
  YOUTH_CATEGORIES: ['U14', 'U16'],

  /**
   * Catégories bilans FFA pour la base athlètes jeunes.
   * BE = Benjamin (U14), MI = Minime (U16).
   */
  BILANS_YOUTH_CATEGORIES: ['BE', 'MI'],

  /**
   * Année des bilans (frmannee). null = année civile courante (TIMEZONE).
   */
  BILANS_YEAR: null,

  /**
   * Ne conserve les perfs athlètes qu’à partir de l’année N - offset.
   * Ex. 1 → garde N-1 et N (et saisons FFA plus récentes), ignore plus ancien.
   */
  ATHLETE_PERF_MIN_YEAR_OFFSET: 1,

  /**
   * Si true, charge la fiche athle.fr de chaque athlète pour PB / SB
   * (section « Meilleures performances par saison »).
   */
  ENRICH_ATHLETE_PROFILES: true,

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
