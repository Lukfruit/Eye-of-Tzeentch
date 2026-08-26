const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "static", "workgraph-model.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context, { filename: "workgraph-model.js" });
const Model = context.window.WorkGraphModel;

function node(id, parentId, status, priority = 1) {
  return { id, parentId, title: id, status, priority, kind: "task" };
}

const tree = [
  node("p1", null, "planned"),
  node("p1-1", "p1", "planned"),
  node("p1-1-1", "p1-1", "needs-decision"),
];

assert.equal(Model.effectiveStatus(tree, "p1-1-1"), "needs-decision");
assert.equal(Model.effectiveStatus(tree, "p1-1"), "needs-decision");
assert.equal(Model.effectiveStatus(tree, "p1"), "needs-decision");

const activeTree = [
  node("p2", null, "planned"),
  node("p2-1", "p2", "active"),
  node("p2-2", "p2", "planned"),
];
assert.equal(Model.effectiveStatus(activeTree, "p2"), "active");

const doneTree = [
  node("p3", null, "active"),
  node("p3-1", "p3", "done"),
  node("p3-2", "p3", "done"),
];
assert.equal(Model.effectiveStatus(doneTree, "p3"), "done");

const ids = [
  node("root", null, "planned"),
  node("child-a", "root", "planned", 1),
  node("child-b", "root", "planned", 2),
  node("grandchild", "child-b", "planned", 1),
];
assert.equal(Model.graphIdForNode(ids, "root"), "P1");
assert.equal(Model.graphIdForNode(ids, "child-a"), "P1-1");
assert.equal(Model.graphIdForNode(ids, "child-b"), "P1-2");
assert.equal(Model.graphIdForNode(ids, "grandchild"), "P1-2-1");

const cyclic = [
  node("a", "b", "planned"),
  node("b", "a", "planned"),
];
assert.equal(Model.effectiveStatus(cyclic, "a"), "blocked");
assert.ok(Model.validate(cyclic).length === 0, "Parent references are present even though the graph is cyclic");

const invalid = [
  node("dup", null, "planned"),
  node("dup", null, "planned"),
  node("orphan", "missing-parent", "planned"),
];
const errors = Model.validate(invalid);
assert.ok(errors.some((error) => error.includes("Duplicate node id")));
assert.ok(errors.some((error) => error.includes("Missing parent")));

console.log("Work Graph model tests passed.");
