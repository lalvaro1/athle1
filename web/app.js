const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const statusEl = document.querySelector("#status");
const competitionSelect = document.querySelector("#competition-select");
const planningEl = document.querySelector("#planning");
const planningTitleEl = document.querySelector("#planning-title");
const planningMetaEl = document.querySelector("#planning-meta");
const planningPlaceEl = document.querySelector("#planning-place");
const scheduleEl = document.querySelector("#schedule");

const params = new URLSearchParams(location.search);
let selectedId = params.get("competition");
/** @type {Array<Record<string, any>>} */
let competitions = [];

competitionSelect.addEventListener("change", () => {
  selectedId = competitionSelect.value || null;
  syncUrl();
  const chosen = competitions.find((comp) => String(comp.resultsId) === String(selectedId));
  if (chosen) loadCompetition(chosen);
});

boot();

async function boot() {
  statusEl.textContent = "Chargement des compétitions…";
  planningEl.hidden = true;
  scheduleEl.replaceChildren();

  try {
    const payload = await fetch(dataUrl("competitions.json"), { cache: "no-store" }).then(
      async (response) => {
        if (response.status === 404) return { competitions: [] };
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      },
    );

    competitions = sortCompetitionsNewestFirst(payload.competitions || []);
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
