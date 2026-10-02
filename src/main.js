// main.js - Boot, webxdc listener, action dispatch, local UI state

// Must come first: on the web it installs window.webxdc
import { transport } from './transport.js';
import './style.css';
import { initialState, reduce, getSummary, MIN_PLAYERS, MAX_PLAYERS } from './state.js';
import { validateAndScore } from './board.js';
import { loadDictionary, isValidWord } from './dict.js';
import { initUI, render, reclampZoom } from './ui.js';
import { generateTextures } from './textures.js';
import { generateNonce, sha256sync, hexToBytes, bytesToHex } from './crypto.js';
import { SKIN_BY_ID, applySkin, savePreferredSkin, loadPreferredSkin } from './skins.js';
import { openCrate } from './crate-ui.js';

var myAddr = window.webxdc.selfAddr;
var myName = window.webxdc.selfName;

var state = initialState();

// Local UI state (not shared)
var uiState = {
  view: 'home',             // 'home' | 'match'
  matchId: null,            // match shown when view === 'match'
  newGameSize: MIN_PLAYERS, // player count picked on the home screen
  selectedRackIndex: null,
  pendingPlacements: [],   // [{rackIndex, row, col, letter, value, isBlank, blankLetter?}]
  exchangeMode: false,
  exchangeIndices: [],
  blankPromptData: null,    // {rackIndex, row, col} - waiting for letter choice
  errorMessage: null,
  rackOrder: null,          // null = natural order, or [indices] mapping for visual reorder
  preview: null,            // { valid, words, totalScore, reason } or null
  showHistory: false,
  matchmaking: transport.matchmaking, // a matchmaking server is reachable (web embed)
  online: transport.kind === 'native',
  queue: null,              // {size, waiting} while searching for a match
  notice: null,             // one-line message from the matchmaking server
};

// matchId -> gameNumber we already sent a commit/reveal for
var pendingCommit = {};
var pendingReveal = {};

function currentMatch() {
  if (uiState.view !== 'match') return null;
  return state.matches[uiState.matchId] || null;
}

function clearError() {
  uiState.errorMessage = null;
  uiState.notice = null;
}

function resetMatchUI() {
  uiState.pendingPlacements = [];
  uiState.selectedRackIndex = null;
  uiState.exchangeMode = false;
  uiState.exchangeIndices = [];
  uiState.blankPromptData = null;
  uiState.rackOrder = null;
  uiState.preview = null;
  uiState.showHistory = false;
}

function isFirstMove(board) {
  for (var i = 0; i < board.length; i++) {
    if (board[i]) return false;
  }
  return true;
}

function updatePreview() {
  var m = currentMatch();
  if (!m || uiState.pendingPlacements.length === 0) {
    uiState.preview = null;
    return;
  }
  var placements = uiState.pendingPlacements.map(function (pp) {
    return {
      row: pp.row, col: pp.col, letter: pp.letter,
      value: pp.value, isBlank: pp.isBlank || false,
    };
  });
  uiState.preview = validateAndScore(m.board, placements, isFirstMove(m.board), isValidWord);
}

function rerender() {
  // My own rack and pending tiles follow my equipped skin via the root --tile-* vars
  applySkin(SKIN_BY_ID[state.skins[myAddr]] || null);
  // A match that doesn't exist (yet) renders the home menu: sendUpdate
  // delivers asynchronously, so a match we just created appears a moment later
  render(state, myAddr, uiState);
}

function send(payload, descr, info) {
  var update = {
    payload: payload,
    summary: getSummary(reduce(state, { payload: payload })),
  };
  if (info) update.info = info;
  window.webxdc.sendUpdate(update, descr || '');
}

function equip(skinId) {
  savePreferredSkin(myAddr, skinId);
  if (state.skins[myAddr] === skinId) return;
  var skin = SKIN_BY_ID[skinId];
  send({ type: 'skin', addr: myAddr, skinId: skinId }, myName + ' equipped ' + (skin ? skin.name : 'Classic') + ' tiles');
}

// Once the update log has replayed, carry this device's skin into a chat that doesn't know it yet
var skinSynced = false;
function syncPreferredSkin() {
  if (skinSynced) return;
  skinSynced = true;
  var pref = loadPreferredSkin(myAddr);
  if (pref && !state.skins[myAddr]) equip(pref);
}

