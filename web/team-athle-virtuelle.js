const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const resultTitleEl = document.querySelector("#virtual-team-result-title");
const resultNoteEl = document.querySelector("#virtual-team-result-note");
const scoreEl = document.querySelector("#virtual-team-score");
const eventsEl = document.querySelector("#virtual-team-events");
const categoryInputs = [...document.querySelectorAll('input[name="virtual-category"]')];
const rulesInputs = [...document.querySelectorAll('input[name="virtual-rules"]')];
const showRulesButton = document.querySelector("#show-rules");
const rulesDialog = document.querySelector("#rules-dialog");
const rulesTitleEl = document.querySelector("#rules-title");
const n1RulesEl = document.querySelector("#n1-rules");
const n2RulesEl = document.querySelector("#n2-rules");
const replaceDialog = document.querySelector("#replace-dialog");
const replaceTitleEl = document.querySelector("#replace-dialog-title");
const replaceMetaEl = document.querySelector("#replace-dialog-meta");
const replaceBodyEl = document.querySelector("#replace-dialog-body");
const resetButton = document.querySelector("#virtual-team-reset");

const ESTIMATED_POINTS = 17;

/** Programme fixe des épreuves par catégorie (jamais réduit). */
const TEAM_EVENTS = {
  U14: [
    { key: "50m", label: "50 m", family: "sprint", aliases: ["50m"] },
    { key: "50mhaies", label: "50 m haies", family: "hurdles", aliases: ["50mhaies"] },
    { key: "1000m", label: "1000 m", family: "middle", aliases: ["1000m"] },
    { key: "2000mmarche", label: "2000 m marche", family: "middle", aliases: ["2000mmarche"] },
    { key: "hauteur", label: "Hauteur", family: "jumps", aliases: ["hauteur"] },
    { key: "longueur", label: "Longueur", family: "jumps", aliases: ["longueur"] },
    { key: "triplesaut", label: "Triple saut", family: "jumps", aliases: ["triplesaut"] },
    { key: "perche", label: "Perche", family: "jumps", aliases: ["perche"] },
    { key: "poids", label: "Poids", family: "throws", aliases: ["poids"] },
    { key: "disque", label: "Disque", family: "throws", aliases: ["disque"] },
    { key: "javelot", label: "Javelot", family: "throws", aliases: ["javelot"] },
    { key: "marteau", label: "Marteau", family: "throws", aliases: ["marteau"] },
    {
      key: "4x60mmixte",
      label: "4x60 m mixte",
      family: "relay",
      aliases: ["4x60mmixte"],
      relay: true,
    },
  ],
  U16: [
    { key: "80m", label: "80 m", family: "sprint", aliases: ["80m"] },
    { key: "120m", label: "120 m", family: "sprint", aliases: ["120m"] },
    {
      key: "u16-haies-courtes",
      label: "80 m haies / 100 m haies",
      family: "hurdles",
      aliases: ["80mhaies", "100mhaies"],
    },
    { key: "200mhaies", label: "200 m haies", family: "hurdles", aliases: ["200mhaies"] },
    { key: "1000m", label: "1000 m", family: "middle", aliases: ["1000m"] },
    { key: "2000m", label: "2000 m", family: "middle", aliases: ["2000m"] },
    { key: "3000mmarche", label: "3000 m marche", family: "middle", aliases: ["3000mmarche"] },
    { key: "hauteur", label: "Hauteur", family: "jumps", aliases: ["hauteur"] },
    { key: "longueur", label: "Longueur", family: "jumps", aliases: ["longueur"] },
    { key: "triplesaut", label: "Triple saut", family: "jumps", aliases: ["triplesaut"] },
    { key: "perche", label: "Perche", family: "jumps", aliases: ["perche"] },
    { key: "poids", label: "Poids", family: "throws", aliases: ["poids"] },
    { key: "disque", label: "Disque", family: "throws", aliases: ["disque"] },
    { key: "javelot", label: "Javelot", family: "throws", aliases: ["javelot"] },
    { key: "marteau", label: "Marteau", family: "throws", aliases: ["marteau"] },
    {
      key: "4x60mmixte",
      label: "4x60 m mixte",
      family: "relay",
      aliases: ["4x60mmixte"],
      relay: true,
    },
  ],
};

