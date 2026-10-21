const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const statusEl = document.querySelector("#status");
const competitionSelect = document.querySelector("#competition-select");
const planningEl = document.querySelector("#planning");
const planningTitleEl = document.querySelector("#planning-title");
const planningMetaEl = document.querySelector("#planning-meta");
const planningPlaceEl = document.querySelector("#planning-place");
const scheduleEl = document.querySelector("#schedule");
const athleteDialog = document.querySelector("#athlete-dialog");
const athleteDialogTitle = document.querySelector("#athlete-dialog-title");
const athleteDialogMeta = document.querySelector("#athlete-dialog-meta");
const athleteDialogBody = document.querySelector("#athlete-dialog-body");

const params = new URLSearchParams(location.search);
let selectedId = params.get("competition");
/** @type {Array<Record<string, any>>} */
let competitions = [];
/** @type {Map<string, Record<string, any>>} */
const athletesById = new Map();
/** @type {Map<string, Record<string, any>>} */
const athletesByNameKey = new Map();

competitionSelect.addEventListener("change", () => {
  selectedId = competitionSelect.value || null;
  syncUrl();
  const chosen = competitions.find((comp) => String(comp.resultsId) === String(selectedId));
  if (chosen) loadCompetition(chosen);
});

scheduleEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-athlete-key]");
  if (!target) return;
  openAthleteDialog(target.dataset.athleteKey, target.dataset.eventName || "");
});

boot();

async function boot() {
  statusEl.textContent = "Chargement…";
  planningEl.hidden = true;
  scheduleEl.replaceChildren();

  try {
    const [competitionsPayload] = await Promise.all([
      fetchJson("competitions.json", { competitions: [] }),
      loadAthletesIndex(),
    ]);

    competitions = sortCompetitionsNewestFirst(competitionsPayload.competitions || []);
    if (!competitions.length) {
      competitionSelect.replaceChildren(new Option("Aucune compétition", ""));
      competitionSelect.disabled = true;
      statusEl.textContent = "0 compétition";
      return;
    }

    fillCompetitionSelect(competitions);

    const chosen =
      competitions.find((comp) => String(comp.resultsId) === String(selectedId)) ||
      competitions[0];
    selectedId = String(chosen.resultsId);
    competitionSelect.value = selectedId;
    competitionSelect.disabled = false;
    statusEl.textContent =
      competitions.length === 1 ? "1 compétition" : `${competitions.length} compétitions`;
    syncUrl();
    await loadCompetition(chosen);
  } catch (error) {
    competitionSelect.replaceChildren(new Option("Chargement impossible", ""));
    competitionSelect.disabled = true;
    statusEl.textContent = "Chargement impossible";
    console.error(error);
  }
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
  try {
    const payload = await fetchJson("athletes.json", { athletes: [] });
    for (const athlete of payload.athletes || []) {
      if (!athlete?.athleteId) continue;
      athletesById.set(String(athlete.athleteId), athlete);
      const key = athleteNameKey(athlete.name);
      if (key) athletesByNameKey.set(key, athlete);
    }
  } catch (error) {
    console.warn("athletes.json indisponible", error);
  }
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
      const record = findAthleteRecord(athlete);
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
      if (record) {
        item.classList.add("is-clickable");
        item.tabIndex = 0;
        item.dataset.athleteKey = athleteLookupKey(athlete);
        item.dataset.eventName = slot.eventName;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", `Voir PB et SB de ${athlete.name}`);
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openAthleteDialog(item.dataset.athleteKey, slot.eventName);
          }
        });
      }
      list.append(item);
    }
    body.append(list);
    row.append(time, body);
    fragment.append(row);
  }
  scheduleEl.replaceChildren(fragment);
}

function buildSchedule(epreuves) {
  const groups = new Map();
  for (const epreuve of epreuves || []) {
    for (const participant of epreuve.participants || []) {
      const time = String(participant.horaire || epreuve.horaire || "—").split(",")[0].trim() || "—";
      const key = `${time}@@${epreuve.name}`;
      if (!groups.has(key)) {
        groups.set(key, { time, eventName: epreuve.name, athletes: [] });
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

function openAthleteDialog(lookupKey, eventName) {
  const record = findAthleteRecordByKey(lookupKey);
  if (!record || !athleteDialog) return;

  athleteDialogTitle.textContent = formatAthleteName(record.name);
  athleteDialogMeta.textContent = [record.youthCategory, record.categoryCode]
    .filter(Boolean)
    .join(" · ");

  const focusEvent = matchAthleteEvent(record, eventName);
  const otherEvents = (record.events || []).filter(
    (entry) => !focusEvent || entry.event !== focusEvent.event,
  );

  athleteDialogBody.replaceChildren();
  if (focusEvent) {
    athleteDialogBody.append(renderAthleteEventCard(focusEvent, true));
  }
  for (const entry of otherEvents) {
    athleteDialogBody.append(renderAthleteEventCard(entry, false));
  }
  if (!focusEvent && !otherEvents.length) {
    athleteDialogBody.append(
      Object.assign(document.createElement("p"), {
        className: "athlete-dialog__empty",
        textContent: "Aucune performance PB/SB disponible pour cet athlète.",
      }),
    );
  }

  if (typeof athleteDialog.showModal === "function") athleteDialog.showModal();
  else athleteDialog.setAttribute("open", "");
}

function renderAthleteEventCard(entry, focused) {
  const card = document.createElement("article");
  card.className = focused ? "athlete-best is-focus" : "athlete-best";

  const title = document.createElement("div");
  title.className = "athlete-best__event";
  title.textContent = entry.event;
  card.append(title);

  const marks = document.createElement("div");
  marks.className = "athlete-best__marks";
  if (entry.pb) marks.append(renderMarkChip("PB", entry.pb));
  if (entry.sb) marks.append(renderMarkChip("SB", entry.sb));
  if (!marks.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "athlete-dialog__empty";
    empty.textContent = "Pas de marque enregistrée";
    card.append(empty);
    return card;
  }
  card.append(marks);
  return card;
}

function renderMarkChip(label, value) {
  const chip = document.createElement("div");
  chip.className = "athlete-best__mark";
  const tag = document.createElement("span");
  tag.textContent = label;
  chip.append(tag, document.createTextNode(value));
  return chip;
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
  if (selectedId) next.set("competition", selectedId);
  const query = next.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function message(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}
