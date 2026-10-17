/**
 * Synchronisation athle.fr → Cloudflare R2.
 *
 * Fichiers : Config.gs, AthleLib.gs, R2SSStorage.gss, Main.gs
 * 1. Configurer ATHLE_CONFIG + setR2ApiTokenFromEditor()
 * 2. runAthleSyncForToday() — sync du jour
 * 3. getAllDataForMonth(10, 2026) — backfill manuel mois par mois
 * 4. installHourlyTrigger() une fois
 */

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
 * Attention : un mois chargé peut approcher la limite d’exécution Apps Script (~6 min).
 * Regardez les logs ; relancez le même mois si besoin (écrase les JSON déjà présents).
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

  var summary = {
    year: year,
    month: month,
    daysProcessed: 0,
    competitions: 0,
    errors: 0,
    days: [],
  };

  for (var day = 1; day <= daysInMonth; day++) {
    var iso = athlePadIsoDate(year, month, day);
    Logger.log('—— Jour %s ——', iso);
    try {
      var dayResult = runAthleSyncForDate(iso);
      summary.daysProcessed += 1;
      summary.competitions += dayResult.count || 0;
      summary.errors += dayResult.errors || 0;
      summary.days.push(dayResult);
    } catch (err) {
      summary.errors += 1;
      summary.days.push({
        date: iso,
        count: 0,
        errors: 1,
        error: String(err.message || err),
      });
      Logger.log('ERREUR jour %s : %s', iso, err.message || err);
    }
  }

  Logger.log(
    'Mois %s/%s terminé — %s jour(s), %s compétition(s), %s erreur(s)',
    month,
    year,
    summary.daysProcessed,
    summary.competitions,
    summary.errors,
  );
  return summary;
}

/** Raccourci éditeur : changez mois/année puis Exécuter. */
function runGetAllDataForMonth() {
  return getAllDataForMonth(10, 2026);
}

/**
 * Sync une date ISO (yyyy-MM-dd) : liste + détails compétitions → R2.
 * @param {string} isoDate
 */
function runAthleSyncForDate(isoDate) {
  r2GetConfig();

  var clubName = ATHLE_CONFIG.CLUB_NAME;
  var youth = ATHLE_CONFIG.YOUTH_CATEGORIES;

  Logger.log('Sync athle → R2 — date %s, club %s', isoDate, clubName);

  var listPayload = athleGetCompetitionsForDate(isoDate, clubName, youth);
  var listFile = 'competitions_' + isoDate + '.json';
  listPayload.storage = {
    provider: 'cloudflare-r2',
    objectKey: r2ObjectKey(listFile),
  };
  r2UploadJson(listFile, listPayload);
  Logger.log('Liste : %s compétition(s) → %s', listPayload.count, listPayload.storage.objectKey);

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

  Logger.log('Sync %s terminée.', isoDate);
  return {
    date: isoDate,
    count: listPayload.count || 0,
    errors: errors,
    objectKey: listPayload.storage.objectKey,
  };
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
