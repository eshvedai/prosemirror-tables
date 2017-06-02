// Utilities used for copy/paste handling.
//
// This module handles pasting cell content into tables, or pasting
// anything into a cell selection, as replacing a block of cells with
// the content of the selection. When pasting cells into a cell, that
// involves placing the block of pasted content so that its top left
// aligns with the selection cell, optionally extending the table to
// the right or bottom to make sure it is large enough. Pasting into a
// cell selection is different, here the cells in the selection are
// clipped to the selection's rectangle, optionally repeating the
// pasted cells when they are smaller than the selection.

var ref = require("prosemirror-model");
var Slice = ref.Slice;
var Fragment = ref.Fragment;
var ref$1 = require("prosemirror-transform");
var Transform = ref$1.Transform;

var ref$2 = require("./util");
var setAttr = ref$2.setAttr;
var ref$3 = require("./tablemap");
var TableMap = ref$3.TableMap;
var ref$4 = require("./cellselection");
var CellSelection = ref$4.CellSelection;
var ref$5 = require("./schema");
var tableNodeTypes = ref$5.tableNodeTypes;

// Utilities to help with copying and pasting table cells

// :: (Slice) → ?{width: number, height: number, rows: [Fragment]}
// Get a rectangular area of cells from a slice, or null if the outer
// nodes of the slice aren't table cells or rows.
exports.pastedCells = function(slice) {
  if (!slice.size) { return null }
  var content = slice.content;
  var openStart = slice.openStart;
  var openEnd = slice.openEnd;
  while (content.childCount == 1 && (openStart > 0 && openEnd > 0 || content.firstChild.type.spec.tableRole == "table")) {
    openStart--
    openEnd--
    content = content.firstChild.content
  }
  var first = content.firstChild, role = first.type.spec.tableRole
  var schema = first.type.schema, rows = []
  if (role == "row") {
    for (var i = 0; i < content.childCount; i++) {
      var cells = content.child(i).content
      var left = i ? 0 : Math.max(0, openStart - 1)
      var right = i < content.childCount - 1 ? 0 : Math.max(0, openEnd - 1)
      if (left || right) { cells = fitSlice(tableNodeTypes(schema).row, new Slice(cells, left, right)).content }
      rows.push(cells)
    }
  } else if (role == "cell" || role == "header_cell") {
    rows.push(openStart || openEnd ? fitSlice(tableNodeTypes(schema).row, new Slice(content, openStart, openEnd)).content : content)
  } else {
    return null
  }
  return ensureRectangular(schema, rows)
}

// :: [Fragment] → {width: number, height: number, rows: [Fragment]}
// Compute the width and height of a set of cells, and make sure each
// row has the same number of cells.
function ensureRectangular(schema, rows) {
  var widths = []
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i]
    for (var j = row.childCount - 1; j >= 0; j--) {
      var ref = row.child(j).attrs;
      var rowspan = ref.rowspan;
      var colspan = ref.colspan;
      for (var r = i; r < i + rowspan; r++)
        { widths[r] = (widths[r] || 0) + colspan }
    }
  }
  var width = 0
  for (var r$1 = 0; r$1 < widths.length; r$1++) { width = Math.max(width, widths[r$1]) }
  for (var r$2 = 0; r$2 < widths.length; r$2++) {
    if (r$2 >= rows.length) { rows.push(Fragment.empty) }
    if (widths[r$2] < width) {
      var empty = tableNodeTypes(schema).cell.createAndFill(), cells = []
      for (var i$1 = widths[r$2]; i$1 < width; i$1++) { cells.push(empty) }
      rows[r$2] = rows[r$2].append(Fragment.from(cells))
    }
  }
  return {height: rows.length, width: width, rows: rows}
}

var fitSlice = exports.fitSlice = function(nodeType, slice) {
  var node = nodeType.createAndFill()
  var tr = new Transform(node).replace(0, node.content.size, slice)
  return tr.doc
}

