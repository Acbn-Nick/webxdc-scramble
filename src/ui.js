// ui.js - All rendering for Scramble: lobby, board, rack, actions, blank prompt, game over

import { BOARD_SIZE, RACK_SIZE, PREMIUM_MAP, TW, DW, TL, DL, ST } from './board.js';

var app;
var sendAction;

// Persistent board viewport elements (survive innerHTML rebuilds)
var boardViewport;
var boardContainer;

// Zoom state - module-level so it persists across renders
var zoomState = { scale: 1, tx: 0, ty: 0 };
var MIN_SCALE = 1;
var MAX_SCALE = 3;

// Natural board dimension (square, fits within viewport)
var boardSize = 0;

// Pinch gesture state
var pinchState = null; // { startDist, startScale, startTx, startTy, focalX, focalY }

// One-finger pan state (when zoomed)
var panState = null; // { lastX, lastY, moved }

// Mouse pan state (desktop left-click pan when zoomed)
var mousePanState = null; // { lastX, lastY, moved }
var suppressClick = false;

// Double-tap detection
var lastTapTime = 0;

function esc(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function updateBoardSize() {
  if (!boardViewport) return;
  var rect = boardViewport.getBoundingClientRect();
  boardSize = Math.min(rect.width, rect.height);
  if (boardContainer && boardSize > 0) {
    boardContainer.style.width = boardSize + 'px';
    boardContainer.style.height = boardSize + 'px';
  }
}

function applyTransform() {
  if (!boardContainer) return;
  updateBoardSize();
  boardContainer.style.transform = 'translate(' + zoomState.tx + 'px,' + zoomState.ty + 'px) scale(' + zoomState.scale + ')';
}

function clampZoom() {
  if (!boardViewport) return;
  var rect = boardViewport.getBoundingClientRect();
  var vw = rect.width;
  var vh = rect.height;
  var s = zoomState.scale;

  // Board scaled size (board is square: boardSize × boardSize)
  var scaledBoard = boardSize * s;

  // Horizontal: center if fits, otherwise clamp pan
  if (scaledBoard <= vw) {
    zoomState.tx = (vw - scaledBoard) / 2;
  } else {
    zoomState.tx = Math.max(vw - scaledBoard, Math.min(0, zoomState.tx));
  }

  // Vertical: center if fits, otherwise clamp pan
  if (scaledBoard <= vh) {
    zoomState.ty = (vh - scaledBoard) / 2;
  } else {
    zoomState.ty = Math.max(vh - scaledBoard, Math.min(0, zoomState.ty));
  }
}

function getTouchDist(t1, t2) {
  var dx = t1.clientX - t2.clientX;
  var dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchMid(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
}

export function reclampZoom() {
  updateBoardSize();
  clampZoom();
  applyTransform();
}

export function initUI(appEl, actionCallback) {
  app = appEl;
  sendAction = actionCallback;

  // Create persistent viewport wrapper
  boardViewport = document.createElement('div');
  boardViewport.className = 'board-viewport';
  boardContainer = document.createElement('div');
  boardContainer.className = 'board-container';
  boardViewport.appendChild(boardContainer);

  app.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.disabled) return;
    var action = btn.getAttribute('data-action');
    var idx = btn.getAttribute('data-index');
    var row = btn.getAttribute('data-row');
    var col = btn.getAttribute('data-col');
    var letter = btn.getAttribute('data-letter');
    sendAction(action, {
      index: idx !== null ? parseInt(idx) : null,
      row: row !== null ? parseInt(row) : null,
      col: col !== null ? parseInt(col) : null,
      letter: letter,
    });
  });

  // -- Pinch-to-Zoom on Board Viewport --

  boardViewport.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      // Enter pinch mode - cancel any in-progress tile drag
      var t1 = e.touches[0], t2 = e.touches[1];
      pinchState = {
        startDist: getTouchDist(t1, t2),
        startScale: zoomState.scale,
        startTx: zoomState.tx,
        startTy: zoomState.ty,
        lastMid: getTouchMid(t1, t2),
      };
      e.preventDefault();
    } else if (e.touches.length === 1 && zoomState.scale > 1 && !pinchState) {
      if (!e.target.closest('[data-drag]')) {
        var touch = e.touches[0];
        panState = { lastX: touch.clientX, lastY: touch.clientY, moved: false };
      }
    }
  }, { passive: false });

  boardViewport.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && pinchState) {
      e.preventDefault();
      var t1 = e.touches[0], t2 = e.touches[1];
      var dist = getTouchDist(t1, t2);
      var mid = getTouchMid(t1, t2);

      // Calculate new scale
      var ratio = dist / pinchState.startDist;
      var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchState.startScale * ratio));

      // Focal-point stable zoom
      var vpRect = boardViewport.getBoundingClientRect();
      var focalX = mid.x - vpRect.left;
      var focalY = mid.y - vpRect.top;

      // Board coordinates of focal point at old transform
      var boardX = (focalX - zoomState.tx) / zoomState.scale;
      var boardY = (focalY - zoomState.ty) / zoomState.scale;

      // New translation to keep focal point stable
      var newTx = focalX - boardX * newScale;
      var newTy = focalY - boardY * newScale;

      // Also apply pan delta
      var panDx = mid.x - pinchState.lastMid.x;
      var panDy = mid.y - pinchState.lastMid.y;
      newTx += panDx;
      newTy += panDy;

      zoomState.scale = newScale;
      zoomState.tx = newTx;
      zoomState.ty = newTy;
      pinchState.lastMid = mid;

      clampZoom();
      applyTransform();
    } else if (e.touches.length === 1 && panState) {
      var touch = e.touches[0];
      var dx = touch.clientX - panState.lastX;
      var dy = touch.clientY - panState.lastY;
      if (!panState.moved && Math.abs(dx) + Math.abs(dy) > 5) {
        panState.moved = true;
      }
      if (panState.moved) {
        zoomState.tx += dx;
        zoomState.ty += dy;
        panState.lastX = touch.clientX;
        panState.lastY = touch.clientY;
        clampZoom();
        applyTransform();
        e.preventDefault();
      }
    }
  }, { passive: false });

  boardViewport.addEventListener('touchend', function (e) {
    if (panState) {
      if (panState.moved) e.preventDefault();
      panState = null;
    }

    if (pinchState && e.touches.length < 2) {
      // Snap to 1x if close
      if (zoomState.scale < 1.08) {
        zoomState.scale = 1;
      }
      clampZoom();
      applyTransform();
      pinchState = null;
    }

    // Double-tap to reset (only when zoomed in)
    if (e.touches.length === 0 && !pinchState && zoomState.scale > 1.05) {
      var now = Date.now();
      if (now - lastTapTime < 300) {
        // Double-tap detected - check target isn't an interactive element
        var touch = e.changedTouches[0];
        var target = document.elementFromPoint(touch.clientX, touch.clientY);
        var isInteractive = target && (target.closest('[data-action]') || target.closest('[data-drag]'));
        if (!isInteractive) {
          zoomState.scale = 1;
          clampZoom();
          applyTransform();
          lastTapTime = 0;
          return;
        }
      }
      lastTapTime = now;
    }
  });

  // -- Scroll-Wheel Zoom --

  boardViewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var newScale = zoomState.scale * (1 - e.deltaY * 0.002);
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    var vpRect = boardViewport.getBoundingClientRect();
    var focalX = e.clientX - vpRect.left;
    var focalY = e.clientY - vpRect.top;

    var boardX = (focalX - zoomState.tx) / zoomState.scale;
    var boardY = (focalY - zoomState.ty) / zoomState.scale;

    zoomState.tx = focalX - boardX * newScale;
    zoomState.ty = focalY - boardY * newScale;
    zoomState.scale = newScale;

    if (zoomState.scale < 1.08) {
      zoomState.scale = 1;
    }

    clampZoom();
    applyTransform();
  }, { passive: false });

  // -- Left-Click Pan When Zoomed --

  boardViewport.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (zoomState.scale <= 1) return;
    if (e.target.closest('[data-drag]')) return;
    mousePanState = { lastX: e.clientX, lastY: e.clientY, moved: false };
    e.preventDefault();
  });

  document.addEventListener('mousemove', function (e) {
    if (!mousePanState) return;
    var dx = e.clientX - mousePanState.lastX;
    var dy = e.clientY - mousePanState.lastY;
    if (!mousePanState.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      mousePanState.moved = true;
    }
    if (mousePanState.moved) {
      zoomState.tx += dx;
      zoomState.ty += dy;
      mousePanState.lastX = e.clientX;
      mousePanState.lastY = e.clientY;
      clampZoom();
      applyTransform();
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (!mousePanState) return;
    if (mousePanState.moved) {
      suppressClick = true;
    }
    mousePanState = null;
  });

  boardViewport.addEventListener('click', function (e) {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressClick = false;
    }
  }, true);

  // -- HTML5 Drag-and-Drop --

  var dragSource = null; // {type: 'rack'|'pending', index: number}

  app.addEventListener('dragstart', function (e) {
    var el = e.target.closest('[data-drag]');
    if (!el) return;
    var type = el.getAttribute('data-drag');
    var index = parseInt(el.getAttribute('data-index'));
    dragSource = { type: type, index: index };
    mousePanState = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // required for Firefox

    // Create drag ghost that matches board cell size
    var cellSize = boardSize / 15 * zoomState.scale;
    var ghostEl = el.cloneNode(true);
    ghostEl.className = 'drag-ghost';
    ghostEl.style.width = cellSize + 'px';
    ghostEl.style.height = cellSize + 'px';
    ghostEl.style.fontSize = (Math.min(window.innerWidth * 0.028, 14) * zoomState.scale) + 'px';
    ghostEl.style.position = 'absolute';
    ghostEl.style.top = '-9999px';
    document.body.appendChild(ghostEl);
    e.dataTransfer.setDragImage(ghostEl, cellSize / 2, cellSize / 2);

    el.classList.add('dragging');
  });

  app.addEventListener('dragend', function (e) {
    dragSource = null;
    var dragging = app.querySelectorAll('.dragging');
    for (var i = 0; i < dragging.length; i++) dragging[i].classList.remove('dragging');
    var overs = app.querySelectorAll('.drag-over');
    for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over');
    // Clean up offscreen drag ghost elements
    var ghosts = document.querySelectorAll('body > .drag-ghost');
    for (var i = 0; i < ghosts.length; i++) ghosts[i].parentNode.removeChild(ghosts[i]);
  });

  app.addEventListener('dragover', function (e) {
    if (!dragSource) return;
    var dropEl = e.target.closest('[data-drop]');
    if (!dropEl) return;
    var dropType = dropEl.getAttribute('data-drop');

    // Rack tile → board cell, or rack tile → rack tile (reorder), or pending → rack
    if (dragSource.type === 'rack' && (dropType === 'cell' || dropType === 'rack')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropEl.classList.add('drag-over');
    } else if (dragSource.type === 'pending' && (dropType === 'rack' || dropType === 'cell')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropEl.classList.add('drag-over');
    }
  });

  app.addEventListener('dragleave', function (e) {
    var el = e.target.closest('.drag-over');
    if (el) el.classList.remove('drag-over');
  });

  app.addEventListener('drop', function (e) {
    e.preventDefault();
    var overs = app.querySelectorAll('.drag-over');
    for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over');
    if (!dragSource) return;

    var dropEl = e.target.closest('[data-drop]');
    if (!dropEl) return;
    var dropType = dropEl.getAttribute('data-drop');

    if (dragSource.type === 'rack' && dropType === 'cell') {
      // Drag rack tile to board cell
      var row = parseInt(dropEl.getAttribute('data-row'));
      var col = parseInt(dropEl.getAttribute('data-col'));
      sendAction('dragplace', { index: dragSource.index, row: row, col: col });
    } else if (dragSource.type === 'rack' && dropType === 'rack') {
      // Reorder rack tiles
      var targetIndex = dropEl.getAttribute('data-index');
      if (targetIndex !== null) {
        sendAction('dragswap', { from: dragSource.index, to: parseInt(targetIndex) });
      }
    } else if (dragSource.type === 'pending' && dropType === 'cell') {
      var row = parseInt(dropEl.getAttribute('data-row'));
      var col = parseInt(dropEl.getAttribute('data-col'));
      sendAction('dragmove', { index: dragSource.index, row: row, col: col });
    } else if (dragSource.type === 'pending' && dropType === 'rack') {
      // Drag pending tile back to rack
      sendAction('dragpickup', { index: dragSource.index });
    }

    dragSource = null;
  });

  // -- Touch Drag Fallback --

  var touchDrag = null; // {type, index, ghost, startX, startY}

  app.addEventListener('touchstart', function (e) {
    // Don't start tile drags during pinch
    if (pinchState) return;
    if (e.touches.length !== 1) return;

    var el = e.target.closest('[data-drag]');
    if (!el) return;
    var type = el.getAttribute('data-drag');
    var index = parseInt(el.getAttribute('data-index'));
    var touch = e.touches[0];

    // Create ghost element sized to match board cells
    var cellSize = boardSize / 15 * zoomState.scale;
    var ghost = el.cloneNode(true);
    ghost.className = 'drag-ghost';
    ghost.style.width = cellSize + 'px';
    ghost.style.height = cellSize + 'px';
    ghost.style.fontSize = (Math.min(window.innerWidth * 0.028, 14) * zoomState.scale) + 'px';
    ghost.style.left = touch.clientX + 'px';
    ghost.style.top = touch.clientY + 'px';
    document.body.appendChild(ghost);

    touchDrag = { type: type, index: index, ghost: ghost, el: el, startX: touch.clientX, startY: touch.clientY, moved: false };
  }, { passive: true });

  app.addEventListener('touchmove', function (e) {
    if (!touchDrag) return;
    // Cancel tile drag if multi-touch (pinch started)
    if (e.touches.length > 1) {
      if (touchDrag.ghost && touchDrag.ghost.parentNode) touchDrag.ghost.parentNode.removeChild(touchDrag.ghost);
      touchDrag = null;
      return;
    }
    var touch = e.touches[0];
    var dx = touch.clientX - touchDrag.startX;
    var dy = touch.clientY - touchDrag.startY;
    if (!touchDrag.moved && Math.abs(dx) + Math.abs(dy) > 10) {
      touchDrag.moved = true;
    }
    if (!touchDrag.moved) return;
    e.preventDefault();
    touchDrag.ghost.style.left = touch.clientX + 'px';
    touchDrag.ghost.style.top = touch.clientY + 'px';

    // Highlight drop target
    var overs = app.querySelectorAll('.drag-over');
    for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over');
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target) {
      var dropEl = target.closest('[data-drop]');
      if (dropEl) dropEl.classList.add('drag-over');
    }
  }, { passive: false });

  app.addEventListener('touchend', function (e) {
    if (!touchDrag) return;
    var td = touchDrag;
    touchDrag = null;

    if (td.ghost && td.ghost.parentNode) td.ghost.parentNode.removeChild(td.ghost);
    var overs = app.querySelectorAll('.drag-over');
    for (var i = 0; i < overs.length; i++) overs[i].classList.remove('drag-over');

    if (!td.moved) return; // was a tap, not a drag - let click handler handle it

    var touch = e.changedTouches[0];
    var target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;
    var dropEl = target.closest('[data-drop]');
    if (!dropEl) return;
    var dropType = dropEl.getAttribute('data-drop');

    if (td.type === 'rack' && dropType === 'cell') {
      var row = parseInt(dropEl.getAttribute('data-row'));
      var col = parseInt(dropEl.getAttribute('data-col'));
      sendAction('dragplace', { index: td.index, row: row, col: col });
    } else if (td.type === 'rack' && dropType === 'rack') {
      var targetIndex = dropEl.getAttribute('data-index');
      if (targetIndex !== null) {
        sendAction('dragswap', { from: td.index, to: parseInt(targetIndex) });
      }
    } else if (td.type === 'pending' && dropType === 'cell') {
      var row = parseInt(dropEl.getAttribute('data-row'));
      var col = parseInt(dropEl.getAttribute('data-col'));
      sendAction('dragmove', { index: td.index, row: row, col: col });
    } else if (td.type === 'pending' && dropType === 'rack') {
      sendAction('dragpickup', { index: td.index });
    }
  });
}

