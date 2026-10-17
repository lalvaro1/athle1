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
