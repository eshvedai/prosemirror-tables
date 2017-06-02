// This file defines a ProseMirror selection subclass that models
// table cell selections. The table plugin needs to be active to wire
// in the user interaction part of table selections (so that you
// actually get such selections when you select across cells).

var ref = require("prosemirror-state");
var Selection = ref.Selection;
var TextSelection = ref.TextSelection;
var NodeSelection = ref.NodeSelection;
var SelectionRange = ref.SelectionRange;
var ref$1 = require("prosemirror-view");
var Decoration = ref$1.Decoration;
var DecorationSet = ref$1.DecorationSet;
var ref$2 = require("prosemirror-model");
var Fragment = ref$2.Fragment;
var Slice = ref$2.Slice;

var ref$3 = require("./util");
var inSameTable = ref$3.inSameTable;
var pointsAtCell = ref$3.pointsAtCell;
var setAttr = ref$3.setAttr;
var ref$4 = require("./tablemap");
var TableMap = ref$4.TableMap;

var CellSelection = (function (Selection) {
  function CellSelection($anchorCell, $headCell) {
    if ( $headCell === void 0 ) $headCell = $anchorCell;

    var table = $anchorCell.node(-1), map = TableMap.get(table), start = $anchorCell.start(-1)
    var rect = map.rectBetween($anchorCell.pos - start, $headCell.pos - start)
    var doc = $anchorCell.node(0)
    var cells = map.cellsInRect(rect).filter(function (p) { return p != $headCell.pos - start; })
    // Make the head cell the first range, so that it counts as the
    // primary part of the selection
    cells.unshift($headCell.pos - start)
    var ranges = cells.map(function (pos) {
      var cell = table.nodeAt(pos), from = pos + start + 1
      return new SelectionRange(doc.resolve(from), doc.resolve(from + cell.content.size))
    })
    Selection.call(this, ranges[0].$from, ranges[0].$to, ranges)
    this.$anchorCell = $anchorCell
    this.$headCell = $headCell
  }

  if ( Selection ) CellSelection.__proto__ = Selection;
  CellSelection.prototype = Object.create( Selection && Selection.prototype );
  CellSelection.prototype.constructor = CellSelection;

  CellSelection.prototype.map = function (doc, mapping) {
    var $anchorCell = doc.resolve(mapping.map(this.$anchorCell.pos))
    var $headCell = doc.resolve(mapping.map(this.$headCell.pos))
    if (pointsAtCell($anchorCell) && pointsAtCell($headCell) && inSameTable($anchorCell, $headCell)) {
      var tableChanged = this.$anchorCell.node(-1) != $anchorCell.node(-1)
      if (tableChanged && this.isColSelection())
        { return CellSelection.colSelection($anchorCell, $headCell) }
      else if (tableChanged && this.isRowSelection())
        { return CellSelection.rowSelection($anchorCell, $headCell) }
      else
        { return new CellSelection($anchorCell, $headCell) }
    }
    return TextSelection.between($anchorCell, $headCell)
  };

  // :: () → Slice
  // Returns a rectangular slice of table rows containing the selected
  // cells.
  CellSelection.prototype.content = function () {
    var table = this.$anchorCell.node(-1), map = TableMap.get(table), start = this.$anchorCell.start(-1)
    var rect = map.rectBetween(this.$anchorCell.pos - start, this.$headCell.pos - start)
    var seen = [], rows = []
    for (var row = rect.top; row < rect.bottom; row++) {
      var rowContent = []
      for (var index = row * map.width + rect.left, col = rect.left; col < rect.right; col++, index++) {
        var pos = map.map[index]
        if (seen.indexOf(pos) == -1) {
          seen.push(pos)
          var cellRect = map.findCell(pos), cell = table.nodeAt(pos)
          if (cellRect.left < rect.left || cellRect.right > rect.right) {
            var attrs = setAttr(cell.attrs, "colspan", Math.min(cellRect.right, rect.right) - Math.max(cellRect.left, rect.left))
            if (cellRect.left < rect.left) { cell = cell.type.createAndFill(attrs) }
            else { cell = cell.type.create(attrs, cell.content) }
          }
          if (cellRect.top < rect.top || cellRect.bottom > rect.bottom) {
            var attrs$1 = setAttr(cell.attrs, "rowspan", Math.min(cellRect.bottom, rect.bottom) - Math.max(cellRect.top, rect.top))
            if (cellRect.top < rect.top) { cell = cell.type.createAndFill(attrs$1) }
            else { cell = cell.type.create(attrs$1, cell.content) }
          }
          rowContent.push(cell)
        }
      }
      rows.push(table.child(row).copy(Fragment.from(rowContent)))
    }
    return new Slice(Fragment.from(rows), 1, 1)
  };

  CellSelection.prototype.replace = function (tr, content) {
    if ( content === void 0 ) content = Slice.empty;

    var mapFrom = tr.steps.length, ranges = this.ranges
    for (var i = 0; i < ranges.length; i++) {
      var ref = ranges[i];
      var $from = ref.$from;
      var $to = ref.$to;
      var mapping = tr.mapping.slice(mapFrom)
      tr.replace(mapping.map($from.pos), mapping.map($to.pos), i ? Slice.empty : content)
    }
    var sel = Selection.findFrom(tr.doc.resolve(tr.mapping.slice(mapFrom).map(this.to)), -1)
    if (sel) { tr.setSelection(sel) }
  };

  CellSelection.prototype.replaceWith = function (tr, node) {
    this.replace(tr, new Slice(Fragment.from(node), 0, 0))
  };

  CellSelection.prototype.forEachCell = function (f) {
    var table = this.$anchorCell.node(-1), map = TableMap.get(table), start = this.$anchorCell.start(-1)
    var cells = map.cellsInRect(map.rectBetween(this.$anchorCell.pos - start, this.$headCell.pos - start))
    for (var i = 0; i < cells.length; i++)
      { f(table.nodeAt(cells[i]), start + cells[i]) }
  };

  // :: () → bool
  // True if this selection goes all the way from the left to the
  // right of the table.
  CellSelection.prototype.isRowSelection = function () {
    var anchorTop = this.$anchorCell.index(-1), headTop = this.$headCell.index(-1)
    if (Math.min(anchorTop, headTop) > 0) { return false }
    var anchorBot = anchorTop + this.$anchorCell.nodeAfter.attrs.rowspan,
        headBot = headTop + this.$headCell.nodeAfter.attrs.rowspan
    return Math.max(anchorBot, headBot) == this.$headCell.node(-1).childCount
  };

  // :: (ResolvedPos, ?ResolvedPos) → CellSelection
  // Returns the smallest row selection that covers the given anchor
  // and head cell.
  CellSelection.rowSelection = function ($anchorCell, $headCell) {
    if ( $headCell === void 0 ) $headCell = $anchorCell;

    var map = TableMap.get($anchorCell.node(-1)), start = $anchorCell.start(-1)
    var anchorRect = map.findCell($anchorCell.pos - start), headRect = map.findCell($headCell.pos - start)
    var doc = $anchorCell.node(0)
    if (anchorRect.top <= headRect.top) {
      if (anchorRect.top > 0)
        { $anchorCell = doc.resolve(start + map.map[anchorRect.left]) }
      if (headRect.bottom < map.height)
        { $headCell = doc.resolve(start + map.map[map.width * (map.height - 1) + headRect.right - 1]) }
    } else {
      if (headRect.top > 0)
        { $headCell = doc.resolve(start + map.map[headRect.left]) }
      if (anchorRect.bottom < map.height)
        { $anchorCell = doc.resolve(start + map.map[map.width * (map.height - 1) + anchorRect.right - 1]) }
    }
    return new CellSelection($anchorCell, $headCell)
  };

  // :: () → bool
  // True if this selection goes all the way from the top to the
  // bottom of the table.
  CellSelection.prototype.isColSelection = function () {
    var map = TableMap.get(this.$anchorCell.node(-1)), start = this.$anchorCell.start(-1)
    var anchorLeft = map.colCount(this.$anchorCell.pos - start),
        headLeft = map.colCount(this.$headCell.pos - start)
    if (Math.min(anchorLeft, headLeft) > 0) { return false }
    var anchorRight = anchorLeft + this.$anchorCell.nodeAfter.attrs.colspan,
        headRight = headLeft + this.$headCell.nodeAfter.attrs.colspan
    return Math.max(anchorRight, headRight) == map.width
  };

  CellSelection.prototype.eq = function (other) {
    return other instanceof CellSelection && other.$anchorCell.pos == this.$anchorCell.pos &&
      other.$headCell.pos == this.$headCell.pos
  };

  // :: (ResolvedPos, ?ResolvedPos) → CellSelection
  // Returns the smallest column selection that covers the given anchor
  // and head cell.
  CellSelection.colSelection = function ($anchorCell, $headCell) {
    if ( $headCell === void 0 ) $headCell = $anchorCell;

    var map = TableMap.get($anchorCell.node(-1)), start = $anchorCell.start(-1)
    var anchorRect = map.findCell($anchorCell.pos - start), headRect = map.findCell($headCell.pos - start)
    var doc = $anchorCell.node(0)
    if (anchorRect.left <= headRect.left) {
      if (anchorRect.left > 0)
        { $anchorCell = doc.resolve(start + map.map[anchorRect.top * map.width]) }
      if (headRect.right < map.width)
        { $headCell = doc.resolve(start + map.map[map.width * (headRect.top + 1) - 1]) }
    } else {
      if (headRect.left > 0)
        { $headCell = doc.resolve(start + map.map[headRect.top * map.width]) }
      if (anchorRect.right < map.width)
        { $anchorCell = doc.resolve(start + map.map[map.width * (anchorRect.top + 1) - 1]) }
    }
    return new CellSelection($anchorCell, $headCell)
  };

  CellSelection.prototype.toJSON = function () {
    return {type: "cell", anchor: this.$anchorCell.pos, head: this.$headCell.pos}
  };

  CellSelection.fromJSON = function (doc, json) {
    return new CellSelection(doc.resolve(json.anchor), doc.resolve(json.head))
  };

  // :: (Node, number, ?number) → CellSelection
  CellSelection.create = function (doc, anchorCell, headCell) {
    if ( headCell === void 0 ) headCell = anchorCell;

    return new CellSelection(doc.resolve(anchorCell), doc.resolve(headCell))
  };

  CellSelection.prototype.getBookmark = function () { return new CellBookmark(this.$anchorCell.pos, this.$headCell.pos) };

  return CellSelection;
}(Selection));
exports.CellSelection = CellSelection