export function render(state, myAddr, uiState) {
  if (state.phase === 'waiting') {
    renderLobby(state, myAddr);
  } else if (state.phase === 'finished') {
    renderFinished(state, myAddr);
  } else {
    renderGame(state, myAddr, uiState);
  }
}

function renderLobby(state, myAddr) {
  var joined = state.playerOrder.indexOf(myAddr) >= 0;
  var html = '<div class="lobby">';
  html += '<h1>Scramble</h1>';
  html += '<div class="lobby-players">';

  if (state.playerOrder.length === 0) {
    html += '<p class="lobby-hint">No players yet</p>';
  }
  for (var i = 0; i < state.playerOrder.length; i++) {
    var addr = state.playerOrder[i];
    var p = state.players[addr];
    var isMe = addr === myAddr;
    html += '<div class="lobby-player">' + esc(p.name) + (isMe ? ' (you)' : '') + '</div>';
  }

  html += '</div>';

  if (!joined) {
    html += '<button class="btn btn-primary" data-action="join">Join Game</button>';
  } else if (state.playerOrder.length === 2) {
    html += '<button class="btn btn-primary" data-action="start">Start Game</button>';
  } else {
    html += '<p class="lobby-hint">Waiting for opponent...</p>';
  }

  html += '<a href="https://hurrse.net" target="_blank" style="display:block;margin-top:2em;font-size:0.8em;color:#888;text-decoration:underline;text-align:center;">hurrse.net</a>';
  html += '</div>';
  app.innerHTML = html;
}

