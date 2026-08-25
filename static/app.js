const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const layerNames = { ux: "EXPERIENCE MAP", app: "APPLICATION MAP", db: "DATA MAP" };
const layerCoordinates = { ux: "PLANE +07", app: "PLANE ±00", db: "PLANE −07" };
const colorHex = { cyan: "#9cff32", amber: "#ff9e43", violet: "#a663ff", rose: "#ff5e89", lime: "#c7ff3d", blue: "#45d9ff", indigo: "#7f8cff", aqua: "#42f5d4" };
const kindColor = { class: "#b267ff", struct: "#b267ff", protocol: "#42f5d4", enum: "#a663ff", actor: "#7f8cff", module: "#45d9ff", function: "#baff35", method: "#45d9ff", screen: "#45d9ff", entry: "#c7ff3d", database: "#c7ff3d", table: "#a663ff", repository: "#45d9ff", cache: "#42f5d4", store: "#9cff32", external: "#7f8cff" };
const kindSigil = { class: "C", struct: "S", protocol: "P", enum: "E", actor: "A", module: "M", function: "ƒ", method: "m", screen: "▣", entry: "◆", database: "DB", table: "▦", repository: "R", cache: "C", store: "S", external: "↗" };
const kindOrder = ["class", "struct", "protocol", "enum", "actor", "module", "function", "method"];
const typeKinds = new Set(["class", "struct", "protocol", "enum", "actor"]);
const savedRouteMode = localStorage.getItem("cyber-soul-route-mode");
const savedOptionalRules = (() => {
  try {
    const value = JSON.parse(localStorage.getItem("cyber-soul-optional-rules") || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
})();

const state = {
  data: null,
  activeLayer: "app",
  scope: { category: null, file: null },
  selected: null,
  selectedColor: "cyan",
  routeMode: ["focus", "primary", "off"].includes(savedRouteMode) ? savedRouteMode : "focus",
  hoverRouteFocus: null,
  mapSelection: null,
  filter: "",
  expandedTypes: new Set(),
  optionalRules: new Set(savedOptionalRules.filter((rule) => ["no-silent-failure", "deep-indentation"].includes(rule))),
};

let routeRecords = [];
let routeTimer = 0;
let draggedSymbolId = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function slug(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `region-${Date.now()}`;
}

function currentLayer() {
  return state.data?.layers[state.activeLayer];
}

function scopeLevel() {
  if (currentLayer()?.mode === "journey") return "journey";
  if (currentLayer()?.mode === "data-flow") return "data-flow";
  if (state.scope.file) return "symbols";
  if (state.scope.category) return "files";
  return "regions";
}

function isOverviewLevel() {
  return scopeLevel() === "regions" || scopeLevel() === "journey" || scopeLevel() === "data-flow";
}

function currentCategory() {
  return currentLayer()?.categories.find((category) => category.id === state.scope.category);
}

function categoryColor(category) {
  const color = category?.color;
  if (color === "rose") return colorHex.indigo;
  if (color === "amber") return colorHex.aqua;
  return colorHex[color] || colorHex.cyan;
}

function includesFilter(...values) {
  if (!state.filter) return true;
  const needle = state.filter.toLowerCase();
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}

function qualitySearchValues(issues = []) {
  return issues.flatMap((issue) => [issue.code, `rule ${issue.charterRule}`, issue.title, issue.message, issue.severity]);
}

function uniqueQualityIssues(issues = []) {
  return [...new Map(issues.map((issue) => [
    `${issue.file}:${issue.line}:${issue.code}`, issue,
  ])).values()];
}

function qualityIssuesForMembers(members, layer = currentLayer()) {
  const files = new Set(members.map((node) => node.file));
  const memberIssues = members.flatMap((node) => node.qualityIssues || []);
  const allAttachedKeys = new Set(
    (layer?.nodes || [])
      .filter((node) => files.has(node.file))
      .flatMap((node) => node.qualityIssues || [])
      .map((issue) => `${issue.file}:${issue.line}:${issue.code}`),
  );
  const unownedFileIssues = [...files].flatMap((file) =>
    (state.data.quality?.files?.[file] || []).filter((issue) =>
      !allAttachedKeys.has(`${issue.file}:${issue.line}:${issue.code}`),
    ),
  );
  return uniqueQualityIssues([...memberIssues, ...unownedFileIssues]);
}

function qualityDetailsHtml(issues = [], compact = false) {
  return issues.map((issue) => `
    <span class="quality-entry ${escapeHtml(issue.severity)} ${compact ? "compact" : ""}">
      <strong>${escapeHtml(issue.code)} · ${issue.optional ? "OPTIONAL" : `RULE ${escapeHtml(issue.charterRule)}`} · LINE ${escapeHtml(issue.line)}</strong>
      <span>${escapeHtml(issue.title)}</span>
      <code>${escapeHtml(issue.evidence || "Source evidence unavailable")}</code>
      <small>${escapeHtml(issue.message)}</small>
    </span>`).join("");
}

function cardShell({ mapId, classes, color, sigil, name, path, metrics, footer, draggable = false, issues = [] }) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `map-card ${classes}`;
  card.dataset.mapId = mapId;
  card.style.setProperty("--card-color", color);
  card.draggable = draggable;
  card.innerHTML = `
    <span class="map-card-head">
      <span class="map-sigil"><span>${escapeHtml(sigil)}</span></span>
      <span style="min-width:0"><h3>${escapeHtml(name)}</h3><small class="card-path">${escapeHtml(path)}</small></span>
    </span>
    ${issues.length ? `<span class="quality-breakdown"><span class="quality-heading">⚠ ${issues.length} RULE ${issues.length === 1 ? "BREACH" : "BREACHES"}</span>${qualityDetailsHtml(issues)}</span>` : ""}
    ${metrics ? `<span class="card-metrics">${metrics.map(([value, label]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`).join("")}</span>` : ""}
    ${footer ? `<span class="card-footer"><span>${escapeHtml(footer[0])}</span><b>${escapeHtml(footer[1])}</b></span>` : ""}`;
  card.addEventListener("mouseenter", () => { state.hoverRouteFocus = mapId; scheduleRoutes(); });
  card.addEventListener("mouseleave", () => { if (state.hoverRouteFocus === mapId) state.hoverRouteFocus = null; scheduleRoutes(); });
  return card;
}

function inspectFromFolder(node, categoryId) {
  state.scope = { category: categoryId, file: node.file };
  state.filter = "";
  $("#map-filter").value = "";
  renderMap();
  inspectNode(node.id, state.activeLayer);
}

function buildTypeTree(members) {
  const types = members.filter((node) => typeKinds.has(node.kind));
  const children = new Map(types.map((node) => [node.id, []]));
  const roots = [];
  const loose = [];
  const findOwner = (node) => {
    if (!node.parent) return null;
    return types.find((type) => type.name === node.parent && type.file === node.file)
      || types.find((type) => type.name === node.parent)
      || null;
  };
  types.forEach((type) => {
    const owner = findOwner(type);
    if (owner && owner.id !== type.id) children.get(owner.id).push(type);
    else roots.push(type);
  });
  members.filter((node) => !typeKinds.has(node.kind)).forEach((node) => {
    const owner = findOwner(node);
    if (owner) children.get(owner.id).push(node);
    else loose.push(node);
  });
  const sortNodes = (items) => items.sort((a, b) => {
    const kindDelta = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    return kindDelta || a.name.localeCompare(b.name) || a.line - b.line;
  });
  roots.sort((a, b) => a.name.localeCompare(b.name) || a.line - b.line);
  children.forEach(sortNodes);
  sortNodes(loose);
  return { roots, children, loose };
}

function appendMemberButton(container, node, categoryId, nested = false) {
  const feature = document.createElement("button");
  feature.type = "button";
  const issues = node.qualityIssues || [];
  feature.className = `folder-feature ${nested ? "nested" : ""} ${issues.length ? "quality-breach" : ""} ${includesFilter(node.name, node.kind, node.signature, node.file, node.parent, ...qualitySearchValues(issues)) ? "" : "filtered-out"}`;
  feature.setAttribute("aria-label", `Inspect ${node.kind} ${node.name}`);
  feature.innerHTML = `<i style="--feature-color:${kindColor[node.kind] || colorHex.cyan}">${escapeHtml(kindSigil[node.kind] || "•")}</i><strong>${escapeHtml(node.name)}${issues.length ? `<em>⚠${issues.length}</em>` : ""}</strong><span>${escapeHtml(issues.length ? `⚠ ${issues.length}` : node.kind)}</span>`;
  feature.addEventListener("click", () => inspectFromFolder(node, categoryId));
  container.appendChild(feature);
}

function appendTypeGroup(container, type, children, categoryId) {
  const key = `${state.activeLayer}:${categoryId}:${type.id}`;
  const owned = children.get(type.id) || [];
  const expanded = state.expandedTypes.has(key) || Boolean(state.filter && owned.some((node) => includesFilter(node.name, node.kind, node.signature, node.file, node.parent)));
  const group = document.createElement("section");
  const issues = type.qualityIssues || [];
  group.className = `folder-type ${issues.length ? "quality-breach" : ""} ${includesFilter(type.name, type.kind, type.signature, type.file, ...qualitySearchValues(issues), ...owned.flatMap((node) => [node.name, node.kind, node.signature, ...qualitySearchValues(node.qualityIssues)])) ? "" : "filtered-out"}`;
  const row = document.createElement("div");
  row.className = "folder-type-row";
  row.innerHTML = `
    <button class="folder-type-toggle" type="button" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse" : "Expand"} ${escapeHtml(type.kind)} ${escapeHtml(type.name)}">
      <i style="--feature-color:${kindColor[type.kind] || colorHex.violet}">${escapeHtml(kindSigil[type.kind] || "T")}</i>
      <strong>${escapeHtml(type.name)}${issues.length ? `<em>⚠${issues.length}</em>` : ""}</strong><span>${issues.length ? `⚠ ${issues.length}` : owned.length}</span><b>${expanded ? "−" : "+"}</b>
    </button>
    <button class="folder-type-inspect" type="button" aria-label="Inspect ${escapeHtml(type.kind)} ${escapeHtml(type.name)}">◎</button>`;
  const childList = document.createElement("div");
  childList.className = "folder-type-members";
  childList.hidden = !expanded;
  if (issues.length) childList.insertAdjacentHTML("beforeend", `<span class="folder-quality-details">${qualityDetailsHtml(issues, true)}</span>`);
  owned.forEach((node) => {
    if (typeKinds.has(node.kind)) appendTypeGroup(childList, node, children, categoryId);
    else appendMemberButton(childList, node, categoryId, true);
  });
  if (!owned.length) childList.insertAdjacentHTML("beforeend", `<span class="folder-type-empty">NO PARSED MEMBERS</span>`);
  row.querySelector(".folder-type-toggle").addEventListener("click", () => {
    const open = childList.hidden;
    childList.hidden = !open;
    row.querySelector(".folder-type-toggle").setAttribute("aria-expanded", String(open));
    row.querySelector(".folder-type-toggle").setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${type.kind} ${type.name}`);
    row.querySelector(".folder-type-toggle b").textContent = open ? "−" : "+";
    if (open) state.expandedTypes.add(key);
    else state.expandedTypes.delete(key);
  });
  row.querySelector(".folder-type-inspect").addEventListener("click", () => inspectFromFolder(type, categoryId));
  group.append(row, childList);
  container.appendChild(group);
}

