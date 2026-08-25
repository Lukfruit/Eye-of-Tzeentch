const workGraphStoreKey = "cyber-soul-work-graph";

const workGraphState = {
  nodes: [],
  selected: null,
  expanded: new Set(),
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
function wgEscape(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }

function loadWorkGraph() {
  try {
    const parsed = JSON.parse(localStorage.getItem(workGraphStoreKey) || "null");
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (_) {}
  return structuredClone(workGraphDefaults);
}

function saveWorkGraph() {
  localStorage.setItem(workGraphStoreKey, JSON.stringify(workGraphState.nodes));
}

function childrenOf(parentId) {
  return workGraphState.nodes.filter((node) => node.parentId === parentId).sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title));
}

function descendantsOf(id) {
  const result = [];
  const walk = (parent) => childrenOf(parent).forEach((node) => { result.push(node); walk(node.id); });
  walk(id);
  return result;
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
  workGraphState.expanded.add(parentId);
  workGraphState.selected = node.id;
  saveWorkGraph();
  renderWorkGraph();
}

function updateNode(id, patch) {
  const node = workGraphState.nodes.find((item) => item.id === id);
  if (!node) return;
  Object.assign(node, patch);
  saveWorkGraph();
}

function deleteNode(id) {
  if (id === "root-project") return;
  const doomed = new Set([id, ...descendantsOf(id).map((node) => node.id)]);
  workGraphState.nodes = workGraphState.nodes.filter((node) => !doomed.has(node.id));
  workGraphState.selected = null;
  saveWorkGraph();
  renderWorkGraph();
}

function renderNode(node, depth = 0) {
  const children = childrenOf(node.id);
  const expanded = workGraphState.expanded.has(node.id);
  const selected = workGraphState.selected === node.id;
  const article = document.createElement("article");
  article.className = "workgraph-node";
  article.dataset.depth = depth;
  article.style.setProperty("--work-color", nodeColor(node));

  const rail = document.createElement("div");
  rail.className = "workgraph-rail";
  rail.innerHTML = `<span class="workgraph-dot"></span>`;

  const content = document.createElement("div");
  content.className = `workgraph-content ${selected ? "selected" : ""}`;
  content.innerHTML = `
    <button class="workgraph-node-main" type="button">
      <button class="workgraph-expand" type="button" aria-label="${expanded ? "Collapse" : "Expand"}">${children.length ? (expanded ? "−" : "+") : "·"}</button>
      <span class="workgraph-title"><strong>${wgEscape(node.title)}</strong><small>${node.kind === "decision" ? "DECISION" : node.why ? wgEscape(node.why) : ""}</small></span>
      <span class="workgraph-meta"><span class="workgraph-priority">P${node.priority ?? 5}</span><span class="workgraph-status ${wgEscape(node.status)}">${statusLabel(node.status)}</span></span>
    </button>
  `;
  const main = content.querySelector(".workgraph-node-main");
  const expand = content.querySelector(".workgraph-expand");
  expand.disabled = !children.length;
  expand.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!children.length) return;
    if (expanded) workGraphState.expanded.delete(node.id); else workGraphState.expanded.add(node.id);
    renderWorkGraph();
  });
  main.addEventListener("click", () => setSelected(node.id));

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
  host.innerHTML = `
    <div class="panel-kicker"><span>02</span> WORK INSPECTOR</div>
    <h3>${wgEscape(node.title)}</h3>
    <div class="data-field"><label>WHY</label><textarea id="wg-why" class="workgraph-notes" placeholder="Why does this work exist?">${wgEscape(node.why || "")}</textarea></div>
    <div class="data-field"><label>NOTES</label><textarea id="wg-notes" class="workgraph-notes" placeholder="Optional context, evidence, decisions…">${wgEscape(node.notes || "")}</textarea></div>
    <div class="data-field"><label>STATUS</label><select id="wg-status" class="workgraph-notes" style="min-height:42px">
      ${["idea","planned","ready","active","waiting","blocked","needs-decision","verification","done","cancelled","superseded"].map((status) => `<option value="${status}" ${node.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
    </select></div>
    <div class="data-field"><label>PRIORITY</label><input id="wg-priority" class="workgraph-notes" style="min-height:42px" type="number" min="1" max="9" value="${node.priority ?? 5}"></div>
    <div class="data-field"><label>DOWNSTREAM</label><p style="margin:0;color:rgba(220,235,241,.65);font:12px/1.5 'IBM Plex Mono',monospace">${descendants.length} descendant work item${descendants.length === 1 ? "" : "s"}</p></div>
    <div class="workgraph-actions" style="margin-top:18px;justify-content:flex-start">
      <button id="wg-add-child" class="hud-button hot">ADD CHILD</button>
      <button id="wg-add-decision" class="hud-button">ADD DECISION</button>
      ${node.id !== "root-project" ? '<button id="wg-delete" class="hud-button">DELETE</button>' : ''}
    </div>`;

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
  const roots = childrenOf(null);
  roots.forEach((node) => tree.appendChild(renderNode(node)));
  renderInspector();
}

function setWorkGraphActive(active) {
  document.body.classList.toggle("workgraph-active", active);
  wg$("#workgraph-view")?.classList.toggle("active", active);
  $$(".workgraph-tab").forEach((button) => button.classList.toggle("active", button.dataset.view === (active ? "workgraph" : "analysis")));
  if (active) renderWorkGraph();
}

function $$(selector) { return [...document.querySelectorAll(selector)]; }

function initWorkGraph() {
  workGraphState.nodes = loadWorkGraph();
  workGraphState.expanded.add("root-project");

  wg$("#workgraph-add-root")?.addEventListener("click", () => addChild(null, "goal"));
  wg$("#workgraph-view")?.addEventListener("click", (event) => {
    const tab = event.target.closest(".workgraph-tab");
    if (tab) setWorkGraphActive(tab.dataset.view === "workgraph");
  });
  $$(".workgraph-tab").forEach((button) => button.addEventListener("click", () => setWorkGraphActive(button.dataset.view === "workgraph")));
  renderWorkGraph();
}

document.addEventListener("DOMContentLoaded", initWorkGraph);
