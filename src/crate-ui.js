// crate-ui.js - CSGO-style horizontal crate roll overlay

import { roll, randomSeed } from './crate.js';
import { RARITY_BY_ID, skinStyle } from './skins.js';

var ITEM_W = 96;  // must match .crate-item width + margin in style.css
var SPIN_MS = 6500;

var overlay = null;
var spinning = false;
var onEquip = null;
var audioCtx = null;

function esc(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function hex8(n) {
  return ('0000000' + (n >>> 0).toString(16)).slice(-8);
}

function tileHtml(skin, letter, value, extraClass) {
  return '<div class="skin-tile' + (extraClass ? ' ' + extraClass : '') + '" style="' + skinStyle(skin) + '">' +
    '<span class="tile-letter">' + esc(letter) + '</span>' +
    '<span class="tile-value">' + value + '</span>' +
    '</div>';
}

function itemHtml(item) {
  var rarity = RARITY_BY_ID[item.skin.rarity];
  return '<div class="crate-item" style="--rarity:' + rarity.color + '">' +
    tileHtml(item.skin, item.letter, item.value) +
    '<div class="crate-item-name">' + esc(item.skin.name) + '</div>' +
    '</div>';
}

// Ease-out with a long tail, like the CS case reel.
function ease(t) {
  return 1 - Math.pow(1 - t, 4);
}

function tick() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.03);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.035);
  } catch (e) {}
}

// equipHandler(skinId) is called when the player presses Equip on a result.
export function openCrate(seed, equipHandler) {
  onEquip = equipHandler || null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'crate-overlay';
    overlay.addEventListener('click', onClick);
    document.body.appendChild(overlay);
  }
  overlay.style.display = '';
  renderIdle(seed);
}

function closeCrate() {
  if (spinning || !overlay) return;
  overlay.style.display = 'none';
}

function renderIdle(seed) {
  overlay.innerHTML =
    '<div class="crate-panel">' +
    '<h2 class="crate-title">Tile Crate</h2>' +
    '<div class="crate-window"><div class="crate-strip"></div><div class="crate-marker"></div></div>' +
    '<div class="crate-result"></div>' +
    '<div class="crate-actions">' +
    '<button class="btn btn-primary" data-crate="spin">Open Crate</button>' +
    '<button class="btn" data-crate="close">Close</button>' +
    '</div>' +
    '<div class="crate-seed"></div>' +
    '</div>';
  overlay.setAttribute('data-seed', seed != null ? String(seed >>> 0) : '');
  // Show a teaser reel so the window isn't empty before the first spin.
  var preview = roll(seed != null ? seed : randomSeed());
  overlay.querySelector('.crate-strip').innerHTML = preview.reel.slice(0, 12).map(itemHtml).join('');
}

function onClick(e) {
  if (e.target === overlay) { closeCrate(); return; }
  var btn = e.target.closest('[data-crate]');
  if (!btn || btn.disabled) return;
  var action = btn.getAttribute('data-crate');
  if (action === 'close') closeCrate();
  else if (action === 'spin') {
    var fixed = overlay.getAttribute('data-seed');
    overlay.setAttribute('data-seed', '');
    spin(fixed ? parseInt(fixed, 10) : randomSeed());
  } else if (action === 'equip') {
    if (onEquip) onEquip(btn.getAttribute('data-skin'));
    btn.textContent = 'Equipped';
    btn.disabled = true;
  }
}

function spin(seed) {
  if (spinning) return;
  spinning = true;
  var result = roll(seed);
  var win = overlay.querySelector('.crate-window');
  var strip = overlay.querySelector('.crate-strip');
  var resultEl = overlay.querySelector('.crate-result');
  var actions = overlay.querySelector('.crate-actions');

  resultEl.innerHTML = '';
  resultEl.className = 'crate-result';
  overlay.querySelector('.crate-seed').textContent = 'seed ' + hex8(seed);
  actions.innerHTML = '<button class="btn" disabled>Rolling...</button>';
  strip.innerHTML = result.reel.map(itemHtml).join('');
  strip.style.transform = 'translateX(0px)';

  // Stop with the marker (window center) over landOffset of the winning item.
  var target = (result.winIndex + result.landOffset) * ITEM_W - win.clientWidth / 2;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var duration = reduced ? 1200 : SPIN_MS;
  var start = null;
  var lastItem = -1;

  function frame(now) {
    if (start === null) start = now;
    var t = Math.min(1, (now - start) / duration);
    var x = target * ease(t);
    strip.style.transform = 'translateX(' + (-x) + 'px)';
    var under = Math.floor((x + win.clientWidth / 2) / ITEM_W);
    if (under !== lastItem) {
      if (lastItem !== -1 && !reduced) tick();
      lastItem = under;
    }
    if (t < 1) requestAnimationFrame(frame);
    else land(result);
  }
  requestAnimationFrame(frame);
}

function land(result) {
  spinning = false;
  var rarity = RARITY_BY_ID[result.rarity];
  var items = overlay.querySelectorAll('.crate-item');
  items[result.winIndex].classList.add('crate-item-won');
  if (result.nearMiss) items[result.nearMiss.index].classList.add('crate-item-near');

  var resultEl = overlay.querySelector('.crate-result');
  resultEl.className = 'crate-result crate-result-show crate-rarity-' + rarity.id;
  resultEl.style.setProperty('--rarity', rarity.color);
  resultEl.innerHTML =
    tileHtml(result.skin, 'S', 1, 'skin-tile-big' + (result.skin.fx ? ' fx-' + result.skin.fx : '')) +
    '<div class="crate-result-text">' +
    '<div class="crate-result-rarity">' + esc(rarity.name) + '</div>' +
    '<div class="crate-result-name">' + esc(result.skin.name) + '</div>' +
    '</div>';

  overlay.querySelector('.crate-actions').innerHTML =
    '<button class="btn btn-primary" data-crate="equip" data-skin="' + result.skin.id + '">Equip</button>' +
    '<button class="btn" data-crate="spin">Open Another</button>' +
    '<button class="btn" data-crate="close">Close</button>';
}