const RELAY_EVENT_KEY = "4x60mmixte";

const TEAM_EVENT_BY_KEY = Object.fromEntries(
  Object.entries(TEAM_EVENTS).map(([category, events]) => [
    category,
    new Map(events.map((event) => [event.key, event])),
  ]),
);

const TEAM_EVENT_BY_ALIAS = Object.fromEntries(
  Object.entries(TEAM_EVENTS).map(([category, events]) => [
    category,
    new Map(
      events.flatMap((event) => event.aliases.map((alias) => [alias, event])),
    ),
  ]),
);

const N1_CATEGORY_LIMITS = {
  U14: { events: 3, races: 1, contests: 2, jumps: 1, throws: 1 },
  U16: { events: 3, races: 2, contests: 2, jumps: 2, throws: 2 },
};

/** @type {Array<Record<string, any>>} */
let athletes = [];
/** @type {Map<string, { label: string, direction: "lower"|"higher", scale: Array<{points:number,value:number}> }>} */
let cotations = new Map();
/** @type {Array<Record<string, any>>} */
let currentEligible = [];
/** @type {Array<Record<string, any>>} */
let currentCandidates = [];
/** @type {Array<Record<string, any>>} */
let currentSelection = [];
/** Athlètes absents de la compétition. */
/** @type {Set<string>} */
let unavailableAthletes = new Set();
/** Athlète imposé par épreuve via « Remplacer ». */
/** @type {Map<string, string>} */
let pinnedByEvent = new Map();
/** Composition manuelle du relais mixte : 2 filles + 2 garçons. */
/** @type {{ F: Array<string|null>, M: Array<string|null> }} */
let pinnedRelay = emptyRelayPins();

for (const input of [...categoryInputs, ...rulesInputs]) {
  input.addEventListener("change", () => {
    resetManualOverrides();
    renderSelection();
  });
}

resetButton.addEventListener("click", () => {
  resetManualOverrides();
  renderSelection();
});

showRulesButton.addEventListener("click", () => {
  const rules = selectedValue(rulesInputs);
  const showN1 = rules === "N1";
  rulesTitleEl.textContent = `Algorithme ${rules}`;
  n1RulesEl.hidden = !showN1;
  n2RulesEl.hidden = showN1;
  if (typeof rulesDialog.showModal === "function") rulesDialog.showModal();
  else rulesDialog.setAttribute("open", "");
});

boot();

async function boot() {
  try {
    const [athletesPayload, cotationsCsv] = await Promise.all([
      fetchJson("athletes.json"),
      fetchTextWithFallback([
        `${R2_ORIGIN}/cotations-jeunes.csv`,
        `${R2_ORIGIN}/${R2_DATA_PREFIX}/cotations-jeunes.csv`,
      ]),
    ]);
    athletes = athletesPayload.athletes || [];
    cotations = parseCotations(cotationsCsv);
    renderSelection();
  } catch (error) {
    resultTitleEl.textContent = "Calcul indisponible";
    resultNoteEl.textContent = "Impossible de charger les athlètes ou le barème.";
    scoreEl.textContent = "—";
    eventsEl.replaceChildren(message("Réessaie dans quelques instants."));
    console.error(error);
  }
}

function emptyRelayPins() {
  return { F: [null, null], M: [null, null] };
}

function resetManualOverrides() {
  unavailableAthletes = new Set();
  pinnedByEvent = new Map();
  pinnedRelay = emptyRelayPins();
}

