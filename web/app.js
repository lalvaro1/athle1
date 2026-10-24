const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const statusEl = document.querySelector("#status");
const competitionSelect = document.querySelector("#competition-select");
const planningEl = document.querySelector("#planning");
const planningTitleEl = document.querySelector("#planning-title");
const planningMetaEl = document.querySelector("#planning-meta");
const planningPlaceEl = document.querySelector("#planning-place");
const scheduleEl = document.querySelector("#schedule");
const athleteSelect = document.querySelector("#athlete-select");
const athleteStatusEl = document.querySelector("#athlete-status");
const athletePanelEl = document.querySelector("#athlete-panel");
const athletePanelTitleEl = document.querySelector("#athlete-panel-title");
const athletePanelMetaEl = document.querySelector("#athlete-panel-meta");
const athletePanelCountEl = document.querySelector("#athlete-panel-count");
const athletePanelBodyEl = document.querySelector("#athlete-panel-body");
const athleteDialog = document.querySelector("#athlete-dialog");
const athleteDialogTitle = document.querySelector("#athlete-dialog-title");
const athleteDialogMeta = document.querySelector("#athlete-dialog-meta");
const athleteDialogBody = document.querySelector("#athlete-dialog-body");
const tabButtons = [...document.querySelectorAll(".tabs__btn")];
const tabCompetitions = document.querySelector("#tab-competitions");
const tabAthletes = document.querySelector("#tab-athletes");
const tabEvents = document.querySelector("#tab-events");
const eventSelect = document.querySelector("#event-select");
const eventStatusEl = document.querySelector("#event-status");
const eventPanelEl = document.querySelector("#event-panel");
const eventPanelTitleEl = document.querySelector("#event-panel-title");
const eventPanelCountEl = document.querySelector("#event-panel-count");
const eventPanelBodyEl = document.querySelector("#event-panel-body");
const athleteFilterButtons = [...document.querySelectorAll("[data-athlete-filter]")];
const eventFilterButtons = [...document.querySelectorAll("[data-event-filter]")];

/** Scroll Y figé pendant l’ouverture de la modale (iOS). */
let dialogScrollLockY = 0;

const params = new URLSearchParams(location.search);
let activeTab = ["athletes", "events"].includes(params.get("tab"))
  ? params.get("tab")
  : "competitions";
let selectedId = params.get("competition");
let selectedAthleteId = params.get("athlete");
let selectedEventKey = params.get("event");
let eventRankingRequestId = 0;
/** @type {Array<Record<string, any>>} */
let competitions = [];
/** @type {Array<Record<string, any>>} */
let athletesList = [];
/** @type {Map<string, Record<string, any>>} */
const athletesById = new Map();
/** @type {Map<string, Record<string, any>>} */
const athletesByNameKey = new Map();
/** @type {Map<string, Record<string, any>>} */
const athleteDetailsById = new Map();
/** @type {Map<string, { direction: "lower"|"higher", scale: Array<{points:number,value:number}> }>} */
const cotationsByCategoryEvent = new Map();
const athleteFilters = { sex: "all", youth: "all" };
const eventFilters = { sex: "all", youth: "all" };

competitionSelect.addEventListener("change", () => {
  selectedId = competitionSelect.value || null;
  syncUrl();
  const chosen = competitions.find((comp) => String(comp.resultsId) === String(selectedId));
  if (chosen) loadCompetition(chosen);
});

athleteSelect.addEventListener("change", () => {
  selectedAthleteId = athleteSelect.value || null;
  syncUrl();
  if (selectedAthleteId) showAthletePanelById(selectedAthleteId);
  else {
    athletePanelEl.hidden = true;
    athletePanelBodyEl.replaceChildren();
  }
});

eventSelect.addEventListener("change", () => {
  selectedEventKey = eventSelect.value || null;
  syncUrl();
  if (selectedEventKey) showEventRanking(selectedEventKey);
  else eventPanelEl.hidden = true;
});

for (const button of athleteFilterButtons) {
  button.addEventListener("click", () => {
    setPickerFilter(athleteFilters, athleteFilterButtons, button);
    refreshAthletePicker();
  });
}

for (const button of eventFilterButtons) {
  button.addEventListener("click", () => {
    setPickerFilter(eventFilters, eventFilterButtons, button);
    refreshEventPicker();
  });
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab || "competitions";
    setActiveTab(tab);
    if (tab === "events" && selectedEventKey) showEventRanking(selectedEventKey);
  });
}

if (athleteDialog) {
  athleteDialog.addEventListener("close", unlockDialogScroll);
  athleteDialog.addEventListener("cancel", unlockDialogScroll);
}

scheduleEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-athlete-key]");
  if (!target) return;
  openAthleteDialog(
    target.dataset.athleteKey,
    target.dataset.eventName || "",
    target.dataset.athleteName || "",
  );
});

boot();

