// Because working with row and column-spanning cells is not quite
// trivial, this code builds up a descriptive structure for a given
// table node. The structures are cached with the (persistent) table
// nodes as key, so that they only have to be recomputed when the
// content of the table changes.
//
// This does mean that they have to store table-relative, not
// document-relative positions. So code that uses them will typically
// compute the start position of the table and offset positions passed
// to or gotten from this structure by that amount.

var readFromCache, addToCache
// Prefer using a weak map to cache table maps. Fall back on a
// fixed-size cache if that's not supported.
if (typeof WeakMap != "undefined") {
  var cache = new WeakMap
  readFromCache = function (key) { return cache.get(key); }
  addToCache = function (key, value) {
    cache.set(key, value)
    return value
  }
} else {
  var cache$1 = [], cacheSize = 10, cachePos = 0
  readFromCache = function (key) {
    for (var i = 0; i < cache$1.length; i += 2)
      { if (cache$1[i] == key) { return cache$1[i + 1] } }
  }
  addToCache = function (key, value) {
    if (cachePos == cacheSize) { cachePos = 0 }
    cache$1[cachePos++] = key
    return cache$1[cachePos++] = value
  }
}

var Rect = function(left, top, right, bottom) {
  this.left = left; this.top = top; this.right = right; this.bottom = bottom
};
exports.Rect = Rect

var TableMap = function(width, height, map, problems) {
  // The width of the table
  this.width = width
  // Its height
  this.height = height
  // A width * height array with the start position of the cell
  // covering that part of the table in each slot
  this.map = map
  // An optional array of problems (cell overlap or non-rectangular
  // shape) for the table, used by the table normalizer.
  this.problems = problems
};

// :: (number) → Rect
// Find the dimensions of the cell at the given position.
TableMap.prototype.findCell = function (pos) {
    var this$1 = this;

  for (var i = 0; i < this.map.length; i++) {
    var curPos = this$1.map[i]
    if (curPos != pos) { continue }
    var left = i % this$1.width, top = (i / this$1.width) | 0
    var right = left + 1, bottom = top + 1
    for (var j = 1; right < this.width && this.map[i + j] == curPos; j++) { right++ }
    for (var j$1 = 1; bottom < this.height && this.map[i + (this.width * j$1)] == curPos; j$1++) { bottom++ }
    return new Rect(left, top, right, bottom)
  }
  throw new RangeError("No cell with offset " + pos + " found")
};

// :: (number) → number
// Find the left side of the cell at the given position.
TableMap.prototype.colCount = function (pos) {
    var this$1 = this;

  for (var i = 0; i < this.map.length; i++)
    { if (this$1.map[i] == pos) { return i % this$1.width } }
  throw new RangeError("No cell with offset " + pos + " found")
};

// :: (number, string, number) → ?number
// Find the next cell in the given direction, starting from the cell
// at `pos`, if any.
TableMap.prototype.nextCell = function (pos, axis, dir) {
  var ref = this.findCell(pos);
    var left = ref.left;
    var right = ref.right;
    var top = ref.top;
    var bottom = ref.bottom;
  if (axis == "horiz") {
    if (dir < 0 ? left == 0 : right == this.width) { return null }
    return this.map[top * this.width + (dir < 0 ? left - 1 : right)]
  } else {
    if (dir < 0 ? top == 0 : bottom == this.height) { return null }
    return this.map[left + this.width * (dir < 0 ? top - 1 : bottom)]
  }
};

// :: (number, number) → Rect
// Get the rectangle spanning the two given cells.
TableMap.prototype.rectBetween = function (a, b) {
  var ref = this.findCell(a);
    var leftA = ref.left;
    var rightA = ref.right;
    var topA = ref.top;
    var bottomA = ref.bottom;
  var ref$1 = this.findCell(b);
    var leftB = ref$1.left;
    var rightB = ref$1.right;
    var topB = ref$1.top;
    var bottomB = ref$1.bottom;
  return new Rect(Math.min(leftA, leftB), Math.min(topA, topB),
                  Math.max(rightA, rightB), Math.max(bottomA, bottomB))
};

