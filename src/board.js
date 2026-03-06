// board.js - board constants, tile distribution, placement validation, scoring

export var BOARD_SIZE = 15;
export var RACK_SIZE = 7;
export var BINGO_BONUS = 50;
export var CENTER = 112; // row 7, col 7 → 7*15+7

// Square types
export var TW = 'TW'; // Triple Word
export var DW = 'DW'; // Double Word
export var TL = 'TL'; // Triple Letter
export var DL = 'DL'; // Double Letter
export var ST = 'ST'; // Star (center, acts as DW)

// Build map (225 cells). null = normal square.
// Standard Scramble board layout, using symmetry.
var _pm = [];
for (var i = 0; i < 225; i++) _pm[i] = null;

function setP(r, c, v) {
  _pm[r * 15 + c] = v;
  _pm[r * 15 + (14 - c)] = v;
  _pm[(14 - r) * 15 + c] = v;
  _pm[(14 - r) * 15 + (14 - c)] = v;
}

// Triple Word
setP(0, 0, TW); setP(0, 7, TW); setP(7, 0, TW);

// Double Word
setP(1, 1, DW); setP(2, 2, DW); setP(3, 3, DW); setP(4, 4, DW);
setP(7, 7, ST);

// Triple Letter
setP(1, 5, TL); setP(5, 1, TL); setP(5, 5, TL);

// Double Letter
setP(0, 3, DL); setP(3, 0, DL);
setP(2, 6, DL); setP(6, 2, DL);
setP(3, 7, DL); setP(7, 3, DL);
setP(6, 6, DL);

export var PREMIUM_MAP = _pm;

// Tile distribution: [letter, value, count]
var TILE_ENTRIES = [
  ['A', 1, 9], ['B', 3, 2], ['C', 3, 2], ['D', 2, 4], ['E', 1, 12],
  ['F', 4, 2], ['G', 2, 3], ['H', 4, 2], ['I', 1, 9], ['J', 8, 1],
  ['K', 5, 1], ['L', 1, 4], ['M', 3, 2], ['N', 1, 6], ['O', 1, 8],
  ['P', 3, 2], ['Q', 10, 1], ['R', 1, 6], ['S', 1, 4], ['T', 1, 6],
  ['U', 1, 4], ['V', 4, 2], ['W', 4, 2], ['X', 8, 1], ['Y', 4, 2],
  ['Z', 10, 1], ['', 0, 2] // blanks
];

export function createBag() {
  var bag = [];
  var id = 0;
  for (var i = 0; i < TILE_ENTRIES.length; i++) {
    var entry = TILE_ENTRIES[i];
    for (var j = 0; j < entry[2]; j++) {
      bag.push({ letter: entry[0], value: entry[1], id: id++ });
    }
  }
  return bag;
}

