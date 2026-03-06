// main.js - Boot, webxdc listener, action dispatch, local UI state

import './style.css';
import { initialState, reduce, getSummary } from './state.js';
import { createBag, shuffleBag, validateAndScore } from './board.js';
import { isValidWord } from './dict.js';
import { initUI, render, reclampZoom } from './ui.js';
import { generateTextures } from './textures.js';

var myAddr = window.webxdc.selfAddr;
var myName = window.webxdc.selfName;

var state = initialState();

// Local UI state (not shared)
var uiState = {
  selectedRackIndex: null,
  pendingPlacements: [],   // [{rackIndex, row, col, letter, value, isBlank, blankLetter?}]
  exchangeMode: false,
  exchangeIndices: [],
  blankPromptData: null,    // {rackIndex, row, col} - waiting for letter choice
  errorMessage: null,
  rackOrder: null,          // null = natural order, or [indices] mapping for visual reorder
  preview: null,            // { valid, words, totalScore, reason } or null
};

function clearError() {
  uiState.errorMessage = null;
}

function isFirstMove(board) {
  for (var i = 0; i < board.length; i++) {
    if (board[i]) return false;
  }
  return true;
}

function updatePreview() {
  if (uiState.pendingPlacements.length === 0) {
    uiState.preview = null;
    return;
  }
  var placements = uiState.pendingPlacements.map(function (pp) {
    return {
      row: pp.row, col: pp.col, letter: pp.letter,
      value: pp.value, isBlank: pp.isBlank || false,
    };
  });
  uiState.preview = validateAndScore(state.board, placements, isFirstMove(state.board), isValidWord);
}

function rerender() {
  render(state, myAddr, uiState);
}

// Boot 

document.addEventListener('DOMContentLoaded', function () {
  generateTextures();
  var appEl = document.getElementById('app');
  initUI(appEl, handleAction);
  rerender();

  // Re-clamp zoom bounds on orientation/resize changes
  window.addEventListener('resize', reclampZoom);

  window.webxdc.setUpdateListener(function (update) {
    state = reduce(state, update);
    // Reset UI state on turn change or phase change
    uiState.pendingPlacements = [];
    uiState.selectedRackIndex = null;
    uiState.exchangeMode = false;
    uiState.exchangeIndices = [];
    uiState.blankPromptData = null;
    uiState.rackOrder = null;
    uiState.preview = null;
    clearError();
    rerender();
  }, 0);
});

// Action Handlers