function renderFinished(state, myAddr) {
  var html = '<div class="finished">';
  html += '<h1>Game Over</h1>';

  if (state.gameOverReason === 'resign') {
    var resignee = state.players[state.lastMove.addr];
    html += '<p class="finish-reason">' + esc(resignee ? resignee.name : '?') + ' resigned</p>';
  } else if (state.gameOverReason === 'consecutivePasses') {
    html += '<p class="finish-reason">Both players passed</p>';
  } else {
    html += '<p class="finish-reason">All tiles played</p>';
  }

  html += '<div class="final-scores">';
  for (var i = 0; i < state.playerOrder.length; i++) {
    var addr = state.playerOrder[i];
    var p = state.players[addr];
    var isWinner = state.winner === addr;
    html += '<div class="final-score' + (isWinner ? ' winner' : '') + '">';
    html += '<span class="final-name">' + esc(p.name) + '</span>';
    html += '<span class="final-pts">' + p.score + '</span>';
    if (isWinner) html += '<span class="final-badge">Winner!</span>';
    html += '</div>';
  }
  if (state.winner === 'draw') {
    html += '<div class="final-score"><span class="final-badge">Draw!</span></div>';
  }
  html += '</div>';

  // Show board
  html += renderBoard(state.board, [], {});

  html += '</div>';
  app.innerHTML = html;
}