function renderSelection() {
  if (!athletes.length || !cotations.size) return;

  const category = selectedValue(categoryInputs);
  const rules = selectedValue(rulesInputs);
  if (rules !== "N1") {
    currentEligible = [];
    currentCandidates = [];
    currentSelection = [];
    resultTitleEl.textContent = "Règles N2";
    resultNoteEl.textContent = "Le calcul N2 sera ajouté prochainement.";
    scoreEl.textContent = "—";
    eventsEl.replaceChildren(message("Sélectionne N1 pour afficher une composition."));
    return;
  }

  currentEligible = athletes.filter(
    (athlete) => String(athlete.youthCategory || "").toUpperCase() === category,
  );
  currentCandidates = buildCandidates(currentEligible, category);
  const filtered = applyManualOverrides(currentCandidates, category);
  const optimized = optimizeN1(filtered, category);
  currentSelection = fillEventBoard(optimized, category);
  const total = currentSelection.reduce((sum, entry) => sum + entry.points, 0);
  const athleteCount = new Set(
    currentSelection.flatMap((entry) => {
      if (entry.relay) {
        return (entry.athletes || []).map((athlete) => String(athlete.athleteId));
      }
      return entry.athlete ? [String(entry.athlete.athleteId)] : [];
    }),
  ).size;
  const emptyCount = currentSelection.filter((entry) => entry.empty).length;
  const unavailableCount = unavailableAthletes.size;

  resultTitleEl.textContent =
    category === "U14" ? "Team Benjamins N1" : "Team Minimes N1";
  resultNoteEl.textContent = `${athleteCount} athlète${athleteCount > 1 ? "s" : ""} retenu${
    athleteCount > 1 ? "s" : ""
  } · ${currentSelection.length} épreuves · filles et garçons réunis${
    emptyCount ? ` · ${emptyCount} sans athlète` : ""
  }${
    unavailableCount
      ? ` · ${unavailableCount} absent${unavailableCount > 1 ? "s" : ""}`
      : ""
  }`;
  scoreEl.textContent = `${total} pts`;
  renderEvents(currentSelection);
}

function fillEventBoard(selection, category) {
  const byEvent = new Map(selection.map((entry) => [entry.eventKey, entry]));
  const selectedIds = new Set(
    selection.map((entry) => String(entry.athlete.athleteId)),
  );
  return (TEAM_EVENTS[category] || []).map((event) => {
    if (event.relay) return buildRelayEntry(event, selectedIds);
    const chosen = byEvent.get(event.key);
    if (chosen) {
      return {
        ...chosen,
        eventLabel: event.label,
        family: event.family,
        empty: false,
      };
    }
    return emptyEventSlot(event);
  });
}

function buildRelayEntry(event, preferredIds) {
  const females = pickRelayAthletes("F", preferredIds);
  const males = pickRelayAthletes("M", preferredIds);
  const athletes = [...females, ...males];
  return {
    athlete: null,
    athletes,
    eventKey: event.key,
    eventLabel: event.label,
    cotationEventKey: event.aliases[0],
    performance: "—",
    points: 0,
    family: "relay",
    relay: true,
    empty: athletes.length === 0,
  };
}

function pickRelayAthletes(sex, preferredIds) {
  const pinned = (pinnedRelay[sex] || [])
    .filter(Boolean)
    .filter((id) => !unavailableAthletes.has(id))
    .slice(0, 2);
  const chosen = [...pinned];
  const chosenSet = new Set(chosen);
  const pool = currentEligible
    .filter((athlete) => {
      const id = String(athlete.athleteId);
      return (
        athleteSex(athlete) === sex &&
        !unavailableAthletes.has(id) &&
        !chosenSet.has(id)
      );
    })
    .sort((a, b) => {
      const aPreferred = preferredIds.has(String(a.athleteId)) ? 0 : 1;
      const bPreferred = preferredIds.has(String(b.athleteId)) ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      return formatAthleteName(a.name).localeCompare(formatAthleteName(b.name), "fr");
    });

  for (const athlete of pool) {
    if (chosen.length >= 2) break;
    chosen.push(String(athlete.athleteId));
  }

  return chosen
    .map((id) => currentEligible.find((athlete) => String(athlete.athleteId) === id))
    .filter(Boolean);
}

function athleteSex(athlete) {
  const fromCode = String(athlete?.categoryCode || "").toUpperCase().match(/[FM]$/);
  if (fromCode) return fromCode[0];
  const sex = String(athlete?.sex || "").toUpperCase();
  return sex === "F" || sex === "M" ? sex : "";
}

function emptyEventSlot(event) {
  return {
    athlete: null,
    eventKey: event.key,
    eventLabel: event.label,
    cotationEventKey: event.aliases[0],
    performance: "—",
    points: 0,
    family: event.family,
    empty: true,
  };
}