CellSelection.prototype.visible = false

Selection.jsonID("cell", CellSelection)

var CellBookmark = function(anchor, head) {
  this.anchor = anchor
  this.head = head
};
CellBookmark.prototype.map = function (mapping) {
  return new CellBookmark(mapping.map(this.anchor), mapping.map(this.head))
};
CellBookmark.prototype.resolve = function (doc) {
  var $anchorCell = doc.resolve(this.anchor), $headCell = doc.resolve(this.head)
  if ($anchorCell.parent.type.spec.tableRole == "row" &&
      $headCell.parent.type.spec.tableRole == "row" &&
      $anchorCell.index() < $anchorCell.parent.childCount &&
      $headCell.index() < $headCell.parent.childCount &&
      inSameTable($anchorCell, $headCell))
    { return new CellSelection($anchorCell, $headCell) }
  else
    { return Selection.near($headCell, 1) }
};

exports.drawCellSelection = function(state) {
  if (!(state.selection instanceof CellSelection)) { return null }
  var cells = []
  state.selection.forEachCell(function (node, pos) {
    cells.push(Decoration.node(pos, pos + node.nodeSize, {class: "selectedCell"}))
  })
  return DecorationSet.create(state.doc, cells)
}

function isCellBoundarySelection(ref) {
  var $from = ref.$from;
  var $to = ref.$to;

  if ($from.pos == $to.pos || $from.pos < $from.pos - 6) { return false } // Cheap elimination
  var afterFrom = $from.pos, beforeTo = $to.pos, depth = $from.depth
  for (; depth >= 0; depth--, afterFrom++)
    { if ($from.after(depth + 1) < $from.end(depth)) { break } }
  for (var d = $to.depth; d >= 0; d--, beforeTo--)
    { if ($to.before(d + 1) > $to.start(d)) { break } }
  return afterFrom == beforeTo && /row|table/.test($from.node(depth).type.spec.tableRole)
}

exports.normalizeSelection = function(state, tr) {
  var sel = (tr || state).selection, doc = (tr || state).doc, normalize, role
  if (sel instanceof NodeSelection && (role = sel.node.type.spec.tableRole)) {
    if (role == "cell" || role == "header_cell") {
      normalize = CellSelection.create(doc, sel.from)
    } else if (role == "row") {
      var $cell = doc.resolve(sel.from + 1)
      normalize = CellSelection.rowSelection($cell, $cell)
    } else {
      var map = TableMap.get(sel.node), start = sel.from + 1
      var lastCell = start + map.map[map.width * map.height - 1]
      normalize = CellSelection.create(doc, start + 1, lastCell)
    }
  } else if (sel instanceof TextSelection && isCellBoundarySelection(sel)) {
    normalize = TextSelection.create(doc, sel.from)
  }
  if (normalize)
    { (tr || (tr = state.tr)).setSelection(normalize) }
  return tr
}