function handleAction(action, data) {
  clearError();

  if (action === 'join') {
    window.webxdc.sendUpdate({
      payload: { type: 'join', addr: myAddr, name: myName },
      summary: getSummary(reduce(state, { payload: { type: 'join', addr: myAddr, name: myName } }), myAddr),
    }, myName + ' joined');
    return;
  }

  if (action === 'start') {
    var bag = shuffleBag(createBag());
    var players = {};
    for (var i = 0; i < state.playerOrder.length; i++) {
      var addr = state.playerOrder[i];
      players[addr] = { name: state.players[addr].name };
    }
    var nextState = reduce(state, { payload: { type: 'start', addr: myAddr, bag: JSON.parse(JSON.stringify(bag)), playerOrder: state.playerOrder, players: players } });
    window.webxdc.sendUpdate({
      payload: { type: 'start', addr: myAddr, bag: bag, playerOrder: state.playerOrder, players: players },
      summary: getSummary(nextState, myAddr),
    }, 'Game started');
    return;
  }

  if (action === 'selecttile') {
    if (state.turn !== myAddr) return;
    if (uiState.selectedRackIndex === data.index) {
      uiState.selectedRackIndex = null;
    } else {
      uiState.selectedRackIndex = data.index;
    }
    rerender();
    return;
  }

  if (action === 'placetile') {
    if (state.turn !== myAddr) return;
    if (uiState.selectedRackIndex === null) return;

    var rackIndex = uiState.selectedRackIndex;
    var rack = state.racks[myAddr];
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
    var rack = state.racks[myAddr];
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
    var rack = state.racks[myAddr] || [];
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
    if (state.turn !== myAddr) return;
    var rackIndex = data.index;
    var rack = state.racks[myAddr];
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
    if (state.board[data.row * 15 + data.col]) return;

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
    var rack = state.racks[myAddr] || [];
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
    if (state.board[data.row * 15 + data.col]) return;
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
    if (state.turn !== myAddr) return;
    if (uiState.pendingPlacements.length === 0) return;

    // Build tiles array for the update
    var tiles = uiState.pendingPlacements.map(function (pp) {
      var t = { rackIndex: pp.rackIndex, row: pp.row, col: pp.col };
      if (pp.isBlank) t.blankLetter = pp.blankLetter;
      return t;
    });

    // Pre-validate locally to show errors
    var rack = state.racks[myAddr];
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
    for (var i = 0; i < state.board.length; i++) {
      if (state.board[i]) { isFirstMove = false; break; }
    }

    var result = validateAndScore(state.board, placements, isFirstMove, isValidWord);
    if (!result.valid) {
      uiState.errorMessage = result.reason;
      rerender();
      return;
    }

    var payload = {
      type: 'place',
      addr: myAddr,
      moveNumber: state.moveNumber,
      tiles: tiles,
    };
    var nextState = reduce(state, { payload: payload });
    var wordList = result.words.map(function(w) { return w.word; }).join(', ');
    window.webxdc.sendUpdate({
      payload: payload,
      summary: getSummary(nextState, myAddr),
      info: myName + ' played ' + wordList + ' for ' + result.totalScore + ' points',
    }, myName + ' played ' + wordList);
    return;
  }

  if (action === 'exchange') {
    if (state.turn !== myAddr) return;
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
    if (state.turn !== myAddr) return;
    if (uiState.exchangeIndices.length === 0) return;

    var rack = state.racks[myAddr];
    var bag = JSON.parse(JSON.stringify(state.bag));

    if (uiState.exchangeIndices.length > bag.length) {
      uiState.errorMessage = 'Not enough tiles in the bag';
      rerender();
      return;
    }

    // Draw new tiles first
    var drawnTiles = bag.splice(0, uiState.exchangeIndices.length);

    // Put returned tiles back into bag
    var returned = [];
    for (var i = 0; i < uiState.exchangeIndices.length; i++) {
      returned.push(JSON.parse(JSON.stringify(rack[uiState.exchangeIndices[i]])));
    }
    for (var i = 0; i < returned.length; i++) {
      bag.push(returned[i]);
    }

    // Shuffle the bag
    shuffleBag(bag);

    var payload = {
      type: 'exchange',
      addr: myAddr,
      moveNumber: state.moveNumber,
      rackIndices: uiState.exchangeIndices.slice(),
      drawnTiles: drawnTiles,
      newBag: bag,
    };

    var nextState = reduce(state, { payload: payload });
    var exchangeCount = uiState.exchangeIndices.length;
    window.webxdc.sendUpdate({
      payload: payload,
      summary: getSummary(nextState, myAddr),
      info: myName + ' exchanged ' + exchangeCount + ' tile' + (exchangeCount !== 1 ? 's' : ''),
    }, myName + ' exchanged ' + exchangeCount + ' tiles');

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
    if (state.turn !== myAddr) return;
    var payload = { type: 'pass', addr: myAddr, moveNumber: state.moveNumber };
    var nextState = reduce(state, { payload: payload });
    window.webxdc.sendUpdate({
      payload: payload,
      summary: getSummary(nextState, myAddr),
      info: myName + ' passed',
    }, myName + ' passed');
    return;
  }

  if (action === 'resign') {
    if (state.turn !== myAddr && state.phase !== 'playing') return;
    var payload = { type: 'resign', addr: myAddr };
    var nextState = reduce(state, { payload: payload });
    window.webxdc.sendUpdate({
      payload: payload,
      summary: getSummary(nextState, myAddr),
      info: myName + ' resigned',
    }, myName + ' resigned');
    return;
  }
}
