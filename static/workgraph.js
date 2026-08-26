const workGraphState = {
  nodes: [],
  selected: null,
  expanded: new Set(),
  projectPath: "",
};

// Single source of truth: graph state lives here and on disk in workgraph.json.
// The DOM is only a projection of this state. Do not read application state back
// from rendered labels, attributes, or generated DOM nodes.
window.workGraphState = workGraphState;

const workGraphDefaults = [{
  id: "root-project",
  parentId: null,
  title: "Project direction",
  why: "Define the highest-level goals before implementation branches grow.",
  notes: "Add goals, explorations and decisions here.",
  status: "planned",
  priority: 1,
  kind: "goal",
}];

const WORKGRAPH_PREF_KEY = "cyber-soul-workgraph-fade-expanded";
let saveTimer = null;
let fadeExpanded = localStorage.getItem(WORKGRAPH_PREF_KEY) !== "false";

function wg$(selector) { return document.querySelector(selector); }
function wgEscape(value = "") {
  return String(value).replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" }[c]));
}

function currentProjectPath() {
  const inputPath = wg$("#project-path")?.value?.trim();
  const queryPath = new URLSearchParams(window.location.search).get("path")?.trim();
  return inputPath || queryPath || "";
}

async function loadWorkGraph() {
  workGraphState.projectPath = currentProjectPath();
  if (!workGraphState.projectPath) return structuredClone(workGraphDefaults);
  try {
    const response = await fetch(`/api/workgraph?path=${encodeURIComponent(workGraphState.projectPath)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json();
    if (Array.isArray(parsed.nodes) && parsed.nodes.length) return parsed.nodes;
  } catch (error) {
    console.warn("[workgraph] failed to load project graph", error);
  }
  return structuredClone(workGraphDefaults);
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void saveWorkGraph();
  }, 250);
}

async function saveWorkGraph() {
  if (!workGraphState.projectPath) return;
  try {
    const response = await fetch("/api/workgraph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: workGraphState.projectPath,
        graph: { version: 1, project: workGraphState.projectPath, nodes: workGraphState.nodes },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error("[workgraph] failed to save project graph", error);
  }
}

async function reloadForProject() {
  const nextPath = currentProjectPath();
  if (nextPath === workGraphState.projectPath && workGraphState.nodes.length) return;
  workGraphState.projectPath = nextPath;
  workGraphState.nodes = await loadWorkGraph();
  workGraphState.selected = null;
  workGraphState.expanded = new Set([workGraphState.nodes[0]?.id || "root-project"]);
  renderWorkGraph();
}

function selectedNode() {
  return workGraphState.nodes.find((node) => node.id === workGraphState.selected) || null;
}

function setSelected(id) {
  workGraphState.selected = id;
  renderWorkGraph();
}

// Central mutation boundary. UI handlers update state here, then the state is
// persisted and (only when requested) rendered. This prevents unrelated DOM
// listeners from becoming hidden state-management channels.
function updateNode(id, patch, { render = false } = {}) {
  const node = workGraphState.nodes.find((item) => item.id === id);
  if (!node) return;
  Object.assign(node, patch);
  scheduleSave();
  if (render) renderWorkGraph();
}

function addChild(parentId, kind = "task") {
  const title = window.prompt(kind === "decision" ? "Decision question" : "New work item");
  if (!title?.trim()) return;
  const parent = workGraphState.nodes.find((node) => node.id === parentId);
  const node = {
    id: `wg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    parentId,
    title: title.trim(),
    why: "",
    notes: "",
    // Decision nodes begin in the system-derived NEEDS DECISION state.
    status: kind === "decision" ? "needs-decision" : "idea",
    priority: parent?.priority ?? 3,
    kind,
  };
  workGraphState.nodes.push(node);
  if (parentId) workGraphState.expanded.add(parentId);
  workGraphState.selected = node.id;
  scheduleSave();
  renderWorkGraph();
}

function deleteNode(id) {
  if (id === "root-project" || id === workGraphState.nodes[0]?.id) return;
  const doomed = new Set([id, ...WorkGraphModel.descendantsOf(workGraphState.nodes, id).map((node) => node.id)]);
  workGraphState.nodes = workGraphState.nodes.filter((node) => !doomed.has(node.id));
  workGraphState.selected = null;
  scheduleSave();
  renderWorkGraph();
}

function toggleNodeExpanded(id) {
  const children = WorkGraphModel.childrenOf(workGraphState.nodes, id);
  if (!children.length) return;
  if (workGraphState.expanded.has(id)) workGraphState.expanded.delete(id);
  else workGraphState.expanded.add(id);
  renderWorkGraph();
}

function effectiveStatus(node) {
  return WorkGraphModel.effectiveStatus(workGraphState.nodes, node.id);
}

function statusLabel(status) {
  return String(status || "idea").replaceAll("-", " ").toUpperCase();
}

function nodeColor(node) {
  switch (effectiveStatus(node)) {
    case "needs-decision": return "#ff5e89";
    case "active": return "#9cff32";
    case "done": return "#42f5d4";
    case "cancelled": return "#68747d";
    case "planned": return "#7f8cff";
    case "idea": return "#a663ff";
    // Reserved for a future automatically-derived dependency state.
    case "blocked": return "#ff5e89";
    default: return "#7f8cff";
  }
}

function renderNode(node, depth = 0) {
  const children = WorkGraphModel.childrenOf(workGraphState.nodes, node.id);
  const expanded = workGraphState.expanded.has(node.id);
  const selected = workGraphState.selected === node.id;
  const effective = effectiveStatus(node);
  const article = document.createElement("article");
  article.className = `workgraph-node ${expanded && children.length ? "expanded" : ""}`;
  article.dataset.depth = depth;
  article.dataset.nodeId = node.id;
  article.dataset.effectiveStatus = effective;
  article.style.setProperty("--work-color", nodeColor(node));

  const rail = document.createElement("div");
  rail.className = "workgraph-rail";
  rail.innerHTML = `<span class="workgraph-dot"></span>`;

  const content = document.createElement("div");
  content.className = `workgraph-content ${selected ? "selected" : ""}`;
  const refs = Array.isArray(node.references) && node.references.length ? ` · ${node.references.length} REF${node.references.length === 1 ? "" : "S"}` : "";
  const graphId = WorkGraphModel.graphIdForNode(workGraphState.nodes, node.id);
  content.innerHTML = `
    <div class="workgraph-node-main" role="button" tabindex="0">
      <button class="workgraph-expand" type="button" aria-label="${expanded ? "Collapse" : "Expand"}">${children.length ? (expanded ? "−" : "+") : "·"}</button>
      <span class="workgraph-title"><strong>${wgEscape(node.title)}</strong><small>${node.kind === "decision" ? "DECISION" : node.why ? wgEscape(node.why) : ""}${refs}</small></span>
      <span class="workgraph-meta"><span class="workgraph-priority">${graphId}</span><span class="workgraph-status ${wgEscape(effective)}">${statusLabel(effective)}</span></span>
    </div>`;

  const main = content.querySelector(".workgraph-node-main");
  const expand = content.querySelector(".workgraph-expand");
  expand.disabled = !children.length;
  expand.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNodeExpanded(node.id);
  });
  main.addEventListener("click", () => setSelected(node.id));
  main.addEventListener("dblclick", (event) => {
    event.preventDefault();
    toggleNodeExpanded(node.id);
  });
  main.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(node.id);
    }
  });

  article.append(rail, content);

  if (expanded && children.length) {
    const branch = document.createElement("div");
    branch.className = "workgraph-children";
    children.forEach((child) => branch.appendChild(renderNode(child, depth + 1)));
    const branchWrap = document.createElement("div");
    branchWrap.className = "workgraph-node-children-wrap";
    branchWrap.appendChild(branch);
    article.appendChild(branchWrap);
  }

  return article;
}