async function boot() {
  statusEl.textContent = "Chargement…";
  athleteStatusEl.textContent = "Chargement…";
  planningEl.hidden = true;
  athletePanelEl.hidden = true;
  scheduleEl.replaceChildren();
  setActiveTab(activeTab, { skipUrl: true });

  try {
    const [competitionsPayload] = await Promise.all([
      fetchJson("competitions.json", { competitions: [] }),
      loadAthletesIndex(),
      loadCotations(),
    ]);

    fillAthleteSelect(athletesList);
    const eventOptions = buildEventOptions(athletesList);
    fillEventSelect(eventOptions);

    competitions = sortCompetitionsNewestFirst(competitionsPayload.competitions || []);
    if (!competitions.length) {
      competitionSelect.replaceChildren(new Option("Aucune compétition", ""));
      competitionSelect.disabled = true;
      statusEl.textContent = "0 compétition";
    } else {
      fillCompetitionSelect(competitions);
      const chosen =
        competitions.find((comp) => String(comp.resultsId) === String(selectedId)) ||
        competitions[0];
      selectedId = String(chosen.resultsId);
      competitionSelect.value = selectedId;
      competitionSelect.disabled = false;
      statusEl.textContent =
        competitions.length === 1 ? "1 compétition" : `${competitions.length} compétitions`;
      await loadCompetition(chosen);
    }

    if (selectedAthleteId && athletesById.has(String(selectedAthleteId))) {
      athleteSelect.value = String(selectedAthleteId);
      await showAthletePanelById(selectedAthleteId);
    } else if (athletesList.length) {
      selectedAthleteId = String(athletesList[0].athleteId);
      athleteSelect.value = selectedAthleteId;
      await showAthletePanelById(selectedAthleteId);
    }

    if (eventOptions.length) {
      const selected =
        eventOptions.find((entry) => entry.key === selectedEventKey) || eventOptions[0];
      selectedEventKey = selected.key;
      eventSelect.value = selectedEventKey;
      if (activeTab === "events") await showEventRanking(selectedEventKey);
    }

    syncUrl();
  } catch (error) {
    competitionSelect.replaceChildren(new Option("Chargement impossible", ""));
    competitionSelect.disabled = true;
    statusEl.textContent = "Chargement impossible";
    athleteSelect.replaceChildren(new Option("Chargement impossible", ""));
    athleteSelect.disabled = true;
    athleteStatusEl.textContent = "Chargement impossible";
    eventSelect.replaceChildren(new Option("Chargement impossible", ""));
    eventSelect.disabled = true;
    eventStatusEl.textContent = "Chargement impossible";
    console.error(error);
  }
}

function setActiveTab(tab, { skipUrl = false } = {}) {
  activeTab = ["athletes", "events"].includes(tab) ? tab : "competitions";
  const showAthletes = activeTab === "athletes";
  const showEvents = activeTab === "events";
  tabCompetitions.hidden = showAthletes || showEvents;
  tabAthletes.hidden = !showAthletes;
  tabEvents.hidden = !showEvents;
  for (const button of tabButtons) {
    const on = button.dataset.tab === activeTab;
    button.classList.toggle("is-active", on);
    button.setAttribute("aria-selected", on ? "true" : "false");
  }
  if (!skipUrl) syncUrl();
}

async function fetchJson(objectKey, fallback = null) {
  const response = await fetch(dataUrl(objectKey), { cache: "no-store" });
  if (response.status === 404 && fallback != null) return fallback;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadAthletesIndex() {
  athletesById.clear();
  athletesByNameKey.clear();
  athletesList = [];
  try {
    const url = dataUrl("athletes.json");
    const payload = await fetchJson("athletes.json", { athletes: [] });
    for (const athlete of payload.athletes || []) {
      if (!athlete?.athleteId) continue;
      athletesById.set(String(athlete.athleteId), athlete);
      const key = athleteNameKey(athlete.name);
      if (key) athletesByNameKey.set(key, athlete);
      athletesList.push(athlete);
    }
    athletesList.sort((a, b) =>
      formatAthleteName(a.name).localeCompare(formatAthleteName(b.name), "fr"),
    );
    console.info(`athletes.json OK (${athletesById.size}) ← ${url}`);
  } catch (error) {
    console.warn("athletes.json indisponible", error);
  }
}

async function loadCotations() {
  cotationsByCategoryEvent.clear();
  try {
    const urls = [
      `${R2_ORIGIN}/cotations-jeunes.csv`,
      `${R2_ORIGIN}/${R2_DATA_PREFIX}/cotations-jeunes.csv`,
    ];
    let response = null;
    for (const url of urls) {
      const candidate = await fetch(url, { cache: "no-store" });
      if (candidate.ok) {
        response = candidate;
        break;
      }
    }
    if (!response) throw new Error("CSV introuvable à la racine R2 ou dans data/");
    const rows = parseSimpleCsv(await response.text());
    const headers = rows.shift() || [];
    const pointColumns = headers.slice(2).map(Number);

    for (const row of rows) {
      const category = String(row[0] || "").trim().toUpperCase();
      const event = normalizeCotationEvent(row[1]);
      if (!category || !event) continue;
      const scale = pointColumns
        .map((points, index) => ({ points, value: Number(row[index + 2]) }))
        .filter((entry) => Number.isFinite(entry.points) && Number.isFinite(entry.value));
      if (!scale.length) continue;
      cotationsByCategoryEvent.set(`${category}:${event}`, {
        direction: scale[0].value <= scale.at(-1).value ? "lower" : "higher",
        scale,
      });
    }
    console.info(`Cotations jeunes OK (${cotationsByCategoryEvent.size} épreuves)`);
  } catch (error) {
    console.warn("cotations-jeunes.csv indisponible", error);
  }
}

function parseSimpleCsv(text) {
  return String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(","));
}

function fillAthleteSelect(list) {
  if (!list.length) {
    athleteSelect.replaceChildren(new Option("Aucun athlète", ""));
    athleteSelect.disabled = true;
    athleteStatusEl.textContent = "0 athlète";
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const athlete of list) {
    const label = [
      formatAthleteName(athlete.name),
      athlete.youthCategory,
      athlete.categoryCode,
    ]
      .filter(Boolean)
      .join(" · ");
    fragment.append(new Option(label, String(athlete.athleteId)));
  }
  athleteSelect.replaceChildren(fragment);
  athleteSelect.disabled = false;
  athleteStatusEl.textContent = list.length === 1 ? "1 athlète" : `${list.length} athlètes`;
}

