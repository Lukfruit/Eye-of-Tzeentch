(() => {
  const STORAGE_KEY = "cyber-soul-workgraph-fade-expanded";
  let fadeExpanded = localStorage.getItem(STORAGE_KEY) !== "false";

  const statusRank = {
    "idea": 1,
    "planned": 2,
    "ready": 3,
    "active": 4,
    "blocked": 5,
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

  function directChildren(node) {
    const wrap = Array.from(node.children).find((child) => child.classList.contains("workgraph-node-children-wrap"));
    const branch = wrap?.querySelector(":scope > .workgraph-children");
    return branch ? Array.from(branch.children).filter((child) => child.classList.contains("workgraph-node")) : [];
  }

  function rawStatus(node) {
    return node.querySelector(":scope > .workgraph-content .workgraph-status")?.textContent?.trim().toLowerCase().replace(/\s+/g, "-") || "planned";
  }

  function rolledStatus(node) {
    const children = directChildren(node);
    if (!children.length) return rawStatus(node);

    const childStatuses = children.map(rolledStatus);
    if (childStatuses.every((status) => status === "done")) return "done";

    const candidates = [rawStatus(node), ...childStatuses].filter((status) => statusRank[status]);
    return candidates.reduce((highest, status) =>
      (statusRank[status] || 0) > (statusRank[highest] || 0) ? status : highest,
      "planned",
    );
  }

  function applyStatusRollup() {
    document.querySelectorAll("#workgraph-tree > .workgraph-node").forEach((root) => {
      const visit = (node) => {
        directChildren(node).forEach(visit);
        const effective = rolledStatus(node);
        const badge = node.querySelector(":scope > .workgraph-content .workgraph-status");
        if (!badge) return;
        badge.textContent = effective.replaceAll("-", " ").toUpperCase();
        badge.dataset.rolledStatus = effective;
        node.dataset.effectiveStatus = effective;
      };
      visit(root);
    });
  }

  function setExpandedMarkers() {
    document.querySelectorAll("#workgraph-tree .workgraph-node").forEach((node) => {
      const children = directChildren(node);
      node.classList.toggle("expanded", children.length > 0 && !children[0]?.parentElement?.hidden);
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
      new MutationObserver(() => setExpandedMarkers()).observe(tree, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