function renderInspector() {
  const host = wg$("#workgraph-inspector-content");
  if (!host) return;
  const node = selectedNode();
  if (!node) {
    host.innerHTML = `<div class="workgraph-empty"><strong>NO WORK SELECTED</strong>Select a node to inspect its intent, state, decision history, and downstream work.</div>`;
    return;
  }

  const descendants = WorkGraphModel.descendantsOf(workGraphState.nodes, node.id);
  const refs = Array.isArray(node.references) && node.references.length
    ? `<div class="data-field"><label>REFERENCES</label><div class="workgraph-reference-list">${node.references.map((ref) => `<code>${wgEscape(ref)}</code>`).join("")}</div></div>` : "";

  host.innerHTML = `
    <div class="panel-kicker"><span>02</span> WORK INSPECTOR</div>
    <h3 class="workgraph-inspector-title">${wgEscape(node.title)}</h3>
    <div class="data-field"><label>GRAPH ID</label><p class="workgraph-readout">${WorkGraphModel.graphIdForNode(workGraphState.nodes, node.id)}</p></div>
    <div class="data-field"><label>WHY</label><textarea id="wg-why" class="workgraph-notes" placeholder="Why does this work exist?"></textarea></div>
    <div class="data-field"><label>NOTES</label><textarea id="wg-notes" class="workgraph-notes" placeholder="Optional context, evidence, decisions…"></textarea></div>
    <div class="data-field"><label>STATUS</label><select id="wg-status" class="workgraph-notes" style="min-height:42px"></select></div>
    <div class="data-field"><label>PRIORITY</label><input id="wg-priority" class="workgraph-notes" style="min-height:42px" type="number" min="1" max="9" value="${node.priority ?? 5}"></div>
    ${refs}
    <div class="data-field"><label>DOWNSTREAM</label><p class="workgraph-muted">${descendants.length} descendant work item${descendants.length === 1 ? "" : "s"}</p></div>
    <div class="workgraph-actions" style="margin-top:18px;justify-content:flex-start"><button id="wg-add-child" class="hud-button hot">ADD CHILD</button><button id="wg-add-decision" class="hud-button">ADD DECISION</button>${node.id !== "root-project" && node.id !== workGraphState.nodes[0]?.id ? '<button id="wg-delete" class="hud-button">DELETE</button>' : ''}</div>`;

  wg$("#wg-why").value = node.why || "";
  wg$("#wg-notes").value = node.notes || "";

  // Only these are user-selectable. NEEDS DECISION is derived/system state.
  const userStatuses = ["idea", "planned", "active", "done", "cancelled"];
  const statusSelect = wg$("#wg-status");
  statusSelect.replaceChildren(...userStatuses.map((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = statusLabel(status);
    option.selected = node.status === status;
    return option;
  }));
  if (node.status === "needs-decision") {
    const option = document.createElement("option");
    option.value = "needs-decision";
    option.textContent = "NEEDS DECISION";
    option.selected = true;
    statusSelect.insertBefore(option, statusSelect.firstChild);
  }

  wg$("#wg-why").addEventListener("input", (event) => updateNode(node.id, { why: event.target.value }));
  wg$("#wg-notes").addEventListener("input", (event) => updateNode(node.id, { notes: event.target.value }));
  statusSelect.addEventListener("change", (event) => updateNode(node.id, { status: event.target.value }, { render: true }));
  wg$("#wg-priority").addEventListener("change", (event) => updateNode(node.id, { priority: Math.max(1, Math.min(9, Number(event.target.value) || 5)) }, { render: true }));
  wg$("#wg-add-child").addEventListener("click", () => addChild(node.id, "task"));
  wg$("#wg-add-decision").addEventListener("click", () => addChild(node.id, "decision"));
  wg$("#wg-delete")?.addEventListener("click", () => deleteNode(node.id));
}