// Fisher-Yates shuffle
export function shuffleBag(bag) {
  for (var i = bag.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return bag;
}

// Get letter value (blanks are 0 regardless of assigned letter)
function tileValue(cell) {
  if (!cell) return 0;
  return cell.isBlank ? 0 : cell.value;
}

// Validate placement and score all formed words.
// board: 225-element array (existing tiles, null for empty)
// placements: [{row, col, letter, value, isBlank}]
// isFirstMove: true if board is empty
// isValidWord: function(word) → boolean
//
// Returns { valid: true, words: [{word, score, cells:[{row,col}]}], totalScore }
//      or { valid: false, reason: string }
export function validateAndScore(board, placements, isFirstMove, isValidWord) {
  if (placements.length === 0) {
    return { valid: false, reason: 'No tiles placed' };
  }

  // Check all target cells are empty
  for (var i = 0; i < placements.length; i++) {
    var p = placements[i];
    var idx = p.row * 15 + p.col;
    if (board[idx]) {
      return { valid: false, reason: 'Cell (' + p.row + ',' + p.col + ') is occupied' };
    }
  }

  // Check all tiles in same row or column
  var rows = [];
  var cols = [];
  for (var i = 0; i < placements.length; i++) {
    rows.push(placements[i].row);
    cols.push(placements[i].col);
  }
  var sameRow = rows.every(function (r) { return r === rows[0]; });
  var sameCol = cols.every(function (c) { return c === cols[0]; });

  if (placements.length > 1 && !sameRow && !sameCol) {
    return { valid: false, reason: 'Tiles must be in a single row or column' };
  }

  // Build a temporary board with new tiles placed
  var tempBoard = board.slice();
  for (var i = 0; i < placements.length; i++) {
    var p = placements[i];
    tempBoard[p.row * 15 + p.col] = { letter: p.letter, value: p.value, isBlank: p.isBlank || false };
  }

  // Build set of new tile positions for quick lookup
  var newPosSet = {};
  for (var i = 0; i < placements.length; i++) {
    newPosSet[placements[i].row * 15 + placements[i].col] = true;
  }

  // Determine direction (horizontal or vertical)
  // For single tile: check both directions
  var isHorizontal;
  if (placements.length === 1) {
    // Single tile: primary direction is whichever forms a longer word
    // or horizontal by default
    isHorizontal = true;
  } else {
    isHorizontal = sameRow;
  }

  // Check no gaps in the line of placed tiles
  if (placements.length > 1) {
    if (isHorizontal) {
      var minC = Math.min.apply(null, cols);
      var maxC = Math.max.apply(null, cols);
      var r = rows[0];
      for (var c = minC; c <= maxC; c++) {
        if (!tempBoard[r * 15 + c]) {
          return { valid: false, reason: 'Gap in placed tiles' };
        }
      }
    } else {
      var minR = Math.min.apply(null, rows);
      var maxR = Math.max.apply(null, rows);
      var c = cols[0];
      for (var r = minR; r <= maxR; r++) {
        if (!tempBoard[r * 15 + c]) {
          return { valid: false, reason: 'Gap in placed tiles' };
        }
      }
    }
  }

  // Check connectivity: must touch existing tiles (or cover center on first move)
  if (isFirstMove) {
    var coversCenter = false;
    for (var i = 0; i < placements.length; i++) {
      if (placements[i].row === 7 && placements[i].col === 7) {
        coversCenter = true;
        break;
      }
    }
    if (!coversCenter) {
      return { valid: false, reason: 'First word must cover the center square' };
    }
  } else {
    var connected = false;
    for (var i = 0; i < placements.length; i++) {
      var pr = placements[i].row;
      var pc = placements[i].col;
      var neighbors = [
        [pr - 1, pc], [pr + 1, pc], [pr, pc - 1], [pr, pc + 1]
      ];
      for (var n = 0; n < neighbors.length; n++) {
        var nr = neighbors[n][0];
        var nc = neighbors[n][1];
        if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15) {
          var nIdx = nr * 15 + nc;
          if (board[nIdx]) { // existing tile (not newly placed)
            connected = true;
            break;
          }
        }
      }
      if (connected) break;
    }
    if (!connected) {
      return { valid: false, reason: 'Word must connect to existing tiles' };
    }
  }

  // Collect all formed words
  var words = [];

  // Helper: extract a word along a direction from a starting cell
  function extractWord(startRow, startCol, dRow, dCol) {
    // Go back to beginning of word
    var r = startRow;
    var c = startCol;
    while (r - dRow >= 0 && r - dRow < 15 && c - dCol >= 0 && c - dCol < 15 &&
           tempBoard[(r - dRow) * 15 + (c - dCol)]) {
      r -= dRow;
      c -= dCol;
    }

    // Collect word
    var cells = [];
    var letters = '';
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && tempBoard[r * 15 + c]) {
      cells.push({ row: r, col: c });
      letters += tempBoard[r * 15 + c].letter;
      r += dRow;
      c += dCol;
    }

    if (cells.length < 2) return null;
    return { word: letters, cells: cells };
  }

  // Primary word (along the placement direction)
  var primaryWord = extractWord(placements[0].row, placements[0].col,
    isHorizontal ? 0 : 1, isHorizontal ? 1 : 0);
  if (primaryWord) {
    words.push(primaryWord);
  }

  // Cross words (perpendicular to placement direction for each new tile)
  for (var i = 0; i < placements.length; i++) {
    var crossWord = extractWord(placements[i].row, placements[i].col,
      isHorizontal ? 1 : 0, isHorizontal ? 0 : 1);
    if (crossWord) {
      words.push(crossWord);
    }
  }

  // Must form at least one word
  if (words.length === 0) {
    return { valid: false, reason: 'No words formed' };
  }

  // Validate all words against dictionary
  for (var i = 0; i < words.length; i++) {
    if (!isValidWord(words[i].word)) {
      return { valid: false, reason: '"' + words[i].word + '" is not a valid word' };
    }
  }

  // Score each word
  var totalScore = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var wordScore = 0;
    var wordMultiplier = 1;
    for (var j = 0; j < w.cells.length; j++) {
      var cell = w.cells[j];
      var idx = cell.row * 15 + cell.col;
      var tile = tempBoard[idx];
      var letterScore = tileValue(tile);
      var premium = PREMIUM_MAP[idx];

      // Premium squares only apply to newly placed tiles
      if (newPosSet[idx]) {
        if (premium === DL) letterScore *= 2;
        else if (premium === TL) letterScore *= 3;

        if (premium === DW || premium === ST) wordMultiplier *= 2;
        else if (premium === TW) wordMultiplier *= 3;
      }

      wordScore += letterScore;
    }
    wordScore *= wordMultiplier;
    w.score = wordScore;
    totalScore += wordScore;
  }

  // Bingo bonus: all 7 tiles used
  if (placements.length === RACK_SIZE) {
    totalScore += BINGO_BONUS;
  }

  return { valid: true, words: words, totalScore: totalScore };
}
