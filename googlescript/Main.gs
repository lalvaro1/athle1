/**
 * Synchronisation horaire athle.fr → Cloudflare R2.
 *
 * Fichiers : Config.gs, AthleLib.gs, R2Storage.gs, Main.gs
 * 1. Configurer ATHLE_CONFIG + secrets R2
 * 2. runAthleSyncForToday() — autoriser UrlFetch externe
 * 3. installHourlyTrigger() une fois
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
  r2GetConfig();

  var tz = ATHLE_CONFIG.TIMEZONE || 'Europe/Paris';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  today = "2026-06-13";

  var clubName = ATHLE_CONFIG.CLUB_NAME;
  var youth = ATHLE_CONFIG.YOUTH_CATEGORIES;

  Logger.log('Sync athle → R2 — date %s, club %s', today, clubName);

  var listPayload = athleGetCompetitionsForDate(today, clubName, youth);
  var listFile = 'competitions_' + today + '.json';
  listPayload.storage = { provider: 'cloudflare-r2', objectKey: listFile };

  r2UploadJson(listFile, listPayload);
  Logger.log('Liste : %s compétition(s) → %s', listPayload.count, listFile);

  var usedNames = {};
  for (var i = 0; i < listPayload.competitions.length; i++) {
    var comp = listPayload.competitions[i];
    try {
      athleMaybeSleep();
      var detail = athleGetClubEpreuvesInCompetition(comp.resultsId, clubName, comp.club);
      var baseName = athleSanitizeObjectFilename(
        comp.calendarLabel || comp.resultsTitle || comp.resultsId,
      );
      var fileName = today + '_' + baseName + '.json';
      if (usedNames[fileName]) {
        fileName = today + '_' + baseName + '_' + comp.resultsId + '.json';
      }
      usedNames[fileName] = true;
      detail.storage = { provider: 'cloudflare-r2', objectKey: fileName };
      r2UploadJson(fileName, detail);
      Logger.log('  → %s (%s épreuves)', fileName, detail.count);
    } catch (err) {
      Logger.log('  ERREUR compétition %s : %s', comp.resultsId, err.message || err);
      r2UploadJson(today + '_ERROR_' + comp.resultsId + '.json', {
        error: String(err.message || err),
        competition: comp,
        fetchedAt: new Date().toISOString(),
      });
    }
  }

  Logger.log('Sync terminée.');
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