function ensureWorkGraphStyles() {
  if (document.querySelector('link[data-workgraph-preferences]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/workgraph-preferences.css";
  link.dataset.workgraphPreferences = "true";
  document.head.appendChild(link);
}

function applyFadePreference() {
  document.body.classList.toggle("wg-fade-expanded", fadeExpanded);
  const button = document.querySelector(".workgraph-preference[data-preference=\"fade-expanded\"]");
  if (button) {
    button.classList.toggle("active", fadeExpanded);
    button.setAttribute("aria-pressed", String(fadeExpanded));
  }
}

function ensureFadePreferenceControl() {
  const panel = document.querySelector(".optional-rules-panel");
  const anchor = document.querySelector("#apply-optional-rules");
  if (!panel || !anchor || document.querySelector(".workgraph-preference[data-preference=\"fade-expanded\"]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "workgraph-preference";
  button.dataset.preference = "fade-expanded";
  button.setAttribute("aria-pressed", String(fadeExpanded));
  button.innerHTML = `<span class="mode-sigil">◌</span><span><strong>FADE EXPANDED GOALS</strong><small>Dim parent goals while their child work is visible.</small></span><i></i>`;
  button.addEventListener("click", () => {
    fadeExpanded = !fadeExpanded;
    localStorage.setItem(WORKGRAPH_PREF_KEY, String(fadeExpanded));
    applyFadePreference();
  });
  panel.insertBefore(button, anchor);
}

// One-way renderer boundary: state -> DOM. Never introduce a MutationObserver
// here whose callback calls renderWorkGraph() or mutates #workgraph-tree; that
// creates an observer -> mutation -> observer loop.
function renderWorkGraph() {
  const tree = wg$("#workgraph-tree");
  if (!tree) return;
  tree.replaceChildren();
  WorkGraphModel.childrenOf(workGraphState.nodes, null).forEach((node) => tree.appendChild(renderNode(node)));
  renderInspector();
}

function setWorkGraphActive(active) {
  document.body.classList.toggle("workgraph-active", active);
  wg$("#workgraph-view")?.classList.toggle("active", active);
  document.querySelectorAll(".workgraph-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === (active ? "workgraph" : "analysis")));
  if (active) renderWorkGraph();
}

function ensureWorkGraphPreferences() {
  if (document.querySelector('script[data-workgraph-preferences]')) return;
  const script = document.createElement("script");
  script.src = "/workgraph-preferences.js";
  script.dataset.workgraphPreferences = "true";
  document.body.appendChild(script);
}

async function initWorkGraph() {
  ensureWorkGraphPreferences();
  ensureWorkGraphStyles();
  ensureFadePreferenceControl();
  applyFadePreference();
  workGraphState.projectPath = currentProjectPath();
  workGraphState.nodes = await loadWorkGraph();
  if (!workGraphState.nodes.length) workGraphState.nodes = structuredClone(workGraphDefaults);
  workGraphState.expanded.add(workGraphState.nodes[0]?.id || "root-project");

  wg$("#workgraph-add-root")?.addEventListener("click", () => addChild(null, "goal"));
  document.querySelectorAll(".workgraph-tab").forEach((button) => button.addEventListener("click", () => setWorkGraphActive(button.dataset.view === "workgraph")));
  wg$("#project-form")?.addEventListener("submit", () => window.setTimeout(() => { void reloadForProject(); }, 100));
  wg$("#project-path")?.addEventListener("change", () => { void reloadForProject(); });
  renderWorkGraph();
}

document.addEventListener("DOMContentLoaded", initWorkGraph);
