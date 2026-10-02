// Crate roll tests: run with `npm test` (node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roll, seedFromReveals, REEL_LENGTH, NEAR_MISS_CHANCE } from '../src/crate.js';
import { RARITIES } from '../src/skins.js';
import { initialState, reduce } from '../src/state.js';

function tier(id) {
  return RARITIES.findIndex(function (r) { return r.id === id; });
}

test('same seed gives the same prize, reel and stop point', function () {
  var a = roll(12345), b = roll(12345);
  assert.equal(a.skin.id, b.skin.id);
  assert.equal(a.landOffset, b.landOffset);
  assert.deepEqual(a.reel.map(function (x) { return x.skin.id + x.letter; }), b.reel.map(function (x) { return x.skin.id + x.letter; }));
  assert.equal(a.reel.length, REEL_LENGTH);
});

test('the reel always stops on the prize', function () {
  for (var s = 0; s < 5000; s++) {
    var r = roll(s);
    assert.equal(r.reel[r.winIndex].skin, r.skin);
    assert.ok(r.landOffset > 0 && r.landOffset < 1);
  }
});

test('near misses sit beside the prize, are a higher tier, and stop at the near edge', function () {
  var seen = 0;
  for (var s = 0; s < 5000; s++) {
    var r = roll(s);
    if (!r.nearMiss) continue;
    seen++;
    assert.equal(Math.abs(r.nearMiss.index - r.winIndex), 1);
    assert.ok(tier(r.reel[r.nearMiss.index].skin.rarity) > tier(r.rarity));
    if (r.nearMiss.index > r.winIndex) assert.ok(r.landOffset >= 0.9);
    else assert.ok(r.landOffset <= 0.1);
  }
  assert.ok(seen > 0);
});

test('odds match the rarity weights and near misses hit their rate', function () {
  var N = 200000, counts = {}, near = 0;
  for (var s = 0; s < N; s++) {
    var r = roll(s);
    counts[r.rarity] = (counts[r.rarity] || 0) + 1;
    if (r.nearMiss) near++;
  }
  RARITIES.forEach(function (rar) {
    var got = (counts[rar.id] || 0) / N, want = rar.weight / 10000;
    assert.ok(Math.abs(got - want) < Math.max(0.002, want * 0.25), rar.id + ' ' + got + ' vs ' + want);
  });
  var eligible = N - (counts[RARITIES[RARITIES.length - 1].id] || 0);
  assert.ok(Math.abs(near / eligible - NEAR_MISS_CHANCE) < 0.01);
});

test('seedFromReveals ignores nonce order but depends on the label', function () {
  assert.equal(seedFromReveals(['deadbeef', '01234567'], 'crate:1'), seedFromReveals(['01234567', 'deadbeef'], 'crate:1'));
  assert.notEqual(seedFromReveals(['deadbeef', '01234567'], 'crate:1'), seedFromReveals(['deadbeef', '01234567'], 'crate:2'));
});

test('equipped skins are shared state and unknown skins are ignored', function () {
  var s = initialState();
  s = reduce(s, { payload: { type: 'skin', addr: 'a', skinId: 'goldleaf' } });
  s = reduce(s, { payload: { type: 'skin', addr: 'b', skinId: 'nope' } });
  assert.deepEqual(s.skins, { a: 'goldleaf' });
  s = reduce(s, { payload: { type: 'skin', addr: 'a', skinId: '' } });
  assert.deepEqual(s.skins, {});
});
