const workGraphState = {
  nodes: [],
  selected: null,
  expanded: new Set(),
  projectPath: "",
};

const workGraphDefaults = [
  {
    id: "root-project",
    parentId: null,
    title: "Project direction",
    why: "Define the highest-level goals before implementation branches grow.",
    notes: "Add goals, explorations and decisions here.",
    status: "planned",
    priority: 1,
    kind: "goal",
  },
];

function wg$(selector) { return document.querySelector(selector); }
function wgEscape(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;" }[c])); }

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

async function saveWorkGraph() {
  if (!workGraphState.projectPath) return;
  try {
    const response = await fetch("/api/workgraph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workGraphState.projectPath, graph: { version: 1, project: workGraphState.projectPath, nodes: workGraphState.nodes } }),
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

function childrenOf(parentId) {
  return workGraphState.nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title));
}

function descendantsOf(id) {
  const result = [];
  const walk = (parent) => childrenOf(parent).forEach((node) => { result.push(node); walk(node.id); });
  walk(id);
  return result;
}

function graphIdForNode(nodeId) {
  const segments = [];
  let current = workGraphState.nodes.find((node) => node.id === nodeId);
  const guard = new Set();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    const siblings = childrenOf(current.parentId);
    const index = Math.max(0, siblings.findIndex((node) => node.id === current.id)) + 1;
    segments.unshift(index);
    current = current.parentId == null
      ? null
      : workGraphState.nodes.find((node) => node.id === current.parentId) || null;
  }
  return segments.length ? `P${segments.join("-")}` : "P1";
}

function statusLabel(status) {
  return String(status || "planned").replaceAll("-", " ").toUpperCase();
}

function nodeColor(node) {
  if (node.status === "needs-decision" || node.status === "blocked") return "#ff5e89";
  if (node.status === "active") return "#9cff32";
  if (node.status === "done") return "#42f5d4";
  if (node.kind === "decision") return "#ff9e43";
  return "#45d9ff";
}

function setSelected(id) {
  workGraphState.selected = id;
  renderWorkGraph();
}

function toggleNodeExpanded(id) {
  const node = workGraphState.nodes.find((item) => item.id === id);
  if (!node) return;
  const children = childrenOf(id);
  if (!children.length) return;
  if (workGraphState.expanded.has(id)) workGraphState.expanded.delete(id);
  else workGraphState.expanded.add(id);
  renderWorkGraph();
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
    status: kind === "decision" ? "needs-decision" : "planned",
    priority: parent?.priority ?? 3,
    kind,
  };
  workGraphState.nodes.push(node);
  if (parentId) workGraphState.expanded.add(parentId);
  workGraphState.selected = node.id;
  void saveWorkGraph();
  renderWorkGraph();
}

function updateNode(id, patch) {
  const node = workGraphState.nodes.find((item) => item.id === id);
  if (!node) return;
  Object.assign(node, patch);
  void saveWorkGraph();
}

function deleteNode(id) {
  if (id === "root-project" || id === workGraphState.nodes[0]?.id) return;
  const doomed = new Set([id, ...descendantsOf(id).map((node) => node.id)]);
  workGraphState.nodes = workGraphState.nodes.filter((node) => !doomed.has(node.id));
  workGraphState.selected = null;
  void saveWorkGraph();
  renderWorkGraph();
}

