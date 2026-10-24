/**
 * Synchronisation athle.fr → Cloudflare R2.
 *
 * Fichiers : Config.gs, AthleLib.gs, R2SSStorage.gss, Main.gs
 * 1. Configurer ATHLE_CONFIG + setR2ApiTokenFromEditor()
 * 2. runAthleSyncForToday() — sync du jour
 * 3. getAllDataForMonth(10, 2026) — backfill manuel mois par mois
 * 4. rebuildCompetitionsIndexFromBucket() — reconstruit competitions.json depuis R2
 * 5. runAthleSyncAthletes() — index compact → data/athletes.json
 * 6. runAthleSyncAthleteDetails() — fiche complète → data/athletes/{id}.json (+ index)
 * 7. installHourlyTrigger() une fois
 *
 * Index agrégé : data/competitions.json (append des nouvelles compétitions).
 * Athlètes : data/athletes.json + data/athletes/{id}.json
 */

var COMPETITIONS_INDEX_FILE = 'competitions.json';
var ATHLETES_FILE = 'athletes.json';
var ATHLETES_DIR = 'athletes';

/**
 * Parcourt les JSON détail déjà présents dans R2 (fichiers data/YYYY-MM-DD_….json)
 * et reconstruit entièrement competitions.json.
 *
 * Ignore competitions_*.json, competitions.json, erreurs, etc.
 * À lancer à la main depuis l’éditeur Apps Script.
 */
function rebuildCompetitionsIndexFromBucket() {
  r2GetConfig();

  Logger.log('Rebuild competitions.json depuis les fichiers YYYY-MM-DD_*.json…');
  var keys = r2ListObjectKeys();
  Logger.log('%s objet(s) sous le préfixe', keys.length);

  var index = athleEmptyCompetitionsIndex();
  var byId = {};
  var stats = { listed: keys.length, detailFiles: 0, skipped: 0, errors: 0, competitions: 0 };
  var detailKeys = [];

  for (var i = 0; i < keys.length; i++) {
    var name = athleR2RelativeName(keys[i]);
    if (/^\d{4}-\d{2}-\d{2}_.+\.json$/i.test(name) && name.indexOf('_ERROR_') === -1) {
      detailKeys.push(keys[i]);
    } else {
      stats.skipped += 1;
    }
  }

  Logger.log('%s fichier(s) compétition à parser', detailKeys.length);

  for (var e = 0; e < detailKeys.length; e++) {
    try {
      var detailKey = detailKeys[e];
      var detailName = athleR2RelativeName(detailKey);
      var detail = r2DownloadJsonByObjectKey(detailKey);
      stats.detailFiles += 1;
      if (!detail) continue;
      if (athleUpsertCompetitionFromDetail(byId, index, detail, detailName, detailKey)) {
        stats.competitions += 1;
      }
    } catch (err) {
      stats.errors += 1;
      Logger.log('ERREUR %s : %s', detailKeys[e], err.message || err);
    }
  }

  index.competitions.sort(function (a, b) {
    var da = a.date || '';
    var db = b.date || '';
    if (da !== db) return da < db ? -1 : 1;
    return String(a.calendarLabel || a.resultsTitle || '').localeCompare(
      String(b.calendarLabel || b.resultsTitle || ''),
      'fr',
    );
  });

  athleSaveCompetitionsIndex(index);
  Logger.log(
    'Rebuild terminé — %s compétition(s), %s fichier(s) lus, %s ignoré(s), %s erreur(s)',
    index.count,
    stats.detailFiles,
    stats.skipped,
    stats.errors,
  );
  return { indexCount: index.count, stats: stats, objectKey: r2ObjectKey(COMPETITIONS_INDEX_FILE) };
}

function athleR2RelativeName(objectKey) {
  var key = String(objectKey || '').replace(/^\/+/, '');
  var prefix = String((ATHLE_CONFIG.R2 && ATHLE_CONFIG.R2.KEY_PREFIX) || '')
    .replace(/^\/+|\/+$/g, '');
  if (prefix && key.indexOf(prefix + '/') === 0) return key.slice(prefix.length + 1);
  return key;
}

function athleEnsureDates(entry, isoDate) {
  if (!entry.dates) entry.dates = entry.date ? [entry.date] : [];
  if (isoDate && entry.dates.indexOf(isoDate) === -1) entry.dates.push(isoDate);
  if (!entry.date && isoDate) entry.date = isoDate;
}

/**
 * @return {boolean} true si nouvelle entrée créée
 */