// :: ({width: number, height: number, rows: [Fragment]}, number, number) → {width: number, height: number, rows: [Fragment]}
// Clip or extend (repeat) the given set of cells to cover the given
// width and height. Will clip rowspan/colspan cells at the edges when
// they stick out.
exports.clipCells = function(ref, newWidth, newHeight) {
  var width = ref.width;
  var height = ref.height;
  var rows = ref.rows;

  if (width != newWidth) {
    var added = [], newRows = []
    for (var row = 0; row < rows.length; row++) {
      var frag = rows[row], cells = []
      for (var col = added[row] || 0, i = 0; col < newWidth; i++) {
        var cell = frag.child(i % frag.childCount)
        if (col + cell.attrs.colspan > newWidth)
          { cell = cell.type.create(setAttr(cell.attrs, "colspan", newWidth - col), cell.content) }
        cells.push(cell)
        col += cell.attrs.colspan
        for (var j = 1; j < cell.attrs.rowspan; j++)
          { added[row + j] = (added[row + j] || 0) + cell.attrs.colspan }
      }
      newRows.push(Fragment.from(cells))
    }
    rows = newRows
    width = newWidth
  }

  if (height != newHeight) {
    var newRows$1 = []
    for (var row$1 = 0, i$1 = 0; row$1 < newHeight; row$1++, i$1++) {
      var cells$1 = [], source = rows[i$1 % height]
      for (var j$1 = 0; j$1 < source.childCount; j$1++) {
        var cell$1 = source.child(j$1)
        if (row$1 + cell$1.attrs.rowspan > newHeight)
          { cell$1 = cell$1.type.create(setAttr(cell$1.attrs, "rowspan", newHeight - cell$1.attrs.rowspan), cell$1.content) }
        cells$1.push(cell$1)
      }
      newRows$1.push(Fragment.from(cells$1))
    }
    rows = newRows$1
    height = newHeight
  }

  return {width: width, height: height, rows: rows}
}

// Make sure a table has at least the given width and height. Return
// true if something was changed.
function growTable(tr, map, table, start, width, height, mapFrom) {
  var schema = tr.doc.type.schema, types = tableNodeTypes(schema), empty, emptyHead
  if (width > map.width) {
    for (var row = 0, rowEnd = 0; row < map.height; row++) {
      var rowNode = table.child(row)
      rowEnd += rowNode.nodeSize
      var cells = [], add = (void 0)
      if (rowNode.lastChild == null || rowNode.lastChild.type == types.cell)
        { add = empty || (empty = types.cell.createAndFill()) }
      else
        { add = emptyHead || (emptyHead = types.header_cell.createAndFill()) }
      for (var i = map.width; i < width; i++) { cells.push(add) }
      tr.insert(tr.mapping.slice(mapFrom).map(rowEnd - 1 + start), cells)
    }
  }
  if (height > map.height) {
    var cells$1 = []
    for (var i$1 = 0, start$1 = (map.height - 1) * map.width; i$1 < Math.max(map.width, width); i$1++) {
      var header = i$1 >= map.width ? false :
          table.nodeAt(map.map[start$1 + i$1]).type == types.header_cell
      cells$1.push(header
                 ? (emptyHead || (emptyHead = types.header_cell.createAndFill()))
                 : (empty || (empty = types.cell.createAndFill())))
    }

    var emptyRow = types.row.create(null, Fragment.from(cells$1)), rows = []
    for (var i$2 = map.height; i$2 < height; i$2++) { rows.push(emptyRow) }
    tr.insert(tr.mapping.slice(mapFrom).map(start + table.nodeSize - 2), rows)
  }
  return !!(empty || emptyHead)
}