function aggregateRoutes(items, resolveEnds) {
  const routes = new Map();
  items.forEach((item) => {
    const ends = resolveEnds(item);
    if (!ends || ends[0] === ends[1]) return;
    const [from, to] = ends.sort();
    const key = `${from}\u0000${to}`;
    const existing = routes.get(key) || { from, to, weight: 0, type: item.type };
    existing.weight += 1;
    routes.set(key, existing);
  });
  return [...routes.values()].sort((a, b) => b.weight - a.weight);
}

function renderJourneyMap(layer) {
  const grid = $("#map-grid");
  grid.className = "map-grid journey-map";
  const nodeById = new Map(layer.nodes.map((node) => [node.id, node]));
  const groupedRoutes = new Map();
  layer.edges.forEach((edge) => {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to) || edge.from === edge.to) return;
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.type}`;
    const route = groupedRoutes.get(key) || { from: `screen:${edge.from}`, to: `screen:${edge.to}`, type: edge.type, weight: 0, evidence: [], sources: [] };
    route.weight += 1;
    if (edge.evidence && !route.evidence.includes(edge.evidence)) route.evidence.push(edge.evidence);
    const source = `${edge.file || "source"}:${edge.line || "?"}`;
    if (!route.sources.includes(source)) route.sources.push(source);
    groupedRoutes.set(key, route);
  });
  routeRecords = [...groupedRoutes.values()];

  const outgoing = new Map(layer.nodes.map((node) => [node.id, []]));
  layer.edges.forEach((edge) => { if (outgoing.has(edge.from)) outgoing.get(edge.from).push(edge); });
  const entryIds = layer.nodes.filter((node) => node.category === "entry").map((node) => node.id);
  const depth = new Map(entryIds.map((id) => [id, 0]));
  const queue = [...entryIds];
  while (queue.length) {
    const source = queue.shift();
    const nextDepth = Math.min(5, (depth.get(source) || 0) + 1);
    (outgoing.get(source) || []).forEach((edge) => {
      if (!depth.has(edge.to)) {
        depth.set(edge.to, nextDepth);
        queue.push(edge.to);
      }
    });
  }
  const fallbackDepth = { entry: 0, primary: 1, screens: 2, details: 3, overlays: 3 };
  const columns = new Map();
  layer.nodes.forEach((node) => {
    const column = depth.get(node.id) ?? fallbackDepth[node.category] ?? 4;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  });
  columns.forEach((nodes) => nodes.sort((a, b) => a.name.localeCompare(b.name)));
  const cardWidth = 286, cardHeight = 228, gapX = 92, gapY = 62;
  const maxColumn = Math.max(0, ...columns.keys());
  const maxRows = Math.max(1, ...[...columns.values()].map((nodes) => nodes.length));
  grid.style.width = `${(maxColumn + 1) * (cardWidth + gapX) + 150}px`;
  grid.style.height = `${maxRows * (cardHeight + gapY) + 140}px`;

  columns.forEach((nodes, column) => nodes.forEach((node, row) => {
    const category = layer.categories.find((item) => item.id === node.category);
    const matches = includesFilter(node.name, node.title, node.sourceName, node.file, ...(node.actions || []));
    const card = document.createElement("article");
    card.className = `category-folder journey-screen ${state.mapSelection === node.id ? "selected" : ""} ${matches ? "" : "filtered-out"}`;
    card.dataset.mapId = `screen:${node.id}`;
    card.dataset.screen = node.id;
    card.style.setProperty("--card-color", categoryColor(category));
    card.style.left = `${70 + column * (cardWidth + gapX)}px`;
    card.style.top = `${30 + row * (cardHeight + gapY) + (column % 2 ? 24 : 0)}px`;
    const transitions = (outgoing.get(node.id) || []).map((edge) => ({ edge, target: nodeById.get(edge.to) })).filter((item) => item.target);
    card.innerHTML = `
      <header class="folder-header">
        <button class="folder-select" type="button" aria-label="Select screen ${escapeHtml(node.name)}">
          <span class="journey-screen-sigil">${node.kind === "entry" ? "◆" : "▣"}</span>
          <span><strong>${escapeHtml(node.title || node.name)}</strong><small>${escapeHtml(category?.name || "Screen")} // ${transitions.length} exits</small></span>
        </button>
        <button class="folder-enter journey-inspect" type="button" aria-label="Inspect screen ${escapeHtml(node.name)}">SOURCE ◎</button>
      </header>
      <div class="folder-list-label"><span>USER ACTIONS / EXITS</span><b>${(node.actions || []).length + transitions.length}</b></div>
      <div class="folder-feature-list journey-action-list" aria-label="Actions available on ${escapeHtml(node.name)}"></div>`;
    const list = card.querySelector(".journey-action-list");
    transitions.forEach(({ edge, target }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "folder-feature journey-transition";
      const evidenceLabel = edge.evidence?.match(/switch case (\.[A-Za-z_]\w*)/)?.[1]
        || (edge.evidence?.startsWith("RootScene tab:") ? "tab" : edge.type);
      button.title = `${edge.evidence || edge.type} // ${edge.file || node.file}:${edge.line || node.line}`;
      button.setAttribute("aria-label", `Follow ${edge.type} path to ${target.name}; evidence ${edge.evidence || edge.type}`);
      button.innerHTML = `<i style="--feature-color:${categoryColor(category)}">→</i><strong>${escapeHtml(target.name)}</strong><span>${escapeHtml(evidenceLabel)}</span>`;
      button.addEventListener("click", () => selectJourneyScreen(layer, target.id));
      list.appendChild(button);
    });
    (node.actions || []).forEach((action) => {
      const rowElement = document.createElement("div");
      rowElement.className = `folder-feature journey-action ${includesFilter(action, node.name) ? "" : "filtered-out"}`;
      rowElement.innerHTML = `<i style="--feature-color:${colorHex.amber}">•</i><strong>${escapeHtml(action)}</strong><span>ACTION</span>`;
      list.appendChild(rowElement);
    });
    if (!list.children.length) list.innerHTML = `<span class="folder-type-empty">NO EXPLICIT USER ACTIONS DETECTED</span>`;
    card.querySelector(".folder-select").addEventListener("click", () => selectJourneyScreen(layer, node.id));
    card.querySelector(".journey-inspect").addEventListener("click", () => inspectNode(node.id, state.activeLayer));
    grid.appendChild(card);
  }));
  const matched = layer.nodes.filter((node) => includesFilter(node.name, node.title, node.sourceName, node.file, ...(node.actions || []))).length;
  $("#visible-count").textContent = `${matched} MATCH // ${layer.nodes.length} SCREENS VISIBLE`;
  $("#map-status").textContent = `${layer.nodes.length} SCREENS // ${routeRecords.length} USER PATHS`;
  selectJourneyScreen(layer, state.mapSelection || entryIds[0] || null);
}