function athleUpsertCompetitionFromDetail(byId, index, detail, detailName, objectKey) {
  var id = detail.competitionId || detail.resultsId;
  if (!id) return false;
  id = String(id);

  var dateMatch = String(detailName).match(/^(\d{4}-\d{2}-\d{2})_(.+)\.json$/i);
  var isoDate = dateMatch ? dateMatch[1] : null;
  var labelFromFile = dateMatch
    ? String(dateMatch[2]).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    : null;

  var current = byId[id];
  var created = false;
  if (!current) {
    current = {
      resultsId: id,
      ficheId: null,
      date: isoDate,
      dates: isoDate ? [isoDate] : [],
      calendarDateLabel: null,
      calendarLabel: labelFromFile,
      place: null,
      type: null,
      level: null,
      resultsTitle: detail.title || null,
      club: detail.club || null,
    };
    index.competitions.push(current);
    byId[id] = current;
    created = true;
  } else {
    athleEnsureDates(current, isoDate);
    if (!current.resultsTitle && detail.title) current.resultsTitle = detail.title;
    if (!current.club && detail.club) current.club = detail.club;
    if (!current.calendarLabel && labelFromFile) current.calendarLabel = labelFromFile;
  }

  current.detailFile = detailName;
  current.detailObjectKey =
    (detail.storage && detail.storage.objectKey) || objectKey || r2ObjectKey(detailName);
  return created;
}

function syncAthleHourly() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('Sync déjà en cours, abandon.');
    return;
  }
  try {
    runAthleSyncForToday();
  } finally {
    lock.releaseLock();
  }
}

function runAthleSyncForToday() {
  var tz = ATHLE_CONFIG.TIMEZONE || 'Europe/Paris';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  return runAthleSyncForDate(today);
}

/**
 * Récupère toutes les compétitions club (U14/U16) pour un mois donné.
 * À lancer à la main, mois par mois, depuis l’éditeur :
 *   getAllDataForMonth(10, 2026)
 *
 * @param {number} month 1–12
 * @param {number} year ex. 2026
 */
function getAllDataForMonth(month, year) {
  r2GetConfig();

  month = Number(month);
  year = Number(year);
  if (!month || month < 1 || month > 12) {
    throw new Error('Mois invalide : utilisez 1 à 12 (ex. getAllDataForMonth(10, 2026))');
  }
  if (!year || year < 2000 || year > 2100) {
    throw new Error('Année invalide');
  }

  var daysInMonth = new Date(year, month, 0).getDate();
  Logger.log(
    'Backfill athle → R2 — %s/%s (%s jours), club %s',
    month,
    year,
    daysInMonth,
    ATHLE_CONFIG.CLUB_NAME,
  );

  var index = athleLoadCompetitionsIndex();
  var summary = {
    year: year,
    month: month,
    daysProcessed: 0,
    competitions: 0,
    added: 0,
    errors: 0,
    days: [],
  };

  for (var day = 1; day <= daysInMonth; day++) {
    var iso = athlePadIsoDate(year, month, day);
    Logger.log('—— Jour %s ——', iso);
    try {
      var dayResult = runAthleSyncForDate(iso, index);
      summary.daysProcessed += 1;
      summary.competitions += dayResult.count || 0;
      summary.added += dayResult.added || 0;
      summary.errors += dayResult.errors || 0;
      summary.days.push(dayResult);
    } catch (err) {
      summary.errors += 1;
      summary.days.push({
        date: iso,
        count: 0,
        added: 0,
        errors: 1,
        error: String(err.message || err),
      });
      Logger.log('ERREUR jour %s : %s', iso, err.message || err);
    }
  }

  athleSaveCompetitionsIndex(index);

  Logger.log(
    'Mois %s/%s terminé — %s jour(s), %s compétition(s) du mois, %s nouvelle(s), %s erreur(s), index=%s',
    month,
    year,
    summary.daysProcessed,
    summary.competitions,
    summary.added,
    summary.errors,
    index.count,
  );
  return summary;
}

/** Raccourci éditeur : changez mois/année puis Exécuter. */
function runGetAllDataForMonth() {
  return getAllDataForMonth(10, 2026);
}

/**
 * Récupère la base athlètes U14/U16 du club via les bilans FFA
 * (catégories BE + MI) et écrit data/athletes.json sur R2 (index compact).
 */
