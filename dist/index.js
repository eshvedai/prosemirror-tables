// This file defines a plugin that handles the drawing of cell
// selections and the basic user interactions for creating and working
// with such selections. It also makes sure that, after each
// transaction, the shapes of tables are normalized to be rectangular
// and not contain overlapping cells.

var ref = require("prosemirror-state");
var Plugin = ref.Plugin;

var ref$1 = require("./input");
var handleTripleClick = ref$1.handleTripleClick;
var handleKeyDown = ref$1.handleKeyDown;
var handlePaste = ref$1.handlePaste;
var handleMouseDown = ref$1.handleMouseDown;
var ref$2 = require("./util");
var key = ref$2.key;
var ref$3 = require("./cellselection");
var drawCellSelection = ref$3.drawCellSelection;
var CellSelection = ref$3.CellSelection;
var normalizeSelection = ref$3.normalizeSelection;
var ref$4 = require("./fixtables");
var fixTables = ref$4.fixTables;
var ref$5 = require("./schema");
var tableNodes = ref$5.tableNodes;
var commands = require("./commands")

exports.tableEditing = function() {
  return new Plugin({
    key: key,

    // This piece of state is used to remember when a mouse-drag
    // cell-selection is happening, so that it can continue even as
    // transactions (which might move its anchor cell) come in.
    state: {
      init: function() { return null },
      apply: function(tr, cur) {
        var set = tr.getMeta(key)
        if (set != null) { return set == -1 ? null : set }
        if (cur == null || !tr.docChanged) { return cur }
        var ref = tr.mapping.mapResult(cur);
        var deleted = ref.deleted;
        var pos = ref.pos;
        return deleted ? null : pos
      }
    },

    props: {
      decorations: drawCellSelection,

      handleDOMEvents: {
        mousedown: handleMouseDown
      },

      createSelectionBetween: function(view) {
        if (key.getState(view.state) != null) { return view.state.selection }
      },

      handleTripleClick: handleTripleClick,

      handleKeyDown: handleKeyDown,

      handlePaste: handlePaste
    },

    appendTransaction: function(_, oldState, state) {
      return normalizeSelection(state, fixTables(state, oldState))
    }
  })
}

exports.tableNodes = tableNodes
exports.CellSelection = CellSelection
for (var name in commands) { exports[name] = commands[name] }