function renderGame(state, myAddr, uiState) {
  var isMyTurn = state.turn === myAddr;

  // Build top HTML (score bar, last move, blank overlay)
  var topHtml = '';

  // Score bar
  topHtml += '<div class="score-bar">';
  for (var i = 0; i < state.playerOrder.length; i++) {
    var addr = state.playerOrder[i];
    var p = state.players[addr];
    var active = addr === state.turn;
    topHtml += '<div class="score-player' + (active ? ' active' : '') + '">';
    topHtml += '<span class="score-name">' + esc(p.name) + '</span>';
    topHtml += '<span class="score-pts">' + p.score + '</span>';
    topHtml += '</div>';
  }
  topHtml += '<div class="tiles-remaining">' + state.bag.length + ' left</div>';
  topHtml += '</div>';

  // Last move info
  if (state.lastMove) {
    topHtml += renderLastMove(state);
  }

  // Blank prompt overlay
  if (uiState.blankPromptData) {
    topHtml += renderBlankPrompt();
  }

  // Build set of last-move positions for highlighting
  var lastMovePos = {};
  if (state.lastMove && state.lastMove.type === 'place' && state.lastMove.placements) {
    for (var i = 0; i < state.lastMove.placements.length; i++) {
      var pl = state.lastMove.placements[i];
      lastMovePos[pl.row * 15 + pl.col] = true;
    }
  }

  // Board HTML
  var boardHtml = renderBoardInner(state.board, uiState.pendingPlacements, lastMovePos);

  // Bottom HTML (rack, preview, action bar)
  var bottomHtml = '';

  // Rack
  if (uiState.exchangeMode) {
    bottomHtml += renderRackExchange(state, myAddr, uiState);
  } else {
    bottomHtml += renderRack(state, myAddr, uiState);
  }

  // Score preview
  bottomHtml += renderPreview(uiState);

  // Action bar
  bottomHtml += renderActionBar(state, myAddr, uiState);

  // --- Assemble DOM ---
  // Clear app, insert top nodes, then persistent viewport, then bottom nodes
  app.innerHTML = '';

  // Insert top HTML
  var topFrag = document.createElement('div');
  topFrag.innerHTML = topHtml;
  while (topFrag.firstChild) {
    app.appendChild(topFrag.firstChild);
  }

  // Append persistent board viewport
  app.appendChild(boardViewport);
  boardContainer.innerHTML = boardHtml;

  // Insert bottom HTML
  var bottomFrag = document.createElement('div');
  bottomFrag.innerHTML = bottomHtml;
  while (bottomFrag.firstChild) {
    app.appendChild(bottomFrag.firstChild);
  }

  // Apply zoom transform synchronously - no flash
  reclampZoom();
}