function runAthleSyncAthletes() {
  r2GetConfig();
  Logger.log(
    'Sync athlètes bilans — club %s (%s), année %s',
    ATHLE_CONFIG.CLUB_NAME,
    ATHLE_CONFIG.CLUB_ID,
    ATHLE_CONFIG.BILANS_YEAR || athleBilansYear(),
  );

  var result = athleGetClubYouthAthletes();
  var stats = result._stats || {};
  var payload = { athletes: result.athletes || [] };
  // Compact JSON (sans indentation) pour limiter la taille sur R2.
  r2PutObject(ATHLETES_FILE, 'application/json; charset=utf-8', JSON.stringify(payload));
  var objectKey = r2ObjectKey(ATHLETES_FILE);
  Logger.log(
    'Athlètes sync OK — %s athlète(s) (dont +%s compétitions), %s fiche(s), %s erreur(s) → %s',
    stats.count || payload.athletes.length,
    stats.fromCompetitions || 0,
    stats.enrichedProfiles || 0,
    stats.enrichErrors || 0,
    objectKey,
  );
  return {
    count: stats.count || payload.athletes.length,
    fromCompetitions: stats.fromCompetitions || 0,
    performanceRows: stats.performanceRows || 0,
    enrichedProfiles: stats.enrichedProfiles || 0,
    enrichErrors: stats.enrichErrors || 0,
    seasonYear: stats.seasonYear,
    objectKey: objectKey,
  };
}

/**
 * Pour chaque athlète listé dans data/athletes.json :
 * récupère la fiche athle.fr complète et écrit data/athletes/{id}.json.
 * Met aussi à jour l’index compact data/athletes.json.
 *
 * Plus rapide : ne reconstruit pas la liste via bilans/compétitions.
 * Prérequis : avoir déjà un athletes.json (runAthleSyncAthletes).
 *
 * À lancer à la main (peut prendre quelques minutes).
 */
