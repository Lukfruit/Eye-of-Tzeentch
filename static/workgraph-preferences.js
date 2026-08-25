(() => {
  const STORAGE_KEY = "cyber-soul-workgraph-fade-expanded";
  let fadeExpanded = localStorage.getItem(STORAGE_KEY) !== "false";

  function ensureStylesheet() {
    if (document.querySelector('link[data-workgraph-preferences]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/workgraph-preferences.css";
    link.dataset.workgraphPreferences = "true";
    document.head.appendChild(link);
  }

  function setExpandedMarkers() {
    document.querySelectorAll("#workgraph-tree .workgraph-node").forEach((node) => {
      const childWrap = Array.from(node.children).find((child) => child.classList.contains("workgraph-node-children-wrap"));
      const childList = childWrap?.querySelector(":scope > .workgraph-children");
      node.classList.toggle("expanded", Boolean(childList && !childList.hidden));
    });
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
