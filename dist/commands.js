// This file defines a number of table-related commands.

var ref = require("prosemirror-state");
var TextSelection = ref.TextSelection;
var ref$1 = require("prosemirror-model");
var Fragment = ref$1.Fragment;

var ref$2 = require("./tablemap");
var TableMap = ref$2.TableMap;
var Rect = ref$2.Rect;
var ref$3 = require("./cellselection");
var CellSelection = ref$3.CellSelection;
var ref$4 = require("./util");
var setAttr = ref$4.setAttr;
var moveCellForward = ref$4.moveCellForward;
var isInTable = ref$4.isInTable;
var selectionCell = ref$4.selectionCell;
var ref$5 = require("./schema");
var tableNodeTypes = ref$5.tableNodeTypes;

// Helper to get the selected rectangle in a table, if any. Adds table
// map, table node, and table start offset to the object for
// convenience.
function selectedRect(state) {
  var sel = state.selection, $pos = selectionCell(state)
  var table = $pos.node(-1), tableStart = $pos.start(-1), map = TableMap.get(table)
  var rect
  if (sel instanceof CellSelection)
    { rect = map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart) }
  else
    { rect = map.findCell($pos.pos - tableStart) }
  rect.tableStart = tableStart
  rect.map = map
  rect.table = table
  return rect
}

function columnIsHeader(map, table, col) {
  var headerCell = tableNodeTypes(table.type.schema).header_cell
  for (var row = 0; row < map.height; row++)
    { if (table.nodeAt(map.map[col + row * map.width]).type != headerCell)
      { return false } }
  return true
}

// Add a column at the given position in a table.
function addColumn(tr, ref, col) {
  var map = ref.map;
  var tableStart = ref.tableStart;
  var table = ref.table;

  var refColumn = col > 0 ? -1 : 0
  if (columnIsHeader(map, table, col + refColumn))
    { refColumn = col == 0 || col == map.width ? null : 0 }

  for (var row = 0; row < map.height; row++) {
    var index = row * map.width + col
    // If this position falls inside a col-spanning cell
    if (col > 0 && col < map.width && map.map[index - 1] == map.map[index]) {
      var pos = map.map[index], cell = table.nodeAt(pos)
      tr.setNodeType(tr.mapping.map(tableStart + pos), null,
                     setAttr(cell.attrs, "colspan", cell.attrs.colspan + 1))
      // Skip ahead if rowspan > 1
      row += cell.attrs.rowspan - 1
    } else {
      var type = refColumn == null ? tableNodeTypes(table.type.schema).cell
          : table.nodeAt(map.map[index + refColumn]).type
      var pos$1 = map.positionAt(row, col, table)
      tr.insert(tr.mapping.map(tableStart + pos$1), type.createAndFill())
    }
  }
  return tr
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Command to add a column before the column with the selection.
function addColumnBefore(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state)
    dispatch(addColumn(state.tr, rect, rect.left))
  }
  return true
}
exports.addColumnBefore = addColumnBefore

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Command to add a column after the column with the selection.
function addColumnAfter(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state)
    dispatch(addColumn(state.tr, rect, rect.right))
  }
  return true
}
exports.addColumnAfter = addColumnAfter

function removeColumn(tr, ref, col) {
  var map = ref.map;
  var table = ref.table;
  var tableStart = ref.tableStart;

  var mapStart = tr.mapping.maps.length
  for (var row = 0; row < map.height;) {
    var index = row * map.width + col, pos = map.map[index], cell = table.nodeAt(pos)
    // If this is part of a col-spanning cell
    if ((col > 0 && map.map[index - 1] == pos) || (col < map.width - 1 && map.map[index + 1] == pos)) {
      tr.setNodeType(tr.mapping.slice(mapStart).map(tableStart + pos), null,
                     setAttr(cell.attrs, "colspan", cell.attrs.colspan - 1))
    } else {
      var start = tr.mapping.slice(mapStart).map(tableStart + pos)
      tr.delete(start, start + cell.nodeSize)
    }
    row += cell.attrs.rowspan
  }
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Command function that removes the selected columns from a table.
function deleteColumn(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state), tr = state.tr
    if (rect.left == 0 && rect.right == rect.map.width) { return false }
    for (var i = rect.right - 1;; i--) {
      removeColumn(tr, rect, i)
      if (i == rect.left) { break }
      rect.table = rect.tableStart ? tr.doc.nodeAt(rect.tableStart - 1) : tr.doc
      rect.map = TableMap.get(rect.table)
    }
    dispatch(tr)
  }
  return true
}
exports.deleteColumn = deleteColumn

