const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const dateLabelEl = document.querySelector("#date-label");
const dateInput = document.querySelector("#date-input");
const statusEl = document.querySelector("#status");
const competitionsEl = document.querySelector("#competitions");
const planningEl = document.querySelector("#planning");
const planningTitleEl = document.querySelector("#planning-title");
const planningMetaEl = document.querySelector("#planning-meta");
const planningPlaceEl = document.querySelector("#planning-place");
const scheduleEl = document.querySelector("#schedule");

const params = new URLSearchParams(location.search);
let selectedId = params.get("competition");

dateInput.value = params.get("date") || todayInParis();
dateInput.addEventListener("change", () => {
  selectedId = null;
  syncUrl();
  loadDay();
});

const dateChip = dateInput.closest(".date-chip");
if (dateChip) {
  dateChip.addEventListener("click", () => {
    if (typeof dateInput.showPicker === "function") {
      try {
        dateInput.showPicker();
      } catch {
        dateInput.focus();
      }
    } else {
      dateInput.focus();
    }
  });
}

loadDay();

function todayInParis() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

function formatLongDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function dataUrl(objectKey) {
  const key = String(objectKey).replace(/^\/+/, "");
  return `${R2_ORIGIN}/${R2_DATA_PREFIX}/${key}`;
}

async function loadDay() {
  const date = dateInput.value;
  dateLabelEl.textContent = formatLongDate(date);
  statusEl.textContent = "Chargement des compétitions…";
  competitionsEl.replaceChildren();
  planningEl.hidden = true;
  scheduleEl.replaceChildren();

  try {
    const response = await fetch(dataUrl(`competitions_${date}.json`), { cache: "no-store" });
    if (response.status === 404) {
      statusEl.textContent = "Aucun fichier publié pour cette date.";
      competitionsEl.append(message("Les compétitions du jour ne sont pas encore disponibles."));
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const competitions = payload.competitions || [];
    if (!competitions.length) {
      statusEl.textContent = "0 compétition";
      competitionsEl.append(message("Aucune compétition du club pour cette date."));
      return;
    }
    statusEl.textContent =
      competitions.length === 1 ? "1 compétition" : `${competitions.length} compétitions`;
    renderCompetitions(competitions);
    const chosen =
      competitions.find((comp) => comp.resultsId === selectedId) ||
      (competitions.length === 1 ? competitions[0] : null);
    if (chosen) {
      selectedId = chosen.resultsId;
      markSelected();
      syncUrl();
      await loadCompetition(date, chosen);
    }
  } catch (error) {
    statusEl.textContent = "Chargement impossible";
    competitionsEl.append(
      message("Impossible de lire les compétitions. Vérifiez que le bucket autorise les lectures depuis cette page (CORS)."),
    );
    console.error(error);
  }
}

function renderCompetitions(competitions) {
  const fragment = document.createDocumentFragment();
  for (const comp of competitions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "competition";
    button.dataset.id = comp.resultsId;
    button.setAttribute("aria-pressed", "false");

    const title = document.createElement("span");
    title.className = "competition-title";
    title.textContent = comp.calendarLabel || comp.resultsTitle || "Compétition";

    const meta = document.createElement("span");
    meta.className = "competition-meta";
    meta.textContent = [comp.place, comp.level, comp.type].filter(Boolean).join(" · ");

    button.append(title, meta);
    button.addEventListener("click", () => {
      selectedId = comp.resultsId;
      markSelected();
      syncUrl();
      loadCompetition(dateInput.value, comp);
    });
    fragment.append(button);
  }
  competitionsEl.replaceChildren(fragment);
}

function markSelected() {
  for (const button of competitionsEl.querySelectorAll(".competition")) {
    button.setAttribute("aria-pressed", String(button.dataset.id === selectedId));
  }
}

async function loadCompetition(date, comp) {
  planningEl.hidden = false;
  planningTitleEl.textContent = comp.calendarLabel || "Épreuves";
  planningPlaceEl.textContent = [comp.place, comp.level].filter(Boolean).join(" · ");
  planningMetaEl.textContent = "Chargement du planning…";
  scheduleEl.replaceChildren();

  const baseName = sanitizeObjectFilename(comp.calendarLabel || comp.resultsTitle || comp.resultsId);
  const keys = [`${date}_${baseName}.json`];
  if (comp.resultsId) keys.push(`${date}_${baseName}_${comp.resultsId}.json`);

  try {
    let payload = null;
    for (const key of keys) {
      const response = await fetch(dataUrl(key), { cache: "no-store" });
      if (response.ok) {
        payload = await response.json();
        break;
      }
    }
    if (!payload) throw new Error("Fichier de compétition introuvable");
    const schedule = buildSchedule(payload.epreuves);
    const athleteCount = schedule.reduce((sum, slot) => sum + slot.athletes.length, 0);
    planningMetaEl.textContent = `${schedule.length} créneau${schedule.length > 1 ? "x" : ""} · ${athleteCount} participation${athleteCount > 1 ? "s" : ""}`;
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
      const name = document.createElement("span");
      name.className = "athlete-name";
      const extra = series.length > 1 && athlete.series ? ` · ${athlete.series}` : "";
      name.textContent = `${athlete.name}${extra}`;
      item.append(name);
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
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
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

function syncUrl() {
  const next = new URLSearchParams();
  if (dateInput.value) next.set("date", dateInput.value);
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