function applyManualOverrides(candidates, category) {
  const byAthleteEvent = new Map();
  const result = [];

  for (const candidate of candidates) {
    const athleteId = String(candidate.athlete.athleteId);
    if (unavailableAthletes.has(athleteId)) continue;
    const pinned = pinnedByEvent.get(candidate.eventKey);
    if (pinned && pinned !== athleteId) continue;
    result.push(candidate);
    byAthleteEvent.set(`${athleteId}:${candidate.eventKey}`, candidate);
  }

  for (const [eventKey, athleteId] of [...pinnedByEvent]) {
    if (eventKey === RELAY_EVENT_KEY) {
      pinnedByEvent.delete(eventKey);
      continue;
    }
    if (unavailableAthletes.has(athleteId)) {
      pinnedByEvent.delete(eventKey);
      continue;
    }
    if (byAthleteEvent.has(`${athleteId}:${eventKey}`)) continue;
    const athlete = currentEligible.find(
      (entry) => String(entry.athleteId) === athleteId,
    );
    const meta = eventMeta(eventKey, category);
    if (!athlete || !meta) continue;
    result.push({
      athlete,
      eventKey,
      eventLabel: meta.eventLabel,
      cotationEventKey: meta.cotationEventKey,
      performance: "estimé",
      points: ESTIMATED_POINTS,
      family: meta.family,
      estimated: true,
    });
  }

  return result;
}

function eventMeta(eventKey, category) {
  const event = TEAM_EVENT_BY_KEY[category]?.get(eventKey);
  if (event) {
    return {
      eventLabel: event.label,
      family: event.family,
      cotationEventKey: event.aliases[0],
    };
  }
  return {
    eventLabel: eventKey,
    family: eventFamily(eventKey),
    cotationEventKey: eventKey,
  };
}

function buildCandidates(list, selectedCategory) {
  const candidates = [];
  for (const athlete of list) {
    const athleteCategoryCode = String(athlete.categoryCode || "").toUpperCase();
    const sex = athleteCategoryCode.match(/[FM]$/)?.[0];
    const categoryPrefix = selectedCategory === "U14" ? "BE" : "MI";
    const scoringCategory = sex ? `${categoryPrefix}${sex}` : "";
    const bestByEvent = new Map();
    for (const entry of athlete.events || []) {
      if (!entry.pb) continue;
      const cotationEventKey = normalizeEvent(entry.event);
      const scale = cotations.get(`${scoringCategory}:${cotationEventKey}`);
      if (!scale) continue;
      const teamEvent = resolveTeamEvent(selectedCategory, cotationEventKey);
      if (!teamEvent || teamEvent.relay) continue;
      const points = performancePoints(entry.pb, scale);
      if (points <= 0) continue;
      const candidate = {
        athlete,
        eventKey: teamEvent.key,
        eventLabel: teamEvent.label,
        cotationEventKey,
        performance: entry.pb,
        points,
        family: teamEvent.family,
      };
      const current = bestByEvent.get(teamEvent.key);
      if (!current || candidate.points > current.points) {
        bestByEvent.set(teamEvent.key, candidate);
      }
    }
    candidates.push(...bestByEvent.values());
  }
  return candidates;
}

function resolveTeamEvent(category, cotationEventKey) {
  return TEAM_EVENT_BY_ALIAS[category]?.get(cotationEventKey) || null;
}

/**
 * B-matching pondéré :
 * - 3 épreuves maximum par athlète ;
 * - limites courses / sauts / lancers propres à la catégorie ;
 * - une seule course de chaque type ;
 * - une seule contribution comptabilisée par épreuve.
 */
