// crate.js - Deterministic crate rolls: a 32-bit seed fully decides the outcome and the reel.
//
// Every client that knows the seed rebuilds the exact same reel and lands on the same skin,
// so the seed can later come from commit-reveal (see seedFromReveals) instead of Math.random.

import { createRng } from './rng.js';
import { RARITIES, skinsOfRarity } from './skins.js';
import { sha256sync, hexToBytes } from './crypto.js';

export var REEL_LENGTH = 60;
export var WIN_INDEX = 52;

var REEL_LETTERS = 'AABCDEEEFGHIILMNOOPRRSSTTU';
var LETTER_VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, L: 1, M: 3, N: 1, O: 1, P: 3, R: 1, S: 1, T: 1, U: 1 };

// murmur3 finalizer: spreads small or similar seeds before they hit xorshift,
// whose first outputs are poorly mixed for low-entropy seeds.
function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Uniform float in [0, 1)
function unit(rng) {
  return rng.next() / 4294967296;
}

function pickRarity(roll) {
  var total = 0;
  for (var i = 0; i < RARITIES.length; i++) total += RARITIES[i].weight;
  var x = roll * total;
  for (var j = 0; j < RARITIES.length; j++) {
    x -= RARITIES[j].weight;
    if (x < 0) return RARITIES[j];
  }
  return RARITIES[RARITIES.length - 1];
}

function pickSkin(rng) {
  var rarity = pickRarity(unit(rng));
  var pool = skinsOfRarity(rarity.id);
  return pool[rng.next() % pool.length];
}

// roll(seed) -> { seed, skin, rarity, reel: [{skin, letter, value}], winIndex, landOffset }
// The first two draws decide the prize; later draws only decorate the reel.
export function roll(seed) {
  var rng = createRng(mix32(seed >>> 0));
  var winner = pickSkin(rng);
  var reel = [];
  for (var i = 0; i < REEL_LENGTH; i++) {
    var skin = i === WIN_INDEX ? winner : pickSkin(rng);
    var letter = REEL_LETTERS.charAt(rng.next() % REEL_LETTERS.length);
    reel.push({ skin: skin, letter: letter, value: LETTER_VALUES[letter] });
  }
  return {
    seed: seed >>> 0,
    skin: winner,
    rarity: winner.rarity,
    reel: reel,
    winIndex: WIN_INDEX,
    // Where under the marker the winning item stops, as a fraction of its width.
    landOffset: 0.12 + unit(rng) * 0.76,
  };
}

// A fresh local seed, for solo/demo rolls.
export function randomSeed() {
  var b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0];
}

// Seed for a shared roll once every participant has revealed their nonce.
// label scopes the roll (e.g. 'crate:<id>:<n>') so one reveal can't be reused for another roll.
export function seedFromReveals(nonces, label) {
  var hex = nonces.slice().sort().join('') + bytesHex(label || '');
  return parseInt(sha256sync(hexToBytes(hex)).slice(0, 8), 16) >>> 0;
}

function bytesHex(str) {
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i) & 0xff;
    out += (c < 16 ? '0' : '') + c.toString(16);
  }
  return out;
}
