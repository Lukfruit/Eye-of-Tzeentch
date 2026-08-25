(() => {
  const STORAGE_KEY = "cyber-soul-workgraph-fade-expanded";
  let fadeExpanded = localStorage.getItem(STORAGE_KEY) !== "false";

  const statusRank = {
    idea: 1,
    planned: 2,
    ready: 3,
    active: 4,
    blocked: 5,
    "needs-decision": 6,
  };

  function ensureStylesheet() {
    if (document.querySelector('link[data-workgraph-preferences]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/workgraph-preferences.css";
    link.dataset.workgraphPreferences = "true";
    document.head.appendChild(link);
  }

  function graphNodes() {
    return typeof workGraphState !== "undefined" ? workGraphState.nodes : [];
  }

  function childrenOf(id) {
    return graphNodes().filter((node) => node.parentId === id);
  }

  function rollupStatus(id, visiting = new Set()) {
    if (visiting.has(id)) return "planned";
    visiting.add(id);

    const node = graphNodes().find((item) => item.id === id);
    if (!node) return "planned";

    const children = childrenOf(id);
    if (!children.length) return node.status || "planned";

    const childStatuses = children.map((child) => rollupStatus(child.id, new Set(visiting)));
    if (childStatuses.every((status) => status === "done")) return "done";

    const candidates = [node.status, ...childStatuses].filter((status) => statusRank[status]);
    return candidates.reduce(
      (highest, status) => ((statusRank[status] || 0) > (statusRank[highest] || 0) ? status : highest),
      "planned",
    );
  }

  function applyStatusRollup() {
    if (typeof workGraphState === "undefined") return;

    const effectiveById = new Map();
    graphNodes().filter((node) => node.parentId == null).forEach((root) => {
      const visit = (node) => {
        effectiveById.set(node.id, rollupStatus(node.id));
        childrenOf(node.id).forEach(visit);
      };
      visit(root);
    });

    document.querySelectorAll("#workgraph-tree .workgraph-node").forEach((element) => {
      const nodeId = element.dataset.nodeId;
      const effective = effectiveById.get(nodeId);
      if (!effective) return;
      const badge = element.querySelector(":scope > .workgraph-content .workgraph-status");
      if (!badge) return;
      const label = effective.replaceAll("-", " ").toUpperCase();
      if (badge.textContent !== label) badge.textContent = label;
      if (badge.dataset.rolledStatus !== effective) badge.dataset.rolledStatus = effective;
      if (element.dataset.effectiveStatus !== effective) element.dataset.effectiveStatus = effective;
    });
  }

  function setExpandedMarkers() {
    document.querySelectorAll("#workgraph-tree .workgraph-node").forEach((node) => {
      const wrap = Array.from(node.children).find((child) => child.classList.contains("workgraph-node-children-wrap"));
      const branch = wrap?.querySelector(":scope > .workgraph-children");
      node.classList.toggle("expanded", Boolean(branch));
    });
    applyStatusRollup();
  }

  function applyFadePreference() {
    document.body.classList.toggle("wg-fade-expanded", fadeExpanded);
    const button = document.querySelector(".workgraph-preference[data-preference=\"fade-expanded\"]");
    if (button) {
      button.classList.toggle("active", fadeExpanded);
      button.setAttribute("aria-pressed", String(fadeExpanded));
    }
    setExpandedMarkers();
  }

  function createPreferenceControl() {
    const panel = document.querySelector(".optional-rules-panel");
    const anchor = document.querySelector("#apply-optional-rules");
    if (!panel || !anchor || document.querySelector(".workgraph-preference[data-preference=\"fade-expanded\"]")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "workgraph-preference";
    button.dataset.preference = "fade-expanded";
    button.setAttribute("aria-pressed", String(fadeExpanded));
    button.innerHTML = `
      <span class="mode-sigil">◌</span>
      <span>
        <strong>FADE EXPANDED GOALS</strong>
        <small>Dim parent goals while their child work is visible.</small>
      </span>
      <i></i>`;
    button.addEventListener("click", () => {
      fadeExpanded = !fadeExpanded;
      localStorage.setItem(STORAGE_KEY, String(fadeExpanded));
      applyFadePreference();
    });
    panel.insertBefore(button, anchor);
  }

  function init() {
    ensureStylesheet();
    createPreferenceControl();
    applyFadePreference();

    const tree = document.querySelector("#workgraph-tree");
    if (tree) {
      const observer = new MutationObserver((mutations) => {
        const hasStructuralChange = mutations.some((mutation) =>
          [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
            node.nodeType === Node.ELEMENT_NODE && (
              node.classList.contains("workgraph-node") ||
              node.classList.contains("workgraph-node-children-wrap") ||
              node.querySelector?.(".workgraph-node")
            ),
          ),
        );
        if (hasStructuralChange) setExpandedMarkers();
      });
      observer.observe(tree, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