function optimizeN1(candidates, category) {
  const limits = N1_CATEGORY_LIMITS[category];
  const graph = [];
  const source = addNode(graph);
  const sink = addNode(graph);
  const athleteNodes = new Map();
  const eventNodes = new Map();

  for (const candidate of candidates) {
    const athleteId = String(candidate.athlete.athleteId);
    if (!athleteNodes.has(athleteId)) {
      const total = addNode(graph);
      const races = addNode(graph);
      const contests = addNode(graph);
      const sprint = addNode(graph);
      const hurdles = addNode(graph);
      const middle = addNode(graph);
      const jumps = addNode(graph);
      const throws = addNode(graph);
      addEdge(graph, source, total, limits.events, 0);
      addEdge(graph, total, races, limits.races, 0);
      addEdge(graph, total, contests, limits.contests, 0);
      addEdge(graph, races, sprint, 1, 0);
      addEdge(graph, races, hurdles, 1, 0);
      addEdge(graph, races, middle, 1, 0);
      addEdge(graph, contests, jumps, limits.jumps, 0);
      addEdge(graph, contests, throws, limits.throws, 0);
      athleteNodes.set(athleteId, { sprint, hurdles, middle, jumps, throws });
    }
    if (!eventNodes.has(candidate.eventKey)) {
      const eventNode = addNode(graph);
      addEdge(graph, eventNode, sink, 1, 0);
      eventNodes.set(candidate.eventKey, eventNode);
    }
  }

  for (const candidate of candidates) {
    const nodes = athleteNodes.get(String(candidate.athlete.athleteId));
    const from = nodes[candidate.family];
    addEdge(graph, from, eventNodes.get(candidate.eventKey), 1, -candidate.points, candidate);
  }

  const selected = [];
  while (true) {
    const path = shortestResidualPath(graph, source);
    if (!Number.isFinite(path.distance[sink]) || path.distance[sink] >= 0) break;
    let node = sink;
    while (node !== source) {
      const previousNode = path.previousNode[node];
      const edgeIndex = path.previousEdge[node];
      const edge = graph[previousNode][edgeIndex];
      edge.capacity -= 1;
      graph[node][edge.reverse].capacity += 1;
      node = previousNode;
    }
  }

  for (const edges of graph) {
    for (const edge of edges) {
      if (edge.candidate && edge.capacity === 0) selected.push(edge.candidate);
    }
  }
  return selected.sort(
    (a, b) => b.points - a.points || a.eventLabel.localeCompare(b.eventLabel, "fr"),
  );
}

function addNode(graph) {
  graph.push([]);
  return graph.length - 1;
}

function addEdge(graph, from, to, capacity, cost, candidate = null) {
  const forward = { to, reverse: graph[to].length, capacity, cost, candidate };
  const reverse = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost };
  graph[from].push(forward);
  graph[to].push(reverse);
}

function shortestResidualPath(graph, source) {
  const distance = Array(graph.length).fill(Infinity);
  const previousNode = Array(graph.length).fill(-1);
  const previousEdge = Array(graph.length).fill(-1);
  const inQueue = Array(graph.length).fill(false);
  const queue = [source];
  distance[source] = 0;
  inQueue[source] = true;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor];
    inQueue[node] = false;
    graph[node].forEach((edge, edgeIndex) => {
      if (edge.capacity <= 0 || distance[edge.to] <= distance[node] + edge.cost) return;
      distance[edge.to] = distance[node] + edge.cost;
      previousNode[edge.to] = node;
      previousEdge[edge.to] = edgeIndex;
      if (!inQueue[edge.to]) {
        queue.push(edge.to);
        inQueue[edge.to] = true;
      }
    });
  }
  return { distance, previousNode, previousEdge };
}

function renderEvents(selection) {
  eventsEl.replaceChildren();
  if (!selection.length) {
    eventsEl.append(message("Aucune épreuve définie pour cette catégorie."));
    return;
  }

  for (const entry of selection) {
    eventsEl.append(entry.relay ? renderRelayRow(entry) : renderEventRow(entry));
  }
}