// :: (Rect) → [number]
// Return the position of all cells that have the top left corner in
// the given rectangle.
TableMap.prototype.cellsInRect = function (rect) {
    var this$1 = this;

  var result = [], seen = []
  for (var row = rect.top; row < rect.bottom; row++) {
    for (var col = rect.left; col < rect.right; col++) {
      var index = row * this$1.width + col, pos = this$1.map[index]
      if (seen.indexOf(pos) > -1) { continue }
      seen.push(pos)
      if ((col != rect.left || !col || this$1.map[index - 1] != pos) &&
          (row != rect.top || !row || this$1.map[index - this$1.width] != pos))
        { result.push(pos) }
    }
  }
  return result
};

// :: (number, number, Node) → number
// Return the position at which the cell at the given row and column
// starts, or would start, if a cell started there.
TableMap.prototype.positionAt = function (row, col, table) {
    var this$1 = this;

  for (var i = 0, rowStart = 0;; i++) {
    var rowEnd = rowStart + table.child(i).nodeSize
    if (i == row) {
      var index = col + row * this$1.width, rowEndIndex = (row + 1) * this$1.width
      // Skip past cells from previous rows (via rowspan)
      while (index < rowEndIndex && this.map[index] < rowStart) { index++ }
      return index == rowEndIndex ? rowEnd - 1 : this$1.map[index]
    }
    rowStart = rowEnd
  }
};

// :: (Node) → TableMap
// Find the table map for the given table node.
TableMap.get = function (table) {
  return readFromCache(table) || addToCache(table, computeMap(table))
};
exports.TableMap = TableMap

// Compute a table map.
function computeMap(table) {
  if (table.type.spec.tableRole != "table") { throw new RangeError("Not a table node: " + table.type.name) }
  var width = findWidth(table), height = table.childCount
  var map = [], mapPos = 0, problems = null
  for (var i = 0, e = width * height; i < e; i++) { map[i] = 0 }

  for (var row = 0, pos = 0; row < height; row++) {
    var rowNode = table.child(row)
    pos++
    for (var i$1 = 0;; i$1++) {
      while (mapPos < map.length && map[mapPos] != 0) { mapPos++ }
      if (i$1 == rowNode.childCount) { break }
      var cellNode = rowNode.child(i$1);
      var ref = cellNode.attrs;
      var colspan = ref.colspan;
      var rowspan = ref.rowspan;
      for (var h = 0; h < rowspan; h++) {
        if (h + row >= height) {
          (problems || (problems = [])).push({type: "overlong_rowspan", pos: pos, n: rowspan - h})
          break
        }
        var start = mapPos + (h * width)
        for (var w = 0; w < colspan; w++) {
          if (map[start + w] == 0)
            { map[start + w] = pos }
          else
            { (problems || (problems = [])).push({type: "collision", row: row, pos: pos, n: colspan - w}) }
        }
      }
      mapPos += colspan
      pos += cellNode.nodeSize
    }
    var expectedPos = (row + 1) * width, missing = 0
    while (mapPos < expectedPos) { if (map[mapPos++] == 0) { missing++ } }
    if (missing) { (problems || (problems = [])).push({type: "missing", row: row, n: missing}) }
    pos++
  }

  return new TableMap(width, height, map, problems)
}

function findWidth(table) {
  var width = -1, hasRowSpan = false
  for (var row = 0; row < table.childCount; row++) {
    var rowNode = table.child(row), rowWidth = 0
    if (hasRowSpan) { for (var j = 0; j < row; j++) {
      var prevRow = table.child(j)
      for (var i = 0; i < prevRow.childCount; i++) {
        var cell = prevRow.child(i)
        if (j + cell.attrs.rowspan > row) { rowWidth += cell.attrs.colspan }
      }
    } }
    for (var i$1 = 0; i$1 < rowNode.childCount; i$1++) {
      var cell$1 = rowNode.child(i$1)
      rowWidth += cell$1.attrs.colspan
      if (cell$1.attrs.rowspan > 1) { hasRowSpan = true }
    }
    if (width == -1)
      { width = rowWidth }
    else if (width != rowWidth)
      { width = Math.max(width, rowWidth) }
  }
  return width
}
