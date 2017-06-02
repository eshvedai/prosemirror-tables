// This file defines a number of helpers for wiring up user input to
// table-related functionality.

var ref = require("prosemirror-model");
var Slice = ref.Slice;
var Fragment = ref.Fragment;
var ref$1 = require("prosemirror-state");
var Selection = ref$1.Selection;
var TextSelection = ref$1.TextSelection;
var ref$2 = require("prosemirror-keymap");
var keydownHandler = ref$2.keydownHandler;

var ref$3 = require("./util");
var key = ref$3.key;
var nextCell = ref$3.nextCell;
var cellAround = ref$3.cellAround;
var inSameTable = ref$3.inSameTable;
var isInTable = ref$3.isInTable;
var selectionCell = ref$3.selectionCell;
var ref$4 = require("./cellselection");
var CellSelection = ref$4.CellSelection;
var ref$5 = require("./tablemap");
var TableMap = ref$5.TableMap;
var ref$6 = require("./copypaste");
var pastedCells = ref$6.pastedCells;
var fitSlice = ref$6.fitSlice;
var clipCells = ref$6.clipCells;
var insertCells = ref$6.insertCells;
var ref$7 = require("./schema");
var tableNodeTypes = ref$7.tableNodeTypes;

exports.handleKeyDown = keydownHandler({
  "ArrowLeft": arrow("horiz", -1),
  "ArrowRight": arrow("horiz", 1),
  "ArrowUp": arrow("vert", -1),
  "ArrowDown": arrow("vert", 1),

  "Shift-ArrowLeft": shiftArrow("horiz", -1),
  "Shift-ArrowRight": shiftArrow("horiz", 1),
  "Shift-ArrowUp": shiftArrow("vert", -1),
  "Shift-ArrowDown": shiftArrow("vert", 1),

  "Backspace": deleteCellSelection,
  "Mod-Backspace": deleteCellSelection,
  "Delete": deleteCellSelection,
  "Mod-Delete": deleteCellSelection
})

function arrow(axis, dir) {
  return function (state, dispatch, view) {
    var sel = state.selection
    if (sel instanceof CellSelection) {
      dispatch(state.tr.setSelection(Selection.near(sel.$headCell, dir)))
      return true
    }
    if (axis != "horiz" && !sel.empty) { return false }
    var end = atEndOfCell(view, axis, dir)
    if (end == null) { return false }
    if (axis == "horiz") {
      dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(sel.head + dir), dir)))
      return true
    } else {
      var $cell = state.doc.resolve(end), $next = nextCell($cell, axis, dir), newSel
      if ($next) { newSel = Selection.near($next, 1) }
      else if (dir < 0) { newSel = Selection.near(state.doc.resolve($cell.before(-1)), -1) }
      else { newSel = Selection.near(state.doc.resolve($cell.after(-1)), 1) }
      dispatch(state.tr.setSelection(newSel))
      return true
    }
  }
}

function shiftArrow(axis, dir) {
  return function (state, dispatch, view) {
    var sel = state.selection
    if (!(sel instanceof CellSelection)) {
      var end = atEndOfCell(view, axis, dir)
      if (end == null) { return false }
      sel = new CellSelection(state.doc.resolve(end))
    }
    var $head = nextCell(sel.$headCell, axis, dir)
    if (!$head) { return false }
    if (dispatch) { dispatch(state.tr.setSelection(new CellSelection(sel.$anchorCell, $head))) }
    return true
  }
}

function deleteCellSelection(state, dispatch) {
  var sel = state.selection
  if (!(sel instanceof CellSelection)) { return false }
  if (dispatch) {
    var tr = state.tr, baseContent = tableNodeTypes(state.schema).cell.createAndFill().content
    sel.forEachCell(function (cell, pos) {
      if (!cell.content.eq(baseContent))
        { tr.replace(tr.mapping.map(pos + 1), tr.mapping.map(pos + cell.nodeSize - 1),
                   new Slice(baseContent, 0, 0)) }
    })
    if (tr.docChanged) { dispatch(tr) }
  }
  return true
}

exports.handleTripleClick = function(view, pos) {
  var doc = view.state.doc, $cell = cellAround(doc.resolve(pos))
  if (!$cell) { return false }
  view.dispatch(view.state.tr.setSelection(new CellSelection($cell)))
  return true
}