function selectJourneyScreen(layer, screenId) {
  const screen = layer.nodes.find((node) => node.id === screenId);
  state.mapSelection = screen?.id || null;
  state.hoverRouteFocus = null;
  $$(".journey-screen").forEach((card) => card.classList.toggle("selected", card.dataset.screen === state.mapSelection));
  const summary = $("#route-summary");
  if (!screen) {
    summary.hidden = true;
    summary.replaceChildren();
    scheduleRoutes();
    return;
  }
  const focusId = `screen:${screen.id}`;
  const connections = routeRecords.filter((route) => route.from === focusId || route.to === focusId).map((route) => {
    const outgoing = route.from === focusId;
    const otherId = (outgoing ? route.to : route.from).replace(/^screen:/, "");
    return { ...route, outgoing, screen: layer.nodes.find((node) => node.id === otherId) };
  }).filter((item) => item.screen).sort((a, b) => Number(b.outgoing) - Number(a.outgoing) || a.screen.name.localeCompare(b.screen.name));
  const strongest = new Set(connections.slice(0, 6).map((item) => item.screen.id));
  $$(".journey-screen").forEach((card) => card.classList.toggle("connected", strongest.has(card.dataset.screen)));
  const category = layer.categories.find((item) => item.id === screen.category);
  summary.hidden = false;
  summary.style.setProperty("--card-color", categoryColor(category));
  summary.innerHTML = `<strong>${escapeHtml(screen.name)}</strong><span>PROVEN PATHS</span>${connections.slice(0, 7).map((item) => {
    const evidence = item.evidence?.join(" / ") || item.type;
    const source = item.sources?.join("; ") || "source unavailable";
    return `<button type="button" data-target-screen="${escapeHtml(item.screen.id)}" title="${escapeHtml(evidence)} // ${escapeHtml(source)}">${item.outgoing ? "→" : "←"} ${escapeHtml(item.screen.name)} <b>${escapeHtml(evidence)}</b></button>`;
  }).join("")}${connections.length > 7 ? `<span>+${connections.length - 7} MORE</span>` : ""}`;
  summary.querySelectorAll("[data-target-screen]").forEach((button) => button.addEventListener("click", () => selectJourneyScreen(layer, button.dataset.targetScreen)));
  scheduleRoutes();
}

function renderDataMap(layer) {
  const grid = $("#map-grid");
  grid.className = "map-grid data-map";
  const nodeById = new Map(layer.nodes.map((node) => [node.id, node]));
  routeRecords = layer.edges
    .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to) && edge.from !== edge.to)
    .map((edge) => ({
      from: `data:${edge.from}`,
      to: `data:${edge.to}`,
      type: edge.type,
      weight: 1,
      evidence: edge.evidence ? [edge.evidence] : [],
      sources: [`${edge.file || "source"}:${edge.line || "?"}`],
    }));
  const relations = new Map(layer.nodes.map((node) => [node.id, []]));
  layer.edges.forEach((edge) => {
    if (relations.has(edge.from)) relations.get(edge.from).push({ edge, other: nodeById.get(edge.to), outgoing: true });
    if (relations.has(edge.to)) relations.get(edge.to).push({ edge, other: nodeById.get(edge.from), outgoing: false });
  });

  const lanes = [
    { kinds: ["cache", "repository", "store"], x: 50 },
    { kinds: ["database", "external"], x: 390 },
    { kinds: ["table"], x: 730, columns: 3 },
  ];
  const affinityPriority = (node) => Math.min(
    ...(relations.get(node.id) || []).map((item) => ({ cache: 0, repository: 1, store: 2, database: 3 }[item.other?.kind] ?? 4)),
    4,
  );
  const cardWidth = 270, cardHeight = 154, gapX = 58, gapY = 34;
  let mapHeight = 700;
  lanes.forEach((lane) => {
    const nodes = layer.nodes
      .filter((node) => lane.kinds.includes(node.kind))
      .sort((a, b) => lane.kinds.indexOf(a.kind) - lane.kinds.indexOf(b.kind)
        || (a.kind === "database" ? (relations.get(b.id)?.length || 0) - (relations.get(a.id)?.length || 0) : 0)
        || (a.kind === "table" ? affinityPriority(a) - affinityPriority(b) : 0)
        || a.name.localeCompare(b.name));
    const columns = lane.columns || 1;
    const cacheTableCount = lane.kinds.includes("table") ? nodes.filter((node) => affinityPriority(node) === 0).length : 0;
    nodes.forEach((node, index) => {
      const cacheTable = node.kind === "table" && affinityPriority(node) === 0;
      const tableIndex = index - cacheTableCount;
      const column = cacheTable ? 0 : Math.max(0, tableIndex) % columns;
      const row = cacheTable ? index : cacheTableCount + Math.floor(Math.max(0, tableIndex) / columns);
      const connected = (relations.get(node.id) || []).filter((item) => item.other);
      const searchable = connected.flatMap((item) => [item.other.name, item.edge.type]);
      const matches = includesFilter(node.name, node.kind, node.file, ...(node.fields || []), ...searchable);
      const card = document.createElement("article");
      card.className = `category-folder data-resource data-${node.kind} ${state.mapSelection === node.id ? "selected" : ""} ${matches ? "" : "filtered-out"}`;
      card.dataset.mapId = `data:${node.id}`;
      card.dataset.resource = node.id;
      card.style.setProperty("--card-color", kindColor[node.kind] || colorHex.cyan);
      card.style.left = `${lane.x + column * (cardWidth + gapX)}px`;
      card.style.top = `${30 + row * (cardHeight + gapY) + (column % 2 ? 18 : 0)}px`;
      mapHeight = Math.max(mapHeight, 30 + (row + 1) * (cardHeight + gapY) + 90);
      const listItems = node.kind === "table"
        ? (node.fields || []).map((field) => ({ label: field, detail: "COLUMN" }))
        : connected.map((item) => ({
          label: item.other.name,
          detail: `${item.outgoing ? "→" : "←"} ${item.edge.type}`,
          target: item.other.id,
        }));
      card.innerHTML = `
        <header class="folder-header">
          <button class="folder-select" type="button" aria-label="Select data resource ${escapeHtml(node.name)}">
            <span class="data-resource-sigil">${escapeHtml(kindSigil[node.kind] || "•")}</span>
            <span><strong>${escapeHtml(node.name)}</strong><small>${escapeHtml(node.kind)} // ${connected.length} flows</small></span>
          </button>
          <button class="folder-enter data-inspect" type="button" aria-label="Inspect evidence for ${escapeHtml(node.name)}">SOURCE ◎</button>
        </header>
        <div class="folder-list-label"><span>${node.kind === "table" ? "COLUMNS" : "CONNECTED DATA"}</span><b>${listItems.length}</b></div>
        <div class="folder-feature-list data-resource-list"></div>`;
      const list = card.querySelector(".data-resource-list");
      listItems.slice(0, 5).forEach((item) => {
        const rowElement = document.createElement(item.target ? "button" : "div");
        if (item.target) rowElement.type = "button";
        rowElement.className = "folder-feature data-resource-row";
        rowElement.innerHTML = `<i style="--feature-color:${kindColor[node.kind] || colorHex.cyan}">${item.target ? "→" : "·"}</i><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span>`;
        if (item.target) rowElement.addEventListener("click", () => selectDataResource(layer, item.target));
        list.appendChild(rowElement);
      });
      if (listItems.length > 5) list.insertAdjacentHTML("beforeend", `<span class="folder-type-empty">+${listItems.length - 5} MORE // SELECT TO DECODE</span>`);
      if (!listItems.length) list.innerHTML = `<span class="folder-type-empty">NO RESOLVED DATA PATHS</span>`;
      card.querySelector(".folder-select").addEventListener("click", () => selectDataResource(layer, node.id));
      card.querySelector(".data-inspect").addEventListener("click", () => {
        selectDataResource(layer, node.id);
        inspectNode(node.id, state.activeLayer);
      });
      card.addEventListener("mouseenter", () => { state.hoverRouteFocus = `data:${node.id}`; scheduleRoutes(); });
      card.addEventListener("mouseleave", () => { if (state.hoverRouteFocus === `data:${node.id}`) state.hoverRouteFocus = null; scheduleRoutes(); });
      grid.appendChild(card);
    });
  });
  grid.style.width = "1750px";
  grid.style.height = `${mapHeight}px`;
  const matched = layer.nodes.filter((node) => {
    const connected = (relations.get(node.id) || []).filter((item) => item.other);
    return includesFilter(node.name, node.kind, node.file, ...(node.fields || []), ...connected.flatMap((item) => [item.other.name, item.edge.type]));
  }).length;
  $("#visible-count").textContent = `${matched} MATCH // ${layer.nodes.length} RESOURCES VISIBLE`;
  $("#map-status").textContent = `${layer.nodes.length} DATA RESOURCES // ${routeRecords.length} PROVEN FLOWS`;
  selectDataResource(layer, state.mapSelection);
}