function runAthleSyncAthleteDetails() {
  r2GetConfig();
  Logger.log(
    'Sync fiches athlètes → %s/{id}.json — club %s',
    r2ObjectKey(ATHLETES_DIR),
    ATHLE_CONFIG.CLUB_NAME,
  );

  var seeds = athleLoadAthleteSeedsFromIndex();
  if (!seeds.length) {
    throw new Error(
      'Aucun athlète dans ' +
        r2ObjectKey(ATHLETES_FILE) +
        ' — lance d’abord runAthleSyncAthletes()',
    );
  }
  Logger.log('%s athlète(s) lus depuis %s', seeds.length, r2ObjectKey(ATHLETES_FILE));

  var compact = [];
  var ok = 0;
  var errors = 0;

  for (var i = 0; i < seeds.length; i++) {
    var seed = seeds[i];
    var id = String(seed.athleteId);
    try {
      if (i > 0) athleMaybeSleep();
      Logger.log('[%s/%s] %s — %s', i + 1, seeds.length, id, seed.name);
      var detail = athleFetchAthleteFullDetail(id, {
        name: seed.name,
        categoryCode: seed.categoryCode,
        youthCategory: seed.youthCategory,
        clubId: ATHLE_CONFIG.CLUB_ID,
        clubName: ATHLE_CONFIG.CLUB_NAME,
      });
      if (!athleIsAllowedYouthCategory(detail.youthCategory)) {
        Logger.log(
          '  skip %s (%s) — catégorie %s hors %s',
          id,
          detail.name,
          detail.youthCategory || detail.categoryCode || '?',
          (ATHLE_CONFIG.YOUTH_CATEGORIES || []).join('/'),
        );
        continue;
      }
      var fileName = ATHLETES_DIR + '/' + id + '.json';
      r2PutObject(fileName, 'application/json; charset=utf-8', JSON.stringify(detail));
      compact.push(athleCompactAthleteFromDetail(detail));
      ok += 1;
    } catch (err) {
      errors += 1;
      Logger.log('  ERREUR %s : %s', id, err.message || err);
      // Conserve l’entrée d’index existante (ou minimale) si la fiche échoue.
      compact.push({
        athleteId: id,
        name: seed.name,
        categoryCode: seed.categoryCode || null,
        youthCategory: seed.youthCategory || null,
        events: Array.isArray(seed.events) ? seed.events : [],
      });
    }
  }

  compact.sort(function (a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
  r2PutObject(
    ATHLETES_FILE,
    'application/json; charset=utf-8',
    JSON.stringify({ athletes: compact }),
  );

  Logger.log(
    'Fiches athlètes OK — %s écrite(s), %s erreur(s), index %s',
    ok,
    errors,
    r2ObjectKey(ATHLETES_FILE),
  );
  return {
    count: seeds.length,
    written: ok,
    errors: errors,
    indexKey: r2ObjectKey(ATHLETES_FILE),
    dirKey: r2ObjectKey(ATHLETES_DIR),
  };
}

/** Lit les seeds (id, name, …) depuis data/athletes.json. */
function athleLoadAthleteSeedsFromIndex() {
  var index = r2DownloadJson(ATHLETES_FILE);
  var list = index && index.athletes ? index.athletes : [];
  var seeds = [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || !row.athleteId) continue;
    var id = String(row.athleteId);
    if (seen[id]) continue;
    var youth =
      row.youthCategory || athleYouthCategoryFromBilansCode(row.categoryCode || '');
    // Nettoie un index déjà pollué par des catégories hors U14/U16.
    if (!athleIsAllowedYouthCategory(youth)) continue;
    seen[id] = true;
    seeds.push({
      athleteId: id,
      name: row.name || id,
      categoryCode: row.categoryCode || null,
      youthCategory: youth || null,
      events: row.events || [],
    });
  }
  return seeds;
}

/** Test rapide : une seule fiche → data/athletes/{id}.json */
function runAthleSyncAthleteDetailOne() {
  r2GetConfig();
  var athleteId = '3503600'; // ← changez l’id pour tester
  var detail = athleFetchAthleteFullDetail(athleteId, {
    clubId: ATHLE_CONFIG.CLUB_ID,
    clubName: ATHLE_CONFIG.CLUB_NAME,
  });
  var fileName = ATHLETES_DIR + '/' + athleteId + '.json';
  r2PutObject(fileName, 'application/json; charset=utf-8', JSON.stringify(detail));
  Logger.log('OK → %s (%s épreuves, %s résultats)', r2ObjectKey(fileName), detail.events.length, detail.recentResults.length);
  return detail;
}

/**
 * Sync une date ISO (yyyy-MM-dd) : agrège l’index + détails compétitions → R2.
 * @param {string} isoDate
 * @param {Object=} sharedIndex index competitions.json déjà chargé (backfill mensuel)
 */
function runAthleSyncForDate(isoDate, sharedIndex) {
  r2GetConfig();

  var clubName = ATHLE_CONFIG.CLUB_NAME;
  var youth = ATHLE_CONFIG.YOUTH_CATEGORIES;
  var ownsIndex = !sharedIndex;
  var index = sharedIndex || athleLoadCompetitionsIndex();

  Logger.log('Sync athle → R2 — date %s, club %s', isoDate, clubName);

  var listPayload = athleGetCompetitionsForDate(isoDate, clubName, youth);
  var merge = athleMergeCompetitionsIntoIndex(index, listPayload.competitions, isoDate);
  Logger.log(
    'Liste jour : %s compétition(s), %s nouvelle(s) → index total %s',
    listPayload.count,
    merge.added,
    index.count,
  );

  if (ownsIndex && merge.added > 0) {
    athleSaveCompetitionsIndex(index);
  } else if (ownsIndex) {
    Logger.log('Index competitions.json inchangé (aucune nouvelle compétition).');
  }

  var usedNames = {};
  var errors = 0;
  for (var i = 0; i < listPayload.competitions.length; i++) {
    var comp = listPayload.competitions[i];
    try {
      athleMaybeSleep();
      var detail = athleGetClubEpreuvesInCompetition(comp.resultsId, clubName, comp.club);
      var baseName = athleSanitizeObjectFilename(
        comp.calendarLabel || comp.resultsTitle || comp.resultsId,
      );
      var fileName = isoDate + '_' + baseName + '.json';
      if (usedNames[fileName]) {
        fileName = isoDate + '_' + baseName + '_' + comp.resultsId + '.json';
      }
      usedNames[fileName] = true;
      detail.storage = {
        provider: 'cloudflare-r2',
        objectKey: r2ObjectKey(fileName),
      };
      r2UploadJson(fileName, detail);
      athleAttachDetailFileToIndex(index, comp.resultsId, fileName, detail.storage.objectKey);
      Logger.log('  → %s (%s épreuves)', detail.storage.objectKey, detail.count);
    } catch (err) {
      errors += 1;
      Logger.log('  ERREUR compétition %s : %s', comp.resultsId, err.message || err);
      r2UploadJson(isoDate + '_ERROR_' + comp.resultsId + '.json', {
        error: String(err.message || err),
        competition: comp,
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  if (ownsIndex && listPayload.competitions.length) {
    athleSaveCompetitionsIndex(index);
  }

  Logger.log('Sync %s terminée.', isoDate);
  return {
    date: isoDate,
    count: listPayload.count || 0,
    added: merge.added,
    errors: errors,
    indexCount: index.count,
    objectKey: r2ObjectKey(COMPETITIONS_INDEX_FILE),
  };
}

function athleEmptyCompetitionsIndex() {
  return {
    fetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clubQuery: ATHLE_CONFIG.CLUB_NAME,
    youthCategories: ATHLE_CONFIG.YOUTH_CATEGORIES || [],
    count: 0,
    competitions: [],
  };
}

function athleLoadCompetitionsIndex() {
  var existing = r2DownloadJson(COMPETITIONS_INDEX_FILE);
  if (!existing || typeof existing !== 'object') {
    Logger.log('Aucun competitions.json — création d’un index vide.');
    return athleEmptyCompetitionsIndex();
  }
  if (!existing.competitions) existing.competitions = [];
  existing.count = existing.competitions.length;
  return existing;
}

function athleSaveCompetitionsIndex(index) {
  index.updatedAt = new Date().toISOString();
  if (!index.fetchedAt) index.fetchedAt = index.updatedAt;
  index.clubQuery = ATHLE_CONFIG.CLUB_NAME;
  index.youthCategories = ATHLE_CONFIG.YOUTH_CATEGORIES || [];
  index.count = (index.competitions || []).length;
  index.storage = {
    provider: 'cloudflare-r2',
    objectKey: r2ObjectKey(COMPETITIONS_INDEX_FILE),
  };
  r2UploadJson(COMPETITIONS_INDEX_FILE, index);
  Logger.log('Index enregistré → %s (%s compétition(s))', index.storage.objectKey, index.count);
  return index;
}

/**
 * Ajoute les compétitions absentes (clé = resultsId). Append seulement.
 * @return {{added: number}}
 */
function athleMergeCompetitionsIntoIndex(index, competitions, isoDate) {
  if (!index.competitions) index.competitions = [];
  var byId = {};
  for (var i = 0; i < index.competitions.length; i++) {
    var existing = index.competitions[i];
    if (existing && existing.resultsId) byId[String(existing.resultsId)] = existing;
  }

  var added = 0;
  for (var j = 0; j < (competitions || []).length; j++) {
    var comp = competitions[j];
    var id = String(comp.resultsId);
    var current = byId[id];
    if (current) {
      if (!current.dates) current.dates = current.date ? [current.date] : [];
      if (current.dates.indexOf(isoDate) === -1) current.dates.push(isoDate);
      continue;
    }

    var entry = {
      resultsId: comp.resultsId,
      ficheId: comp.ficheId,
      date: isoDate,
      dates: [isoDate],
      calendarDateLabel: comp.calendarDateLabel,
      calendarLabel: comp.calendarLabel,
      place: comp.place,
      type: comp.type,
      level: comp.level,
      resultsTitle: comp.resultsTitle,
      club: comp.club,
    };
    index.competitions.push(entry);
    byId[id] = entry;
    added += 1;
    Logger.log('  + nouvelle compétition %s — %s', id, entry.calendarLabel || entry.resultsTitle);
  }

  index.count = index.competitions.length;
  return { added: added };
}

function athleAttachDetailFileToIndex(index, resultsId, fileName, objectKey) {
  var id = String(resultsId);
  for (var i = 0; i < (index.competitions || []).length; i++) {
    var entry = index.competitions[i];
    if (String(entry.resultsId) !== id) continue;
    entry.detailFile = fileName;
    entry.detailObjectKey = objectKey;
    return;
  }
}

function installHourlyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncAthleHourly') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncAthleHourly').timeBased().everyHours(1).create();
  Logger.log('Déclencheur horaire installé pour syncAthleHourly');
}

function athleSanitizeObjectFilename(name) {
  return athleRemoveAccents(String(name))
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^-|-$/g, '')
    .substring(0, 72);
}

function r2ObjectKey(relativeFilename) {
  var prefix = (ATHLE_CONFIG.R2 && ATHLE_CONFIG.R2.KEY_PREFIX) || '';
  return r2BuildObjectKey(prefix, relativeFilename);
}

function athlePadIsoDate(year, month, day) {
  return (
    String(year) +
    '-' +
    ('0' + month).slice(-2) +
    '-' +
    ('0' + day).slice(-2)
  );
}