function rowIsHeader(map, table, row) {
  var headerCell = tableNodeTypes(table.type.schema).header_cell
  for (var col = 0; col < map.width; col++)
    { if (table.nodeAt(map.map[col + row * map.width]).type != headerCell)
      { return false } }
  return true
}

function addRow(tr, ref, row) {
  var map = ref.map;
  var tableStart = ref.tableStart;
  var table = ref.table;

  var rowPos = tableStart
  for (var i = 0; i < row; i++) { rowPos += table.child(i).nodeSize }
  var cells = [], refRow = row > 0 ? -1 : 0
  if (rowIsHeader(map, table, row + refRow))
    { refRow = row == 0 || row == map.height ? null : 0 }
  for (var col = 0, index = map.width * row; col < map.width; col++, index++) {
    // Covered by a rowspan cell
    if (row > 0 && row < map.height && map.map[index] == map.map[index - map.width]) {
      var pos = map.map[index], attrs = table.nodeAt(pos).attrs
      tr.setNodeType(tableStart + pos, null, setAttr(attrs, "rowspan", attrs.rowspan + 1))
      col += attrs.colspan - 1
    } else {
      var type = refRow == null ? tableNodeTypes(table.type.schema).cell
          : table.nodeAt(map.map[index + refRow * map.width]).type
      cells.push(type.createAndFill())
    }
  }
  tr.insert(rowPos, tableNodeTypes(table.type.schema).row.create(null, cells))
  return tr
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Add a table row before the selection.
function addRowBefore(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state)
    dispatch(addRow(state.tr, rect, rect.top))
  }
  return true
}
exports.addRowBefore = addRowBefore

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Add a table row after the selection.
function addRowAfter(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state)
    dispatch(addRow(state.tr, rect, rect.bottom))
  }
  return true
}
exports.addRowAfter = addRowAfter

