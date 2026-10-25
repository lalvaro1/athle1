const R2_ORIGIN = "https://pub-e5058c16a56f4bf5ba83dcdbd80dc5b3.r2.dev";
const R2_DATA_PREFIX = "data";

const resultTitleEl = document.querySelector("#virtual-team-result-title");
const resultNoteEl = document.querySelector("#virtual-team-result-note");
const scoreEl = document.querySelector("#virtual-team-score");
const eventsEl = document.querySelector("#virtual-team-events");
const categoryInputs = [...document.querySelectorAll('input[name="virtual-category"]')];
const rulesInputs = [...document.querySelectorAll('input[name="virtual-rules"]')];

const CATEGORY_EVENT_RULES = {
  U14: {
    excluded: new Set(),
    groups: new Map(),
  },
  U16: {
    excluded: new Set(["50m", "50mhaies"]),
    groups: new Map([
      [
        "80mhaies",
        {
          key: "u16-haies-courtes",
          label: "80 m haies / 100 m haies",
        },
      ],
      [
        "100mhaies",
        {
          key: "u16-haies-courtes",
          label: "80 m haies / 100 m haies",
        },
      ],
    ]),
  },
};

/** @type {Array<Record<string, any>>} */
let athletes = [];
/** @type {Map<string, { label: string, direction: "lower"|"higher", scale: Array<{points:number,value:number}> }>} */
let cotations = new Map();

for (const input of [...categoryInputs, ...rulesInputs]) {
  input.addEventListener("change", renderSelection);
}

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

function renderSelection() {
  if (!athletes.length || !cotations.size) return;

  const category = selectedValue(categoryInputs);
  const rules = selectedValue(rulesInputs);
  if (rules !== "N1") {
    resultTitleEl.textContent = "Règles N2";
    resultNoteEl.textContent = "Le calcul N2 sera ajouté prochainement.";
    scoreEl.textContent = "—";
    eventsEl.replaceChildren(message("Sélectionne N1 pour afficher une composition."));
    return;
  }

  const eligible = athletes.filter(
    (athlete) => String(athlete.youthCategory || "").toUpperCase() === category,
  );
  const candidates = buildCandidates(eligible, category);
  const selection = optimizeN1(candidates);
  const total = selection.reduce((sum, entry) => sum + entry.points, 0);
  const athleteCount = new Set(selection.map((entry) => String(entry.athlete.athleteId))).size;

  resultTitleEl.textContent =
    category === "U14" ? "Team Benjamins N1" : "Team Minimes N1";
  resultNoteEl.textContent = `${athleteCount} athlète${athleteCount > 1 ? "s" : ""} retenu${
    athleteCount > 1 ? "s" : ""
  } · filles et garçons réunis · calcul basé sur les PB`;
  scoreEl.textContent = `${total} pts`;
  renderEvents(selection);
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
      const teamEvent = resolveTeamEvent(
        selectedCategory,
        cotationEventKey,
        scale.label,
      );
      if (!teamEvent) continue;
      const points = performancePoints(entry.pb, scale);
      if (points <= 0) continue;
      const candidate = {
        athlete,
        eventKey: teamEvent.key,
        eventLabel: teamEvent.label,
        cotationEventKey,
        performance: entry.pb,
        points,
        family: eventFamily(cotationEventKey),
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

function resolveTeamEvent(category, cotationEventKey, defaultLabel) {
  const rules = CATEGORY_EVENT_RULES[category];
  if (rules?.excluded.has(cotationEventKey)) return null;
  return (
    rules?.groups.get(cotationEventKey) || {
      key: cotationEventKey,
      label: defaultLabel,
    }
  );
}

/**
 * B-matching pondéré :
 * - 3 épreuves maximum par athlète ;
 * - 2 courses et 2 concours maximum ;
 * - une seule course de chaque type ;
 * - une seule contribution comptabilisée par épreuve.
 */
function optimizeN1(candidates) {
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
      addEdge(graph, source, total, 3, 0);
      addEdge(graph, total, races, 2, 0);
      addEdge(graph, total, contests, 2, 0);
      addEdge(graph, races, sprint, 1, 0);
      addEdge(graph, races, hurdles, 1, 0);
      addEdge(graph, races, middle, 1, 0);
      athleteNodes.set(athleteId, { contests, sprint, hurdles, middle });
    }
    if (!eventNodes.has(candidate.eventKey)) {
      const eventNode = addNode(graph);
      addEdge(graph, eventNode, sink, 1, 0);
      eventNodes.set(candidate.eventKey, eventNode);
    }
  }

  for (const candidate of candidates) {
    const nodes = athleteNodes.get(String(candidate.athlete.athleteId));
    const from = candidate.family === "contest" ? nodes.contests : nodes[candidate.family];
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
    eventsEl.append(message("Aucune performance cotée pour cette catégorie."));
    return;
  }

  for (const entry of selection) {
    const row = document.createElement("article");
    row.className = "virtual-team-event";

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
    athlete.append(
      Object.assign(document.createElement("strong"), {
        textContent: formatAthleteName(entry.athlete.name),
      }),
      Object.assign(document.createElement("span"), {
        textContent: entry.athlete.categoryCode || "",
      }),
    );

    const performance = document.createElement("div");
    performance.className = "virtual-team-event__performance";
    performance.append(
      Object.assign(document.createElement("strong"), { textContent: entry.performance }),
      Object.assign(document.createElement("span"), {
        textContent: `${entry.points} pts`,
      }),
    );
    row.append(event, athlete, performance);
    eventsEl.append(row);
  }
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
  return "contest";
}

function familyLabel(family) {
  return {
    hurdles: "Course · haies",
    sprint: "Course · sprint",
    middle: "Course · demi-fond",
    contest: "Concours",
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
