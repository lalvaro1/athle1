/**
 * Bibliothèque athle.fr (calendrier, club, épreuves) — Google Apps Script.
 */

var ATHLE_SITE = 'https://www.athle.fr';
var ATHLE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function athleFetchHtml(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: {
      'User-Agent': ATHLE_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'fr-FR,fr;q=0.9',
    },
  });
  var code = response.getResponseCode();
  if (code >= 400) {
    throw new Error('HTTP ' + code + ' — ' + url);
  }
  var text = response.getContentText('UTF-8');
  if (text.length < 500 && text.indexOf('supprimée') !== -1) {
    throw new Error('Page athle.fr refusée (User-Agent ?)');
  }
  return text;
}

function athleStripHtml(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')
    .trim();
}

function athleRemoveAccents(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function athleNormalizeClubName(name) {
  return athleRemoveAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function athleClubNamesMatch(foundName, query) {
  var a = athleNormalizeClubName(foundName);
  var b = athleNormalizeClubName(query);
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
  var bTokens = b.split(' ').filter(function (t) {
    return t.length > 2;
  });
  for (var i = 0; i < bTokens.length; i++) {
    if (a.indexOf(bTokens[i]) === -1) return false;
  }
  return bTokens.length > 0;
}

function athleBuildCalendarUrl(date) {
  var q = [
    'frmbase=calendrier',
    'frmdate_a1=' + date.getFullYear(),
    'frmdate_a2=' + date.getFullYear(),
    'frmdate_m1=' + (date.getMonth() + 1),
    'frmdate_m2=' + (date.getMonth() + 1),
    'frmdate_j1=' + date.getDate(),
    'frmdate_j2=' + date.getDate(),
    'frmespace=0',
    'frmligue=',
    'frmmode=1',
  ];
  return ATHLE_SITE + '/bases/liste.aspx?' + q.join('&');
}

function athleBuildResultsUrl(competitionId, params) {
  params = params || {};
  var q = [
    'frmbase=resultats',
    'frmmode=1',
    'frmespace=0',
    'frmcompetition=' + encodeURIComponent(String(competitionId)),
  ];
  if (params.frmclub) q.push('frmclub=' + encodeURIComponent(String(params.frmclub)));
  if (params.frmepreuve) q.push('frmepreuve=' + encodeURIComponent(params.frmepreuve));
  if (params.frmposition != null) q.push('frmposition=' + String(params.frmposition));
  return ATHLE_SITE + '/bases/liste.aspx?' + q.join('&');
}

function athleParseCalendarListHtml(html) {
  var rows = [];
  var trRe = /<tr class="(?!detail-row)[^"]*">([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    var chunk = trMatch[1];
    var tds = [];
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdMatch;
    while ((tdMatch = tdRe.exec(chunk)) !== null) {
      tds.push(tdMatch[1]);
    }
    if (tds.length < 6) continue;
    var ficheMatch = chunk.match(/href="\/competitions\/(\d+)"/i);
    var resultsMatch = chunk.match(/frmbase=resultats[^"]*frmcompetition=(\d+)/i);
    rows.push({
      dateLabel: athleStripHtml(tds[0]),
      label: athleStripHtml(tds[1]),
      place: athleStripHtml(tds[2]),
      type: athleStripHtml(tds[3]),
      level: athleStripHtml(tds[4]),
      ficheId: ficheMatch ? ficheMatch[1] : null,
      resultsId: resultsMatch ? resultsMatch[1] : null,
    });
  }
  return rows;
}

var ATHLE_MONTHS = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

function athleParseFrenchDateLabel(dateLabel, refYear) {
  var m = String(dateLabel).match(
    /(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)/i,
  );
  if (!m) return null;
  var month = ATHLE_MONTHS[m[3].toLowerCase()];
  return {
    month: month,
    dayStart: Number(m[1]),
    dayEnd: m[2] ? Number(m[2]) : Number(m[1]),
    year: refYear,
  };
}

function athleCompetitionTouchesDate(isoDate, dateLabel, refYear) {
  var parsed = athleParseFrenchDateLabel(dateLabel, refYear);
  if (!parsed) return true;
  var parts = isoDate.split('-');
  var ty = Number(parts[0]);
  var tm = Number(parts[1]) - 1;
  var td = Number(parts[2]);
  for (var d = parsed.dayStart; d <= parsed.dayEnd; d++) {
    if (parsed.year === ty && parsed.month - 1 === tm && d === td) return true;
  }
  return false;
}

function athleCompetitionHaystack(comp) {
  return athleRemoveAccents(
    [comp.label, comp.dateLabel, comp.type, comp.level, comp.resultsTitle]
      .filter(Boolean)
      .join(' '),
  ).toLowerCase();
}

function athleHasU14(text) {
  if (/\bu\s*[-/]?\s*14\b/.test(text)) return true;
  if (/\bu14\b/.test(text)) return true;
  if (/\bbenjamin?s?\b/.test(text)) return true;
  if (/\bbef\b/.test(text)) return true;
  if (/\bequip[\s'-]?athle\b/.test(text) && /\b(u\s*14|14\s*[-/]\s*16|benjamin)/.test(text)) return true;
  return false;
}

function athleHasU16(text) {
  if (/\bu\s*[-/]?\s*16\b/.test(text)) return true;
  if (/\bu16\b/.test(text)) return true;
  if (/\bminimes?\b/.test(text)) return true;
  if (/\bbem\b/.test(text)) return true;
  if (/\bequip[\s'-]?athle\b/.test(text) && /\b(u\s*16|14\s*[-/]\s*16|minime)/.test(text)) return true;
  return false;
}

function athleIsYouthCompetition(comp, categories) {
  categories = categories || ['U14', 'U16'];
  var text = athleCompetitionHaystack(comp);
  for (var i = 0; i < categories.length; i++) {
    if (categories[i] === 'U14' && athleHasU14(text)) return true;
    if (categories[i] === 'U16' && athleHasU16(text)) return true;
  }
  return false;
}

function athleParseCompetitionTitle(html) {
  var m = html.match(/class="mainheaders heading-4">([\s\S]*?)<\/div>/i);
  if (!m) return null;
  return m[1]
    .replace(/<br\s*\/?>/gi, ' — ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function athleParseClubsFromResultsHtml(html) {
  var clubs = {};
  var re = /<a href="\/bases\/liste\.aspx\?[^"]*frmclub=(\d+)[^"]*">([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var name = athleStripHtml(m[2]).replace(/\*+$/, '').trim();
    if (name && !clubs[m[1]]) clubs[m[1]] = name;
  }
  return clubs;
}

function athleFindClubInMap(clubs, clubName) {
  for (var id in clubs) {
    if (athleClubNamesMatch(clubs[id], clubName)) {
      return { id: id, name: clubs[id] };
    }
  }
  return null;
}

function athleParseResultsPageUrls(html) {
  var blockMatch = html.match(/id="optionsPagination"[\s\S]*?<\/div>\s*<\/div>/i);
  var block = blockMatch ? blockMatch[0] : '';
  var urls = [];
  var re = /data-url="([^"]+)"/gi;
  var m;
  while ((m = re.exec(block)) !== null) {
    var u = m[1];
    urls.push(u.indexOf('http') === 0 ? u : ATHLE_SITE + u);
  }
  var unique = [];
  for (var i = 0; i < urls.length; i++) {
    if (unique.indexOf(urls[i]) === -1) unique.push(urls[i]);
  }
  return unique;
}

function athleFindClubInCompetition(competitionId, clubName) {
  var entryUrl = athleBuildResultsUrl(competitionId);
  var firstHtml = athleFetchHtml(entryUrl);
  var resultsTitle = athleParseCompetitionTitle(firstHtml);
  var hit = athleFindClubInMap(athleParseClubsFromResultsHtml(firstHtml), clubName);
  if (hit) return { club: hit, resultsTitle: resultsTitle };

  var pageUrls = athleParseResultsPageUrls(firstHtml);
  for (var i = 0; i < pageUrls.length; i++) {
    if (pageUrls[i] === entryUrl) continue;
    athleMaybeSleep();
    var html = athleFetchHtml(pageUrls[i]);
    hit = athleFindClubInMap(athleParseClubsFromResultsHtml(html), clubName);
    if (hit) return { club: hit, resultsTitle: resultsTitle };
  }
  return null;
}

function athleGetCompetitionsForDate(isoDate, clubName, youthCategories) {
  var parts = isoDate.split('-');
  var day = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var url = athleBuildCalendarUrl(day);
  var html = athleFetchHtml(url);
  var all = athleParseCalendarListHtml(html);
  var refYear = day.getFullYear();
  var onDay = all.filter(function (row) {
    return athleCompetitionTouchesDate(isoDate, row.dateLabel, refYear);
  });

  var candidates = onDay.filter(function (c) {
    return c.resultsId;
  });
  var beforeYouth = candidates.length;
  if (youthCategories && youthCategories.length) {
    candidates = candidates.filter(function (c) {
      return athleIsYouthCompetition(c, youthCategories);
    });
  }

  var competitions = [];
  for (var i = 0; i < candidates.length; i++) {
    var comp = candidates[i];
    athleMaybeSleep();
    var found = athleFindClubInCompetition(comp.resultsId, clubName);
    if (!found) continue;
    competitions.push({
      resultsId: comp.resultsId,
      ficheId: comp.ficheId,
      calendarDateLabel: comp.dateLabel,
      calendarLabel: comp.label,
      place: comp.place,
      type: comp.type,
      level: comp.level,
      resultsTitle: found.resultsTitle,
      club: found.club,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    date: isoDate,
    clubQuery: clubName,
    youthCategories: youthCategories,
    calendarCompetitions: onDay.length,
    withResultsBeforeYouthFilter: beforeYouth,
    checkedWithResults: candidates.length,
    count: competitions.length,
    competitions: competitions,
  };
}

function athleNormalizeSeriesLabel(s) {
  return athleRemoveAccents(String(s)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function athleNormalizeEpreuveName(s) {
  return athleNormalizeSeriesLabel(s).replace(/\s*\/\s*/g, ' / ');
}

function athleParseEpreuveOptions(html) {
  var blockMatch = html.match(/id="optionsEpreuve"[\s\S]*?<\/div>\s*<\/div>/i);
  var block = blockMatch ? blockMatch[0] : '';
  var opts = [];
  var re = /data-url="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi;
  var m;
  while ((m = re.exec(block)) !== null) {
    var path = m[1];
    var idMatch = path.match(/frmepreuve=([^&]+)/);
    if (!idMatch) continue;
    var name = athleStripHtml(m[2]).replace(/^>\s*|\s*<$/g, '').trim();
    var id = decodeURIComponent(idMatch[1].replace(/\+/g, ' '));
    opts.push({ id: id, name: name });
  }
  return opts;
}

function athleParseClubParticipantRows(html) {
  var rows = [];
  var trRe = /<tr class="">([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    var chunk = trMatch[1];
    var athleteMatch = chunk.match(/\/athletes\/(\d+)\//);
    if (!athleteMatch) continue;
    var tds = [];
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdMatch;
    while ((tdMatch = tdRe.exec(chunk)) !== null) {
      tds.push(tdMatch[1]);
    }
    if (tds.length < 8) continue;
    rows.push({
      athleteId: athleteMatch[1],
      athleteName: athleStripHtml(tds[0]),
      epreuveName: athleStripHtml(tds[1]),
      performance: athleStripHtml(tds[2]) || null,
      series: athleStripHtml(tds[3]) || null,
      dossard: athleStripHtml(tds[4]) || null,
      category: athleStripHtml(tds[6]) || null,
      date: athleStripHtml(tds[7]) || null,
    });
  }
  return rows;
}

function athleScheduleAdd(schedule, series, time) {
  if (!series || !time) return;
  schedule[athleNormalizeSeriesLabel(series)] = time;
  var tailMatch = series.match(/finale[\s-]*(.+)/i);
  if (tailMatch) {
    var tail = tailMatch[1].trim();
    schedule[athleNormalizeSeriesLabel(tail)] = time;
    schedule[athleNormalizeSeriesLabel('finale- ' + tail)] = time;
  }
}

function athleParseSeriesSchedule(html) {
  var schedule = {};
  var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    var chunk = trMatch[1];
    var text = athleStripHtml(chunk);
    if (!/\d{1,2}:\d{2}/.test(text)) continue;
    if (chunk.indexOf('Chr :') !== -1) {
      var timeMatch = text.match(/(\d{1,2}:\d{2})\s*$/);
      if (!timeMatch) continue;
      var beforeChr = text.split('Chr :')[0].trim();
      var seriesMatch = beforeChr.match(/(Série \d+|Finale[\w\s\d-]*)/i);
      athleScheduleAdd(schedule, seriesMatch ? seriesMatch[1].trim() : beforeChr, timeMatch[1]);
      continue;
    }
    var pipeMatch = text.match(/(Finale[^|]*|Série \d+)\s*\|\s*(\d{1,2}:\d{2})/i);
    if (pipeMatch) athleScheduleAdd(schedule, pipeMatch[1].trim(), pipeMatch[2]);
  }
  return schedule;
}

function athleLookupSeriesTime(schedule, series) {
  if (!series) return null;
  var key = athleNormalizeSeriesLabel(series);
  if (schedule[key]) return schedule[key];
  var tail = key.replace(/^finale[\s-]*/i, '').trim();
  if (tail && schedule[tail]) return schedule[tail];
  for (var k in schedule) {
    if (k.indexOf(key) !== -1 || key.indexOf(k) !== -1) return schedule[k];
    if (tail && (k.indexOf(tail) !== -1 || tail.indexOf(k) !== -1)) return schedule[k];
  }
  return null;
}

function athleMatchEpreuveId(epreuveName, options) {
  var target = athleNormalizeEpreuveName(epreuveName);
  for (var i = 0; i < options.length; i++) {
    if (athleNormalizeEpreuveName(options[i].name) === target) return options[i].id;
  }
  for (var j = 0; j < options.length; j++) {
    var n = athleNormalizeEpreuveName(options[j].name);
    if (n.indexOf(target) !== -1 || target.indexOf(n) !== -1) return options[j].id;
  }
  return null;
}

/**
 * @param {string} competitionId frmcompetition
 * @param {string} clubNameOrId
 * @param {{id:string,name:string}=} knownClub optionnel (évite une recherche)
 */
function athleGetClubEpreuvesInCompetition(competitionId, clubNameOrId, knownClub) {
  var compId = String(competitionId).trim();
  var club;
  if (knownClub && knownClub.id) {
    club = knownClub;
  } else if (/^\d{5,6}$/.test(String(clubNameOrId).trim())) {
    club = { id: String(clubNameOrId).trim(), name: String(clubNameOrId).trim() };
  } else {
    var found = athleFindClubInCompetition(compId, clubNameOrId);
    if (!found) throw new Error('Club introuvable : ' + clubNameOrId);
    club = found.club;
  }

  var clubUrl = athleBuildResultsUrl(compId, { frmclub: club.id });
  var clubHtml = athleFetchHtml(clubUrl);
  var title = athleParseCompetitionTitle(clubHtml);
  var epreuveOptions = athleParseEpreuveOptions(clubHtml);
  var participantRows = athleParseClubParticipantRows(clubHtml);

  var byEpreuve = {};
  for (var r = 0; r < participantRows.length; r++) {
    var row = participantRows[r];
    var key = athleNormalizeEpreuveName(row.epreuveName);
    if (!byEpreuve[key]) {
      byEpreuve[key] = {
        id: athleMatchEpreuveId(row.epreuveName, epreuveOptions),
        name: row.epreuveName,
        horaire: null,
        seriesSchedule: {},
        participants: [],
      };
    }
    var copy = {};
    for (var pk in row) copy[pk] = row[pk];
    copy.horaire = null;
    byEpreuve[key].participants.push(copy);
  }

  var scheduleCache = {};
  for (var ek in byEpreuve) {
    var entry = byEpreuve[ek];
    if (!entry.id) continue;
    athleMaybeSleep();
    var epreuveUrl = athleBuildResultsUrl(compId, { frmepreuve: entry.id });
    if (!scheduleCache[entry.id]) {
      scheduleCache[entry.id] = athleParseSeriesSchedule(athleFetchHtml(epreuveUrl));
    }
    entry.seriesSchedule = scheduleCache[entry.id];
    var times = {};
    for (var p = 0; p < entry.participants.length; p++) {
      var part = entry.participants[p];
      part.horaire = athleLookupSeriesTime(entry.seriesSchedule, part.series);
      if (part.horaire) times[part.horaire] = true;
    }
    var timeKeys = Object.keys(times).sort();
    entry.horaire = timeKeys.length === 1 ? timeKeys[0] : timeKeys.length > 1 ? timeKeys.join(', ') : null;
  }

  var epreuves = [];
  for (var nameKey in byEpreuve) epreuves.push(byEpreuve[nameKey]);
  epreuves.sort(function (a, b) {
    return a.name.localeCompare(b.name, 'fr');
  });

  return {
    fetchedAt: new Date().toISOString(),
    competitionId: compId,
    title: title,
    club: club,
    sourceUrl: clubUrl,
    count: epreuves.length,
    participantRows: participantRows.length,
    epreuves: epreuves,
  };
}

function athleMaybeSleep() {
  if (typeof ATHLE_CONFIG !== 'undefined' && ATHLE_CONFIG.PAUSE_MS > 0) {
    Utilities.sleep(ATHLE_CONFIG.PAUSE_MS);
  }
}

/**
 * Bilans club (performances) — source pour la liste des athlètes.
 * Ex. frmbase=bilans&frmclub=033011&frmligue=N-A&frmdepartement=033&frmcategorie=BE&frmannee=2026&frmpostback=true
 */
function athleBuildBilansUrl(params) {
  params = params || {};
  var q = [
    'frmbase=bilans',
    'frmmode=1',
    'frmespace=0',
    'frmpostback=true',
    'frmligue=' + encodeURIComponent(String(params.ligue || '')),
    'frmdepartement=' + encodeURIComponent(String(params.department || '')),
    'frmclub=' + encodeURIComponent(String(params.clubId || '')),
    'frmannee=' + encodeURIComponent(String(params.year || '')),
    'frmcategorie=' + encodeURIComponent(String(params.category || '')),
    'frmsexe=' + encodeURIComponent(String(params.sex || '')),
    'frmepreuve=' + encodeURIComponent(String(params.epreuve || '')),
  ];
  if (params.position != null && params.position !== '') {
    q.push('frmposition=' + encodeURIComponent(String(params.position)));
  }
  return ATHLE_SITE + '/bases/liste.aspx?' + q.join('&');
}

function athleBilansYear() {
  if (typeof ATHLE_CONFIG !== 'undefined' && ATHLE_CONFIG.BILANS_YEAR) {
    return Number(ATHLE_CONFIG.BILANS_YEAR);
  }
  var tz =
    typeof ATHLE_CONFIG !== 'undefined' && ATHLE_CONFIG.TIMEZONE
      ? ATHLE_CONFIG.TIMEZONE
      : 'Europe/Paris';
  return Number(Utilities.formatDate(new Date(), tz, 'yyyy'));
}

/** Année mini des perfs conservées (N - ATHLETE_PERF_MIN_YEAR_OFFSET). */
function athleMinPerformanceYear() {
  var offset = 1;
  if (
    typeof ATHLE_CONFIG !== 'undefined' &&
    ATHLE_CONFIG.ATHLETE_PERF_MIN_YEAR_OFFSET != null
  ) {
    offset = Number(ATHLE_CONFIG.ATHLETE_PERF_MIN_YEAR_OFFSET);
  }
  if (isNaN(offset) || offset < 0) offset = 1;
  return athleBilansYear() - offset;
}

/**
 * Mappe un code bilan FFA (BE/MI/…) vers U14/U16.
 * @return {'U14'|'U16'|null}
 */
function athleYouthCategoryFromBilansCode(code) {
  var c = String(code || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (c.indexOf('BE') === 0) return 'U14';
  if (c.indexOf('MI') === 0) return 'U16';
  return null;
}

/**
 * Parse "BEF/ 14" → code, sexe, année de naissance estimée, U14/U16.
 */
function athleParseBilansAthleteCategory(raw) {
  var text = String(raw || '').trim();
  var match = text.match(/^([A-Za-z]{2,4})\s*\/\s*(\d{2})\s*$/);
  var code = match ? match[1].toUpperCase() : text.split('/')[0].trim().toUpperCase();
  var yearSuffix = match ? Number(match[2]) : null;
  var birthYear = yearSuffix == null ? null : yearSuffix >= 30 ? 1900 + yearSuffix : 2000 + yearSuffix;
  var sex = null;
  if (/F$/i.test(code)) sex = 'F';
  else if (/M$/i.test(code)) sex = 'M';
  return {
    raw: text,
    code: code || null,
    sex: sex,
    birthYear: birthYear,
    youthCategory: athleYouthCategoryFromBilansCode(code),
  };
}

function athleParseBilansListHtml(html) {
  var rows = [];
  var trRe = /<tr class="(?!detail-row)[^"]*">([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    var chunk = trMatch[1];
    var athleteMatch = chunk.match(/\/athletes\/(\d+)/i);
    if (!athleteMatch) continue;
    var tds = [];
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdMatch;
    while ((tdMatch = tdRe.exec(chunk)) !== null) {
      tds.push(athleStripHtml(tdMatch[1]));
    }
    // Place | Performance | Nom | Club | Ligue | Dep. | Infos | Date | Lieu
    if (tds.length < 8) continue;
    rows.push({
      athleteId: athleteMatch[1],
      performance: tds[1] || null,
      name: tds[2] || null,
      clubName: tds[3] || null,
      ligue: tds[4] || null,
      department: tds[5] || null,
      category: tds[6] || null,
      date: tds[7] || null,
      place: tds[8] || null,
    });
  }
  var totalMatch = html.match(/(\d+)\s+r[ée]sultats?/i);
  var positions = [];
  var posRe = /frmposition=(\d+)/gi;
  var posMatch;
  while ((posMatch = posRe.exec(html)) !== null) {
    var n = Number(posMatch[1]);
    if (positions.indexOf(n) === -1) positions.push(n);
  }
  positions.sort(function (a, b) {
    return a - b;
  });
  return {
    rows: rows,
    total: totalMatch ? Number(totalMatch[1]) : rows.length,
    positions: positions,
  };
}

/**
 * Parcourt les pages de bilans pour une catégorie (BE, MI, …).
 */
function athleFetchBilansRowsForCategory(club, year, category) {
  var all = [];
  var position = 0;
  var seen = {};
  var guard = 0;
  while (!seen[position] && guard < 50) {
    seen[position] = true;
    guard += 1;
    var url = athleBuildBilansUrl({
      clubId: club.id,
      ligue: club.ligue,
      department: club.department,
      year: year,
      category: category,
      position: position,
    });
    if (guard > 1) athleMaybeSleep();
    var parsed = athleParseBilansListHtml(athleFetchHtml(url));
    for (var i = 0; i < parsed.rows.length; i++) {
      all.push(parsed.rows[i]);
    }
    var next = null;
    for (var p = 0; p < parsed.positions.length; p++) {
      if (parsed.positions[p] > position) {
        next = parsed.positions[p];
        break;
      }
    }
    if (next == null) break;
    position = next;
  }
  return all;
}

/**
 * Base athlètes U14/U16 du club via les bilans FFA (dédupliqués par athleteId).
 */
function athleGetClubYouthAthletes(options) {
  options = options || {};
  var club = {
    id: String(options.clubId || ATHLE_CONFIG.CLUB_ID || ''),
    name: String(options.clubName || ATHLE_CONFIG.CLUB_NAME || ''),
    ligue: String(options.ligue || ATHLE_CONFIG.CLUB_LIGUE || ''),
    department: String(options.department || ATHLE_CONFIG.CLUB_DEPARTEMENT || ''),
  };
  if (!club.id) throw new Error('CLUB_ID manquant pour les bilans athlètes');

  var year = options.year != null ? Number(options.year) : athleBilansYear();
  var bilansCategories =
    options.bilansCategories || ATHLE_CONFIG.BILANS_YOUTH_CATEGORIES || ['BE', 'MI'];

  var byId = {};
  var performanceRows = 0;

  for (var c = 0; c < bilansCategories.length; c++) {
    var cat = bilansCategories[c];
    Logger.log(
      'Bilans %s — %s',
      cat,
      athleBuildBilansUrl({
        clubId: club.id,
        ligue: club.ligue,
        department: club.department,
        year: year,
        category: cat,
        position: 0,
      }),
    );
    var rows = athleFetchBilansRowsForCategory(club, year, cat);
    performanceRows += rows.length;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row.athleteId) continue;
      var parsedCat = athleParseBilansAthleteCategory(row.category);
      var current = byId[row.athleteId];
      if (!current) {
        byId[row.athleteId] = {
          athleteId: row.athleteId,
          name: row.name,
          categoryCode: parsedCat.code,
          youthCategory: parsedCat.youthCategory,
          events: [],
        };
      } else {
        if (!current.name && row.name) current.name = row.name;
        if (parsedCat.code) current.categoryCode = parsedCat.code;
        if (parsedCat.youthCategory) current.youthCategory = parsedCat.youthCategory;
      }
    }
  }

  var fromCompetitions = 0;
  if (options.includeCompetitionAthletes !== false) {
    fromCompetitions = athleMergeAthletesFromCompetitionDetails(byId);
    Logger.log('Athlètes ajoutés depuis les compétitions R2 : %s', fromCompetitions);
  }

  var athletes = [];
  for (var id in byId) athletes.push(byId[id]);
  athletes.sort(function (a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });

  var enrich =
    options.enrichProfiles != null
      ? !!options.enrichProfiles
      : !!(typeof ATHLE_CONFIG !== 'undefined' && ATHLE_CONFIG.ENRICH_ATHLETE_PROFILES);
  var enriched = 0;
  var enrichErrors = 0;
  if (enrich) {
    Logger.log('Enrichissement fiches athlètes (%s) pour PB/SB…', athletes.length);
    for (var a = 0; a < athletes.length; a++) {
      try {
        athleMaybeSleep();
        athleEnrichAthleteFromProfile(athletes[a]);
        enriched += 1;
      } catch (err) {
        enrichErrors += 1;
        Logger.log(
          '  ERREUR fiche %s (%s) : %s',
          athletes[a].athleteId,
          athletes[a].name,
          err.message || err,
        );
      }
    }
  }

  return {
    _stats: {
      performanceRows: performanceRows,
      fromCompetitions: fromCompetitions,
      enrichedProfiles: enriched,
      enrichErrors: enrichErrors,
      seasonYear: year,
      count: athletes.length,
    },
    athletes: athletes,
  };
}

/**
 * Complète la base avec les athlètes présents dans les JSON compétition R2
 * (ex. U14 absents des bilans mais présents en meeting).
 */
function athleMergeAthletesFromCompetitionDetails(byId) {
  var keys = r2ListObjectKeys();
  var added = 0;
  for (var i = 0; i < keys.length; i++) {
    var name = athleR2RelativeName(keys[i]);
    if (!/^\d{4}-\d{2}-\d{2}_.+\.json$/i.test(name)) continue;
    if (name.indexOf('_ERROR_') !== -1) continue;
    var detail = null;
    try {
      detail = r2DownloadJsonByObjectKey(keys[i]);
    } catch (err) {
      Logger.log('  skip détail %s : %s', name, err.message || err);
      continue;
    }
    if (!detail || !detail.epreuves) continue;
    for (var e = 0; e < detail.epreuves.length; e++) {
      var parts = detail.epreuves[e].participants || [];
      for (var p = 0; p < parts.length; p++) {
        var part = parts[p];
        var athleteId = part.athleteId ? String(part.athleteId) : '';
        if (!athleteId) continue;
        var parsedCat = athleParseBilansAthleteCategory(part.category || '');
        if (byId[athleteId]) {
          if (!byId[athleteId].name && part.athleteName) byId[athleteId].name = part.athleteName;
          if (!byId[athleteId].categoryCode && parsedCat.code) {
            byId[athleteId].categoryCode = parsedCat.code;
            byId[athleteId].youthCategory = parsedCat.youthCategory;
          }
          continue;
        }
        byId[athleteId] = {
          athleteId: athleteId,
          name: part.athleteName || athleteId,
          categoryCode: parsedCat.code,
          youthCategory: parsedCat.youthCategory,
          events: [],
        };
        added += 1;
      }
    }
  }
  return added;
}

function athleBuildAthleteProfileUrl(athleteId) {
  return ATHLE_SITE + '/athletes/' + encodeURIComponent(String(athleteId));
}

/**
 * Enrichit un athlète avec les PB/SB depuis sa fiche profil (format compact).
 */
function athleEnrichAthleteFromProfile(athlete) {
  var html = athleFetchHtml(athleBuildAthleteProfileUrl(athlete.athleteId));
  var identity = athleParseAthleteProfileIdentity(html);
  if (identity.categoryCode) {
    if (!athlete.categoryCode) athlete.categoryCode = identity.categoryCode;
    if (!athlete.youthCategory) {
      athlete.youthCategory = athleYouthCategoryFromBilansCode(identity.categoryCode);
    }
  }
  athlete.events = athleParseAthleteSeasonBests(html, { detailed: false });
  return athlete;
}

/**
 * Fiche athlète complète (identité + bests détaillés + résultats récents).
 * @param {string} athleteId
 * @param {Object=} seed champs déjà connus (name, categoryCode, …)
 */
function athleFetchAthleteFullDetail(athleteId, seed) {
  seed = seed || {};
  var id = String(athleteId);
  var profileUrl = athleBuildAthleteProfileUrl(id);
  var html = athleFetchHtml(profileUrl);
  var identity = athleParseAthleteProfileIdentity(html);
  var categoryCode = identity.categoryCode || seed.categoryCode || null;
  var youthCategory =
    athleYouthCategoryFromBilansCode(categoryCode) || seed.youthCategory || null;

  return {
    athleteId: id,
    name: identity.displayName || seed.name || id,
    profileUrl: profileUrl,
    fetchedAt: new Date().toISOString(),
    birthYear: identity.birthYear,
    licence: identity.licence,
    sex: identity.sex || null,
    categoryCode: categoryCode,
    youthCategory: youthCategory,
    club: {
      id: String(seed.clubId || ATHLE_CONFIG.CLUB_ID || ''),
      name: identity.clubName || seed.clubName || ATHLE_CONFIG.CLUB_NAME || '',
    },
    events: athleParseAthleteSeasonBests(html, { detailed: true }),
    recentResults: athleParseAthleteRecentResults(html),
  };
}

/**
 * Index compact dérivé d’une fiche détaillée (pour athletes.json).
 */
function athleCompactAthleteFromDetail(detail) {
  return {
    athleteId: detail.athleteId,
    name: detail.name,
    categoryCode: detail.categoryCode,
    youthCategory: detail.youthCategory,
    events: (detail.events || []).map(function (entry) {
      var out = { event: entry.event };
      if (entry.pb) out.pb = entry.pb;
      if (entry.sb) out.sb = entry.sb;
      return out;
    }),
  };
}

function athleParseAthleteProfileIdentity(html) {
  var birth = html.match(/Né\(e\)\s*en\s*:\s*<\/span>\s*(\d{4})/i);
  var club = html.match(/Club\s*:\s*<\/span>\s*([^<]+)/i);
  var licence = html.match(/N°\s*de\s*licence[^:]*:\s*<\/span>\s*([^<]+)/i);
  var cat = html.match(
    /Catégorie\s*\/\s*Nationalité\s*:\s*<\/span>\s*([A-Za-z]{1,4})\s*(?:<span[^>]*>\s*\/\s*<\/span>\s*([A-Za-z]))?/i,
  );
  var sex = cat && cat[2] ? String(cat[2]).toUpperCase() : null;
  var nameMatch = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  return {
    displayName: nameMatch ? athleStripHtml(nameMatch[1]) : null,
    birthYear: birth ? Number(birth[1]) : null,
    clubName: club ? athleStripHtml(club[1]) : null,
    licence: licence ? athleStripHtml(licence[1]) : null,
    categoryCode: cat ? String(cat[1]).toUpperCase() : null,
    sex: sex === 'F' || sex === 'M' ? sex : null,
  };
}

/**
 * Tableau « résultats récents » de la fiche (avant les meilleures perfs).
 */
function athleParseAthleteRecentResults(html) {
  var end = html.indexOf('Meilleures performances par saison');
  var chunk = end === -1 ? html : html.substring(0, end);
  var tableMatch = chunk.match(
    /<table[^>]*class="[^"]*base-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i,
  );
  if (!tableMatch) return [];
  var body = tableMatch[1];
  if (!/Epreuve/i.test(body) || !/Performance/i.test(body)) return [];

  var minYear = athleMinPerformanceYear();
  var rows = [];
  var trRe = /<tr(?![^>]*detail-row)[^>]*>([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRe.exec(body)) !== null) {
    var chunkTr = trMatch[1];
    if (/<th\b/i.test(chunkTr)) continue;
    var tds = [];
    var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdMatch;
    while ((tdMatch = tdRe.exec(chunkTr)) !== null) {
      tds.push(athleStripHtml(tdMatch[1]));
    }
    // Date | Epreuve | Performance | Vent | Tour | Place | Niveau | Points | Lieu
    if (tds.length < 6) continue;
    if (!tds[0] || !tds[1]) continue;
    var yearInDate = athleYearFromDateLabel(tds[0]);
    // Si l’année est connue et trop ancienne, on ignore ; sinon on garde (table « récente »).
    if (yearInDate != null && yearInDate < minYear) continue;
    rows.push({
      date: tds[0] || null,
      event: tds[1] || null,
      performance: athleCompactMark(tds[2] || ''),
      wind: tds[3] || null,
      round: tds[4] || null,
      place: tds[5] || null,
      level: tds[6] || null,
      points: tds[7] || null,
      venue: tds[8] || null,
    });
  }
  return rows;
}

/** Extrait une année 20xx depuis un libellé de date FFA, sinon null. */
function athleYearFromDateLabel(dateLabel) {
  var match = String(dateLabel || '').match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/** Nettoie une marque : retire vent / mentions entre parenthèses. */
function athleCompactMark(perf) {
  return String(perf || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Section « Meilleures performances par saison » de la fiche athlète.
 * @param {string} html
 * @param {{detailed?: boolean}=} options detailed=true conserve bySeason[]
 */
function athleParseAthleteSeasonBests(html, options) {
  options = options || {};
  var detailed = !!options.detailed;
  var marker = 'Meilleures performances par saison';
  var start = html.indexOf(marker);
  if (start === -1) return [];
  var rest = html.substring(start);
  var endMatch = rest.substring(marker.length).match(/<h3\b/i);
  var section = endMatch ? rest.substring(0, marker.length + endMatch.index) : rest.substring(0, 40000);

  var parts = section.split(/<div class="headers text-normal mb-10">/i);
  var events = [];
  for (var i = 1; i < parts.length; i++) {
    var part = parts[i];
    var nameMatch = part.match(/^([^<]+)<\/div>/i);
    if (!nameMatch) continue;
    var eventName = athleStripHtml(nameMatch[1]);
    if (!eventName) continue;
    var body = part.substring(nameMatch[0].length);
    var bySeason = [];
    var trRe = /<tr(?![^>]*detail-row)[^>]*>([\s\S]*?)<\/tr>/gi;
    var trMatch;
    while ((trMatch = trRe.exec(body)) !== null) {
      var chunk = trMatch[1];
      if (/<th\b/i.test(chunk)) continue;
      if (/no-border-no-padding/i.test(trMatch[0])) continue;
      var tds = [];
      var tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      var tdMatch;
      while ((tdMatch = tdRe.exec(chunk)) !== null) {
        tds.push(tdMatch[1]);
      }
      if (tds.length < 3) continue;
      var season = athleStripHtml(tds[0]);
      if (!/^\d{4}$/.test(season)) continue;
      var perfHtml = tds[2];
      bySeason.push({
        season: season,
        date: athleStripHtml(tds[1]),
        performance: athleStripHtml(perfHtml),
        club: tds[3] ? athleStripHtml(tds[3]) : null,
        place: tds[5] ? athleStripHtml(tds[5]) : null,
        highlighted: /<b\b/i.test(perfHtml),
      });
    }
    bySeason = athleFilterSeasonsFromMinYear(bySeason);
    if (!bySeason.length) continue;
    events.push(athleBuildEventBests(eventName, bySeason, detailed));
  }
  return events;
}

/** Garde uniquement les saisons >= N-1 (voir ATHLETE_PERF_MIN_YEAR_OFFSET). */
function athleFilterSeasonsFromMinYear(bySeason) {
  var minYear = athleMinPerformanceYear();
  var kept = [];
  for (var i = 0; i < (bySeason || []).length; i++) {
    var row = bySeason[i];
    if (Number(row.season) >= minYear) kept.push(row);
  }
  return kept;
}

function athleBuildEventBests(eventName, bySeason, detailed) {
  var pb = null;
  var sb = null;
  var latestSeason = null;
  // Après filtre N-1, on recalcule PB/SB sans se fier au gras FFA (souvent all-time).
  for (var i = 0; i < bySeason.length; i++) {
    var row = bySeason[i];
    if (latestSeason == null || Number(row.season) > Number(latestSeason)) {
      latestSeason = row.season;
      sb = row;
    }
    if (!pb || athleIsBetterPerformance(row.performance, pb.performance, eventName)) {
      pb = row;
    }
  }
  var out = { event: eventName };
  if (pb && pb.performance) out.pb = athleCompactMark(pb.performance);
  if (sb && sb.performance) out.sb = athleCompactMark(sb.performance);
  if (detailed) {
    out.bySeason = bySeason.map(function (row) {
      return {
        season: row.season,
        date: row.date,
        performance: athleCompactMark(row.performance),
        place: row.place,
      };
    });
  }
  return out;
}

/**
 * true si perfA est meilleure que perfB pour l’épreuve.
 */
function athleIsBetterPerformance(perfA, perfB, eventName) {
  var a = athlePerformanceMetric(perfA, eventName);
  var b = athlePerformanceMetric(perfB, eventName);
  if (a.value == null || b.value == null) return false;
  return a.lowerIsBetter ? a.value < b.value : a.value > b.value;
}

/**
 * Convertit une perf texte en valeur comparable.
 * @return {{value:number|null, lowerIsBetter:boolean}}
 */
function athlePerformanceMetric(perf, eventName) {
  var raw = String(perf || '');
  var cleaned = raw
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  var event = String(eventName || '').toLowerCase();

  var pts = cleaned.match(/(\d+(?:\.\d+)?)\s*pts/i);
  if (pts || /triathlon|pentathlon|heptathlon|décathlon|points/i.test(event)) {
    var pv = pts ? Number(pts[1]) : Number((cleaned.match(/(\d+(?:\.\d+)?)/) || [])[1]);
    return { value: isNaN(pv) ? null : pv, lowerIsBetter: false };
  }

  // Distance / hauteur : 3m98, 13m17, 1m02
  var dist = cleaned.match(/(\d+)\s*m\s*(\d+)/i);
  if (dist) {
    var decimals = dist[2].length;
    var meters = Number(dist[1]) + Number(dist[2]) / Math.pow(10, decimals);
    return { value: meters, lowerIsBetter: false };
  }

  // Temps : 3'58''04 | 9''39 | 1°02'' | 58''04
  var time = cleaned.match(/(?:(\d+)['’°])?(\d+)[''″"]{1,2}(\d+)?/);
  if (time) {
    var min = time[1] ? Number(time[1]) : 0;
    var sec = Number(time[2]);
    var hun = time[3] ? Number(time[3]) / Math.pow(10, time[3].length) : 0;
    return { value: min * 60 + sec + hun, lowerIsBetter: true };
  }

  var plain = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (plain) {
    var lower =
      /m\b|haies|steeple|marche|course|relais|\/|sprint/i.test(event) &&
      !/hauteur|longueur|triple|poids|disque|javelot|marteau|perche/i.test(event);
    return { value: Number(plain[1]), lowerIsBetter: lower };
  }
  return { value: null, lowerIsBetter: true };
}
