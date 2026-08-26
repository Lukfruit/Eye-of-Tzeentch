/*
 * Work Graph model layer.
 *
 * This file is deliberately DOM-free. Keep graph traversal, derived status,
 * and hierarchy rules here so UI code cannot create state/DOM feedback loops.
 *
 * Contract: functions in this module are pure with respect to `nodes`.
 */
(() => {
  const STATUS_RANK = Object.freeze({
    idea: 1,
    planned: 2,
    ready: 3,
    waiting: 3,
    verification: 4,
    active: 4,
    blocked: 5,
    "needs-decision": 6,
  });

  function childrenOf(nodes, parentId) {
    return nodes
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || a.title.localeCompare(b.title));
  }

  function descendantsOf(nodes, id, seen = new Set()) {
    if (seen.has(id)) return [];
    seen.add(id);
    const result = [];
    for (const child of childrenOf(nodes, id)) {
      result.push(child);
      result.push(...descendantsOf(nodes, child.id, seen));
    }
    return result;
  }

  function graphIdForNode(nodes, nodeId) {
    const segments = [];
    let current = nodes.find((node) => node.id === nodeId);
    const seen = new Set();

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const siblings = childrenOf(nodes, current.parentId);
      const index = Math.max(0, siblings.findIndex((node) => node.id === current.id)) + 1;
      segments.unshift(index);
      current = current.parentId == null ? null : nodes.find((node) => node.id === current.parentId);
    }

    return segments.length ? `P${segments.join("-")}` : "P1";
  }

  function effectiveStatus(nodes, nodeId, visiting = new Set()) {
    if (visiting.has(nodeId)) return "blocked";

    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return "planned";

    const children = childrenOf(nodes, nodeId);
    if (!children.length) return node.status || "planned";

    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    const childStatuses = children.map((child) => effectiveStatus(nodes, child.id, nextVisiting));

    if (childStatuses.every((status) => status === "done")) return "done";

    const candidates = [node.status, ...childStatuses].filter((status) => STATUS_RANK[status]);
    return candidates.reduce(
      (highest, status) => (STATUS_RANK[status] > (STATUS_RANK[highest] || 0) ? status : highest),
      "planned",
    );
  }

  function validate(nodes) {
    const ids = new Set();
    const errors = [];

    for (const node of nodes) {
      if (!node?.id) errors.push("Node is missing an id");
      else if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
      else ids.add(node.id);
    }

    for (const node of nodes) {
      if (node.parentId != null && !ids.has(node.parentId)) {
        errors.push(`Missing parent ${node.parentId} for node ${node.id}`);
      }
    }

    const visit = (id, visiting, visited) => {
      if (visiting.has(id)) {
        errors.push(`Cycle detected at node ${id}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      childrenOf(nodes, id).forEach((child) => visit(child.id, visiting, visited));
      visiting.delete(id);
      visited.add(id);
    };

    const visited = new Set();
    nodes.forEach((node) => visit(node.id, new Set(), visited));
    return [...new Set(errors)];
  }

  window.WorkGraphModel = Object.freeze({
    STATUS_RANK,
    childrenOf,
    descendantsOf,
    graphIdForNode,
    effectiveStatus,
    validate,
  });
})();
