// crate.js - Deterministic crate rolls: a 32-bit seed fully decides the outcome and the reel.
//
// Every client that knows the seed rebuilds the exact same reel and lands on the same skin,
// so the seed can later come from commit-reveal (see seedFromReveals) instead of Math.random.

import { createRng } from './rng.js';
import { RARITIES, skinsOfRarity } from './skins.js';
import { sha256sync, hexToBytes } from './crypto.js';

export var REEL_LENGTH = 60;
export var WIN_INDEX = 52;
// Chance (out of 1) that a roll below the top tier stops right beside a better skin
export var NEAR_MISS_CHANCE = 0.3;

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

function rarityIndex(id) {
  for (var i = 0; i < RARITIES.length; i++) if (RARITIES[i].id === id) return i;
  return 0;
}

// roll(seed) -> { seed, skin, rarity, reel: [{skin, letter, value}], winIndex, landOffset, nearMiss }
// The first two draws decide the prize; later draws only decorate the reel and
// choose where it stops, so near misses never change what you win.
export function roll(seed) {
  var rng = createRng(mix32(seed >>> 0));
  var winner = pickSkin(rng);
  var reel = [];
  for (var i = 0; i < REEL_LENGTH; i++) {
    var skin = i === WIN_INDEX ? winner : pickSkin(rng);
    var letter = REEL_LETTERS.charAt(rng.next() % REEL_LETTERS.length);
    reel.push({ skin: skin, letter: letter, value: LETTER_VALUES[letter] });
  }
  // Where under the marker the winning item stops, as a fraction of its width.
  var landOffset = 0.12 + unit(rng) * 0.76;

  // Near miss: put a better skin right next to the prize and stop a hair short of it.
  var nearMiss = null;
  var tier = rarityIndex(winner.rarity);
  var top = RARITIES.length - 1;
  if (unit(rng) < NEAR_MISS_CHANCE && tier < top) {
    var side = rng.next() % 2 ? 1 : -1;
    var better = RARITIES[tier + 1 + rng.next() % (top - tier)];
    var pool = skinsOfRarity(better.id);
    var idx = WIN_INDEX + side;
    reel[idx].skin = pool[rng.next() % pool.length];
    landOffset = side > 0 ? 0.9 + unit(rng) * 0.07 : 0.03 + unit(rng) * 0.07;
    nearMiss = { index: idx, rarity: better.id };
  }

  return {
    seed: seed >>> 0,
    skin: winner,
    rarity: winner.rarity,
    reel: reel,
    winIndex: WIN_INDEX,
    landOffset: landOffset,
    nearMiss: nearMiss,
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