function renderNode(node, depth = 0) {
  const children = childrenOf(node.id);
  const expanded = workGraphState.expanded.has(node.id);
  const selected = workGraphState.selected === node.id;
  const article = document.createElement("article");
  article.className = `workgraph-node ${expanded && children.length ? "expanded" : ""}`;
  article.dataset.depth = depth;
  article.style.setProperty("--work-color", nodeColor(node));

  const rail = document.createElement("div");
  rail.className = "workgraph-rail";
  rail.innerHTML = `<span class="workgraph-dot"></span>`;

  const content = document.createElement("div");
  content.className = `workgraph-content ${selected ? "selected" : ""}`;
  const refs = Array.isArray(node.references) && node.references.length ? ` · ${node.references.length} REF${node.references.length === 1 ? "" : "S"}` : "";
  const graphId = graphIdForNode(node.id);
  content.innerHTML = `
    <div class="workgraph-node-main" role="button" tabindex="0">
      <button class="workgraph-expand" type="button" aria-label="${expanded ? "Collapse" : "Expand"}">${children.length ? (expanded ? "−" : "+") : "·"}</button>
      <span class="workgraph-title"><strong>${wgEscape(node.title)}</strong><small>${node.kind === "decision" ? "DECISION" : node.why ? wgEscape(node.why) : ""}${refs}</small></span>
      <span class="workgraph-meta"><span class="workgraph-priority">${graphId}</span><span class="workgraph-status ${wgEscape(node.status)}">${statusLabel(node.status)}</span></span>
    </div>
  `;
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
    if (!children.length) return;
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
  const node = workGraphState.nodes.find((item) => item.id === workGraphState.selected);
  if (!node) {
    host.innerHTML = `<div class="workgraph-empty"><strong>NO WORK SELECTED</strong>Select a node to inspect its intent, state, decision history, and downstream work.</div>`;
    return;
  }

  const descendants = descendantsOf(node.id);
  const refs = Array.isArray(node.references) && node.references.length
    ? `<div class="data-field"><label>REFERENCES</label><div class="workgraph-reference-list">${node.references.map((ref) => `<code>${wgEscape(ref)}</code>`).join("")}</div></div>`
    : "";
  host.innerHTML = `
    <div class="panel-kicker"><span>02</span> WORK INSPECTOR</div>
    <h3>${wgEscape(node.title)}</h3>
    <div class="data-field"><label>GRAPH ID</label><p style="margin:0;color:#9cff32;font:12px 'IBM Plex Mono',monospace">${graphIdForNode(node.id)}</p></div>
    <div class="data-field"><label>TITLE</label><input id="wg-title" class="workgraph-notes" style="min-height:42px" type="text" value="${wgEscape(node.title)}" placeholder="Work item title"></div>
    <div class="data-field"><label>WHY</label><textarea id="wg-why" class="workgraph-notes" placeholder="Why does this work exist?"></textarea></div>
    <div class="data-field"><label>NOTES</label><textarea id="wg-notes" class="workgraph-notes" placeholder="Optional context, evidence, decisions…"></textarea></div>
    <div class="data-field"><label>STATUS</label><select id="wg-status" class="workgraph-notes" style="min-height:42px">
      ${["idea","planned","ready","active","waiting","blocked","needs-decision","verification","done","cancelled","superseded"].map((status) => `<option value="${status}" ${node.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
    </select></div>
    <div class="data-field"><label>PRIORITY</label><input id="wg-priority" class="workgraph-notes" style="min-height:42px" type="number" min="1" max="9" value="${node.priority ?? 5}"></div>
    <div class="data-field"><label>PROJECT</label><p style="margin:0;color:rgba(220,235,241,.65);font:12px/1.5 'IBM Plex Mono',monospace;word-break:break-all">${wgEscape(workGraphState.projectPath || "—")}</p></div>
    ${refs}
    <div class="data-field"><label>DOWNSTREAM</label><p style="margin:0;color:rgba(220,235,241,.65);font:12px/1.5 'IBM Plex Mono',monospace">${descendants.length} descendant work item${descendants.length === 1 ? "" : "s"}</p></div>
    <div class="workgraph-actions" style="margin-top:18px;justify-content:flex-start">
      <button id="wg-add-child" class="hud-button hot">ADD CHILD</button>
      <button id="wg-add-decision" class="hud-button">ADD DECISION</button>
      ${node.id !== "root-project" && node.id !== workGraphState.nodes[0]?.id ? '<button id="wg-delete" class="hud-button">DELETE</button>' : ''}
    </div>`;

  wg$("#wg-title").value = node.title || "";
  wg$("#wg-why").value = node.why || "";
  wg$("#wg-notes").value = node.notes || "";
  wg$("#wg-title").addEventListener("change", (event) => {
    const title = event.target.value.trim();
    if (!title) { event.target.value = node.title || ""; return; }
    updateNode(node.id, { title });
    renderWorkGraph();
  });
  wg$("#wg-why").addEventListener("input", (event) => updateNode(node.id, { why: event.target.value }));
  wg$("#wg-notes").addEventListener("input", (event) => updateNode(node.id, { notes: event.target.value }));
  wg$("#wg-status").addEventListener("change", (event) => { updateNode(node.id, { status: event.target.value }); renderWorkGraph(); });
  wg$("#wg-priority").addEventListener("change", (event) => { updateNode(node.id, { priority: Math.max(1, Math.min(9, Number(event.target.value) || 5)) }); renderWorkGraph(); });
  wg$("#wg-add-child").addEventListener("click", () => addChild(node.id, "task"));
  wg$("#wg-add-decision").addEventListener("click", () => addChild(node.id, "decision"));
  wg$("#wg-delete")?.addEventListener("click", () => deleteNode(node.id));
}

function renderWorkGraph() {
  const tree = wg$("#workgraph-tree");
  if (!tree) return;
  tree.replaceChildren();
  childrenOf(null).forEach((node) => tree.appendChild(renderNode(node)));
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