function selectDataResource(layer, resourceId) {
  const resource = layer.nodes.find((node) => node.id === resourceId);
  state.mapSelection = resource?.id || null;
  state.hoverRouteFocus = null;
  $$(".data-resource").forEach((card) => {
    card.classList.toggle("selected", card.dataset.resource === state.mapSelection);
    card.classList.remove("connected");
  });
  const summary = $("#route-summary");
  if (!resource) {
    summary.hidden = true;
    summary.replaceChildren();
    scheduleRoutes();
    return;
  }
  const focusId = `data:${resource.id}`;
  const connections = routeRecords.filter((route) => route.from === focusId || route.to === focusId).map((route) => {
    const outgoing = route.from === focusId;
    const otherId = (outgoing ? route.to : route.from).replace(/^data:/, "");
    return { ...route, outgoing, resource: layer.nodes.find((node) => node.id === otherId) };
  }).filter((item) => item.resource).sort((a, b) => a.resource.name.localeCompare(b.resource.name));
  const connectedIds = new Set(connections.map((item) => item.resource.id));
  $$(".data-resource").forEach((card) => card.classList.toggle("connected", connectedIds.has(card.dataset.resource)));
  summary.hidden = false;
  summary.style.setProperty("--card-color", kindColor[resource.kind] || colorHex.cyan);
  summary.innerHTML = `<strong>${escapeHtml(resource.name)}</strong><span>DATA FLOWS</span>${connections.slice(0, 7).map((item) => {
    const evidence = item.evidence?.join(" / ") || item.type;
    const source = item.sources?.join("; ") || "source unavailable";
    return `<button type="button" data-target-resource="${escapeHtml(item.resource.id)}" title="${escapeHtml(evidence)} // ${escapeHtml(source)}">${item.outgoing ? "→" : "←"} ${escapeHtml(item.resource.name)} <b>${escapeHtml(item.type.toUpperCase())}</b></button>`;
  }).join("")}${connections.length > 7 ? `<span>+${connections.length - 7} MORE</span>` : ""}`;
  summary.querySelectorAll("[data-target-resource]").forEach((button) => button.addEventListener("click", () => selectDataResource(layer, button.dataset.targetResource)));
  scheduleRoutes();
}

function renderRegions(layer) {
  const grid = $("#map-grid");
  grid.className = "map-grid regions category-map";
  const categoryByNode = new Map(layer.nodes.map((node) => [node.id, node.category]));
  routeRecords = aggregateRoutes(layer.edges, (edge) => {
    const from = categoryByNode.get(edge.from), to = categoryByNode.get(edge.to);
    return from && to ? [`category:${from}`, `category:${to}`] : null;
  });

  const folderData = layer.categories.map((category) => {
    const members = layer.nodes.filter((node) => node.category === category.id);
    const files = new Set(members.map((node) => node.file));
    const qualityIssues = qualityIssuesForMembers(members, layer);
    const qualitySeverity = qualityIssues.some((issue) => issue.severity === "error") ? "error" : "warning";
    const id = `category:${category.id}`;
    const routeCount = routeRecords.filter((route) => route.from === id || route.to === id).length;
    const matches = includesFilter(category.name, ...qualitySearchValues(qualityIssues), ...members.flatMap((node) => [node.name, node.file]));
    return { category, members, files, qualityIssues, qualitySeverity, id, routeCount, matches };
  }).sort((a, b) => b.qualityIssues.length - a.qualityIssues.length || b.members.length - a.members.length || a.category.name.localeCompare(b.category.name));

  const columns = 4;
  const cardWidth = 286;
  const cardHeight = 228;
  const gapX = 78;
  const gapY = 74;
  grid.style.width = `${columns * (cardWidth + gapX) + 150}px`;
  grid.style.height = `${Math.ceil(folderData.length / columns) * (cardHeight + gapY) + 140}px`;
  folderData.forEach((entry, index) => {
    const { category, members, qualityIssues, qualitySeverity, id, routeCount, matches } = entry;
    const col = index % columns;
    const row = Math.floor(index / columns);
    const offsetX = row % 2 ? 42 : 0;
    const offsetY = col % 2 ? 24 : 0;
    const folder = document.createElement("article");
    folder.className = `category-folder ${qualityIssues.length ? `has-quality-breaches ${qualitySeverity}` : ""} ${state.mapSelection === category.id ? "selected" : ""} ${matches ? "" : "filtered-out"}`;
    folder.dataset.mapId = id;
    folder.dataset.category = category.id;
    folder.style.setProperty("--card-color", categoryColor(category));
    folder.style.left = `${70 + col * (cardWidth + gapX) + offsetX}px`;
    folder.style.top = `${30 + row * (cardHeight + gapY) + offsetY}px`;
    const tree = buildTypeTree(members);
    const typeCount = tree.roots.length;
    folder.innerHTML = `
      <header class="folder-header">
        <button class="folder-select" type="button" aria-label="Select folder ${escapeHtml(category.name)}">
          <span class="folder-tab"></span>
          <span><strong>${escapeHtml(category.name)}</strong><small>${typeCount} types // ${members.length} symbols // ${routeCount} links</small>${qualityIssues.length ? `<em class="region-breach-count ${qualitySeverity}">⚠ ${qualityIssues.length} ${qualityIssues.length === 1 ? "BREACH" : "BREACHES"}</em>` : `<em class="region-quality-clear">✓ NO BREACHES</em>`}</span>
        </button>
        <button class="folder-enter" type="button" aria-label="Open folder ${escapeHtml(category.name)}">OPEN →</button>
      </header>
      <div class="folder-list-label"><span>CLASSES / TYPES</span><b>${typeCount}</b></div>
      <div class="folder-feature-list" aria-label="Classes and types in ${escapeHtml(category.name)}"></div>`;
    const featureList = folder.querySelector(".folder-feature-list");
    tree.roots.forEach((type) => appendTypeGroup(featureList, type, tree.children, category.id));
    if (tree.loose.length) {
      const looseGroup = document.createElement("section");
      looseGroup.className = `folder-type module-symbols ${includesFilter(...tree.loose.flatMap((node) => [node.name, node.kind, node.signature])) ? "" : "filtered-out"}`;
      const looseKey = `${state.activeLayer}:${category.id}:module-symbols`;
      const looseExpanded = state.expandedTypes.has(looseKey) || Boolean(state.filter && tree.loose.some((node) => includesFilter(node.name, node.kind, node.signature, node.file)));
      looseGroup.innerHTML = `<div class="folder-type-row"><button class="folder-type-toggle" type="button" aria-expanded="${looseExpanded}"><i style="--feature-color:${colorHex.cyan}">M</i><strong>Module symbols</strong><span>${tree.loose.length}</span><b>${looseExpanded ? "−" : "+"}</b></button></div><div class="folder-type-members" ${looseExpanded ? "" : "hidden"}></div>`;
      const looseMembers = looseGroup.querySelector(".folder-type-members");
      tree.loose.forEach((node) => appendMemberButton(looseMembers, node, category.id, true));
      looseGroup.querySelector(".folder-type-toggle").addEventListener("click", (event) => {
        const open = looseMembers.hidden;
        looseMembers.hidden = !open;
        event.currentTarget.setAttribute("aria-expanded", String(open));
        event.currentTarget.querySelector("b").textContent = open ? "−" : "+";
        if (open) state.expandedTypes.add(looseKey);
        else state.expandedTypes.delete(looseKey);
      });
      featureList.appendChild(looseGroup);
    }
    folder.querySelector(".folder-select").addEventListener("click", () => selectMapFolder(layer, category.id));
    folder.querySelector(".folder-enter").addEventListener("click", () => {
      state.scope = { category: category.id, file: null };
      state.filter = "";
      $("#map-filter").value = "";
      closeInspector();
      renderMap();
    });
    grid.appendChild(folder);
  });
  const matched = folderData.filter((entry) => entry.matches).length;
  const affectedRegions = folderData.filter((entry) => entry.qualityIssues.length).length;
  $("#visible-count").textContent = `${matched} MATCH // ${folderData.length} FOLDERS VISIBLE`;
  $("#map-status").textContent = `${layer.categories.length} REGIONS // ${affectedRegions} WITH BREACHES // ${state.data.quality?.summary?.violations || 0} TOTAL BREACHES`;
  selectMapFolder(layer, state.mapSelection);
}

function selectMapFolder(layer, categoryId) {
  const category = layer.categories.find((item) => item.id === categoryId);
  state.mapSelection = category?.id || null;
  state.hoverRouteFocus = null;
  $$(".category-folder").forEach((folder) => folder.classList.toggle("selected", folder.dataset.category === state.mapSelection));
  const summary = $("#route-summary");
  if (!category) {
    summary.hidden = true;
    summary.replaceChildren();
    scheduleRoutes();
    return;
  }
  const id = `category:${category.id}`;
  const connections = routeRecords.filter((route) => route.from === id || route.to === id).map((route) => {
    const otherId = route.from === id ? route.to : route.from;
    const otherCategoryId = otherId.replace(/^category:/, "");
    return { ...route, otherId, category: layer.categories.find((item) => item.id === otherCategoryId) };
  }).filter((entry) => entry.category).sort((a, b) => b.weight - a.weight || a.category.name.localeCompare(b.category.name));
  const strongest = new Set(connections.slice(0, 4).map((entry) => entry.otherId));
  $$(".category-folder").forEach((folder) => {
    const rowId = folder.dataset.mapId;
    const connection = connections.find((entry) => entry.otherId === rowId);
    folder.classList.toggle("connected", strongest.has(rowId));
    if (connection && strongest.has(rowId)) folder.dataset.routeWeight = String(connection.weight);
    else delete folder.dataset.routeWeight;
  });
  summary.hidden = false;
  summary.style.setProperty("--card-color", categoryColor(category));
  summary.innerHTML = `<strong>${escapeHtml(category.name)}</strong><span>CONNECTS TO</span>${connections.slice(0, 6).map((entry) => `<button type="button" data-target-category="${escapeHtml(entry.category.id)}">${escapeHtml(entry.category.name)} <b>${entry.weight}</b></button>`).join("")}${connections.length > 6 ? `<span>+${connections.length - 6} MORE</span>` : ""}`;
  summary.querySelectorAll("[data-target-category]").forEach((button) => button.addEventListener("click", () => selectMapFolder(layer, button.dataset.targetCategory)));
  scheduleRoutes();
}

