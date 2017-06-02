// Various helper function for working with tables

var ref = require("prosemirror-state");
var PluginKey = ref.PluginKey;
var NodeSelection = ref.NodeSelection;

var ref$1 = require("./tablemap");
var TableMap = ref$1.TableMap;

exports.key = new PluginKey("selectingCells")

exports.cellAround = function($pos) {
  for (var d = $pos.depth - 1; d > 0; d--)
    { if ($pos.node(d).type.spec.tableRole == "row") { return $pos.node(0).resolve($pos.before(d + 1)) } }
  return null
}

exports.isInTable = function(state) {
  var $head = state.selection.$head
  for (var d = $head.depth; d > 0; d--) { if ($head.node(d).type.spec.tableRole == "row") { return true } }
  return false
}

exports.selectionCell = function(state) {
  var sel = state.selection
  if (sel instanceof NodeSelection && sel.$from.parent.type.spec.tableRole == "row") { return sel.$from }
  return sel.$anchorCell || exports.cellAround(sel.$head)
}

exports.pointsAtCell = function($pos) {
  return $pos.parent.type.spec.tableRole == "row" && $pos.nodeAfter
}

exports.moveCellForward = function($pos) {
  return $pos.node(0).resolve($pos.pos + $pos.nodeAfter.nodeSize)
}

exports.inSameTable = function($a, $b) {
  return $a.depth == $b.depth && $a.pos >= $b.start(-1) && $a.pos <= $b.end(-1)
}

exports.findCell = function($pos) {
  return TableMap.get($pos.node(-1)).findCell($pos.pos - $pos.start(-1))
}

exports.colCount = function($pos) {
  return TableMap.get($pos.node(-1)).colCount($pos.pos - $pos.start(-1))
}

exports.nextCell = function($pos, axis, dir) {
  var start = $pos.start(-1), map = TableMap.get($pos.node(-1))
  var moved = map.nextCell($pos.pos - start, axis, dir)
  return moved == null ? null : $pos.node(0).resolve(start + moved)
}

exports.setAttr = function(attrs, name, value) {
  var result = {}
  for (var prop in attrs) { result[prop] = attrs[prop] }
  result[name] = value
  return result
}