function renderLastMove(state) {
  var lm = state.lastMove;
  var name = state.players[lm.addr] ? esc(state.players[lm.addr].name) : '?';
  var html = '<div class="last-move">';

  if (lm.type === 'place') {
    var wordStrs = lm.words.map(function (w) { return w.word.toUpperCase(); });
    html += name + ' played <b>' + wordStrs.join(', ') + '</b> for <b>' + lm.totalScore + '</b> pts';
  } else if (lm.type === 'exchange') {
    html += name + ' exchanged ' + lm.count + ' tile' + (lm.count > 1 ? 's' : '');
  } else if (lm.type === 'pass') {
    html += name + ' passed';
  } else if (lm.type === 'resign') {
    html += name + ' resigned';
  }

  html += '</div>';
  return html;
}

function renderBoardInner(board, pendingPlacements, lastMovePos) {
  // Build pending placement map: idx → {letter, value, isBlank, pendingIndex}
  var pendingMap = {};
  for (var i = 0; i < pendingPlacements.length; i++) {
    var pp = pendingPlacements[i];
    var idx = pp.row * 15 + pp.col;
    pendingMap[idx] = { letter: pp.letter, value: pp.value, isBlank: pp.isBlank, pendingIndex: i };
  }

  var html = '<div class="board">';
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      var idx = r * BOARD_SIZE + c;
      var tile = board[idx];
      var pending = pendingMap[idx];
      var premium = PREMIUM_MAP[idx];
      var cellClass = 'cell';
      var isLastMove = lastMovePos && lastMovePos[idx];

      if (tile) {
        // Existing tile on board
        cellClass += ' cell-tile';
        if (isLastMove) cellClass += ' cell-lastmove';
        html += '<div class="' + cellClass + '">';
        html += '<span class="tile-letter">' + esc(tile.letter) + '</span>';
        if (!tile.isBlank) html += '<span class="tile-value">' + tile.value + '</span>';
        html += '</div>';
      } else if (pending) {
        // Pending (not yet submitted) tile
        cellClass += ' cell-pending';
        html += '<div class="' + cellClass + '" draggable="true" data-action="pickup" data-index="' + pending.pendingIndex + '" data-drag="pending">';
        html += '<span class="tile-letter">' + esc(pending.letter) + '</span>';
        if (!pending.isBlank) html += '<span class="tile-value">' + pending.value + '</span>';
        html += '</div>';
      } else {
        // Empty cell
        if (premium === TW) cellClass += ' cell-tw';
        else if (premium === DW) cellClass += ' cell-dw';
        else if (premium === TL) cellClass += ' cell-tl';
        else if (premium === DL) cellClass += ' cell-dl';
        else if (premium === ST) cellClass += ' cell-star';

        html += '<div class="' + cellClass + '" data-action="placetile" data-row="' + r + '" data-col="' + c + '" data-drop="cell">';
        if (premium === TW) html += '<span class="premium-label">TW</span>';
        else if (premium === DW) html += '<span class="premium-label">DW</span>';
        else if (premium === TL) html += '<span class="premium-label">TL</span>';
        else if (premium === DL) html += '<span class="premium-label">DL</span>';
        else if (premium === ST) html += '<span class="premium-label">&#9733;</span>';
        html += '</div>';
      }
    }
  }
  html += '</div>';
  return html;
}