function renderFiles(layer) {
  const grid = $("#map-grid");
  grid.className = "map-grid files";
  const scopedNodes = layer.nodes.filter((node) => node.category === state.scope.category);
  const files = new Map();
  scopedNodes.forEach((node) => {
    if (!files.has(node.file)) files.set(node.file, []);
    files.get(node.file).push(node);
  });
  const fileByNode = new Map(scopedNodes.map((node) => [node.id, node.file]));
  routeRecords = aggregateRoutes(layer.edges, (edge) => {
    const from = fileByNode.get(edge.from), to = fileByNode.get(edge.to);
    return from && to ? [`file:${from}`, `file:${to}`] : null;
  });

  const cards = [];
  [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([file, members]) => {
    const issues = qualityIssuesForMembers(members, layer);
    if (!includesFilter(file, ...members.map((node) => node.name), ...qualitySearchValues(issues))) return;
    const id = `file:${file}`;
    const routeCount = routeRecords.filter((route) => route.from === id || route.to === id).length;
    const typeCount = members.filter((node) => node.kind !== "method" && node.kind !== "function").length;
    const name = file.split("/").pop() || file;
    const card = cardShell({
      mapId: id,
      classes: `file-card ${issues.length ? "quality-breach" : ""}`,
      color: issues.length ? colorHex.rose : colorHex.blue,
      sigil: issues.length ? "!" : "▤",
      name,
      path: file,
      metrics: [[members.length, "SYMBOLS"], [typeCount, "TYPES"], [routeCount, "ROUTES"], [issues.length, "BREACHES"]],
      footer: [issues.length ? `${issues.length} RULE BREACHES` : "SOURCE FILE", "OPEN →"],
      issues,
    });
    card.dataset.file = file;
    card.addEventListener("click", () => {
      state.scope.file = file;
      state.filter = "";
      $("#map-filter").value = "";
      renderMap();
    });
    cards.push(card);
  });
  cards.forEach((card) => grid.appendChild(card));
  showEmptyIfNeeded(grid, "NO FILES MATCH THIS FILTER");
  $("#visible-count").textContent = `${cards.length} / ${files.size} FILES`;
  const breachCount = uniqueQualityIssues(
    [...files.values()].flatMap((members) => qualityIssuesForMembers(members, layer)),
  ).length;
  $("#map-status").textContent = `${files.size} FILES // ${routeRecords.length} ROUTES // ${breachCount} RULE BREACHES`;
}

function renderSymbols(layer) {
  const grid = $("#map-grid");
  grid.className = "map-grid symbols";
  const fileNodes = layer.nodes.filter((node) => node.category === state.scope.category && node.file === state.scope.file);
  const ids = new Set(fileNodes.map((node) => node.id));
  routeRecords = layer.edges
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .map((edge) => ({ from: `symbol:${edge.from}`, to: `symbol:${edge.to}`, weight: 1, type: edge.type }));
  const relationCount = new Map();
  routeRecords.forEach((route) => {
    relationCount.set(route.from, (relationCount.get(route.from) || 0) + 1);
    relationCount.set(route.to, (relationCount.get(route.to) || 0) + 1);
  });

  let visible = 0;
  kindOrder.forEach((kind) => {
    const nodes = fileNodes.filter((node) => node.kind === kind && includesFilter(node.name, node.kind, node.signature, node.parent, ...qualitySearchValues(node.qualityIssues)));
    if (!nodes.length) return;
    visible += nodes.length;
    const group = document.createElement("section");
    group.className = "symbol-group";
    group.innerHTML = `<h2>${escapeHtml(kind.toUpperCase())} <span>${nodes.length}</span></h2><div class="symbol-list"></div>`;
    const list = group.querySelector(".symbol-list");
    nodes.sort((a, b) => a.line - b.line).forEach((node) => {
      const id = `symbol:${node.id}`;
      const issues = node.qualityIssues || [];
      const card = cardShell({
        mapId: id,
        classes: `symbol-card ${issues.length ? "quality-breach" : ""} ${state.selected?.id === node.id ? "selected" : ""}`,
        color: issues.length ? colorHex.rose : (kindColor[node.kind] || colorHex.cyan),
        sigil: issues.length ? "!" : (kindSigil[node.kind] || "•"),
        name: node.name,
        path: node.parent ? `${node.parent} // line ${node.line}` : `${node.language} // line ${node.line}`,
        metrics: [[node.line, "LINE"], [relationCount.get(id) || 0, "PATHS"], [issues.length, "BREACHES"]],
        footer: [issues.length ? `${issues.length} RULE BREACHES` : node.kind.toUpperCase(), "INSPECT"],
        draggable: true,
        issues,
      });
      const signature = document.createElement("span");
      signature.className = "symbol-signature";
      signature.textContent = node.signature || node.name;
      card.querySelector(".card-footer").before(signature);
      card.addEventListener("click", () => inspectNode(node.id, state.activeLayer));
      card.addEventListener("dragstart", (event) => {
        draggedSymbolId = node.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.id);
      });
      card.addEventListener("dragend", () => { draggedSymbolId = null; $$(".region-drop").forEach((item) => item.classList.remove("drag-over")); });
      list.appendChild(card);
    });
    grid.appendChild(group);
  });
  showEmptyIfNeeded(grid, "NO SYMBOLS MATCH THIS FILTER");
  $("#visible-count").textContent = `${visible} / ${fileNodes.length} SYMBOLS`;
  const breachCount = state.data.quality?.files?.[state.scope.file]?.length || 0;
  $("#map-status").textContent = `${fileNodes.length} SYMBOLS // ${routeRecords.length} PATHS // ${breachCount} FILE BREACHES`;
  renderRegionDock(layer);
}

function renderRegionDock(layer) {
  const dock = $("#region-dock");
  dock.hidden = false;
  dock.innerHTML = `<h2>DRAG A SYMBOL TO REASSIGN ITS REGION</h2><div class="region-dock-list"></div>`;
  const list = dock.querySelector(".region-dock-list");
  layer.categories.forEach((category) => {
    const target = document.createElement("button");
    target.type = "button";
    target.className = "region-drop";
    target.textContent = category.name;
    target.style.setProperty("--card-color", categoryColor(category));
    target.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; target.classList.add("drag-over"); });
    target.addEventListener("dragleave", () => target.classList.remove("drag-over"));
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("drag-over");
      const id = draggedSymbolId || event.dataTransfer.getData("text/plain");
      if (id) moveNode(id, state.activeLayer, category.id);
    });
    list.appendChild(target);
  });
}

function showEmptyIfNeeded(container, message) {
  if (container.children.length) return;
  container.innerHTML = `<div class="empty-map"><div><strong>NO SIGNALS ACQUIRED</strong>${escapeHtml(message)}</div></div>`;
}

function renderMap() {
  if (!state.data) return;
  routeRecords = [];
  state.hoverRouteFocus = null;
  $("#map-grid").replaceChildren();
  $("#map-grid").style.width = "";
  $("#map-grid").style.height = "";
  $("#region-dock").hidden = true;
  $("#region-dock").replaceChildren();
  $("#route-summary").hidden = true;
  $("#route-summary").replaceChildren();
  const layer = currentLayer();
  const level = scopeLevel();
  if (level === "journey") renderJourneyMap(layer);
  else if (level === "data-flow") renderDataMap(layer);
  else if (level === "regions") renderRegions(layer);
  else if (level === "files") renderFiles(layer);
  else renderSymbols(layer);
  updateLayerHud();
  updateScopeHud();
  scheduleRoutes();
}

function scheduleRoutes() {
  if (routeTimer) return;
  routeTimer = requestAnimationFrame(() => {
    routeTimer = 0;
    drawRoutes();
  });
}

