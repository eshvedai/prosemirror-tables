// This file defines helpers for normalizing tables, making sure no
// cells overlap (which can happen, if you have the wrong col- and
// rowspans) and that each row has the same width. Uses the problems
// reported by `TableMap`.

var ref = require("./tablemap");
var TableMap = ref.TableMap;
var ref$1 = require("./util");
var setAttr = ref$1.setAttr;
var ref$2 = require("./schema");
var tableNodeTypes = ref$2.tableNodeTypes;

// Helper for iterating through the nodes in a document that changed
// compared to the given previous document. Useful for avoiding
// duplicate work on each transaction.
function changedDescendants(old, cur, offset, f) {
  var oldSize = old.childCount, curSize = cur.childCount
  outer: for (var i = 0, j = 0; i < curSize; i++) {
    var child = cur.child(i)
    for (var scan = j, e = Math.min(oldSize, i + 3); scan < e; scan++) {
      if (old.child(scan) == child) {
        j = scan + 1
        offset += child.nodeSize
        continue outer
      }
    }
    f(child, offset)
    if (j < oldSize && old.child(j).sameMarkup(child))
      { changedDescendants(old.child(j), child, offset + 1, f) }
    else
      { child.nodesBetween(0, child.content.size, f, offset + 1) }
    offset += child.nodeSize
  }
}

// :: (EditorState, ?EditorState) → ?Transaction
// Inspect all tables in the given state's document and return a
// transaction that fixes them, if necessary. If `oldState` was
// provided, that is assumed to hold a previous, known-good state,
// which will be used to avoid re-scanning unchanged parts of the
// document.
exports.fixTables = function(state, oldState) {
  var tr, check = function (node, pos) {
    if (node.type.spec.tableRole == "table") { tr = fixTable(state, node, pos, tr) }
  }
  if (!oldState) { state.doc.descendants(check) }
  else if (oldState.doc != state.doc) { changedDescendants(oldState.doc, state.doc, 0, check) }
  return tr
}

// :: (EditorState, Node, number, ?Transaction) → ?Transaction
// Fix the given table, if necessary. Will append to the transaction
// it was given, if non-null, or create a new one if necessary.
var fixTable = exports.fixTable = function(state, table, tablePos, tr) {
  var map = TableMap.get(table)
  if (!map.problems) { return tr }
  if (!tr) { tr = state.tr }

  // Track which rows we must add cells to, so that we can adjust that
  // when fixing collisions.
  var mustAdd = []
  for (var i = 0; i < map.height; i++) { mustAdd.push(0) }
  for (var i$1 = 0; i$1 < map.problems.length; i$1++) {
    var prob = map.problems[i$1]
    if (prob.type == "collision") {
      var cell = table.nodeAt(prob.pos)
      for (var j = 0; j < cell.attrs.rowspan; j++) { mustAdd[prob.row + j] += prob.n }
      tr.setNodeType(tr.mapping.map(tablePos + 1 + prob.pos), null, setAttr(cell.attrs, "colspan", cell.attrs.colspan - prob.n))
    } else if (prob.type == "missing") {
      mustAdd[prob.row] += prob.n
    } else if (prob.type == "overlong_rowspan") {
      var cell$1 = table.nodeAt(prob.pos)
      tr.setNodeType(tr.mapping.map(tablePos + 1 + prob.pos), null, setAttr(cell$1.attrs, "rowspan", cell$1.attrs.rowspan - prob.n))
    }
  }
  var first, last
  for (var i$2 = 0; i$2 < mustAdd.length; i$2++) { if (mustAdd[i$2]) {
    if (first == null) { first = i$2 }
    last = i$2
  } }
  // Add the necessary cells, using a heuristic for whether to add the
  // cells at the start or end of the rows (if it looks like a 'bite'
  // was taken out of the table, add cells at the start of the row
  // after the bite. Otherwise add them at the end).
  for (var i$3 = 0, pos = tablePos + 1; i$3 < map.height; i$3++) {
    var end = pos + table.child(i$3).nodeSize
    var add = mustAdd[i$3]
    if (add > 0) {
      var nodes = []
      for (var j$1 = 0; j$1 < add; j$1++)
        { nodes.push(tableNodeTypes(state.schema).cell.createAndFill()) }
      var side = (i$3 == 0 || first == i$3 - 1) && last == i$3 ? pos + 1 : end - 1
      tr.insert(tr.mapping.map(side), nodes)
    }
    pos = end
  }
  return tr
}
