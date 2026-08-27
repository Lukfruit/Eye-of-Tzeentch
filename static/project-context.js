/*
 * Shared project context.
 *
 * ROOT:// is the active project selector. The URL's ?path= parameter mirrors
 * that state for deep-linking/reload persistence; it is not a second source
 * of truth. Project changes should go through setActiveProject().
 */
(() => {
  function projectInput() {
    return document.querySelector("#project-path");
  }

  function normalizePath(path) {
    return String(path || "").trim();
  }

  function getActiveProject() {
    const inputPath = normalizePath(projectInput()?.value);
    if (inputPath) return inputPath;
    return normalizePath(new URLSearchParams(window.location.search).get("path"));
  }

  function setActiveProject(path, { updateUrl = true, dispatch = true } = {}) {
    const nextPath = normalizePath(path);
    if (!nextPath) return "";

    const input = projectInput();
    if (input && input.value !== nextPath) input.value = nextPath;

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("path", nextPath);
      window.history.replaceState(window.history.state, "", url);
    }

    if (dispatch) {
      document.dispatchEvent(new CustomEvent("cyber-soul:project-changed", {
        detail: { path: nextPath },
      }));
    }

    return nextPath;
  }

  window.getActiveProject = getActiveProject;
  window.setActiveProject = setActiveProject;

  function bridgeScanProject() {
    const original = window.scanProject;
    if (typeof original !== "function" || original.__projectContextBridge) return;

    const bridged = async function projectContextScanProject(path, ...args) {
      const result = await original.call(this, path, ...args);
      setActiveProject(path);
      return result;
    };

    bridged.__projectContextBridge = true;
    window.scanProject = bridged;
  }

  function init() {
    const launchPath = normalizePath(new URLSearchParams(window.location.search).get("path"));
    const inputPath = normalizePath(projectInput()?.value);
    if (!inputPath && launchPath) setActiveProject(launchPath, { updateUrl: false, dispatch: false });
    bridgeScanProject();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