function renderEventRow(entry) {
  const row = document.createElement("article");
  row.className = entry.empty
    ? "virtual-team-event virtual-team-event--empty"
    : "virtual-team-event";

  const event = document.createElement("div");
  event.className = "virtual-team-event__event";
  event.append(
    Object.assign(document.createElement("strong"), { textContent: entry.eventLabel }),
    Object.assign(document.createElement("span"), {
      textContent: familyLabel(entry.family),
    }),
  );

  const athlete = document.createElement("div");
  athlete.className = "virtual-team-event__athlete";
  if (entry.empty) {
    athlete.append(
      Object.assign(document.createElement("strong"), { textContent: "Personne" }),
      Object.assign(document.createElement("span"), { textContent: "Non pourvu" }),
    );
  } else {
    athlete.append(
      Object.assign(document.createElement("strong"), {
        textContent: formatAthleteName(entry.athlete.name),
      }),
      Object.assign(document.createElement("span"), {
        textContent: entry.estimated
          ? `${entry.athlete.categoryCode || ""} · estimé`
          : entry.athlete.categoryCode || "",
      }),
    );
  }

  const performance = document.createElement("div");
  performance.className = "virtual-team-event__performance";
  performance.append(
    Object.assign(document.createElement("strong"), {
      textContent: entry.empty || entry.estimated ? "—" : entry.performance,
    }),
    Object.assign(document.createElement("span"), {
      className: entry.estimated ? "is-estimated" : "",
      textContent: entry.estimated ? `(${entry.points} pts)` : `${entry.points} pts`,
    }),
  );

  const actions = document.createElement("div");
  actions.className = "virtual-team-event__actions";

  const removeButton = Object.assign(document.createElement("button"), {
    type: "button",
    className: "virtual-team-action",
    textContent: "Retirer",
    disabled: entry.empty,
  });
  if (!entry.empty) {
    removeButton.addEventListener("click", () => removeAthlete(entry.athlete));
  }

  const replaceButton = Object.assign(document.createElement("button"), {
    type: "button",
    className: "virtual-team-action virtual-team-action--replace",
    textContent: entry.empty ? "Choisir" : "Remplacer",
  });
  replaceButton.addEventListener("click", () => openReplaceDialog(entry));

  actions.append(removeButton, replaceButton);
  row.append(event, athlete, performance, actions);
  return row;
}

function renderRelayRow(entry) {
  const row = document.createElement("article");
  row.className = entry.empty
    ? "virtual-team-event virtual-team-event--empty virtual-team-event--relay"
    : "virtual-team-event virtual-team-event--relay";

  const event = document.createElement("div");
  event.className = "virtual-team-event__event";
  event.append(
    Object.assign(document.createElement("strong"), { textContent: entry.eventLabel }),
    Object.assign(document.createElement("span"), {
      textContent: "Relais · 2 filles + 2 garçons · bonus",
    }),
  );

  const athlete = document.createElement("div");
  athlete.className = "virtual-team-event__athlete virtual-team-event__relay-athletes";
  const females = (entry.athletes || []).filter((item) => athleteSex(item) === "F");
  const males = (entry.athletes || []).filter((item) => athleteSex(item) === "M");
  athlete.append(
    renderRelayGroup("Filles", females, 2),
    renderRelayGroup("Garçons", males, 2),
  );

  const performance = document.createElement("div");
  performance.className = "virtual-team-event__performance";
  performance.append(
    Object.assign(document.createElement("strong"), { textContent: "—" }),
    Object.assign(document.createElement("span"), {
      className: "is-estimated",
      textContent: "(bonus)",
    }),
  );

  const actions = document.createElement("div");
  actions.className = "virtual-team-event__actions";
  const replaceButton = Object.assign(document.createElement("button"), {
    type: "button",
    className: "virtual-team-action virtual-team-action--replace",
    textContent: "Composer",
  });
  replaceButton.addEventListener("click", () => openRelayDialog(entry));
  actions.append(replaceButton);

  row.append(event, athlete, performance, actions);
  return row;
}

function renderRelayGroup(label, athletes, slots) {
  const group = document.createElement("div");
  group.className = "virtual-team-relay-group";
  group.append(
    Object.assign(document.createElement("span"), { textContent: label }),
  );
  for (let index = 0; index < slots; index += 1) {
    const athlete = athletes[index];
    group.append(
      Object.assign(document.createElement("strong"), {
        textContent: athlete ? formatAthleteName(athlete.name) : "Personne",
      }),
    );
  }
  return group;
}

