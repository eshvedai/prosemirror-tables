// Helper for creating a schema that supports tables.

function getCellAttrs(dom, extraAttrs) {
  var result = {
    colspan: Number(dom.getAttribute("colspan") || 1),
    rowspan: Number(dom.getAttribute("rowspan") || 1)
  }
  for (var prop in extraAttrs) {
    var getter = extraAttrs[prop].getFromDOM
    var value = getter && getter(dom)
    if (value != null) { result[prop] = value }
  }
  return result
}

function setCellAttrs(node, extraAttrs) {
  var attrs = {}
  if (node.attrs.colspan != 1) { attrs.colspan = node.attrs.colspan }
  if (node.attrs.rowspan != 1) { attrs.rowspan = node.attrs.rowspan }
  for (var prop in extraAttrs) {
    var setter = extraAttrs[prop].setDOMAttr
    if (setter) { setter(node.attrs[prop], attrs) }
  }
  return attrs
}

// :: (Object) → Object
// Create a set of node specs for `table`, `table_row`, and
// `table_cell` nodes as used by this module.
//
//   options::- The following options are understood:
//
//     tableGroup:: ?string
//     A group name (something like `"block"`) to add to the table
//     node type.
//
//     cellContent:: string
//     The content expression for table cells.
//
//     cellAttributes:: Object
//     Additional attributes to add to cells. Maps attribute names to
//     objects with the following properties:
//
//       default:: any
//       The attribute's default value.
//
//       getFromDOM:: ?(dom.Node) → any
//       A function to read the attribute's value from a DOM node.
//
//       setDOMAttr:: ?(value: any, attrs: Object)>
//       A function to add the attribute's value to an attribute
//       object that's used to render the cell's DOM.
function tableNodes(options) {
  var extraAttrs = options.cellAttributes || {}
  var cellAttrs = {
    colspan: {default: 1},
    rowspan: {default: 1}
  }
  for (var prop in extraAttrs)
    { cellAttrs[prop] = {default: extraAttrs[prop].default} }

  return {
    table: {
      content: "table_row+",
      tableRole: "table",
      group: options.tableGroup,
      parseDOM: [{tag: "table"}],
      toDOM: function() { return ["table", ["tbody", 0]] }
    },
    table_row: {
      content: "(table_cell | table_header)*",
      tableRole: "row",
      parseDOM: [{tag: "tr"}],
      toDOM: function() { return ["tr", 0] }
    },
    table_cell: {
      content: options.cellContent,
      attrs: cellAttrs,
      tableRole: "cell",
      isolating: true,
      parseDOM: [{tag: "td", getAttrs: function (dom) { return getCellAttrs(dom, extraAttrs); }}],
      toDOM: function(node) { return ["td", setCellAttrs(node, extraAttrs), 0] }
    },
    table_header: {
      content: options.cellContent,
      attrs: cellAttrs,
      tableRole: "header_cell",
      isolating: true,
      parseDOM: [{tag: "th", getAttrs: function (dom) { return getCellAttrs(dom, extraAttrs); }}],
      toDOM: function(node) { return ["th", setCellAttrs(node, extraAttrs), 0] }
    }
  }
}
exports.tableNodes = tableNodes

function tableNodeTypes(schema) {
  var result = schema.cached.tableNodeTypes
  if (!result) {
    result = schema.cached.tableNodeTypes = {}
    for (var name in schema.nodes) {
      var type = schema.nodes[name], role = type.spec.tableRole
      if (role) { result[role] = type }
    }
  }
  return result
}
exports.tableNodeTypes = tableNodeTypes