// Make sure the given line (left, top) to (right, top) doesn't cross
// any rowspan cells by splitting cells that cross it. Return true if
// something changed.
function isolateHorizontal(tr, map, table, start, left, right, top, mapFrom) {
  if (top == 0 || top == map.height) { return false }
  var found = false
  for (var col = left; col < right; col++) {
    var index = top * map.width + col, pos = map.map[index]
    if (map.map[index - map.width] == pos) {
      found = true
      var cell = table.nodeAt(pos)
      var ref = map.findCell(pos);
      var cellTop = ref.top;
      var cellLeft = ref.left;
      tr.setNodeType(tr.mapping.slice(mapFrom).map(pos + start), null, setAttr(cell.attrs, "rowspan", top - cellTop))
      tr.insert(tr.mapping.slice(mapFrom).map(map.positionAt(top, cellLeft, table)),
                cell.type.createAndFill(setAttr(cell.attrs, "rowspan", (cellTop + cell.attrs.rowspan) - top)))
      col += cell.attrs.colspan - 1
    }
  }
  return found
}

// Make sure the given line (left, top) to (left, bottom) doesn't
// cross any colspan cells by splitting cells that cross it. Return
// true if something changed.
function isolateVertical(tr, map, table, start, top, bottom, left, mapFrom) {
  if (left == 0 || left == map.width) { return false }
  var found = false
  for (var row = top; row < bottom; row++) {
    var index = row * map.width + left, pos = map.map[index]
    if (map.map[index - 1] == pos) {
      found = true
      var cell = table.nodeAt(pos), cellLeft = map.colCount(pos)
      var updatePos = tr.mapping.slice(mapFrom).map(pos + start)
      tr.setNodeType(updatePos, null, setAttr(cell.attrs, "colspan", left - cellLeft))
      tr.insert(updatePos + cell.nodeSize,
                cell.type.createAndFill(setAttr(cell.attrs, "colspan", (cellLeft + cell.attrs.colspan) - left)))
      row += cell.attrs.rowspan - 1
    }
  }
  return found
}

// Insert the given set of cells (as returned by `pastedCells`) into a
// table, at the position pointed at by rect.
exports.insertCells = function(state, dispatch, tableStart, rect, cells) {
  var table = tableStart ? state.doc.nodeAt(tableStart - 1) : state.doc, map = TableMap.get(table)
  var top = rect.top;
  var left = rect.left;
  var right = left + cells.width, bottom = top + cells.height
  var tr = state.tr, mapFrom = 0
  function recomp() {
    table = tableStart ? tr.doc.nodeAt(tableStart - 1) : tr.doc
    map = TableMap.get(table)
    mapFrom = tr.mapping.maps.length
  }
  // Prepare the table to be large enough and not have any cells
  // crossing the boundaries of the rectangle that we want to
  // insert into. If anything about it changes, recompute the table
  // map so that subsequent operations can see the current shape.
  if (growTable(tr, map, table, tableStart, right, bottom, mapFrom)) { recomp() }
  if (isolateHorizontal(tr, map, table, tableStart, left, right, top, mapFrom)) { recomp() }
  if (isolateHorizontal(tr, map, table, tableStart, left, right, bottom, mapFrom)) { recomp() }
  if (isolateVertical(tr, map, table, tableStart, top, bottom, left, mapFrom)) { recomp() }
  if (isolateVertical(tr, map, table, tableStart, top, bottom, right, mapFrom)) { recomp() }

  for (var row = top; row < bottom; row++) {
    var from = map.positionAt(row, left, table), to = map.positionAt(row, right, table)
    tr.replace(tr.mapping.slice(mapFrom).map(from + tableStart), tr.mapping.slice(mapFrom).map(to + tableStart),
               new Slice(cells.rows[row - top], 0, 0))
  }
  recomp()
  tr.setSelection(new CellSelection(tr.doc.resolve(tableStart + map.positionAt(top, left, table)),
                                    tr.doc.resolve(tableStart + map.positionAt(bottom - 1, right - 1, table))))
  dispatch(tr)
}
