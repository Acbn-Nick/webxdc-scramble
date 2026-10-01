// state.js - Immutable reducer for Scramble app state
//
// One webxdc instance (one chat message) can hold many matches. Every update
// payload carries a matchId and is routed to that match's reducer; all
// clients replay the same update log, so every client ends up with the same
// set of matches.

import { BOARD_SIZE, RACK_SIZE, CENTER, createBag, validateAndScore } from './board.js';
import { isValidWord } from './dict.js';
import { createRng, seededShuffle } from './rng.js';
import { sha256sync, hexToBytes } from './crypto.js';
import { SKIN_BY_ID } from './skins.js';

export var MIN_PLAYERS = 2;
export var MAX_PLAYERS = 4;

// Updates sent before matches existed have no matchId; they all belong to
// this one implicit 2-player match so old chats still replay.
export var LEGACY_MATCH_ID = 'legacy';

export function initialState() {
  return {
    matches: {},            // matchId -> match state
    order: [],              // matchIds in creation order
    skins: {},              // addr -> equipped tile skin id, shared across matches
  };
}

export function initialMatch(id, hostAddr, maxPlayers, seq) {
  return {
    id: id,
    seq: seq,               // creation order, for sorting
    host: hostAddr,
    maxPlayers: maxPlayers,
    phase: 'waiting',       // 'waiting' | 'seeding' | 'playing' | 'finished'
    players: {},            // addr -> {name, score, resigned?}
    playerOrder: [],        // [addr1, addr2, ...]
    board: newBoard(),      // 225-element flat array
    bag: [],                // remaining tiles
    racks: {},              // addr -> [{letter, value, id}]
    turn: null,             // addr of current player
    moveNumber: 0,          // increments each turn
    consecutivePasses: 0,
    lastMove: null,         // {addr, type, placements?, words?, totalScore?, count?}
    gameOverReason: null,
    winner: null,
    gameNumber: 0,
    gameHistory: [],        // [{gameNumber, winner, scores, reason, finalBoard}]
    commits: {},            // addr -> hash hex
    reveals: {},            // addr -> nonce hex
    seed: null,             // computed XOR seed
    rngState: null,         // PRNG internal state (single int)
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

function clampPlayers(n) {
  n = parseInt(n, 10);
  if (!(n >= MIN_PLAYERS)) return MIN_PLAYERS;
  if (n > MAX_PLAYERS) return MAX_PLAYERS;
  return n;
}

export function activePlayers(m) {
  return m.playerOrder.filter(function (addr) {
    return !m.players[addr].resigned;
  });
}

function nextTurn(m) {
  var idx = m.playerOrder.indexOf(m.turn);
  for (var step = 1; step <= m.playerOrder.length; step++) {
    var addr = m.playerOrder[(idx + step) % m.playerOrder.length];
    if (!m.players[addr].resigned) return addr;
  }
  return m.turn;
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

function xorAll(nonces) {
  var seed = 0;
  for (var i = 0; i < nonces.length; i++) {
    seed = (seed ^ parseInt(nonces[i], 16)) >>> 0;
  }
  return seed;
}

function pickWinner(m, addrs) {
  var best = null;
  var tie = false;
  for (var i = 0; i < addrs.length; i++) {
    var score = m.players[addrs[i]].score;
    if (best === null || score > m.players[best].score) {
      best = addrs[i];
      tie = false;
    } else if (score === m.players[best].score) {
      tie = true;
    }
  }
  return tie ? 'draw' : best;
}

function endGame(m, reason) {
  m.phase = 'finished';
  m.gameOverReason = reason;

  var addrs = activePlayers(m);
  if (addrs.length < 2) {
    m.winner = addrs[0] || null;
    return;
  }

  // Subtract remaining rack tiles from each player's score
  // Player who goes out gets the total of opponents' remaining tiles
  var rackValues = {};
  var emptyRackAddr = null;

  for (var i = 0; i < addrs.length; i++) {
    var addr = addrs[i];
    var rack = m.racks[addr] || [];
    var total = 0;
    for (var j = 0; j < rack.length; j++) {
      total += rack[j].value;
    }
    rackValues[addr] = total;
    if (rack.length === 0) emptyRackAddr = addr;
  }

  for (var i = 0; i < addrs.length; i++) {
    var addr = addrs[i];
    m.players[addr].score -= rackValues[addr];
  }

  if (emptyRackAddr) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i] !== emptyRackAddr) {
        m.players[emptyRackAddr].score += rackValues[addrs[i]];
      }
    }
  }

  m.winner = pickWinner(m, addrs);
}

