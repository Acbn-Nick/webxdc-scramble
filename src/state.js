// state.js - Immutable reducer for Scramble game state

import { BOARD_SIZE, RACK_SIZE, CENTER, createBag, validateAndScore } from './board.js';
import { isValidWord } from './dict.js';

export function initialState() {
  return {
    phase: 'waiting',       // 'waiting' | 'playing' | 'finished'
    players: {},            // addr → {name, score}
    playerOrder: [],        // [addr1, addr2]
    board: newBoard(),      // 225-element flat array
    bag: [],                // remaining tiles
    racks: {},              // addr → [{letter, value, id}]
    turn: null,             // addr of current player
    moveNumber: 0,          // increments each turn
    consecutivePasses: 0,
    lastMove: null,         // {addr, type, placements?, words?, totalScore?, count?}
    gameOverReason: null,
    winner: null,
  };
}

function newBoard() {
  var b = [];
  for (var i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) b[i] = null;
  return b;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nextTurn(state) {
  var idx = state.playerOrder.indexOf(state.turn);
  return state.playerOrder[(idx + 1) % state.playerOrder.length];
}

function isFirstMove(board) {
  for (var i = 0; i < board.length; i++) {
    if (board[i]) return false;
  }
  return true;
}

function drawTiles(bag, count) {
  var drawn = bag.splice(0, Math.min(count, bag.length));
  return drawn;
}

function endGame(state, reason) {
  state.phase = 'finished';
  state.gameOverReason = reason;

  var addrs = state.playerOrder;
  if (addrs.length < 2) {
    state.winner = addrs[0] || null;
    return;
  }

  // Subtract remaining rack tiles from each player's score
  // Player who goes out gets the total of opponent's remaining tiles
  var rackValues = {};
  var emptyRackAddr = null;

  for (var i = 0; i < addrs.length; i++) {
    var addr = addrs[i];
    var rack = state.racks[addr] || [];
    var total = 0;
    for (var j = 0; j < rack.length; j++) {
      total += rack[j].value;
    }
    rackValues[addr] = total;
    if (rack.length === 0) emptyRackAddr = addr;
  }

  for (var i = 0; i < addrs.length; i++) {
    var addr = addrs[i];
    state.players[addr].score -= rackValues[addr];
  }

  // Player who went out gets opponent's remaining tile values
  if (emptyRackAddr) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i] !== emptyRackAddr) {
        state.players[emptyRackAddr].score += rackValues[addrs[i]];
      }
    }
  }

  // Determine winner
  var s0 = state.players[addrs[0]].score;
  var s1 = state.players[addrs[1]].score;
  if (s0 > s1) state.winner = addrs[0];
  else if (s1 > s0) state.winner = addrs[1];
  else state.winner = 'draw';
}