// Keep renderBoard for lobby/finished screens (no viewport)
function renderBoard(board, pendingPlacements, lastMovePos) {
  return renderBoardInner(board, pendingPlacements, lastMovePos);
}

function renderRack(state, myAddr, uiState) {
  var rack = state.racks[myAddr] || [];
  // Build set of rack indices that are pending on board
  var usedIndices = {};
  for (var i = 0; i < uiState.pendingPlacements.length; i++) {
    usedIndices[uiState.pendingPlacements[i].rackIndex] = true;
  }

  // Determine visual order
  var order = uiState.rackOrder;
  if (!order || order.length !== rack.length) {
    order = [];
    for (var i = 0; i < rack.length; i++) order.push(i);
  }

  var html = '<div class="rack" data-drop="rack">';
  for (var vi = 0; vi < order.length; vi++) {
    var i = order[vi]; // real rack index
    if (usedIndices[i]) {
      // This tile is on the board, show empty slot
      html += '<div class="rack-slot empty" data-drop="rack" data-index="' + i + '"></div>';
    } else {
      var sel = uiState.selectedRackIndex === i;
      var tileClass = 'rack-tile' + (sel ? ' selected' : '');
      var displayLetter = rack[i].letter || '?';
      html += '<div class="' + tileClass + '" draggable="true" data-action="selecttile" data-index="' + i + '" data-drag="rack">';
      html += '<span class="tile-letter">' + esc(displayLetter) + '</span>';
      if (rack[i].letter !== '') {
        html += '<span class="tile-value">' + rack[i].value + '</span>';
      }
      html += '</div>';
    }
  }
  html += '</div>';
  return html;
}