// Top-level reducer: routes each update to its match.
export function reduce(state, update) {
  var s = clone(state);
  var p = clone(update.payload || update);
  var id = p.matchId || LEGACY_MATCH_ID;

  // Equipped skins are per player, not per match, so every match shows them
  if (p.type === 'skin') {
    if (!s.skins) s.skins = {};
    if (!p.addr) return s;
    if (p.skinId && SKIN_BY_ID[p.skinId]) s.skins[p.addr] = p.skinId;
    else if (!p.skinId) delete s.skins[p.addr];
    return s;
  }

  if (p.type === 'create') {
    if (!p.matchId || s.matches[id]) return s;
    if (!p.addr) return s;
    var m = initialMatch(id, p.addr, clampPlayers(p.maxPlayers), s.order.length);
    m.players[p.addr] = { name: p.name, score: 0 };
    m.playerOrder.push(p.addr);
    s.matches[id] = m;
    s.order.push(id);
    return s;
  }

  var match = s.matches[id];
  if (!match) {
    if (id !== LEGACY_MATCH_ID || (p.type !== 'join' && p.type !== 'start')) return s;
    match = initialMatch(id, p.addr, 2, s.order.length);
    s.order.push(id);
  }

  var next = reduceMatch(match, p);
  if (next === null) {
    delete s.matches[id];
    s.order = s.order.filter(function (x) { return x !== id; });
  } else {
    s.matches[id] = next;
  }
  return s;
}

// Mutates and returns the (already cloned) match, or null to delete it.
function reduceMatch(s, p) {
  var type = p.type;

  if (type === 'join') {
    if (s.phase !== 'waiting') return s;
    if (s.playerOrder.length >= s.maxPlayers) return s;
    if (s.players[p.addr]) return s;
    s.players[p.addr] = { name: p.name, score: 0 };
    s.playerOrder.push(p.addr);
    return s;
  }

  if (type === 'leave') {
    if (s.phase !== 'waiting') return s;
    if (!s.players[p.addr]) return s;
    delete s.players[p.addr];
    s.playerOrder = s.playerOrder.filter(function (a) { return a !== p.addr; });
    if (s.playerOrder.length === 0) return null;
    if (s.host === p.addr) s.host = s.playerOrder[0];
    return s;
  }

  if (type === 'start') {
    if (s.phase !== 'waiting') return s;
    // Populate player data from start payload if join updates were missed
    if (p.playerOrder && p.players) {
      for (var i = 0; i < p.playerOrder.length; i++) {
        var addr = p.playerOrder[i];
        if (!s.players[addr] && s.playerOrder.length < s.maxPlayers) {
          s.players[addr] = { name: p.players[addr].name, score: 0 };
          s.playerOrder.push(addr);
        }
      }
    }
    if (s.playerOrder.length < MIN_PLAYERS || s.playerOrder.length > s.maxPlayers) return s;
    s.phase = 'seeding';
    s.commits = {};
    s.reveals = {};
    s.seed = null;
    s.rngState = null;
    return s;
  }

  if (type === 'commit') {
    if (s.phase !== 'seeding') return s;
    if (!s.players[p.addr]) return s;
    // Allow overwriting (handles app restart where nonce was lost)
    s.commits[p.addr] = p.hash;
    // If overwriting, clear any existing reveal for that addr
    if (s.reveals[p.addr]) {
      delete s.reveals[p.addr];
    }
    return s;
  }

  if (type === 'reveal') {
    if (s.phase !== 'seeding') return s;
    if (!s.players[p.addr]) return s;
    // All commits must exist
    for (var i = 0; i < s.playerOrder.length; i++) {
      if (!s.commits[s.playerOrder[i]]) return s;
    }
    // Addr must not have revealed yet
    if (s.reveals[p.addr]) return s;
    // Verify: sha256(nonce bytes) must match commit
    var computedHash = sha256sync(hexToBytes(p.nonce));
    if (computedHash !== s.commits[p.addr]) {
      console.warn('[scramble] rejected reveal: hash mismatch', { computed: computedHash, expected: s.commits[p.addr] });
      return s;
    }
    s.reveals[p.addr] = p.nonce;
    // When all reveals present, derive seed and deal
    var nonces = [];
    for (var i = 0; i < s.playerOrder.length; i++) {
      if (!s.reveals[s.playerOrder[i]]) return s;
      nonces.push(s.reveals[s.playerOrder[i]]);
    }
    s.seed = xorAll(nonces);
    var rng = createRng(s.seed);
    s.bag = seededShuffle(createBag(), rng);
    s.racks = {};
    for (var i = 0; i < s.playerOrder.length; i++) {
      var addr = s.playerOrder[i];
      s.racks[addr] = drawTiles(s.bag, RACK_SIZE);
    }
    s.rngState = rng.getState();
    s.turn = s.playerOrder[0];
    s.moveNumber = 1;
    s.phase = 'playing';
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
      s.board[pl.row * 15 + pl.col] = { letter: pl.letter, value: pl.value, isBlank: pl.isBlank, by: p.addr };
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

    // Remove tiles from rack (sort descending)
    var indices = p.rackIndices.slice().sort(function (a, b) { return b - a; });
    var returned = [];
    for (var i = 0; i < indices.length; i++) {
      if (indices[i] >= rack.length) { console.warn('[scramble] rejected exchange: rack index out of bounds', {index: indices[i], rackLen: rack.length}); return s; }
      returned.push(rack.splice(indices[i], 1)[0]);
    }

    // Draw new tiles from front of bag
    var drawn = drawTiles(s.bag, p.rackIndices.length);
    for (var i = 0; i < drawn.length; i++) {
      rack.push(drawn[i]);
    }

    // Put returned tiles back into bag, then reshuffle deterministically
    for (var i = 0; i < returned.length; i++) {
      s.bag.push(returned[i]);
    }
    var rng = createRng(s.rngState);
    seededShuffle(s.bag, rng);
    s.rngState = rng.getState();

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

    // Game ends once every remaining player has passed in a row
    if (s.consecutivePasses >= activePlayers(s).length) {
      endGame(s, 'consecutivePasses');
      return s;
    }

    s.turn = nextTurn(s);
    s.moveNumber++;
    return s;
  }

  if (type === 'resign') {
    if (s.phase !== 'playing') { console.warn('[scramble] rejected resign: wrong phase', {phase: s.phase}); return s; }
    if (!s.players[p.addr] || s.players[p.addr].resigned) { console.warn('[scramble] rejected resign: unknown player', {addr: p.addr}); return s; }

    s.lastMove = { addr: p.addr, type: 'resign' };
    s.players[p.addr].resigned = true;

    var remaining = activePlayers(s);
    if (remaining.length <= 1) {
      // Last player standing wins
      s.winner = remaining[0] || null;
      s.gameOverReason = 'resign';
      s.phase = 'finished';
      return s;
    }

    // With 3-4 players the game continues without the resigned player
    s.consecutivePasses = 0;
    if (s.turn === p.addr) {
      s.turn = nextTurn(s);
      s.moveNumber++;
    }
    return s;
  }

  if (type === 'newgame') {
    if (s.phase !== 'finished') return s;
    // Push summary to gameHistory
    var scores = {};
    for (var i = 0; i < s.playerOrder.length; i++) {
      var addr = s.playerOrder[i];
      scores[addr] = s.players[addr].score;
    }
    s.gameHistory.push({
      gameNumber: s.gameNumber,
      winner: s.winner,
      scores: scores,
      reason: s.gameOverReason,
      finalBoard: s.board,
    });
    // Reset game state (keep players/playerOrder/gameHistory intact)
    s.board = newBoard();
    s.bag = [];
    s.racks = {};
    s.turn = null;
    s.moveNumber = 0;
    s.consecutivePasses = 0;
    s.lastMove = null;
    s.gameOverReason = null;
    s.winner = null;
    s.commits = {};
    s.reveals = {};
    s.seed = null;
    s.rngState = null;
    // Reset scores and resignations
    for (var i = 0; i < s.playerOrder.length; i++) {
      s.players[s.playerOrder[i]].score = 0;
      delete s.players[s.playerOrder[i]].resigned;
    }
    s.phase = 'waiting';
    s.gameNumber++;
    return s;
  }

  return s;
}