function drawRoutes() {
  const svg = $("#route-layer");
  svg.replaceChildren();
  if (state.routeMode === "off" || !routeRecords.length) return;
  const selectedFocus = scopeLevel() === "journey" && state.mapSelection
    ? `screen:${state.mapSelection}`
    : scopeLevel() === "data-flow" && state.mapSelection
      ? `data:${state.mapSelection}`
      : scopeLevel() === "regions" && state.mapSelection
        ? `category:${state.mapSelection}`
    : state.selected ? `symbol:${state.selected.id}` : null;
  const focus = state.hoverRouteFocus || selectedFocus;
  let routes = routeRecords;
  if (isOverviewLevel()) {
    if (!focus) return;
    routes = routes.filter((route) => route.from === focus || route.to === focus).slice(0, scopeLevel() === "journey" ? 6 : scopeLevel() === "data-flow" ? 10 : 4);
  } else if (state.routeMode === "focus") {
    if (!focus) return;
    routes = routes.filter((route) => route.from === focus || route.to === focus);
  } else {
    routes = routes.slice(0, scopeLevel() === "regions" ? 18 : scopeLevel() === "files" ? 24 : 36);
  }
  const viewport = $("#map-viewport").getBoundingClientRect();
  const cards = new Map($$("[data-map-id]").map((card) => [card.dataset.mapId, card]));
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  const toolbarBottom = isOverviewLevel()
    ? Math.max($(".map-toolbar").getBoundingClientRect().bottom, $("#route-summary").hidden ? 0 : $("#route-summary").getBoundingClientRect().bottom)
    : viewport.top;
  const routeBounds = {
    left: 8,
    right: viewport.width - 8,
    top: Math.max(8, toolbarBottom - viewport.top + 8),
    bottom: viewport.height - 8,
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const intersectsViewport = (rect) => rect.right >= viewport.left && rect.left <= viewport.right
    && rect.bottom >= toolbarBottom && rect.top <= viewport.bottom;
  const routePoint = (rect, horizontalSide) => {
    const raw = {
      x: (horizontalSide === "right" ? rect.right : rect.left) - viewport.left,
      y: rect.top - viewport.top + rect.height / 2,
    };
    return {
      x: clamp(raw.x, routeBounds.left, routeBounds.right),
      y: clamp(raw.y, routeBounds.top, routeBounds.bottom),
      offscreen: !intersectsViewport(rect),
    };
  };
  routes.forEach((route) => {
    const fromCard = cards.get(route.from), toCard = cards.get(route.to);
    if (!fromCard || !toCard) return;
    const fromRect = fromCard.getBoundingClientRect(), toRect = toCard.getBoundingClientRect();
    const rightward = toRect.left + toRect.width / 2 >= fromRect.left + fromRect.width / 2;
    const from = routePoint(fromRect, rightward ? "right" : "left");
    const to = routePoint(toRect, rightward ? "left" : "right");
    if (Math.hypot(to.x - from.x, to.y - from.y) < 8) return;
    const bend = Math.max(36, Math.abs(to.x - from.x) * .42);
    const direction = Math.sign(to.x - from.x) || 1;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x + direction * bend} ${from.y}, ${to.x - direction * bend} ${to.y}, ${to.x} ${to.y}`);
    path.setAttribute("class", `route-path ${focus && (route.from === focus || route.to === focus) ? "focused" : ""} ${from.offscreen || to.offscreen ? "offscreen-route" : ""} ${scopeLevel() === "files" ? "file-route" : scopeLevel() === "symbols" ? "symbol-route" : ""}`);
    path.style.strokeWidth = String(Math.min(4, 1 + Math.log2(route.weight || 1) * .35));
    svg.appendChild(path);
    if (isOverviewLevel()) {
      const target = route.from === focus ? to : from;
      if (target.offscreen) {
        const beacon = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        beacon.setAttribute("cx", String(target.x));
        beacon.setAttribute("cy", String(target.y));
        beacon.setAttribute("r", "4");
        beacon.setAttribute("class", "route-beacon");
        svg.appendChild(beacon);
      }
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(clamp(target.x + (target.x > viewport.width - 70 ? -34 : 10), routeBounds.left, routeBounds.right - 28)));
      label.setAttribute("y", String(clamp(target.y - 6, routeBounds.top + 8, routeBounds.bottom)));
      label.setAttribute("class", "route-weight");
      label.textContent = scopeLevel() === "journey" || scopeLevel() === "data-flow"
        ? `${target.offscreen ? "↗ " : ""}${String(route.type || "path").toUpperCase()}`
        : `${target.offscreen ? "↗ " : ""}×${route.weight}`;
      svg.appendChild(label);
    }
  });
}

function updateLayerHud() {
  $$(".layer-row").forEach((row) => row.classList.toggle("active", row.dataset.layer === state.activeLayer));
  $("#active-coordinate").textContent = layerCoordinates[state.activeLayer];
  $("#active-title").textContent = layerNames[state.activeLayer];
  const mode = currentLayer()?.mode;
  const journey = mode === "journey";
  const dataFlow = mode === "data-flow";
  $("#add-category").hidden = journey || dataFlow;
  $(".legend").hidden = journey || dataFlow;
  $(".controls-help").innerHTML = journey
    ? `<p><span>CLICK SCREEN</span> trace user paths</p><p><span>CLICK EXIT</span> follow navigation</p><p><span>SOURCE ◎</span> inspect implementation</p><p><span>DRAG SPACE</span> pan journey</p>`
    : dataFlow
      ? `<p><span>CLICK RESOURCE</span> trace data flows</p><p><span>CLICK CONNECTION</span> follow persistence</p><p><span>SOURCE ◎</span> inspect evidence</p><p><span>DRAG SPACE</span> pan topology</p>`
    : `<p><span>CLICK FOLDER</span> decode links</p><p><span>OPEN</span> enter folder</p><p><span>DRAG SPACE</span> pan atlas</p><p><span>EXPAND TYPE</span> reveal members</p><p><span>CLICK MEMBER / ◎</span> inspect source</p>`;
}

function updateScopeHud() {
  if (currentLayer()?.mode === "journey") {
    $("#scope-path").textContent = "CODEBASE / USER JOURNEY";
    $("#scope-back").hidden = true;
    return;
  }
  if (currentLayer()?.mode === "data-flow") {
    $("#scope-path").textContent = "CODEBASE / DATA TOPOLOGY";
    $("#scope-back").hidden = true;
    return;
  }
  const category = currentCategory();
  const fileName = state.scope.file?.split("/").pop();
  const parts = ["CODEBASE", category?.name?.toUpperCase(), fileName?.toUpperCase()].filter(Boolean);
  $("#scope-path").textContent = parts.join(" / ");
  $("#scope-back").hidden = !state.scope.category;
}

function ascendScope() {
  if (state.scope.file) state.scope.file = null;
  else {
    state.mapSelection = state.scope.category;
    state.scope = { category: null, file: null };
  }
  state.filter = "";
  $("#map-filter").value = "";
  closeInspector();
  renderMap();
}

function focusLayer(layer) {
  if (!state.data) return;
  state.activeLayer = layer;
  state.scope = { category: null, file: null };
  state.mapSelection = null;
  state.filter = "";
  $("#map-filter").value = "";
  closeInspector();
  renderMap();
}

function inspectNode(id, layerName = state.activeLayer) {
  const layer = state.data.layers[layerName];
  const node = layer.nodes.find((item) => item.id === id);
  if (!node) return;
  state.selected = { id, layer: layerName };
  document.body.classList.add("inspector-open");
  $("#inspector-empty").hidden = true;
  $("#inspector-content").hidden = false;
  $("#inspector").classList.remove("empty");
  $("#detail-kind").textContent = node.kind.toUpperCase();
  $("#detail-name").textContent = node.name;
  $("#detail-parent").textContent = node.parent ? `WITHIN ${node.parent}` : node.language.toUpperCase();
  $("#detail-file").textContent = `${node.file}:${node.line}`;
  $("#detail-signature").textContent = node.signature || node.name;
  const qualityIssues = node.qualityIssues || [];
  $("#detail-quality").innerHTML = qualityIssues.length
    ? qualityIssues.map((issue) => `
      <div class="quality-item ${escapeHtml(issue.severity)}">
        <strong>${escapeHtml(issue.code)} // ${issue.optional ? "OPTIONAL" : `RULE ${escapeHtml(issue.charterRule)}`}</strong>
        <span>${escapeHtml(issue.title)} · line ${escapeHtml(issue.line)}</span>
        <code>${escapeHtml(issue.evidence || "Source evidence unavailable")}</code>
        <p>${escapeHtml(issue.message)}</p>
      </div>`).join("")
    : `<span class="quality-clear">NO AUTOMATED BREACHES IN THIS SYMBOL</span>`;
  $("#detail-category").closest(".data-field").hidden = layer.mode === "journey" || layer.mode === "data-flow";
  $("#detail-category").innerHTML = layer.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${category.id === node.category ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("");
  const relations = layer.edges.filter((edge) => edge.from === id || edge.to === id);
  const list = $("#detail-relations");
  list.innerHTML = relations.length ? "" : `<span class="no-relations">NO RESOLVED PATHWAYS</span>`;
  relations.slice(0, 30).forEach((edge) => {
    const outgoing = edge.from === id;
    const targetId = outgoing ? edge.to : edge.from;
    const target = layer.nodes.find((item) => item.id === targetId);
    if (!target) return;
    const button = document.createElement("button");
    button.innerHTML = `<span>${outgoing ? "→" : "←"} ${escapeHtml(edge.type.toUpperCase())}</span>${escapeHtml(target.name)}`;
    button.addEventListener("click", () => {
      const resourceMap = layer.mode === "journey" || layer.mode === "data-flow";
      state.scope = resourceMap ? { category: null, file: null } : { category: target.category, file: target.file };
      if (resourceMap) state.mapSelection = target.id;
      state.filter = "";
      $("#map-filter").value = "";
      renderMap();
      inspectNode(targetId, layerName);
    });
    list.appendChild(button);
  });
  $$(".symbol-card").forEach((card) => card.classList.toggle("selected", card.dataset.mapId === `symbol:${id}`));
  scheduleRoutes();
}

function closeInspector() {
  state.selected = null;
  document.body.classList.remove("inspector-open");
  $("#inspector-empty").hidden = false;
  $("#inspector-content").hidden = true;
  $("#inspector").classList.add("empty");
  $("#detail-category").closest(".data-field").hidden = false;
  $$(".symbol-card.selected").forEach((card) => card.classList.remove("selected"));
  scheduleRoutes();
}

function moveNode(id, layerName, categoryId) {
  const layer = state.data.layers[layerName];
  const node = layer.nodes.find((item) => item.id === id);
  if (!node || node.category === categoryId) return;
  node.category = categoryId;
  const category = layer.categories.find((item) => item.id === categoryId);
  state.scope = { category: categoryId, file: null };
  closeInspector();
  saveLayout(layerName);
  renderMap();
  toast(`${node.name.toUpperCase()} RELOCATED // ${category?.name.toUpperCase()}`);
}

async function saveLayout(layerName) {
  const layer = state.data.layers[layerName];
  const assignments = Object.fromEntries(layer.nodes.map((node) => [node.id, node.category]));
  try {
    await fetch("/api/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectKey: state.data.projectKey, layer: layerName, categories: layer.categories, assignments }) });
  } catch (_) {
    toast("LAYOUT PERSISTENCE OFFLINE", true);
  }
}

async function scanProject(path) {
  $("#loading-screen").classList.remove("done");
  $("#loading-detail").textContent = "ANALYZING SOURCE TOPOLOGY";
  try {
    const query = new URLSearchParams({ path });
    if (state.optionalRules.size) query.set("optional", [...state.optionalRules].sort().join(","));
    const response = await fetch(`/api/scan?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "SCAN FAILURE");
    state.data = data;
    state.scope = { category: null, file: null };
    state.mapSelection = null;
    state.filter = "";
    $("#map-filter").value = "";
    $("#project-path").value = data.project;
    $("#project-name").textContent = data.projectName.toUpperCase();
    $("#project-language").textContent = Object.entries(data.stats.languages).map(([name, count]) => `${name.toUpperCase()} ${count}`).join(" // ") || "NO SUPPORTED SOURCE";
    $("#stat-files").textContent = data.stats.files;
    $("#stat-symbols").textContent = data.stats.symbols;
    $("#stat-relations").textContent = data.stats.relations;
    $("#stat-quality").textContent = data.stats.qualityViolations || 0;
    $("#stat-quality").closest(".quality-vital").classList.toggle("active", Boolean(data.stats.qualityViolations));
    closeInspector();
    renderMap();
    setTimeout(() => $("#loading-screen").classList.add("done"), 180);
    toast(`${data.stats.symbols} LOCATIONS INDEXED`);
  } catch (error) {
    $("#loading-detail").textContent = error.message.toUpperCase();
    toast(error.message, true);
  }
}

async function browseForProject() {
  const button = $("#browse-folder");
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "CHOOSING…";
  try {
    const response = await fetch("/api/select-folder", { method: "POST", cache: "no-store", headers: { "X-Cyber-Soul-Action": "select-folder" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Folder chooser unavailable");
    if (result.cancelled) return toast("FOLDER SELECTION CANCELLED");
    if (!result.path) throw new Error("Folder chooser returned no path");
    $("#project-path").value = result.path;
    await scanProject(result.path);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function configureRouteMode(mode, announce = true) {
  state.routeMode = ["focus", "primary", "off"].includes(mode) ? mode : "focus";
  localStorage.setItem("cyber-soul-route-mode", state.routeMode);
  $$(".mode-option").forEach((button) => {
    const active = button.dataset.routeMode === state.routeMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  scheduleRoutes();
  if (announce) toast(`PATHWAYS // ${state.routeMode.toUpperCase()}`);
}

function renderOptionalRuleControls() {
  $$(".optional-rule").forEach((button) => {
    const active = state.optionalRules.has(button.dataset.optionalRule);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function applyOptionalRules() {
  state.optionalRules = new Set(
    $$(".optional-rule.active").map((button) => button.dataset.optionalRule),
  );
  localStorage.setItem("cyber-soul-optional-rules", JSON.stringify([...state.optionalRules].sort()));
  $("#options-dialog").close();
  await scanProject(state.data?.project || $("#project-path").value || ".");
  toast(`OPTIONAL RULES // ${state.optionalRules.size || "OFF"}`);
}

function mermaidSource() {
  if (!state.data) return "flowchart LR\n  loading[\"Scanning codebase\"]";
  const layer = currentLayer();
  const connected = new Set(layer.edges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = layer.nodes.filter((node) => connected.has(node.id)).slice(0, 120);
  const ids = new Set(nodes.map((node) => node.id));
  const safe = (value) => value.replace(/[^a-zA-Z0-9_]/g, "_");
  const label = (value) => value.replace(/["\[\]{}()]/g, "").slice(0, 48);
  const lines = ["flowchart LR"];
  layer.categories.forEach((category) => {
    const members = nodes.filter((node) => node.category === category.id);
    if (!members.length) return;
    lines.push(`  subgraph ${safe(category.id)}[\"${label(category.name)}\"]`);
    members.forEach((node) => lines.push(`    ${safe(node.id)}[\"${label(node.name)}\"]`));
    lines.push("  end");
  });
  layer.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).slice(0, 250).forEach((edge) => lines.push(`  ${safe(edge.from)} -->|${edge.type}| ${safe(edge.to)}`));
  return lines.join("\n");
}

const qualityRemediation = {
  "CQ3.1": "Identify cohesive responsibilities in the file and extract them into focused modules without changing public behavior.",
  "CQ3.2": "Split unrelated state and behavior into focused types; preserve the current public contract while migrating callers incrementally.",
  "CQ3.3": "Extract named helpers around distinct phases or decisions, keeping side effects at clear boundaries.",
  "CQ4.1": "Catch only the exceptions the operation can deliberately handle; allow process-control exceptions to propagate.",
  "CQ4.2": "Handle, contextualize and rethrow, or explicitly document the recovery policy instead of discarding the failure.",
  "CQ4.3": "Use None as the default and allocate the mutable collection inside the callable.",
  "CQ4.4": "Replace forced error handling with do/catch, throws propagation, or an explicitly justified invariant.",
  "CQ6.1": "Remove and rotate the credential, then load it through the repository's approved environment or secret-management mechanism.",
  "CQ6.2": "Replace dynamic execution with a constrained parser, explicit dispatch table, or strict allow-list.",
  "CQ6.3": "Pass a fixed argument array without a shell; validate or allow-list any externally supplied values.",
  "CQ6.4": "Use a safe serializer with a constrained schema and treat serialized input as untrusted.",
  "CQ7.1": "Correct the syntax error first, then run the language compiler or parser before making behavioral changes.",
  "OQ3.1": "Flatten the callable with guard clauses or extract a named helper around the deepest decision.",
  "OQ4.1": "Log the failure with useful context, rethrow it, or document and test the deliberate fallback policy.",
};

const qualityVerification = {
  "CQ3.1": "Run existing tests and compare public imports/exports after the module split.",
  "CQ3.2": "Run focused tests for the type plus integration tests for its callers.",
  "CQ3.3": "Add or update tests for normal, boundary, and failure paths before and after extraction.",
  "CQ4.1": "Test the expected exception and confirm unexpected exceptions still propagate.",
  "CQ4.2": "Test both the recovery path and the surfaced error context.",
  "CQ4.3": "Call the function twice and prove state does not leak between invocations.",
  "CQ4.4": "Exercise success and failure paths and confirm failure no longer terminates the process unexpectedly.",
  "CQ6.1": "Scan the working tree and history as appropriate, verify the old credential is revoked, and test secret injection locally.",
  "CQ6.2": "Test rejected input, allowed input, and attempts to escape the constrained grammar.",
  "CQ6.3": "Test arguments containing spaces and shell metacharacters and confirm they are passed literally.",
  "CQ6.4": "Test malformed and hostile payloads and confirm no arbitrary object construction occurs.",
  "CQ7.1": "Run the language syntax/compiler check and the narrowest relevant tests.",
  "OQ3.1": "Run focused tests for every branch moved or flattened and confirm behavior is unchanged.",
  "OQ4.1": "Exercise the failure path and assert that it emits a log or surfaces an exception.",
};

function issueKey(issue) {
  return `${issue.file}:${issue.line}:${issue.code}`;
}

function markdownText(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/([`*_{}\[\]<>])/g, "\\$1");
}

function markdownEvidence(value = "") {
  return String(value || "Source evidence unavailable")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function issueContext(issue) {
  const layer = state.data.layers.app;
  const nodes = layer.nodes.filter((node) =>
    (node.qualityIssues || []).some((candidate) => issueKey(candidate) === issueKey(issue)),
  );
  const regions = [...new Set(nodes.map((node) =>
    layer.categories.find((category) => category.id === node.category)?.name,
  ).filter(Boolean))].sort();
  const symbols = [...new Set(nodes.map((node) =>
    `${node.kind} ${node.parent ? `${node.parent}.` : ""}${node.name}`,
  ))].sort();
  return { regions, symbols };
}

function breachReportMarkdown() {
  if (!state.data) return "# Code Quality Breach Report\n\nNo project has been scanned.";
  const issues = Object.values(state.data.quality?.files || {}).flat();
  const severityRank = { error: 0, warning: 1 };
  issues.sort((a, b) => (severityRank[a.severity] ?? 2) - (severityRank[b.severity] ?? 2)
    || a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code));
  const contexts = new Map(issues.map((issue) => [issueKey(issue), issueContext(issue)]));
  const affectedRegions = new Set([...contexts.values()].flatMap((context) => context.regions));
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const affectedFiles = new Set(issues.map((issue) => issue.file));
  const lines = [
    "# Code Quality Breach Report",
    "",
    `- **Project:** ${markdownText(state.data.projectName)}`,
    `- **Root:** ${markdownText(state.data.project)}`,
    `- **Scanned:** ${markdownText(state.data.generatedAt)}`,
    `- **Rules:** ${markdownText(state.data.quality?.rulesDocument || "CODE_QUALITY_RULES.md")}`,
    `- **Scanner scope:** ${markdownText(state.data.quality?.scope || "Deterministic source checks")}`,
    `- **Optional rules enabled:** ${(state.data.quality?.optionalRules || []).map((rule) => markdownText(rule.name)).join(", ") || "None"}`,
    "",
    "## Summary",
    "",
    `- **Total breaches:** ${issues.length}`,
    `- **Errors:** ${errorCount}`,
    `- **Warnings:** ${warningCount}`,
    `- **Affected files:** ${affectedFiles.size}`,
    `- **Affected regions:** ${affectedRegions.size}`,
    "",
    "## Instructions for the fixing agent",
    "",
    "Work through this report in severity order. Inspect the surrounding code and its callers before editing. Make the smallest coherent fix for one breach at a time, preserve existing behavior unless the finding requires changing it, add or update focused tests, run the stated verification plus repository checks, and report any false positive rather than suppressing it silently. Never expose or reproduce redacted credentials.",
    "",
  ];
  if (!issues.length) {
    lines.push("No deterministic quality breaches were detected.");
    return lines.join("\n");
  }
  let currentFile = null;
  issues.forEach((issue, index) => {
    if (issue.file !== currentFile) {
      currentFile = issue.file;
      lines.push(`## ${markdownText(currentFile)}`, "");
    }
    const context = contexts.get(issueKey(issue)) || { regions: [], symbols: [] };
    lines.push(
      `### ${index + 1}. ${markdownText(issue.code)} — ${markdownText(issue.title)}`,
      "",
      `- **Severity:** ${markdownText(issue.severity).toUpperCase()}`,
      issue.optional
        ? `- **Rule:** OPTIONAL — ${markdownText(issue.charterTitle)}`
        : `- **Charter rule:** ${issue.charterRule} — ${markdownText(issue.charterTitle)}`,
      `- **Location:** ${markdownText(issue.file)}:${issue.line}`,
      `- **Regions:** ${context.regions.length ? context.regions.map(markdownText).join(", ") : "File-wide / unassigned"}`,
      `- **Affected symbols:** ${context.symbols.length ? context.symbols.map(markdownText).join(", ") : "File-wide finding"}`,
      "",
      "**Offending evidence**",
      "",
      markdownEvidence(issue.evidence),
      "",
      `**Why this is a breach:** ${markdownText(issue.message)}`,
      "",
      `**Suggested repair:** ${markdownText(qualityRemediation[issue.code] || "Inspect the surrounding contract and apply the smallest change that satisfies the charter rule.")}`,
      "",
      `**Verify:** ${markdownText(qualityVerification[issue.code] || "Run the narrowest relevant tests, then the broader repository checks.")}`,
      "",
    );
  });
  lines.push(
    "## Completion checklist",
    "",
    "- [ ] Every error breach is resolved or documented as a verified false positive.",
    "- [ ] Every warning breach is resolved, explicitly accepted, or tracked.",
    "- [ ] Focused regression tests cover changed behavior and failure paths.",
    "- [ ] Formatter, compiler/type checker, linter, tests, and security checks pass where available.",
    "- [ ] The complete diff contains no unrelated changes, secrets, debug output, or documentation drift.",
    "- [ ] Cyber Soul is rescanned and the report is regenerated.",
  );
  return lines.join("\n");
}

function qualityReportFilename() {
  const project = String(state.data?.projectName || "codebase").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${project || "codebase"}-quality-breaches.md`;
}

function downloadTextFile(filename, content) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(content) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(content);
    copied = true;
  } catch (_) {
    // The local browser may not grant the asynchronous Clipboard API permission.
  }
  const fallback = document.createElement("textarea");
  fallback.value = content;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.appendChild(fallback);
  fallback.select();
  copied = document.execCommand("copy") || copied;
  fallback.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

let toastTimer;
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.style.borderColor = error ? "rgba(255,94,137,.5)" : "";
  element.style.color = error ? "var(--rose)" : "";
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2200);
}

$("#project-form").addEventListener("submit", (event) => { event.preventDefault(); scanProject($("#project-path").value); });
$("#browse-folder").addEventListener("click", browseForProject);
$("#reset-map").addEventListener("click", () => {
  state.scope = { category: null, file: null };
  state.mapSelection = null;
  state.filter = "";
  $("#map-filter").value = "";
  closeInspector();
  renderMap();
});
$("#show-all").addEventListener("click", () => {
  state.scope = { category: null, file: null };
  state.mapSelection = null;
  state.filter = "";
  $("#map-filter").value = "";
  closeInspector();
  renderMap();
});
$("#scope-back").addEventListener("click", ascendScope);
$("#map-filter").addEventListener("input", (event) => { state.filter = event.target.value.trim(); renderMap(); });
$("#map-stage").addEventListener("scroll", scheduleRoutes, { passive: true });

let mapPan = null;
$("#map-stage").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("button,input,select,textarea,a,.folder-feature-list")) return;
  const stage = $("#map-stage");
  mapPan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  stage.classList.add("panning");
  stage.setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("#map-stage").addEventListener("pointermove", (event) => {
  if (!mapPan || event.pointerId !== mapPan.id) return;
  const stage = $("#map-stage");
  stage.scrollLeft = mapPan.left - (event.clientX - mapPan.x);
  stage.scrollTop = mapPan.top - (event.clientY - mapPan.y);
});
function endMapPan(event) {
  if (!mapPan || event.pointerId !== mapPan.id) return;
  const stage = $("#map-stage");
  stage.classList.remove("panning");
  try { stage.releasePointerCapture(event.pointerId); } catch (_) {}
  mapPan = null;
}
$("#map-stage").addEventListener("pointerup", endMapPan);
$("#map-stage").addEventListener("pointercancel", endMapPan);
$("#options-button").addEventListener("click", () => { renderOptionalRuleControls(); $("#options-dialog").showModal(); });
$("#close-options").addEventListener("click", () => $("#options-dialog").close());
$$(".mode-option").forEach((button) => button.addEventListener("click", () => configureRouteMode(button.dataset.routeMode)));
$$(".optional-rule").forEach((button) => button.addEventListener("click", () => {
  button.classList.toggle("active");
  button.setAttribute("aria-pressed", String(button.classList.contains("active")));
}));
$("#apply-optional-rules").addEventListener("click", applyOptionalRules);
$$(".focus-layer, .visibility-toggle").forEach((button) => button.addEventListener("click", () => focusLayer(button.closest(".layer-row").dataset.layer)));
$("#close-inspector").addEventListener("click", closeInspector);
$("#detail-category").addEventListener("change", (event) => { if (state.selected) moveNode(state.selected.id, state.selected.layer, event.target.value); });
$("#add-category").addEventListener("click", () => { if (!state.data) return; $("#category-name").value = ""; $("#category-dialog").showModal(); requestAnimationFrame(() => $("#category-name").focus()); });
$("#cancel-category").addEventListener("click", () => $("#category-dialog").close());
$$("#color-row button").forEach((button) => button.addEventListener("click", () => { state.selectedColor = button.dataset.color; $$("#color-row button").forEach((item) => item.classList.toggle("selected", item === button)); }));
$("#category-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("#category-name").value.trim();
  if (!name) return;
  const layer = currentLayer();
  let id = slug(name);
  if (layer.categories.some((category) => category.id === id)) id += `-${Date.now().toString().slice(-4)}`;
  layer.categories.push({ id, name, color: state.selectedColor });
  $("#category-dialog").close();
  saveLayout(state.activeLayer);
  renderMap();
  toast(`${name.toUpperCase()} REGION MATERIALIZED`);
});
$("#export-button").addEventListener("click", () => { if (!state.data) return; $("#export-title").textContent = layerNames[state.activeLayer]; $("#mermaid-source").value = mermaidSource(); $("#copy-status").textContent = ""; $("#export-dialog").showModal(); });
$("#close-export").addEventListener("click", () => $("#export-dialog").close());
$("#copy-mermaid").addEventListener("click", async () => {
  try {
    await copyText($("#mermaid-source").value);
    $("#copy-status").textContent = "DATA-SCROLL COPIED";
  } catch (error) {
    $("#copy-status").textContent = error.message.toUpperCase();
  }
});
$("#quality-report-button").addEventListener("click", () => {
  if (!state.data) return;
  $("#quality-report-source").value = breachReportMarkdown();
  $("#quality-report-status").textContent = `${state.data.stats.qualityViolations || 0} BREACHES // MARKDOWN READY`;
  $("#quality-report-dialog").showModal();
});
$("#close-quality-report").addEventListener("click", () => $("#quality-report-dialog").close());
$("#copy-quality-report").addEventListener("click", async () => {
  try {
    await copyText($("#quality-report-source").value);
    $("#quality-report-status").textContent = "AI REPORT COPIED";
  } catch (error) {
    $("#quality-report-status").textContent = error.message.toUpperCase();
  }
});
$("#download-quality-report").addEventListener("click", () => {
  downloadTextFile(qualityReportFilename(), $("#quality-report-source").value);
  $("#quality-report-status").textContent = `${qualityReportFilename().toUpperCase()} DOWNLOADED`;
});
addEventListener("resize", scheduleRoutes);
addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#scope-back").hidden && !$("dialog[open]")) ascendScope(); });

configureRouteMode(state.routeMode, false);
renderOptionalRuleControls();
const initialPath = new URLSearchParams(location.search).get("path") || ".";
scanProject(initialPath);