function newMatchId() {
  var bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// --- Nonce lifecycle helpers ---

function nonceKey(m) {
  return 'scramble_nonce_' + m.id + '_' + m.gameNumber + '_' + myAddr;
}

function storeNonce(m, nonce) {
  try { localStorage.setItem(nonceKey(m), nonce); } catch (e) {}
}

function loadNonce(m) {
  try { return localStorage.getItem(nonceKey(m)); } catch (e) { return null; }
}

function autoCommit(m) {
  var nonce = generateNonce();
  storeNonce(m, nonce);
  var hash = sha256sync(hexToBytes(nonce));
  send({ type: 'commit', matchId: m.id, addr: myAddr, hash: hash });
}

function autoReveal(m) {
  var nonce = loadNonce(m);
  if (!nonce) {
    // Nonce lost (app restart) — re-commit
    delete pendingReveal[m.id];
    pendingCommit[m.id] = m.gameNumber;
    autoCommit(m);
    return;
  }
  // Don't clear the nonce here — reveal may be rejected; it is keyed by match and gameNumber so won't collide
  send({ type: 'reveal', matchId: m.id, addr: myAddr, nonce: nonce });
}

// A table the matchmaking bot opened fills and starts itself: everyone in
// that group chat is a matched player
var pendingJoin = {};
var pendingStart = {};
var logReplayed = false;  // act on tables only once the whole log is in
function handleTable(m) {
  if (!m.players[myAddr]) {
    if (m.playerOrder.length < m.maxPlayers && !pendingJoin[m.id]) {
      pendingJoin[m.id] = true;
      send({ type: 'join', matchId: m.id, addr: myAddr, name: myName }, myName + ' joined');
      if (uiState.view === 'home') openMatch(m.id);
    }
    return;
  }
  if (m.playerOrder.length === m.maxPlayers && !pendingStart[m.id]) {
    pendingStart[m.id] = true;
    var players = {};
    for (var i = 0; i < m.playerOrder.length; i++) players[m.playerOrder[i]] = { name: m.players[m.playerOrder[i]].name };
    send({ type: 'start', matchId: m.id, addr: myAddr, playerOrder: m.playerOrder, players: players }, 'Game started');
  }
}

// Commit-reveal runs for every match I'm in, whether or not it's on screen
function handleSeeding() {
  for (var k = 0; k < state.order.length; k++) {
    var m = state.matches[state.order[k]];
    if (logReplayed && m.phase === 'waiting' && m.matchmade) handleTable(m);
    if (m.phase !== 'seeding') continue;
    if (!m.players[myAddr]) continue;

    if (!m.commits[myAddr]) {
      if (pendingCommit[m.id] !== m.gameNumber) {
        pendingCommit[m.id] = m.gameNumber;
        autoCommit(m);
      }
      continue;
    }
    var allCommitted = true;
    for (var i = 0; i < m.playerOrder.length; i++) {
      if (!m.commits[m.playerOrder[i]]) { allCommitted = false; break; }
    }
    if (allCommitted && !m.reveals[myAddr]) {
      if (pendingReveal[m.id] !== m.gameNumber) {
        pendingReveal[m.id] = m.gameNumber;
        autoReveal(m);
      }
    }
  }
}

function afterReplay() {
  logReplayed = true;
  syncPreferredSkin();
  // A chat the matchmaking bot made holds one table: open it straight away
  if (transport.kind === 'native' && uiState.view === 'home') {
    for (var i = state.order.length - 1; i >= 0; i--) {
      var m = state.matches[state.order[i]];
      if (m.matchmade && m.phase !== 'finished') { openMatch(m.id); break; }
    }
  }
  handleSeeding();
}

// Boot

document.addEventListener('DOMContentLoaded', function () {
  loadDictionary().then(function () {
    generateTextures();
    var appEl = document.getElementById('app');
    initUI(appEl, handleAction);
    rerender();

    // Re-clamp zoom bounds on orientation/resize changes
    window.addEventListener('resize', reclampZoom);

    var replayed = window.webxdc.setUpdateListener(function (update) {
      var payload = update.payload || {};
      var touched = payload.matchId || 'legacy';
      state = reduce(state, update);
      // Reset UI state only when the match on screen changed, so moves in
      // other matches don't wipe tiles I'm placing here
      if (uiState.view === 'match' && touched === uiState.matchId) {
        resetMatchUI();
        clearError();
      }
      rerender();
      // Auto-seeding after render
      handleSeeding();
    }, 0);
    // Resolves once the existing log has replayed, so we know whether this chat has my skin
    if (replayed && replayed.then) replayed.then(afterReplay);
    else afterReplay();

    transport.on(handleTransport);
    // #join=<matchId> is an invite link to a game on the matchmaking server
    var invite = /^#join=([0-9a-f]{8,32})$/i.exec(location.hash);
    if (invite && transport.matchmaking) {
      transport.watch(invite[1].toLowerCase());
      openMatch(invite[1].toLowerCase());
    }

    // #crate opens the crate overlay directly; #crate=<hex seed> replays a specific roll
    var m = /^#crate(?:=([0-9a-f]{1,8}))?$/i.exec(location.hash);
    if (m) openCrate(m[1] ? parseInt(m[1], 16) : null, equip);
  });
});

// Matchmaking server events (web embed only)
function handleTransport(ev) {
  if (ev.t === 'status') {
    uiState.online = ev.online;
    uiState.notice = ev.error || null;
    if (!ev.online) uiState.queue = null;
  } else if (ev.t === 'queue') {
    uiState.queue = ev.size ? { size: ev.size, waiting: ev.waiting } : null;
  } else if (ev.t === 'matched') {
    uiState.queue = null;
    openMatch(ev.room);
    return;
  } else if (ev.t === 'error') {
    uiState.notice = ev.error;
  } else {
    return;
  }
  rerender();
}

// Action Handlers

function handleAction(action, data) {
  clearError();

  if (action === 'opencrate') {
    openCrate(null, equip);
    return;
  }

  // --- Home menu ---

  if (action === 'pickSize') {
    if (data.index >= MIN_PLAYERS && data.index <= MAX_PLAYERS) uiState.newGameSize = data.index;
    rerender();
    return;
  }

  if (action === 'findmatch') {
    if (!transport.matchmaking) return;
    uiState.notice = null;
    uiState.queue = { size: uiState.newGameSize, waiting: 0 };
    transport.queue(uiState.newGameSize);
    rerender();
    return;
  }

  if (action === 'cancelqueue') {
    transport.cancel();
    uiState.queue = null;
    rerender();
    return;
  }

  if (action === 'copyinvite') {
    var link = inviteLink(data.id);
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function () {});
    uiState.notice = 'Invite link copied';
    rerender();
    return;
  }

  if (action === 'create') {
    var id = newMatchId();
    send({ type: 'create', matchId: id, addr: myAddr, name: myName, maxPlayers: uiState.newGameSize },
      myName + ' opened a ' + uiState.newGameSize + '-player game');
    openMatch(id);
    return;
  }

  if (action === 'open') {
    openMatch(data.id);
    return;
  }

  if (action === 'home') {
    uiState.view = 'home';
    uiState.matchId = null;
    resetMatchUI();
    rerender();
    return;
  }

  var m = currentMatch();
  if (!m) return;

  // --- Match lobby ---

  if (action === 'join') {
    send({ type: 'join', matchId: m.id, addr: myAddr, name: myName }, myName + ' joined');
    return;
  }

  if (action === 'leave') {
    send({ type: 'leave', matchId: m.id, addr: myAddr }, myName + ' left');
    uiState.view = 'home';
    uiState.matchId = null;
    rerender();
    return;
  }

  if (action === 'start') {
    var players = {};
    for (var i = 0; i < m.playerOrder.length; i++) {
      var addr = m.playerOrder[i];
      players[addr] = { name: m.players[addr].name };
    }
    send({ type: 'start', matchId: m.id, addr: myAddr, playerOrder: m.playerOrder, players: players }, 'Game started');
    return;
  }

  if (action === 'newgame') {
    send({ type: 'newgame', matchId: m.id, addr: myAddr }, 'New game started');
    return;
  }

  if (action === 'showhistory') {
    uiState.showHistory = true;
    rerender();
    return;
  }

  if (action === 'hidehistory') {
    uiState.showHistory = false;
    rerender();
    return;
  }

  if (action === 'selecttile') {
    if (m.turn !== myAddr) return;
    if (uiState.selectedRackIndex === data.index) {
      uiState.selectedRackIndex = null;
    } else {
      uiState.selectedRackIndex = data.index;
    }
    rerender();
    return;
  }

  if (action === 'placetile') {
    if (m.turn !== myAddr) return;
    if (uiState.selectedRackIndex === null) return;

    var rackIndex = uiState.selectedRackIndex;
    var rack = m.racks[myAddr];
    var tile = rack[rackIndex];
    if (!tile) return;

    // Check if this cell already has a pending tile
    for (var i = 0; i < uiState.pendingPlacements.length; i++) {
      if (uiState.pendingPlacements[i].row === data.row && uiState.pendingPlacements[i].col === data.col) {
        return; // cell already occupied by pending tile
      }
    }

    // If blank tile, prompt for letter
    if (tile.letter === '') {
      uiState.blankPromptData = { rackIndex: rackIndex, row: data.row, col: data.col };
      uiState.selectedRackIndex = null;
      rerender();
      return;
    }

    uiState.pendingPlacements.push({
      rackIndex: rackIndex,
      row: data.row,
      col: data.col,
      letter: tile.letter,
      value: tile.value,
      isBlank: false,
    });
    uiState.selectedRackIndex = null;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'chooseletter') {
    if (!uiState.blankPromptData) return;
    var bd = uiState.blankPromptData;
    var rack = m.racks[myAddr];
    var tile = rack[bd.rackIndex];

    uiState.pendingPlacements.push({
      rackIndex: bd.rackIndex,
      row: bd.row,
      col: bd.col,
      letter: data.letter,
      value: 0,
      isBlank: true,
      blankLetter: data.letter,
    });
    uiState.blankPromptData = null;
    uiState.selectedRackIndex = null;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'cancelblanks') {
    uiState.blankPromptData = null;
    rerender();
    return;
  }

  if (action === 'pickup') {
    // Pick up a pending tile back to rack
    var idx = data.index;
    if (idx >= 0 && idx < uiState.pendingPlacements.length) {
      uiState.pendingPlacements.splice(idx, 1);
    }
    updatePreview();
    rerender();
    return;
  }

  if (action === 'recall') {
    // Return all pending tiles to rack
    uiState.pendingPlacements = [];
    uiState.selectedRackIndex = null;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'shuffle') {
    // Recall pending placements and shuffle the visual rack order
    uiState.pendingPlacements = [];
    uiState.selectedRackIndex = null;
    var rack = m.racks[myAddr] || [];
    var order = [];
    for (var i = 0; i < rack.length; i++) order.push(i);
    // Fisher-Yates shuffle
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    uiState.rackOrder = order;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'dragplace') {
    // Drag a rack tile directly to a board cell
    if (m.turn !== myAddr) return;
    var rackIndex = data.index;
    var rack = m.racks[myAddr];
    var tile = rack[rackIndex];
    if (!tile) return;

    // Check if this rack tile is already placed
    for (var i = 0; i < uiState.pendingPlacements.length; i++) {
      if (uiState.pendingPlacements[i].rackIndex === rackIndex) return;
    }
    // Check if cell is occupied by pending tile
    for (var i = 0; i < uiState.pendingPlacements.length; i++) {
      if (uiState.pendingPlacements[i].row === data.row && uiState.pendingPlacements[i].col === data.col) return;
    }
    // Check if cell has existing board tile
    if (m.board[data.row * 15 + data.col]) return;

    // If blank tile, prompt for letter
    if (tile.letter === '') {
      uiState.blankPromptData = { rackIndex: rackIndex, row: data.row, col: data.col };
      uiState.selectedRackIndex = null;
      rerender();
      return;
    }

    uiState.pendingPlacements.push({
      rackIndex: rackIndex,
      row: data.row,
      col: data.col,
      letter: tile.letter,
      value: tile.value,
      isBlank: false,
    });
    uiState.selectedRackIndex = null;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'dragswap') {
    // Reorder rack tiles visually
    var rack = m.racks[myAddr] || [];
    var order = uiState.rackOrder;
    if (!order || order.length !== rack.length) {
      order = [];
      for (var i = 0; i < rack.length; i++) order.push(i);
    }
    var fromReal = data.from;
    var toReal = data.to;
    // Find visual positions of the two real indices
    var fromVis = -1, toVis = -1;
    for (var i = 0; i < order.length; i++) {
      if (order[i] === fromReal) fromVis = i;
      if (order[i] === toReal) toVis = i;
    }
    if (fromVis >= 0 && toVis >= 0 && fromVis !== toVis) {
      var tmp = order[fromVis];
      order[fromVis] = order[toVis];
      order[toVis] = tmp;
      uiState.rackOrder = order;
    }
    rerender();
    return;
  }

  if (action === 'dragmove') {
    var pendingIdx = data.index;
    if (pendingIdx < 0 || pendingIdx >= uiState.pendingPlacements.length) return;
    for (var i = 0; i < uiState.pendingPlacements.length; i++) {
      if (i !== pendingIdx && uiState.pendingPlacements[i].row === data.row && uiState.pendingPlacements[i].col === data.col) return;
    }
    if (m.board[data.row * 15 + data.col]) return;
    uiState.pendingPlacements[pendingIdx].row = data.row;
    uiState.pendingPlacements[pendingIdx].col = data.col;
    updatePreview();
    rerender();
    return;
  }

  if (action === 'dragpickup') {
    // Drag a pending tile back to rack
    var idx = data.index;
    if (idx >= 0 && idx < uiState.pendingPlacements.length) {
      uiState.pendingPlacements.splice(idx, 1);
    }
    updatePreview();
    rerender();
    return;
  }

  if (action === 'play') {
    if (m.turn !== myAddr) return;
    if (uiState.pendingPlacements.length === 0) return;

    // Build tiles array for the update
    var tiles = uiState.pendingPlacements.map(function (pp) {
      var t = { rackIndex: pp.rackIndex, row: pp.row, col: pp.col };
      if (pp.isBlank) t.blankLetter = pp.blankLetter;
      return t;
    });

    // Pre-validate locally to show errors
    var rack = m.racks[myAddr];
    var placements = uiState.pendingPlacements.map(function (pp) {
      return {
        row: pp.row,
        col: pp.col,
        letter: pp.letter,
        value: pp.value,
        isBlank: pp.isBlank || false,
      };
    });

    var isFirstMove = true;
    for (var i = 0; i < m.board.length; i++) {
      if (m.board[i]) { isFirstMove = false; break; }
    }

    var result = validateAndScore(m.board, placements, isFirstMove, isValidWord);
    if (!result.valid) {
      uiState.errorMessage = result.reason;
      rerender();
      return;
    }

    var payload = {
      type: 'place',
      matchId: m.id,
      addr: myAddr,
      moveNumber: m.moveNumber,
      tiles: tiles,
    };
    var wordList = result.words.map(function(w) { return w.word; }).join(', ');
    send(payload, myName + ' played ' + wordList, myName + ' played ' + wordList + ' for ' + result.totalScore + ' points');
    return;
  }

  if (action === 'exchange') {
    if (m.turn !== myAddr) return;
    uiState.exchangeMode = true;
    uiState.exchangeIndices = [];
    uiState.pendingPlacements = [];
    uiState.selectedRackIndex = null;
    rerender();
    return;
  }

  if (action === 'toggleexchange') {
    var i = uiState.exchangeIndices.indexOf(data.index);
    if (i >= 0) {
      uiState.exchangeIndices.splice(i, 1);
    } else {
      uiState.exchangeIndices.push(data.index);
    }
    rerender();
    return;
  }

  if (action === 'confirmexchange') {
    if (m.turn !== myAddr) return;
    if (uiState.exchangeIndices.length === 0) return;

    if (uiState.exchangeIndices.length > m.bag.length) {
      uiState.errorMessage = 'Not enough tiles in the bag';
      rerender();
      return;
    }

    var payload = {
      type: 'exchange',
      matchId: m.id,
      addr: myAddr,
      moveNumber: m.moveNumber,
      rackIndices: uiState.exchangeIndices.slice(),
    };

    var exchangeCount = uiState.exchangeIndices.length;
    send(payload, myName + ' exchanged ' + exchangeCount + ' tiles', myName + ' exchanged ' + exchangeCount + ' tile' + (exchangeCount !== 1 ? 's' : ''));

    uiState.exchangeMode = false;
    uiState.exchangeIndices = [];
    return;
  }

  if (action === 'cancelexchange') {
    uiState.exchangeMode = false;
    uiState.exchangeIndices = [];
    rerender();
    return;
  }

  if (action === 'pass') {
    if (m.turn !== myAddr) return;
    var payload = { type: 'pass', matchId: m.id, addr: myAddr, moveNumber: m.moveNumber };
    send(payload, myName + ' passed', myName + ' passed');
    return;
  }

  if (action === 'resign') {
    if (m.turn !== myAddr && m.phase !== 'playing') return;
    var payload = { type: 'resign', matchId: m.id, addr: myAddr };
    send(payload, myName + ' resigned', myName + ' resigned');
    return;
  }
}

function inviteLink(id) {
  return location.href.split('#')[0] + '#join=' + id;
}

function openMatch(id) {
  uiState.view = 'match';
  uiState.matchId = id;
  resetMatchUI();
  rerender();
}
