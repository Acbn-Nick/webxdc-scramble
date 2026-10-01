// skins.js - Tile skin catalog, rarity tiers, and applying skins via --tile-* CSS vars

// Rarity tiers, lowest to highest. weight is out of 10000 (CS-style odds).
export var RARITIES = [
  { id: 'common',    name: 'Common',    color: '#4b69ff', weight: 7992 },
  { id: 'rare',      name: 'Rare',      color: '#8847ff', weight: 1598 },
  { id: 'epic',      name: 'Epic',      color: '#d32ce6', weight: 320 },
  { id: 'legendary', name: 'Legendary', color: '#eb4b4b', weight: 64 },
  { id: 'exotic',    name: 'Exotic',    color: '#e4ae39', weight: 26 },
];

export var RARITY_BY_ID = {};
for (var r = 0; r < RARITIES.length; r++) RARITY_BY_ID[RARITIES[r].id] = RARITIES[r];

// Each skin is a set of --tile-* values. bg may be any CSS background (gradients ok).
// fx is an optional animated effect class applied to rack tiles.
export var SKINS = [
  // Common
  { id: 'birch',    name: 'Birch',    rarity: 'common',
    bg: 'linear-gradient(160deg,#f3e3c3,#e2c999)', light: '#fbf1dc', border: '#a88b5a', text: '#3d2b14', value: '#7a5c35' },
  { id: 'slate',    name: 'Slate',    rarity: 'common',
    bg: 'linear-gradient(160deg,#6b7785,#4a5562)', light: '#8995a3', border: '#2f3740', text: '#f1f4f7', value: '#c5ced8' },
  { id: 'mint',     name: 'Mint',     rarity: 'common',
    bg: 'linear-gradient(160deg,#d8f5e6,#a9e4c6)', light: '#effcf5', border: '#5fa883', text: '#1b4332', value: '#40916c' },
  { id: 'sky',      name: 'Sky',      rarity: 'common',
    bg: 'linear-gradient(160deg,#dcefff,#a8d4fb)', light: '#f3f9ff', border: '#5a8fc0', text: '#0d3b66', value: '#3a6a96' },
  { id: 'brick',    name: 'Brick',    rarity: 'common',
    bg: 'linear-gradient(160deg,#c8674a,#9e4430)', light: '#e08b70', border: '#6d2a1c', text: '#fff4ec', value: '#f3c6b4' },
  // Rare
  { id: 'marble',   name: 'Marble',   rarity: 'rare',
    bg: 'linear-gradient(125deg,#fafafa 0%,#e7e7ea 30%,#fafafa 45%,#d9d9de 60%,#f5f5f7 100%)', light: '#fff', border: '#9d9da6', text: '#22222a', value: '#6a6a75' },
  { id: 'walnut',   name: 'Walnut',   rarity: 'rare',
    bg: 'repeating-linear-gradient(100deg,#6b4226 0 6px,#5a361e 6px 9px,#734a2c 9px 15px)', light: '#8c6040', border: '#3a2212', text: '#f7e6cf', value: '#d9b98e' },
  { id: 'neon',     name: 'Neon Grid', rarity: 'rare',
    bg: 'linear-gradient(160deg,#1a0b3a,#0d0221)', light: '#ff2a6d', border: '#05d9e8', text: '#05d9e8', value: '#ff2a6d' },
  // Epic
  { id: 'holo',     name: 'Hologram', rarity: 'epic', fx: 'shimmer',
    bg: 'linear-gradient(120deg,#ffd1f7,#c4f1ff,#d9ffc9,#fff3b8,#ffd1f7)', light: '#ffffff', border: '#9a8fc7', text: '#2a1f4f', value: '#5b4c8f' },
  { id: 'carbon',   name: 'Carbon',   rarity: 'epic',
    bg: 'repeating-linear-gradient(45deg,#1c1c1c 0 3px,#2a2a2a 3px 6px)', light: '#444', border: '#000', text: '#e8e8e8', value: '#ff5c39' },
  // Legendary
  { id: 'ember',    name: 'Obsidian Ember', rarity: 'legendary', fx: 'shimmer',
    bg: 'linear-gradient(135deg,#120606,#2b0b0b 40%,#7a1a06 70%,#ff6a00 100%)', light: '#ff8c3a', border: '#2a0000', text: '#ffd9b0', value: '#ff8c3a' },
  { id: 'abyss',    name: 'Abyssal',  rarity: 'legendary', fx: 'shimmer',
    bg: 'linear-gradient(135deg,#001219,#005f73 50%,#0a9396 75%,#94d2bd 100%)', light: '#94d2bd', border: '#001219', text: '#e9fff8', value: '#94d2bd' },
  // Exotic
  { id: 'goldleaf', name: 'Gold Leaf', rarity: 'exotic', fx: 'shimmer',
    bg: 'linear-gradient(120deg,#8a6a1f,#f5d77a 25%,#c9a13b 45%,#fff2c2 60%,#b8882a 80%,#8a6a1f)', light: '#fff2c2', border: '#6b4f12', text: '#3b2a05', value: '#5c430e' },
];

export var SKIN_BY_ID = {};
for (var s = 0; s < SKINS.length; s++) SKIN_BY_ID[SKINS[s].id] = SKINS[s];

export function skinsOfRarity(rarityId) {
  return SKINS.filter(function (sk) { return sk.rarity === rarityId; });
}

// Inline style string for a single element (e.g. a reel tile or preview).
export function skinStyle(skin) {
  return '--tile-bg:' + skin.bg +
    ';--tile-border-light:' + skin.light +
    ';--tile-border:' + skin.border +
    ';--tile-text:' + skin.text +
    ';--tile-value:' + skin.value;
}

var VARS = ['--tile-bg', '--tile-border-light', '--tile-border', '--tile-text', '--tile-value'];
var STORAGE_KEY = 'scramble_equipped_skin';

// Apply a skin to every tile in the game by overriding the root --tile-* vars.
// Pass null to restore the default tile look.
export function applySkin(skin) {
  var root = document.documentElement;
  if (!skin) {
    for (var i = 0; i < VARS.length; i++) root.style.removeProperty(VARS[i]);
    root.removeAttribute('data-tile-fx');
    return;
  }
  root.style.setProperty('--tile-bg', skin.bg);
  root.style.setProperty('--tile-border-light', skin.light);
  root.style.setProperty('--tile-border', skin.border);
  root.style.setProperty('--tile-text', skin.text);
  root.style.setProperty('--tile-value', skin.value);
  if (skin.fx) root.setAttribute('data-tile-fx', skin.fx);
  else root.removeAttribute('data-tile-fx');
}

export function equipSkin(skinId) {
  try { localStorage.setItem(STORAGE_KEY, skinId || ''); } catch (e) {}
  applySkin(SKIN_BY_ID[skinId] || null);
}

export function loadEquippedSkin() {
  var id = null;
  try { id = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  applySkin(SKIN_BY_ID[id] || null);
  return id;
}