// Helper: one-line status of a single match, from myAddr's point of view
export function getMatchSummary(m, myAddr) {
  var prefix = m.gameNumber > 0 ? 'Game ' + (m.gameNumber + 1) + ': ' : '';
  if (m.phase === 'waiting') {
    return prefix + 'Waiting for players (' + m.playerOrder.length + '/' + m.maxPlayers + ')';
  }
  if (m.phase === 'seeding') {
    return prefix + 'Setting up game...';
  }
  if (m.phase === 'finished') {
    if (m.winner === 'draw') return prefix + 'Game over - Draw!';
    if (m.winner === myAddr) return prefix + 'You won!';
    var winnerName = m.players[m.winner] ? m.players[m.winner].name : 'Unknown';
    return prefix + winnerName + ' won!';
  }
  // Playing
  var scores = m.playerOrder.map(function (addr) {
    return m.players[addr].score;
  });
  var turnText = m.turn === myAddr ? 'Your turn' : (m.players[m.turn].name + "'s turn");
  return prefix + turnText + ' - ' + scores.join(' vs ');
}

// Helper: summary text for the chat list. Every chat member sees the same
// text, so it describes the whole lobby rather than one player's view.
export function getSummary(state) {
  var open = 0, playing = 0;
  for (var i = 0; i < state.order.length; i++) {
    var m = state.matches[state.order[i]];
    if (m.phase === 'waiting') open++;
    else if (m.phase !== 'finished') playing++;
  }
  if (open === 0 && playing === 0) return state.order.length ? 'No active games' : 'No games yet';
  var parts = [];
  if (open) parts.push(open + ' open');
  if (playing) parts.push(playing + ' in progress');
  return 'Games: ' + parts.join(', ');
}