exports.handlePaste = function(view, _, slice) {
  if (!isInTable(view.state)) { return false }
  var cells = pastedCells(slice), sel = view.state.selection
  if (sel instanceof CellSelection) {
    if (!cells) { cells = {width: 1, height: 1, rows: [Fragment.from(fitSlice(tableNodeTypes(view.state.schema).cell, slice))]} }
    var table = sel.$anchorCell.node(-1), start = sel.$anchorCell.start(-1)
    var rect = TableMap.get(table).rectBetween(sel.$anchorCell.pos - start, sel.$headCell.pos - start)
    cells = clipCells(cells, rect.right - rect.left, rect.bottom - rect.top)
    insertCells(view.state, view.dispatch, start, rect, cells)
    return true
  } else if (cells) {
    var $cell = selectionCell(view.state), start$1 = $cell.start(-1)
    insertCells(view.state, view.dispatch, start$1, TableMap.get($cell.node(-1)).findCell($cell.pos - start$1), cells)
    return true
  } else {
    return false
  }
}

exports.handleMouseDown = function(view, startEvent) {
  if (startEvent.ctrlKey || startEvent.metaKey) { return }

  var startDOMCell = domInCell(view, startEvent.target), $anchor
  if (startEvent.shiftKey && (view.state.selection instanceof CellSelection)) {
    // Adding to an existing cell selection
    setCellSelection(view.state.selection.$anchorCell, startEvent)
    startEvent.preventDefault()
  } else if (startEvent.shiftKey && startDOMCell &&
             ($anchor = cellAround(view.state.selection.$anchor)) != null &&
             cellUnderMouse(view, startEvent).pos != $anchor.pos) {
    // Adding to a selection that starts in another cell (causing a
    // cell selection to be created).
    setCellSelection($anchor, startEvent)
    startEvent.preventDefault()
  } else if (!startDOMCell) {
    // Not in a cell, let the default behavior happen.
    return
  }

  // Create and dispatch a cell selection between the given anchor and
  // the position under the mouse.
  function setCellSelection($anchor, event) {
    var $head = cellUnderMouse(view, event)
    var starting = key.getState(view.state) == null
    if (!$head || !inSameTable($anchor, $head)) {
      if (starting) { $head = $anchor }
      else { return }
    }
    var selection = new CellSelection($anchor, $head)
    if (starting || !view.state.selection.eq(selection)) {
      var tr = view.state.tr.setSelection(selection)
      if (starting) { tr.setMeta(key, $anchor.pos) }
      view.dispatch(tr)
    }
  }

  // Stop listening to mouse motion events.
  function stop() {
    view.root.removeEventListener("mouseup", stop)
    view.root.removeEventListener("mousemove", move)
    if (key.getState(view.state) != null) { view.dispatch(view.state.tr.setMeta(key, -1)) }
  }

  function move(event) {
    var anchor = key.getState(view.state), $anchor
    if (anchor != null) {
      // Continuing an existing cross-cell selection
      $anchor = view.state.doc.resolve(anchor)
    } else if (domInCell(view, event.target) != startDOMCell) {
      // Moving out of the initial cell -- start a new cell selection
      $anchor = cellUnderMouse(view, startEvent)
      if (!$anchor) { return stop() }
    }
    if ($anchor) { setCellSelection($anchor, event) }
  }
  view.root.addEventListener("mouseup", stop)
  view.root.addEventListener("mousemove", move)
}

// Check whether the cursor is at the end of a cell (so that further
// motion would move out of the cell)
function atEndOfCell(view, axis, dir) {
  if (!(view.state.selection instanceof TextSelection)) { return null }
  var ref = view.state.selection;
  var $head = ref.$head;
  for (var d = $head.depth - 1; d >= 0; d--) {
    var parent = $head.node(d), index = dir < 0 ? $head.index(d) : $head.indexAfter(d)
    if (index != (dir < 0 ? 0 : parent.childCount)) { return null }
    if (parent.type.spec.tableRole == "cell" || parent.type.spec.tableRole == "header_cell") {
      var cellPos = $head.before(d)
      var dirStr = axis == "vert" ? (dir > 0 ? "down" : "up") : (dir > 0 ? "right" : "left")
      return view.endOfTextblock(dirStr) ? cellPos : null
    }
  }
  return null
}

function domInCell(view, dom) {
  for (; dom && dom != view.dom; dom = dom.parentNode)
    { if (dom.nodeName == "TD" || dom.nodeName == "TH") { return dom } }
}

function cellUnderMouse(view, event) {
  var mousePos = view.posAtCoords({left: event.clientX, top: event.clientY})
  if (!mousePos) { return null }
  return mousePos ? cellAround(view.state.doc.resolve(mousePos.pos)) : null
}