function clubOptionsForEvent(eventKey, category) {
  const known = new Map(
    currentCandidates
      .filter((candidate) => candidate.eventKey === eventKey)
      .map((candidate) => [String(candidate.athlete.athleteId), candidate]),
  );
  const meta = eventMeta(eventKey, category);

  return currentEligible
    .filter((athlete) => !unavailableAthletes.has(String(athlete.athleteId)))
    .map((athlete) => {
      const athleteId = String(athlete.athleteId);
      const knownCandidate = known.get(athleteId);
      if (knownCandidate) return knownCandidate;
      return {
        athlete,
        eventKey,
        eventLabel: meta.eventLabel,
        cotationEventKey: meta.cotationEventKey,
        performance: "estimé",
        points: ESTIMATED_POINTS,
        family: meta.family,
        estimated: true,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        Number(Boolean(a.estimated)) - Number(Boolean(b.estimated)) ||
        formatAthleteName(a.athlete.name).localeCompare(
          formatAthleteName(b.athlete.name),
          "fr",
        ),
    );
}

function removeAthlete(athlete) {
  const athleteId = String(athlete.athleteId);
  unavailableAthletes.add(athleteId);
  for (const [eventKey, pinnedId] of [...pinnedByEvent]) {
    if (pinnedId === athleteId) pinnedByEvent.delete(eventKey);
  }
  for (const sex of ["F", "M"]) {
    pinnedRelay[sex] = pinnedRelay[sex].map((id) => (id === athleteId ? null : id));
  }
  renderSelection();
}

function openReplaceDialog(entry) {
  if (entry.relay) {
    openRelayDialog(entry);
    return;
  }

  const category = selectedValue(categoryInputs);
  const currentId = entry.athlete ? String(entry.athlete.athleteId) : "";
  const options = clubOptionsForEvent(entry.eventKey, category);

  replaceTitleEl.textContent = entry.eventLabel;
  replaceMetaEl.textContent =
    "Choisis un athlète du club. Sans perf connue, une estimation de 17 pts est utilisée.";
  replaceBodyEl.replaceChildren();

  for (const option of options) {
    const athleteId = String(option.athlete.athleteId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "replace-option";
    if (currentId && athleteId === currentId) button.classList.add("is-current");

    const identity = document.createElement("div");
    const metaBits = [
      option.athlete.categoryCode || "",
      currentId && athleteId === currentId ? "actuel" : "",
      option.estimated ? "estimé" : "",
    ].filter(Boolean);
    identity.append(
      Object.assign(document.createElement("strong"), {
        textContent: formatAthleteName(option.athlete.name),
      }),
      Object.assign(document.createElement("span"), {
        textContent: metaBits.join(" · "),
      }),
    );

    const score = document.createElement("div");
    score.className = "replace-option__score";
    score.append(
      Object.assign(document.createElement("strong"), {
        textContent: option.estimated ? "—" : option.performance,
      }),
      Object.assign(document.createElement("span"), {
        className: option.estimated ? "is-estimated" : "",
        textContent: option.estimated ? `(${option.points} pts)` : `${option.points} pts`,
      }),
    );

    button.append(identity, score);
    button.addEventListener("click", () => {
      pinnedByEvent.set(entry.eventKey, athleteId);
      replaceDialog.close();
      renderSelection();
    });
    replaceBodyEl.append(button);
  }

  if (typeof replaceDialog.showModal === "function") replaceDialog.showModal();
  else replaceDialog.setAttribute("open", "");
}

function openRelayDialog(entry) {
  const draft = {
    F: [...(pinnedRelay.F || [null, null])],
    M: [...(pinnedRelay.M || [null, null])],
  };
  const current = entry.athletes || [];
  for (const sex of ["F", "M"]) {
    const fromCurrent = current
      .filter((athlete) => athleteSex(athlete) === sex)
      .map((athlete) => String(athlete.athleteId));
    for (let index = 0; index < 2; index += 1) {
      if (!draft[sex][index]) draft[sex][index] = fromCurrent[index] || null;
    }
  }

  replaceTitleEl.textContent = entry.eventLabel;
  replaceMetaEl.textContent =
    "Compose le relais : 2 filles et 2 garçons. Aucune contrainte d’épreuves, 0 point.";
  renderRelayDialogBody(draft);

  if (typeof replaceDialog.showModal === "function") replaceDialog.showModal();
  else replaceDialog.setAttribute("open", "");
}

function renderRelayDialogBody(draft) {
  replaceBodyEl.replaceChildren();

  for (const sex of ["F", "M"]) {
    const section = document.createElement("section");
    section.className = "relay-composer";
    section.append(
      Object.assign(document.createElement("h3"), {
        textContent: sex === "F" ? "Filles" : "Garçons",
      }),
    );

    for (let slot = 0; slot < 2; slot += 1) {
      const label = document.createElement("label");
      label.className = "relay-composer__slot";
      label.append(
        Object.assign(document.createElement("span"), {
          textContent: `Poste ${slot + 1}`,
        }),
      );

      const select = document.createElement("select");
      select.append(new Option("Personne", ""));
      for (const athlete of relayOptions(sex, draft, slot)) {
        const id = String(athlete.athleteId);
        select.append(
          new Option(
            `${formatAthleteName(athlete.name)} · ${athlete.categoryCode || sex}`,
            id,
          ),
        );
      }
      select.value = draft[sex][slot] || "";
      select.addEventListener("change", () => {
        draft[sex][slot] = select.value || null;
        renderRelayDialogBody(draft);
      });
      label.append(select);
      section.append(label);
    }
    replaceBodyEl.append(section);
  }

  const save = Object.assign(document.createElement("button"), {
    type: "button",
    className: "relay-composer__save",
    textContent: "Valider le relais",
  });
  save.addEventListener("click", () => {
    pinnedRelay = {
      F: [...draft.F],
      M: [...draft.M],
    };
    replaceDialog.close();
    renderSelection();
  });
  replaceBodyEl.append(save);
}

function relayOptions(sex, draft, slotIndex) {
  const used = new Set();
  for (const otherSex of ["F", "M"]) {
    draft[otherSex].forEach((id, index) => {
      if (!id) return;
      if (otherSex === sex && index === slotIndex) return;
      used.add(id);
    });
  }

  return currentEligible
    .filter((athlete) => {
      const id = String(athlete.athleteId);
      return (
        athleteSex(athlete) === sex &&
        !unavailableAthletes.has(id) &&
        !used.has(id)
      );
    })
    .sort((a, b) =>
      formatAthleteName(a.name).localeCompare(formatAthleteName(b.name), "fr"),
    );
}

function parseCotations(text) {
  const rows = String(text)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(","));
  const headers = rows.shift() || [];
  const points = headers.slice(2).map(Number);
  const result = new Map();
  for (const row of rows) {
    const category = String(row[0] || "").trim().toUpperCase();
    const label = String(row[1] || "").trim();
    const event = normalizeEvent(label);
    const scale = points
      .map((value, index) => ({ points: value, value: Number(row[index + 2]) }))
      .filter((entry) => Number.isFinite(entry.points) && Number.isFinite(entry.value));
    if (!category || !event || !scale.length) continue;
    result.set(`${category}:${event}`, {
      label,
      direction: scale[0].value <= scale.at(-1).value ? "lower" : "higher",
      scale,
    });
  }
  return result;
}

function performancePoints(performance, cotation) {
  const value = parsePerformanceValue(performance, cotation.direction);
  if (!Number.isFinite(value)) return 0;
  for (const threshold of cotation.scale) {
    const reached =
      cotation.direction === "lower"
        ? value <= threshold.value
        : value >= threshold.value;
    if (reached) return threshold.points;
  }
  return 0;
}

function eventFamily(eventKey) {
  if (eventKey.includes("haies")) return "hurdles";
  if (eventKey.includes("marche") || /^(?:1000m|2000m)/.test(eventKey)) return "middle";
  if (/^(?:50m|80m|120m|4x60m)/.test(eventKey)) return "sprint";
  if (/^(?:hauteur|longueur|perche|triplesaut)$/.test(eventKey)) return "jumps";
  return "throws";
}

function familyLabel(family) {
  return {
    hurdles: "Course · haies",
    sprint: "Course · sprint",
    middle: "Course · demi-fond",
    jumps: "Concours · saut",
    throws: "Concours · lancer",
    relay: "Relais mixte",
  }[family];
}

function normalizeEvent(value) {
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
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separator, letter) => {
      return separator + letter.toUpperCase();
    });
}

function selectedValue(inputs) {
  return inputs.find((input) => input.checked)?.value || "";
}

async function fetchJson(objectKey) {
  const response = await fetch(
    `${R2_ORIGIN}/${R2_DATA_PREFIX}/${String(objectKey).replace(/^\/+/, "")}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchTextWithFallback(urls) {
  for (const url of urls) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return response.text();
  }
  throw new Error("Barème introuvable");
}

function message(text) {
  return Object.assign(document.createElement("p"), {
    className: "empty",
    textContent: text,
  });
}