function setPickerFilter(state, buttons, selectedButton) {
  const key =
    selectedButton.dataset.athleteFilter || selectedButton.dataset.eventFilter;
  if (!key) return;
  state[key] = selectedButton.dataset.value || "all";
  for (const button of buttons) {
    const buttonKey = button.dataset.athleteFilter || button.dataset.eventFilter;
    if (buttonKey !== key) continue;
    const active = button === selectedButton;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function athleteSex(athlete) {
  const fromCode = String(athlete?.categoryCode || "").toUpperCase().match(/[FM]$/);
  return fromCode?.[0] || String(athlete?.sex || "").toUpperCase();
}

function athleteYouthCategory(athlete) {
  const youth = String(athlete?.youthCategory || "").toUpperCase();
  if (youth === "U14" || youth === "U16") return youth;
  const code = String(athlete?.categoryCode || "").toUpperCase();
  if (code.startsWith("BE")) return "U14";
  if (code.startsWith("MI")) return "U16";
  return "";
}

function athleteMatchesFilters(athlete, filters) {
  return (
    (filters.sex === "all" || athleteSex(athlete) === filters.sex) &&
    (filters.youth === "all" || athleteYouthCategory(athlete) === filters.youth)
  );
}

function refreshAthletePicker() {
  const filtered = athletesList.filter((athlete) =>
    athleteMatchesFilters(athlete, athleteFilters),
  );
  fillAthleteSelect(filtered);
  if (!filtered.length) {
    selectedAthleteId = null;
    athletePanelEl.hidden = true;
    athletePanelBodyEl.replaceChildren();
    syncUrl();
    return;
  }
  const selected =
    filtered.find((athlete) => String(athlete.athleteId) === String(selectedAthleteId)) ||
    filtered[0];
  selectedAthleteId = String(selected.athleteId);
  athleteSelect.value = selectedAthleteId;
  showAthletePanelById(selectedAthleteId);
  syncUrl();
}

function refreshEventPicker() {
  const filteredAthletes = athletesList.filter((athlete) =>
    athleteMatchesFilters(athlete, eventFilters),
  );
  const options = buildEventOptions(filteredAthletes);
  fillEventSelect(options);
  if (!options.length) {
    selectedEventKey = null;
    eventPanelEl.hidden = true;
    eventPanelBodyEl.replaceChildren();
    syncUrl();
    return;
  }
  const selected = options.find((entry) => entry.key === selectedEventKey) || options[0];
  selectedEventKey = selected.key;
  eventSelect.value = selectedEventKey;
  if (activeTab === "events") showEventRanking(selectedEventKey);
  syncUrl();
}

function buildEventOptions(athletes) {
  const byKey = new Map();
  for (const athlete of athletes) {
    for (const entry of athlete.events || []) {
      const key = normalizeCotationEvent(entry.event);
      if (!key) continue;
      const label = eventDisplayName(entry.event);
      const current = byKey.get(key);
      if (!current || label.length < current.label.length) byKey.set(key, { key, label });
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "fr", { numeric: true }),
  );
}

function eventDisplayName(value) {
  return String(value || "")
    .replace(/\s*\/\s*(?:BEF|BEM|MIF|MIM)\b/gi, "")
    .replace(/\((?:19|20)\d{2}\)/g, "")
    .replace(/\b(?:Piste Courte|Salle)\b/gi, "")
    .replace(/\s*-\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fillEventSelect(options) {
  if (!options.length) {
    eventSelect.replaceChildren(new Option("Aucune épreuve", ""));
    eventSelect.disabled = true;
    eventStatusEl.textContent = "0 épreuve";
    return;
  }
  eventSelect.replaceChildren(
    ...options.map((entry) => new Option(entry.label, entry.key)),
  );
  eventSelect.disabled = false;
  eventStatusEl.textContent =
    options.length === 1 ? "1 épreuve" : `${options.length} épreuves`;
}

async function showEventRanking(eventKey) {
  const requestId = ++eventRankingRequestId;
  const candidates = athletesList.filter(
    (athlete) =>
      athleteMatchesFilters(athlete, eventFilters) &&
      (athlete.events || []).some(
        (entry) => normalizeCotationEvent(entry.event) === eventKey,
      ),
  );
  const label =
    [...eventSelect.options].find((option) => option.value === eventKey)?.textContent ||
    "Épreuve";

  eventPanelEl.hidden = false;
  eventPanelTitleEl.textContent = label;
  eventPanelCountEl.textContent = "…";
  eventPanelBodyEl.replaceChildren(message("Chargement du classement…"));

  const records = await Promise.all(
    candidates.map(async (summary) => (await loadAthleteDetail(summary.athleteId)) || summary),
  );
  if (requestId !== eventRankingRequestId || eventKey !== selectedEventKey) return;

  const ranking = records
    .map((athlete) => buildEventRankingEntry(athlete, eventKey))
    .filter(Boolean)
    .sort(compareEventRankingEntries);

  eventPanelCountEl.textContent =
    ranking.length === 1 ? "1 athlète" : `${ranking.length} athlètes`;
  eventPanelBodyEl.replaceChildren();
  if (!ranking.length) {
    eventPanelBodyEl.append(message("Aucune performance disponible."));
    return;
  }

  ranking.forEach((row, index) => {
    eventPanelBodyEl.append(renderEventRankingRow(row, index + 1, label));
  });
}

function buildEventRankingEntry(athlete, eventKey) {
  const entries = (athlete.events || []).filter(
    (entry) => normalizeCotationEvent(entry.event) === eventKey && entry.pb,
  );
  if (!entries.length) return null;

  const scored = entries.map((entry) => {
    const year = performanceYearForBest(entry, entry.pb);
    const score = getPerformanceScore(athlete, entry.event, entry.pb, year);
    const category = score?.category || athleteCotationCategory(athlete, year);
    const cotation = category
      ? cotationsByCategoryEvent.get(`${category}:${eventKey}`)
      : null;
    return {
      athlete,
      event: entry.event,
      performance: entry.pb,
      year,
      score,
      direction: cotation?.direction || null,
      value: cotation ? parsePerformanceValue(entry.pb, cotation.direction) : NaN,
    };
  });
  scored.sort(compareEventRankingEntries);
  return scored[0];
}

function compareEventRankingEntries(a, b) {
  const pointsA = a.score?.points ?? -1;
  const pointsB = b.score?.points ?? -1;
  if (pointsA !== pointsB) return pointsB - pointsA;
  if (Number.isFinite(a.value) && Number.isFinite(b.value) && a.value !== b.value) {
    return a.direction === "higher" ? b.value - a.value : a.value - b.value;
  }
  return formatAthleteName(a.athlete.name).localeCompare(
    formatAthleteName(b.athlete.name),
    "fr",
  );
}

function renderEventRankingRow(row, rank, eventLabel) {
  const item = document.createElement("article");
  item.className = "event-ranking__row";

  const rankEl = document.createElement("span");
  rankEl.className = "event-ranking__rank";
  rankEl.textContent = String(rank);

  const identity = document.createElement("div");
  identity.className = "event-ranking__identity";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "event-ranking__athlete";
  button.textContent = formatAthleteName(row.athlete.name);
  button.addEventListener("click", () =>
    openAthleteDialog(
      `id:${row.athlete.athleteId}`,
      row.event || eventLabel,
      row.athlete.name,
    ),
  );
  const meta = document.createElement("span");
  meta.textContent = [row.score?.category, row.year].filter(Boolean).join(" · ");
  identity.append(button, meta);

  const performance = document.createElement("strong");
  performance.className = "event-ranking__performance";
  performance.textContent = row.performance;

  item.append(rankEl, identity, performance);
  if (row.score) item.append(renderPerformanceIndicator(row.score));
  return item;
}

async function showAthletePanelById(athleteId) {
  const id = String(athleteId || "");
  const summary = athletesById.get(id);
  if (!summary) {
    athletePanelEl.hidden = true;
    athletePanelBodyEl.replaceChildren();
    return;
  }

  athletePanelEl.hidden = false;
  athletePanelTitleEl.textContent = formatAthleteName(summary.name);
  athletePanelMetaEl.textContent = "Chargement de la fiche…";
  athletePanelCountEl.textContent = "…";
  athletePanelBodyEl.replaceChildren(
    Object.assign(document.createElement("p"), {
      className: "empty",
      textContent: "Chargement des performances…",
    }),
  );

  const detail = await loadAthleteDetail(id);
  if (id !== String(selectedAthleteId || "")) return;
  const athlete = detail || summary;
  renderAthletePanel(athlete, Boolean(detail));
}

async function loadAthleteDetail(athleteId) {
  const id = String(athleteId || "");
  if (!id) return null;
  if (athleteDetailsById.has(id)) return athleteDetailsById.get(id);
  try {
    const detail = await fetchJson(`athletes/${id}.json`, null);
    if (detail?.athleteId) {
      athleteDetailsById.set(id, detail);
      return detail;
    }
  } catch (error) {
    console.warn(`Fiche athletes/${id}.json indisponible`, error);
  }
  return null;
}

function renderAthletePanel(athlete, fromDetail) {
  athletePanelTitleEl.textContent = formatAthleteName(athlete.name);
  athletePanelMetaEl.textContent = athleteIdentityLine(athlete);
  const events = athlete.events || [];
  const recent = athlete.recentResults || [];
  athletePanelCountEl.textContent =
    events.length === 1 ? "1 épreuve" : `${events.length} épreuves`;

  athletePanelBodyEl.replaceChildren();
  athletePanelBodyEl.append(renderAthleteFacts(athlete, fromDetail));

  if (events.length) {
    athletePanelBodyEl.append(renderSectionTitle("Meilleures performances"));
    for (const entry of events) {
      athletePanelBodyEl.append(
        renderAthleteEventCard(entry, false, { showSeasons: true, athlete }),
      );
    }
  }

  if (recent.length) {
    athletePanelBodyEl.append(renderSectionTitle("Résultats récents"));
    athletePanelBodyEl.append(renderRecentResults(recent, athlete));
  }

  if (!events.length && !recent.length) {
    athletePanelBodyEl.append(
      Object.assign(document.createElement("p"), {
        className: "empty",
        textContent: fromDetail
          ? "Aucune performance récente pour cet athlète."
          : "Fiche détaillée indisponible — affichage de l’index compact.",
      }),
    );
  }
}

function athleteIdentityLine(athlete) {
  return [athlete.youthCategory, athlete.categoryCode, athlete.sex, athlete.birthYear]
    .filter(Boolean)
    .join(" · ");
}

function renderSectionTitle(text) {
  return Object.assign(document.createElement("h3"), {
    className: "athlete-section-title",
    textContent: text,
  });
}

function renderAthleteFacts(athlete, fromDetail) {
  const wrap = document.createElement("div");
  wrap.className = "athlete-facts";

  const list = document.createElement("dl");
  list.className = "athlete-facts__list";

  // Naissance / catégorie déjà dans le sous-titre du header → on évite la redondance.
  const facts = [
    athlete.licence ? { label: "Licence", value: String(athlete.licence) } : null,
    athlete.club?.name ? { label: "Club", value: athlete.club.name } : null,
    !athlete.youthCategory && athlete.categoryCode
      ? { label: "Code", value: athlete.categoryCode }
      : null,
  ].filter(Boolean);

  for (const fact of facts) {
    const row = document.createElement("div");
    row.className = "athlete-facts__item";
    row.append(
      Object.assign(document.createElement("dt"), { textContent: fact.label }),
      Object.assign(document.createElement("dd"), { textContent: fact.value }),
    );
    list.append(row);
  }

  if (!facts.length && !fromDetail) {
    const row = document.createElement("div");
    row.className = "athlete-facts__item";
    row.append(
      Object.assign(document.createElement("dt"), { textContent: "Source" }),
      Object.assign(document.createElement("dd"), { textContent: "Index compact" }),
    );
    list.append(row);
  }

  wrap.append(list);

  if (athlete.profileUrl) {
    const link = document.createElement("a");
    link.className = "athlete-facts__link";
    link.href = athlete.profileUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Voir sur athle.fr";
    wrap.append(link);
  }

  return wrap;
}

function renderRecentResults(results, athlete) {
  const list = document.createElement("div");
  list.className = "athlete-results";
  for (const row of results) {
    const item = document.createElement("article");
    item.className = "athlete-result";

    const when = document.createElement("div");
    when.className = "athlete-result__date";
    when.textContent = [row.date, row.venue].filter(Boolean).join(" · ");

    const main = document.createElement("div");
    main.className = "athlete-result__main";
    const event = document.createElement("div");
    event.className = "athlete-result__event";
    event.textContent = row.event || "Épreuve";
    main.append(event);
    const meta = [row.round, row.place ? `${row.place}e` : "", row.points ? `${row.points} pts` : ""]
      .filter(Boolean)
      .join(" · ");
    if (meta) {
      main.append(
        Object.assign(document.createElement("div"), {
          className: "athlete-result__meta",
          textContent: meta,
        }),
      );
    }

    const perf = document.createElement("div");
    perf.className = "athlete-result__performance";
    perf.append(
      Object.assign(document.createElement("div"), {
        className: "athlete-result__perf",
        textContent: row.performance || "—",
      }),
    );
    const score = getPerformanceScore(
      athlete,
      row.event,
      row.performance,
      performanceYearFromRow(row, athlete),
    );
    if (score != null) perf.append(renderPerformanceIndicator(score));

    item.append(when, main, perf);
    list.append(item);
  }
  return list;
}

function sortCompetitionsNewestFirst(list) {
  return [...list].sort((a, b) => {
    const da = competitionSortDate(a);
    const db = competitionSortDate(b);
    if (da !== db) return db.localeCompare(da);
    return String(a.calendarLabel || a.resultsTitle || "").localeCompare(
      String(b.calendarLabel || b.resultsTitle || ""),
      "fr",
    );
  });
}

function competitionSortDate(comp) {
  const dates = Array.isArray(comp.dates) && comp.dates.length ? comp.dates : [];
  const candidates = [comp.date, ...dates].filter(Boolean).map(String);
  if (!candidates.length) return "";
  return candidates.sort().at(-1);
}

function fillCompetitionSelect(list) {
  const fragment = document.createDocumentFragment();
  for (const comp of list) {
    const label = competitionOptionLabel(comp);
    fragment.append(new Option(label, String(comp.resultsId)));
  }
  competitionSelect.replaceChildren(fragment);
}

function competitionOptionLabel(comp) {
  const date = competitionSortDate(comp);
  const title = comp.calendarLabel || comp.resultsTitle || `Compétition ${comp.resultsId}`;
  const when = date ? formatShortDate(date) : "";
  const location = formatCompetitionLocation(comp);
  const head = when ? `${when} — ${title}` : title;
  return location ? `${head} — ${location}` : head;
}

/**
 * Ville + département depuis `place` ou la fin de `resultsTitle`
 * (ex. "… — TALENCE - N-A - 033").
 * @returns {{ city: string, department: string } | null}
 */
function competitionLocation(comp) {
  const fromPlace = parseLocationFromPlace(comp.place);
  if (fromPlace) return fromPlace;
  return parseLocationFromResultsTitle(comp.resultsTitle);
}

function parseLocationFromPlace(place) {
  const text = String(place || "").trim();
  if (!text) return null;
  const match = text.match(/^(.+?)\s+(\d{2,3})(?:\s*-\s*.*)?$/);
  if (!match) return null;
  return { city: toTitle(match[1].trim()), department: match[2] };
}

function parseLocationFromResultsTitle(resultsTitle) {
  const text = String(resultsTitle || "").trim();
  if (!text) return null;
  const tail = text.includes("—") ? text.split("—").pop().trim() : "";
  if (!tail) return null;
  // "TALENCE - N-A - 033" ou "SAINT JEAN DE LUZ - N-A - 064"
  const match = tail.match(/^(.+?)\s+-\s+\S+\s+-\s+(\d{2,3})$/);
  if (match) return { city: toTitle(match[1].trim()), department: match[2] };
  const short = tail.match(/^(.+?)\s+-\s+(\d{2,3})$/);
  if (short) return { city: toTitle(short[1].trim()), department: short[2] };
  return null;
}

function formatCompetitionLocation(comp) {
  const loc = competitionLocation(comp);
  if (!loc) return "";
  return `${loc.city} (${String(Number(loc.department))})`;
}

async function loadCompetition(comp) {
  planningEl.hidden = false;
  planningTitleEl.textContent = comp.calendarLabel || comp.resultsTitle || "Épreuves";
  const date = competitionSortDate(comp);
  const when = date ? formatLongDate(date) : "";
  const location = formatCompetitionLocation(comp);
  planningPlaceEl.textContent =
    when && location ? `${when} à ${location}` : when || location;
  planningMetaEl.textContent = "Chargement du planning…";
  scheduleEl.replaceChildren();

  const detailDate = comp.date || date;
  const baseName = sanitizeObjectFilename(comp.calendarLabel || comp.resultsTitle || comp.resultsId);
  const keys = [];
  if (comp.detailFile) keys.push(comp.detailFile);
  if (detailDate) {
    keys.push(`${detailDate}_${baseName}.json`);
    if (comp.resultsId) keys.push(`${detailDate}_${baseName}_${comp.resultsId}.json`);
  }

  try {
    let payload = null;
    for (const key of [...new Set(keys)]) {
      const response = await fetch(dataUrl(key), { cache: "no-store" });
      if (response.ok) {
        payload = await response.json();
        break;
      }
    }
    if (!payload) throw new Error("Fichier de compétition introuvable");
    const schedule = buildSchedule(payload.epreuves);
    const athleteCount = new Set(
      schedule.flatMap((slot) => slot.athletes.map((athlete) => athlete.name)),
    ).size;
    planningMetaEl.textContent =
      athleteCount === 1 ? "1 athlète" : `${athleteCount} athlètes`;
    renderSchedule(schedule);
  } catch (error) {
    planningMetaEl.textContent = "Planning indisponible";
    scheduleEl.append(message("Impossible de charger les épreuves de cette compétition."));
    console.error(error);
  }
}

function renderSchedule(schedule) {
  if (!schedule.length) {
    scheduleEl.append(message("Aucun athlète du club sur cette compétition."));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const slot of schedule) {
    const row = document.createElement("article");
    row.className = "slot";

    const time = document.createElement("time");
    time.dateTime = slot.time;
    time.textContent = slot.time;

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "event-name";
    name.textContent = slot.eventName;
    body.append(name);

    const series = uniqueSeries(slot.athletes);
    if (series.length === 1 && series[0]) {
      const seriesEl = document.createElement("div");
      seriesEl.className = "series";
      seriesEl.textContent = series[0];
      body.append(seriesEl);
    }

    const list = document.createElement("ul");
    list.className = "athletes";
    for (const athlete of slot.athletes) {
      const item = document.createElement("li");
      const athleteName = document.createElement("span");
      athleteName.className = "athlete-name";
      const extra = series.length > 1 && athlete.series ? ` · ${athlete.series}` : "";
      athleteName.textContent = `${athlete.name}${extra}`;
      item.append(athleteName);
      if (athlete.performance) {
        const perf = document.createElement("span");
        perf.className = "perf";
        perf.textContent = athlete.performance;
        item.append(perf);
      }
      item.classList.add("is-clickable");
      item.tabIndex = 0;
      item.dataset.athleteKey = athleteLookupKey(athlete);
      item.dataset.athleteName = athlete.name;
      item.dataset.eventName = slot.eventName;
      item.setAttribute("role", "button");
      item.setAttribute("aria-label", `Voir PB et SB de ${athlete.name}`);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAthleteDialog(item.dataset.athleteKey, slot.eventName, athlete.name);
        }
      });
      list.append(item);
    }
    body.append(list);
    row.append(time, body);
    fragment.append(row);
  }
  scheduleEl.replaceChildren(fragment);
}

/** athle.fr tronque souvent le libellé en tableau ; l’id d’épreuve est plus complet. */
function resolveEpreuveDisplayName(epreuve) {
  const candidates = [
    epreuve?.id,
    epreuve?.name,
    ...(epreuve?.participants || []).map((p) => p?.epreuveName),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  let best = candidates[0] || "Épreuve";
  for (const candidate of candidates) {
    if (scoreEpreuveName(candidate) > scoreEpreuveName(best)) best = candidate;
  }
  // Sur mobile surtout : on retire "/ MIF", "/ BEF", etc. pour gagner de la place.
  return best.replace(/\s*\/\s*[A-Za-z]{2,4}\s*$/, "").replace(/\s*\/\s*$/, "").trim() || best;
}

function scoreEpreuveName(name) {
  const text = String(name || "");
  let score = text.length;
  if (/\([^)]*$/.test(text)) score -= 80; // parenthèse non fermée → tronqué
  if (/\s\/\s*$/.test(text)) score -= 40; // slash final sans catégorie
  if (/\s\/\s*[A-Za-z]{2,4}\b/.test(text)) score += 40;
  if (/\)\s*\/\s*[A-Za-z]/.test(text)) score += 20;
  return score;
}

function buildSchedule(epreuves) {
  const groups = new Map();
  for (const epreuve of epreuves || []) {
    const eventName = resolveEpreuveDisplayName(epreuve);
    for (const participant of epreuve.participants || []) {
      const time = String(participant.horaire || epreuve.horaire || "—").split(",")[0].trim() || "—";
      const key = `${time}@@${eventName}`;
      if (!groups.has(key)) {
        groups.set(key, { time, eventName, athletes: [] });
      }
      groups.get(key).athletes.push({
        id: participant.athleteId ? String(participant.athleteId) : null,
        rawName: participant.athleteName || "",
        name: formatAthleteName(participant.athleteName),
        series: participant.series || "",
        performance: formatPerformance(participant.performance),
      });
    }
  }
  return [...groups.values()].sort((a, b) => {
    const delta = timeToMinutes(a.time) - timeToMinutes(b.time);
    if (delta) return delta;
    return a.eventName.localeCompare(b.eventName, "fr");
  });
}

function athleteLookupKey(athlete) {
  if (athlete?.id) return `id:${athlete.id}`;
  return `name:${athleteNameKey(athlete?.rawName || athlete?.name || "")}`;
}

function findAthleteRecord(athlete) {
  if (!athlete) return null;
  if (athlete.id && athletesById.has(athlete.id)) return athletesById.get(athlete.id);
  const key = athleteNameKey(athlete.rawName || athlete.name);
  return key ? athletesByNameKey.get(key) || null : null;
}

function findAthleteRecordByKey(lookupKey) {
  if (!lookupKey) return null;
  if (lookupKey.startsWith("id:")) return athletesById.get(lookupKey.slice(3)) || null;
  if (lookupKey.startsWith("name:")) return athletesByNameKey.get(lookupKey.slice(5)) || null;
  return null;
}

function athleteNameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function matchAthleteEvent(record, eventName) {
  const events = record?.events || [];
  if (!events.length) return null;
  const base = String(eventName || "")
    .split("/")[0]
    .trim();
  let best = null;
  let bestScore = 0;
  for (const entry of events) {
    const name = String(entry.event || "").trim();
    if (!name) continue;
    let score = 0;
    if (name === base || name === eventName) score = 100;
    else if (base.startsWith(name)) score = 80 + Math.min(name.length, 20);
    else if (name.startsWith(base)) score = 70;
    else if (base.includes(name)) score = 50;
    else if (name.includes(base)) score = 40;
    const baseSalle = /salle/i.test(base);
    const nameSalle = /salle/i.test(name);
    if (baseSalle !== nameSalle) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore > 0 ? best : null;
}

function lockDialogScroll() {
  dialogScrollLockY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add("dialog-open");
  document.body.style.position = "fixed";
  document.body.style.top = `-${dialogScrollLockY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
}

function unlockDialogScroll() {
  if (!document.documentElement.classList.contains("dialog-open")) return;
  document.documentElement.classList.remove("dialog-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, dialogScrollLockY);
}

async function openAthleteDialog(lookupKey, eventName, fallbackName = "") {
  if (!athleteDialog) return;
  const summary = findAthleteRecordByKey(lookupKey);
  const athleteId =
    summary?.athleteId ||
    (lookupKey?.startsWith("id:") ? lookupKey.slice(3) : null);

  athleteDialogTitle.textContent = formatAthleteName(summary?.name || fallbackName || "Athlète");
  athleteDialogMeta.textContent = summary
    ? athleteIdentityLine(summary)
    : athletesById.size
      ? "Pas encore dans la base athlètes"
      : "Base athlètes non chargée";
  athleteDialogBody.replaceChildren(
    Object.assign(document.createElement("p"), {
      className: "athlete-dialog__empty",
      textContent: "Chargement…",
    }),
  );

  lockDialogScroll();
  if (typeof athleteDialog.showModal === "function") athleteDialog.showModal();
  else athleteDialog.setAttribute("open", "");
  // Remonte le contenu au bandeau (bouton fermer toujours accessible).
  athleteDialogBody.scrollTop = 0;

  const detail = athleteId ? await loadAthleteDetail(athleteId) : null;
  const record = detail || summary;
  athleteDialogBody.replaceChildren();

  if (!record) {
    athleteDialogBody.append(
      Object.assign(document.createElement("p"), {
        className: "athlete-dialog__empty",
        textContent: athletesById.size
          ? "Cet athlète n’est pas encore présent dans athletes.json."
          : "Impossible de charger athletes.json depuis R2.",
      }),
    );
    return;
  }

  athleteDialogTitle.textContent = formatAthleteName(record.name || fallbackName);
  athleteDialogMeta.textContent = athleteIdentityLine(record);
  if (detail) athleteDialogBody.append(renderAthleteFacts(detail, true));

  const focusEvent = matchAthleteEvent(record, eventName);
  const otherEvents = (record.events || []).filter(
    (entry) => !focusEvent || entry.event !== focusEvent.event,
  );
  if (focusEvent) {
    athleteDialogBody.append(
      renderAthleteEventCard(focusEvent, true, { showSeasons: true, athlete: record }),
    );
  }
  for (const entry of otherEvents) {
    athleteDialogBody.append(
      renderAthleteEventCard(entry, false, {
        showSeasons: Boolean(detail),
        athlete: record,
      }),
    );
  }
  if (!focusEvent && !otherEvents.length) {
    athleteDialogBody.append(
      Object.assign(document.createElement("p"), {
        className: "athlete-dialog__empty",
        textContent: "Aucune performance PB/SB disponible pour cet athlète.",
      }),
    );
  }
}

function renderAthleteEventCard(entry, focused, options = {}) {
  const card = document.createElement("article");
  card.className = focused ? "athlete-best is-focus" : "athlete-best";

  const title = document.createElement("div");
  title.className = "athlete-best__event";
  title.textContent = entry.event;
  card.append(title);

  const marks = document.createElement("div");
  marks.className = "athlete-best__marks";
  if (entry.pb) {
    marks.append(
      renderMarkChip(
        "PB",
        entry.pb,
        getPerformanceScore(
          options.athlete,
          entry.event,
          entry.pb,
          performanceYearForBest(entry, entry.pb),
        ),
      ),
    );
  }
  if (entry.sb) {
    marks.append(
      renderMarkChip(
        "SB",
        entry.sb,
        getPerformanceScore(
          options.athlete,
          entry.event,
          entry.sb,
          performanceYearForBest(entry, entry.sb),
        ),
      ),
    );
  }
  if (!marks.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "athlete-dialog__empty";
    empty.textContent = "Pas de marque enregistrée";
    card.append(empty);
    return card;
  }
  card.append(marks);

  if (options.showSeasons && Array.isArray(entry.bySeason) && entry.bySeason.length) {
    const seasons = document.createElement("ul");
    seasons.className = "athlete-seasons";
    for (const row of entry.bySeason) {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = [row.season, row.performance, row.date, row.place]
        .filter(Boolean)
        .join(" · ");
      item.append(text);
      const score = getPerformanceScore(
        options.athlete,
        entry.event,
        row.performance,
        performanceYearFromRow(row, options.athlete),
      );
      if (score != null) item.append(renderPerformanceIndicator(score, true));
      seasons.append(item);
    }
    card.append(seasons);
  }

  return card;
}

function renderMarkChip(label, value, points = null) {
  const chip = document.createElement("div");
  chip.className = "athlete-best__mark";
  const tag = document.createElement("span");
  tag.textContent = label;
  chip.append(tag, document.createTextNode(value));
  if (points != null) chip.append(renderPerformanceIndicator(points, true));
  return chip;
}

function getPerformanceScore(athlete, eventName, performance, performanceYear = null) {
  const category = athleteCotationCategory(athlete, performanceYear);
  const event = normalizeCotationEvent(eventName);
  if (!category || !event || !performance) return null;
  const cotation = cotationsByCategoryEvent.get(`${category}:${event}`);
  if (!cotation) return null;

  const value = parsePerformanceValue(performance, cotation.direction);
  if (!Number.isFinite(value)) return null;
  for (const threshold of cotation.scale) {
    const reached =
      cotation.direction === "lower"
        ? value <= threshold.value
        : value >= threshold.value;
    if (reached) return { points: threshold.points, category };
  }
  return { points: 0, category };
}

function athleteCotationCategory(athlete, performanceYear = null) {
  const code = String(athlete?.categoryCode || "").toUpperCase();
  const sexFromCode = code.match(/[FM]$/)?.[0] || "";
  const sex = sexFromCode || String(athlete?.sex || "").toUpperCase();
  const birthYear = Number(athlete?.birthYear);
  const year = Number(performanceYear);

  if (
    Number.isInteger(birthYear) &&
    Number.isInteger(year) &&
    /^[FM]$/.test(sex)
  ) {
    const age = year - birthYear;
    if (age === 12 || age === 13) return `BE${sex}`;
    if (age === 14 || age === 15) return `MI${sex}`;
    // Pas de table dans ce CSV pour les poussins, cadets, etc.
    return null;
  }

  if (/^(BEF|BEM|MIF|MIM)$/.test(code)) return code;
  const youth = String(athlete?.youthCategory || "").toUpperCase();
  if (youth === "U14" && /^[FM]$/.test(sex)) return `BE${sex}`;
  if (youth === "U16" && /^[FM]$/.test(sex)) return `MI${sex}`;
  return null;
}

function performanceYearForBest(entry, performance) {
  const target = normalizePerformanceMark(performance);
  const years = (entry?.bySeason || [])
    .filter((row) => normalizePerformanceMark(row.performance) === target)
    .map((row) => Number(row.season))
    .filter(Number.isInteger);
  return years.length ? Math.max(...years) : null;
}

function performanceYearFromRow(row, athlete) {
  const season = Number(row?.season);
  if (Number.isInteger(season)) return season;
  const yearInDate = String(row?.date || "").match(/\b(20\d{2})\b/);
  if (yearInDate) return Number(yearInDate[1]);
  const fetchedAt = String(athlete?.fetchedAt || "");
  const fetchedDate = fetchedAt.match(/^(20\d{2})-(\d{2})/);
  if (fetchedDate) {
    const year = Number(fetchedDate[1]);
    return Number(fetchedDate[2]) >= 9 ? year + 1 : year;
  }
  const now = new Date();
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

function normalizePerformanceMark(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"')
    .replace(/\s+/g, "")
    .trim();
}

function normalizeCotationEvent(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\/\s*(?:bef|bem|mif|mim)\b/g, "")
    .replace(/\((?:19|20)\d{2}\)/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(?:piste courte|salle)\b/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, "")
    .replace(/^(\d)000m/, "$1000m")
    .replace(/^4x60metres?$/, "4x60m")
    .trim();
}

function parsePerformanceValue(raw, direction) {
  const text = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"');

  if (direction === "higher") {
    const metric = text.match(/(\d+)(?:m|\.)(\d{1,2})/i);
    if (metric) return Number(metric[1]) + Number(metric[2].padEnd(2, "0")) / 100;
    const number = text.match(/\d+(?:\.\d+)?/);
    return number ? Number(number[0]) : NaN;
  }

  const minutes = text.match(/(\d+)'(\d{1,2})(?:"|'{1,2})(\d{1,2})?/);
  if (minutes) {
    return (
      Number(minutes[1]) * 60 +
      Number(minutes[2]) +
      Number((minutes[3] || "0").padEnd(2, "0")) / 100
    );
  }
  const seconds = text.match(/(\d+)(?:"|'{2})(\d{1,2})?/);
  if (seconds) {
    return Number(seconds[1]) + Number((seconds[2] || "0").padEnd(2, "0")) / 100;
  }
  const number = text.match(/\d+(?:\.\d+)?/);
  return number ? Number(number[0]) : NaN;
}

function renderPerformanceIndicator(result, compact = false) {
  const points = typeof result === "object" ? result.points : result;
  const category = typeof result === "object" ? result.category : null;
  const score = Math.max(0, Math.min(50, Number(points) || 0));
  const indicator = document.createElement("div");
  indicator.className = compact
    ? "performance-score performance-score--compact"
    : "performance-score";
  indicator.style.setProperty("--score", String(score));
  indicator.style.setProperty("--score-color", `hsl(${Math.round(5 + score * 2.5)} 72% 42%)`);
  indicator.title = `${score} point${score > 1 ? "s" : ""} sur 50${
    category ? ` · barème ${category}` : ""
  }`;
  indicator.setAttribute("aria-label", indicator.title);

  const bar = document.createElement("span");
  bar.className = "performance-score__bar";
  bar.append(Object.assign(document.createElement("i"), { ariaHidden: "true" }));
  const label = document.createElement("strong");
  label.textContent = `${score} pts`;
  indicator.append(bar, label);
  return indicator;
}

function uniqueSeries(athletes) {
  return [...new Set(athletes.map((athlete) => athlete.series).filter(Boolean))];
}

function timeToMinutes(value) {
  const match = String(value).match(/(\d{1,2})\s*[:h]\s*(\d{2})/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatPerformance(raw) {
  let value = String(raw || "").trim();
  if (!value || /^NP\b/i.test(value)) return "";
  return value.replace(/^\d+\.\s*/, "").trim();
}

function formatAthleteName(raw) {
  const parts = String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const surnames = [];
  const givens = [];
  for (const part of parts) {
    const letters = part.replace(/[^A-Za-zÀ-ÿ]/g, "");
    if (letters && letters === letters.toUpperCase()) surnames.push(toTitle(part));
    else givens.push(toTitle(part));
  }
  if (!surnames.length || !givens.length) return toTitle(raw);
  return `${givens.join(" ")} ${surnames.join(" ")}`;
}

function toTitle(value) {
  return String(value)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
}

function sanitizeObjectFilename(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^-|-$/g, "")
    .substring(0, 72);
}

function formatLongDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function dataUrl(objectKey) {
  const key = String(objectKey).replace(/^\/+/, "");
  return `${R2_ORIGIN}/${R2_DATA_PREFIX}/${key}`;
}

function syncUrl() {
  const next = new URLSearchParams();
  if (activeTab !== "competitions") next.set("tab", activeTab);
  if (selectedId) next.set("competition", selectedId);
  if (selectedAthleteId) next.set("athlete", selectedAthleteId);
  if (selectedEventKey) next.set("event", selectedEventKey);
  const query = next.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function message(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}