function removeRow(tr, ref, row) {
  var map = ref.map;
  var table = ref.table;
  var tableStart = ref.tableStart;

  var rowPos = 0
  for (var i = 0; i < row; i++) { rowPos += table.child(i).nodeSize }
  var nextRow = rowPos + table.child(row).nodeSize

  var mapFrom = tr.mapping.maps.length
  tr.delete(rowPos + tableStart, nextRow + tableStart)

  for (var col = 0, index = row * map.width; col < map.width; col++, index++) {
    var pos = map.map[index]
    if (row > 0 && pos == map.map[index - map.width]) {
      // If this cell starts in the row above, simply reduce its rowspan
      var attrs = table.nodeAt(pos).attrs
      tr.setNodeType(tr.mapping.slice(mapFrom).map(pos + tableStart), null, setAttr(attrs, "rowspan", attrs.rowspan - 1))
      col += attrs.colspan - 1
    } else if (row < map.width && pos == map.map[index + map.width]) {
      // Else, if it continues in the row below, it has to be moved down
      var cell = table.nodeAt(pos)
      var copy = cell.type.create(setAttr(cell.attrs, "rowspan", cell.attrs.rowspan - 1), cell.content)
      var newPos = map.positionAt(row + 1, col, table)
      tr.insert(tr.mapping.slice(mapFrom).map(tableStart + newPos), copy)
      col += cell.attrs.colspan - 1
    }
  }
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Remove the selected rows from a table.
function deleteRow(state, dispatch) {
  if (!isInTable(state)) { return false }
  if (dispatch) {
    var rect = selectedRect(state), tr = state.tr
    if (rect.top == 0 && rect.bottom == rect.map.height) { return false }
    for (var i = rect.bottom - 1;; i--) {
      removeRow(tr, rect, i)
      if (i == rect.top) { break }
      rect.table = rect.tableStart ? tr.doc.nodeAt(rect.tableStart - 1) : tr.doc
      rect.map = TableMap.get(rect.table)
    }
    dispatch(tr)
  }
  return true
}
exports.deleteRow = deleteRow

function isEmpty(cell) {
  var c = cell.content
  return c.childCount == 1 && c.firstChild.isTextblock && c.firstChild.childCount == 0
}

function cellsOverlapRectangle(ref, rect) {
  var width = ref.width;
  var height = ref.height;
  var map = ref.map;

  var indexTop = rect.top * width + rect.left, indexLeft = indexTop
  var indexBottom = (rect.bottom - 1) * width + rect.left, indexRight = indexTop + (rect.right - rect.left - 1)
  for (var i = rect.top; i < rect.bottom; i++) {
    if (rect.left > 0 && map[indexLeft] == map[indexLeft - 1] ||
        rect.right < width && map[indexRight] == map[indexRight + 1]) { return true }
    indexLeft += width; indexRight += width
  }
  for (var i$1 = rect.left; i$1 < rect.right; i$1++) {
    if (rect.top > 0 && map[indexTop] == map[indexTop - width] ||
        rect.bottom < height && map[indexBottom] == map[indexBottom + width]) { return true }
    indexTop++; indexBottom++
  }
  return false
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Merge the selected cells into a single cell. Only available when
// the selected cells' outline forms a rectangle.
function mergeCells(state, dispatch) {
  var sel = state.selection
  if (!(sel instanceof CellSelection) || sel.$anchorCell.pos == sel.$headCell.pos) { return false }
  var rect = selectedRect(state);
  var map = rect.map;
  if (cellsOverlapRectangle(map, rect)) { return false }
  if (dispatch) {
    var tr = state.tr, seen = [], content = Fragment.empty, mergedPos, mergedCell
    for (var row = rect.top; row < rect.bottom; row++) {
      for (var col = rect.left; col < rect.right; col++) {
        var cellPos = map.map[row * map.width + col], cell = rect.table.nodeAt(cellPos)
        if (seen.indexOf(cellPos) > -1) { continue }
        seen.push(cellPos)
        if (mergedPos == null) {
          mergedPos = cellPos
          mergedCell = cell
        } else {
          if (!isEmpty(cell)) { content = content.append(cell.content) }
          var mapped = tr.mapping.map(cellPos + rect.tableStart)
          tr.delete(mapped, mapped + cell.nodeSize)
        }
      }
    }
    tr.setNodeType(mergedPos + rect.tableStart, null,
                   setAttr(setAttr(mergedCell.attrs, "colspan", rect.right - rect.left),
                           "rowspan", rect.bottom - rect.top))
    if (content.size) {
      var end = mergedPos + 1 + mergedCell.content.size
      var start = isEmpty(mergedCell) ? mergedPos + 1 : end
      tr.replaceWith(start + rect.tableStart, end + rect.tableStart, content)
    }
    tr.setSelection(new CellSelection(tr.doc.resolve(mergedPos + rect.tableStart)))
    dispatch(tr)
  }
  return true
}
exports.mergeCells = mergeCells

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Split a selected cell, whose rowpan or colspan is greater than one,
// into smaller cells.
function splitCell(state, dispatch) {
  var sel = state.selection
  if (!(sel instanceof CellSelection) || sel.$anchorCell.pos != sel.$headCell.pos) { return false }
  var cellNode = sel.$anchorCell.nodeAfter
  if (cellNode.attrs.colspan == 1 && cellNode.attrs.rowspan == 1) { return false }
  if (dispatch) {
    var attrs = setAttr(setAttr(cellNode.attrs, "colspan", 1), "rowspan", 1)
    var rect = selectedRect(state), tr = state.tr
    var newCell = tableNodeTypes(state.schema).cell.createAndFill(attrs)
    var lastCell
    for (var row = 0; row < rect.bottom; row++) {
      if (row >= rect.top) {
        var pos = rect.map.positionAt(row, rect.left, rect.table)
        if (row == rect.top) { pos += cellNode.nodeSize }
        for (var col = rect.left; col < rect.right; col++) {
          if (col == rect.left && row == rect.top) { continue }
          tr.insert(lastCell = tr.mapping.map(pos + rect.tableStart, 1), newCell)
        }
      }
    }
    tr.setNodeType(sel.$anchorCell.pos, null, attrs)
    tr.setSelection(new CellSelection(tr.doc.resolve(sel.$anchorCell.pos),
                                      lastCell && tr.doc.resolve(lastCell)))
    dispatch(tr)
  }
  return true
}
exports.splitCell = splitCell

// :: (string, any) → (EditorState, dispatch: ?(tr: Transaction)) → bool
// Returns a command that sets the given attribute to the given value,
// and is only available when the currently selected cell doesn't
// already have that attribute set to that value.
function setCellAttr(name, value) {
  return function(state, dispatch) {
    if (!isInTable(state)) { return false }
    var $cell = selectionCell(state)
    if ($cell.nodeAfter.attrs[name] === value) { return false }
    if (dispatch) {
      var tr = state.tr
      if (state.selection instanceof CellSelection)
        { state.selection.forEachCell(function (node, pos) {
          if (node.attrs[name] !== value)
            { tr.setNodeType(pos, null, setAttr(node.attrs, name, value)) }
        }) }
      else
        { tr.setNodeType($cell.pos, null, setAttr($cell.nodeAfter.attrs, name, value)) }
      dispatch(tr)
    }
    return true
  }
}
exports.setCellAttr = setCellAttr

function toggleHeader(type) {
  return function(state, dispatch) {
    if (!isInTable(state)) { return false }
    if (dispatch) {
      var types = tableNodeTypes(state.schema)
      var rect = selectedRect(state), tr = state.tr
      var cells = rect.map.cellsInRect(type == "column" ? new Rect(rect.left, 0, rect.right, rect.map.height) :
                                       type == "row" ? new Rect(0, rect.top, rect.map.width, rect.bottom) : rect)
      var nodes = cells.map(function (pos) { return rect.table.nodeAt(pos); })
      for (var i = 0; i < cells.length; i++) // Remove headers, if any
        { if (nodes[i].type == types.header_cell)
          { tr.setNodeType(rect.tableStart + cells[i], types.cell, nodes[i].attrs) } }
      if (tr.steps.length == 0) { for (var i$1 = 0; i$1 < cells.length; i$1++) // No headers removed, add instead
        { tr.setNodeType(rect.tableStart + cells[i$1], types.header_cell, nodes[i$1].attrs) } }
      dispatch(tr)
    }
    return true
  }
}

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Toggles whether the selected row contains header cells.
exports.toggleHeaderRow = toggleHeader("row")

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Toggles whether the selected column contains header cells.
exports.toggleHeaderColumn = toggleHeader("column")

// :: (EditorState, dispatch: ?(tr: Transaction)) → bool
// Toggles whether the selected cells are header cells.
exports.toggleHeaderCell = toggleHeader("cell")

function findNextCell($cell, dir) {
  if (dir < 0) {
    var before = $cell.nodeBefore
    if (before) { return $cell.pos - before.nodeSize }
    for (var row = $cell.index(-1) - 1, rowEnd = $cell.before(); row >= 0; row--) {
      var rowNode = $cell.node(-1).child(row)
      if (rowNode.childCount) { return rowEnd - 1 - rowNode.lastChild.nodeSize }
      rowEnd -= rowNode.nodeSize
    }
  } else {
    if ($cell.index() < $cell.parent.childCount - 1) { return $cell.pos + $cell.nodeAfter.nodeSize }
    var table = $cell.node(-1)
    for (var row$1 = $cell.indexAfter(-1), rowStart = $cell.after(); row$1 < table.childCount; row$1++) {
      var rowNode$1 = table.child(row$1)
      if (rowNode$1.childCount) { return rowStart + 1 }
      rowStart += rowNode$1.nodeSize
    }
  }
}

// :: (number) → (EditorState, dispatch: ?(tr: Transaction)) → bool
// Returns a command for selecting the next (direction=1) or previous
// (direction=-1) cell in a table.
function goToNextCell(direction) {
  return function(state, dispatch) {
    if (!isInTable(state) || state.selection instanceof CellSelection) { return false }
    var cell = findNextCell(selectionCell(state), direction)
    if (cell == null) { return }
    if (dispatch) {
      var $cell = state.doc.resolve(cell)
      dispatch(state.tr.setSelection(TextSelection.between($cell, moveCellForward($cell))).scrollIntoView())
    }
    return true
  }
}
exports.goToNextCell = goToNextCell

// :: (EditorState, ?(tr: Transaction)) → bool
// Deletes the table around the selection, if any.
function deleteTable(state, dispatch) {
  var $pos = state.selection.$anchor
  for (var d = $pos.depth; d > 0; d--) {
    var node = $pos.node(d)
    if (node.type.spec.tableRole == "table") {
      if (dispatch) { dispatch(state.tr.delete($pos.before(d), $pos.after(d)).scrollIntoView()) }
      return true
    }
  }
  return false
}
exports.deleteTable = deleteTable