function renderRackExchange(state, myAddr, uiState) {
  var rack = state.racks[myAddr] || [];
  var html = '<div class="rack exchange-mode">';
  for (var i = 0; i < rack.length; i++) {
    var marked = uiState.exchangeIndices.indexOf(i) >= 0;
    var tileClass = 'rack-tile' + (marked ? ' exchange-marked' : '');
    var displayLetter = rack[i].letter || '?';
    html += '<div class="' + tileClass + '" data-action="toggleexchange" data-index="' + i + '">';
    html += '<span class="tile-letter">' + esc(displayLetter) + '</span>';
    if (rack[i].letter !== '') {
      html += '<span class="tile-value">' + rack[i].value + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderPreview(uiState) {
  if (!uiState.preview) return '';
  var p = uiState.preview;
  if (p.valid) {
    var parts = p.words.map(function (w) {
      return esc(w.word.toUpperCase()) + ' (' + w.score + ')';
    });
    return '<div class="preview-bar preview-valid">' +
      '<span class="preview-words">' + parts.join(' + ') + '</span>' +
      ' = <span class="preview-total">' + p.totalScore + ' pts</span></div>';
  } else {
    return '<div class="preview-bar preview-invalid">' + esc(p.reason) + '</div>';
  }
}

function renderActionBar(state, myAddr, uiState) {
  var isMyTurn = state.turn === myAddr;
  var html = '<div class="action-bar">';

  if (uiState.exchangeMode) {
    html += '<button class="btn btn-primary" data-action="confirmexchange"' +
            (uiState.exchangeIndices.length === 0 ? ' disabled' : '') +
            '>Exchange ' + uiState.exchangeIndices.length + '</button>';
    html += '<button class="btn" data-action="cancelexchange">Cancel</button>';
  } else if (isMyTurn) {
    var hasPending = uiState.pendingPlacements.length > 0;
    html += '<button class="btn btn-primary" data-action="play"' + (hasPending ? '' : ' disabled') + '>Play</button>';
    html += '<button class="btn" data-action="shuffle">Shuffle</button>';
    html += '<button class="btn" data-action="recall">Recall</button>';
    html += '<button class="btn" data-action="exchange"' + (hasPending ? ' disabled' : '') + '>Exchange</button>';
    html += '<button class="btn" data-action="pass">Pass</button>';
    html += '<button class="btn btn-danger" data-action="resign">Resign</button>';
  } else {
    var turnName = state.players[state.turn] ? esc(state.players[state.turn].name) : '?';
    html += '<div class="waiting-text">Waiting for ' + turnName + '...</div>';
  }

  if (uiState.errorMessage) {
    html += '<div class="error-message">' + esc(uiState.errorMessage) + '</div>';
  }

  html += '</div>';
  return html;
}

function renderBlankPrompt() {
  var html = '<div class="blank-overlay">';
  html += '<div class="blank-prompt">';
  html += '<h3>Choose a letter for blank tile</h3>';
  html += '<div class="blank-grid">';
  for (var i = 0; i < 26; i++) {
    var letter = String.fromCharCode(65 + i);
    html += '<button class="blank-letter" data-action="chooseletter" data-letter="' + letter + '">' + letter + '</button>';
  }
  html += '</div>';
  html += '<button class="btn" data-action="cancelblanks">Cancel</button>';
  html += '</div>';
  html += '</div>';
  return html;
}