export function reduce(state, update) {
  var s = clone(state);
  var p = clone(update.payload || update);
  var type = p.type;

  if (type === 'join') {
    if (s.phase !== 'waiting') return s;
    if (s.playerOrder.length >= 2) return s;
    if (s.players[p.addr]) return s;
    s.players[p.addr] = { name: p.name, score: 0 };
    s.playerOrder.push(p.addr);
    return s;
  }

  if (type === 'start') {
    if (s.phase !== 'waiting') return s;
    // Populate player data from start payload if join updates were missed
    if (p.playerOrder && p.players) {
      s.playerOrder = p.playerOrder;
      for (var i = 0; i < p.playerOrder.length; i++) {
        var addr = p.playerOrder[i];
        if (!s.players[addr]) {
          s.players[addr] = { name: p.players[addr].name, score: 0 };
        }
      }
    }
    if (s.playerOrder.length !== 2) return s;
    s.phase = 'playing';
    s.bag = p.bag; // pre-shuffled bag from the initiator
    // Deal 7 tiles to each player
    s.racks = {};
    for (var i = 0; i < s.playerOrder.length; i++) {
      var addr = s.playerOrder[i];
      s.racks[addr] = drawTiles(s.bag, RACK_SIZE);
    }
    // First player goes first
    s.turn = s.playerOrder[0];
    s.moveNumber = 1;
    return s;
  }

  if (type === 'place') {
    if (s.phase !== 'playing') { console.warn('[scramble] rejected place: wrong phase', {phase: s.phase}); return s; }
    if (p.addr !== s.turn) { console.warn('[scramble] rejected place: not your turn', {addr: p.addr, turn: s.turn}); return s; }
    if (p.moveNumber !== s.moveNumber) { console.warn('[scramble] rejected place: moveNumber mismatch', {got: p.moveNumber, expected: s.moveNumber}); return s; }

    var rack = s.racks[p.addr];
    // Build placements from the rack
    var placements = [];
    // Track which rack indices are used (sort descending for safe splicing later)
    var usedRackIndices = [];
    for (var i = 0; i < p.tiles.length; i++) {
      var t = p.tiles[i];
      var rackTile = rack[t.rackIndex];
      if (!rackTile) { console.warn('[scramble] rejected place: invalid rackIndex', {rackIndex: t.rackIndex, rackLen: rack.length}); return s; }
      var isBlank = rackTile.letter === '';
      placements.push({
        row: t.row,
        col: t.col,
        letter: isBlank ? t.blankLetter : rackTile.letter,
        value: rackTile.value,
        isBlank: isBlank,
      });
      usedRackIndices.push(t.rackIndex);
    }

    // Validate placement and score
    var result = validateAndScore(s.board, placements, isFirstMove(s.board), isValidWord);
    if (!result.valid) { console.warn('[scramble] rejected place: validation failed', {reason: result.reason}); return s; }

    // Apply tiles to board
    for (var i = 0; i < placements.length; i++) {
      var pl = placements[i];
      s.board[pl.row * 15 + pl.col] = { letter: pl.letter, value: pl.value, isBlank: pl.isBlank };
    }

    // Remove used tiles from rack (sort descending so indices stay valid)
    usedRackIndices.sort(function (a, b) { return b - a; });
    for (var i = 0; i < usedRackIndices.length; i++) {
      rack.splice(usedRackIndices[i], 1);
    }

    // Draw replacements
    var drawn = drawTiles(s.bag, placements.length);
    for (var i = 0; i < drawn.length; i++) {
      rack.push(drawn[i]);
    }

    // Update score
    s.players[p.addr].score += result.totalScore;

    // Record last move
    s.lastMove = {
      addr: p.addr,
      type: 'place',
      placements: placements.map(function (pl) { return { row: pl.row, col: pl.col }; }),
      words: result.words.map(function (w) { return { word: w.word, score: w.score }; }),
      totalScore: result.totalScore,
    };

    s.consecutivePasses = 0;

    // Check game end: rack empty and bag empty
    if (rack.length === 0 && s.bag.length === 0) {
      endGame(s, 'allPlayed');
      return s;
    }

    // Next turn
    s.turn = nextTurn(s);
    s.moveNumber++;
    return s;
  }

  if (type === 'exchange') {
    if (s.phase !== 'playing') { console.warn('[scramble] rejected exchange: wrong phase', {phase: s.phase}); return s; }
    if (p.addr !== s.turn) { console.warn('[scramble] rejected exchange: not your turn', {addr: p.addr, turn: s.turn}); return s; }
    if (p.moveNumber !== s.moveNumber) { console.warn('[scramble] rejected exchange: moveNumber mismatch', {got: p.moveNumber, expected: s.moveNumber}); return s; }

    var rack = s.racks[p.addr];

    // Need at least as many tiles in bag as exchanging
    if (p.rackIndices.length > s.bag.length) { console.warn('[scramble] rejected exchange: not enough tiles in bag', {requested: p.rackIndices.length, bagSize: s.bag.length}); return s; }
    if (p.rackIndices.length === 0) { console.warn('[scramble] rejected exchange: zero tiles selected'); return s; }

    // The sender provides the new bag state (with returned tiles shuffled back in)
    // and the drawn tiles. We trust the sender (same casual trust model as poker).
    // Remove tiles from rack (sort descending)
    var indices = p.rackIndices.slice().sort(function (a, b) { return b - a; });
    var returned = [];
    for (var i = 0; i < indices.length; i++) {
      if (indices[i] >= rack.length) { console.warn('[scramble] rejected exchange: rack index out of bounds', {index: indices[i], rackLen: rack.length}); return s; }
      returned.push(rack.splice(indices[i], 1)[0]);
    }

    // Add drawn tiles to rack
    for (var i = 0; i < p.drawnTiles.length; i++) {
      rack.push(p.drawnTiles[i]);
    }

    // Replace bag with new bag (drawn tiles removed, returned tiles shuffled in)
    s.bag = p.newBag;

    s.lastMove = {
      addr: p.addr,
      type: 'exchange',
      count: p.rackIndices.length,
    };

    s.consecutivePasses = 0;
    s.turn = nextTurn(s);
    s.moveNumber++;
    return s;
  }

  if (type === 'pass') {
    if (s.phase !== 'playing') { console.warn('[scramble] rejected pass: wrong phase', {phase: s.phase}); return s; }
    if (p.addr !== s.turn) { console.warn('[scramble] rejected pass: not your turn', {addr: p.addr, turn: s.turn}); return s; }
    if (p.moveNumber !== s.moveNumber) { console.warn('[scramble] rejected pass: moveNumber mismatch', {got: p.moveNumber, expected: s.moveNumber}); return s; }


    s.consecutivePasses++;
    s.lastMove = { addr: p.addr, type: 'pass' };

    if (s.consecutivePasses >= 2) {
      endGame(s, 'consecutivePasses');
      return s;
    }

    s.turn = nextTurn(s);
    s.moveNumber++;
    return s;
  }

  if (type === 'resign') {
    if (s.phase !== 'playing') { console.warn('[scramble] rejected resign: wrong phase', {phase: s.phase}); return s; }
    if (!s.players[p.addr]) { console.warn('[scramble] rejected resign: unknown player', {addr: p.addr}); return s; }

    s.lastMove = { addr: p.addr, type: 'resign' };
    // Winner is the other player
    s.winner = s.playerOrder[0] === p.addr ? s.playerOrder[1] : s.playerOrder[0];
    s.gameOverReason = 'resign';
    s.phase = 'finished';
    return s;
  }

  return s;
}

// Helper: get summary text for the chat list
export function getSummary(state, myAddr) {
  if (state.phase === 'waiting') {
    return 'Waiting for players (' + state.playerOrder.length + '/2)';
  }
  if (state.phase === 'finished') {
    if (state.winner === 'draw') return 'Game over - Draw!';
    if (state.winner === myAddr) return 'You won!';
    var winnerName = state.players[state.winner] ? state.players[state.winner].name : 'Unknown';
    return winnerName + ' won!';
  }
  // Playing
  var scores = state.playerOrder.map(function (addr) {
    return state.players[addr].score;
  });
  var turnText = state.turn === myAddr ? 'Your turn' : (state.players[state.turn].name + "'s turn");
  return turnText + ' - ' + scores.join(' vs ');
}
