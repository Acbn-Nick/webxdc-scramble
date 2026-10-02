// Reducer tests: run with `npm test` (node --test)

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, reduce, getSummary, LEGACY_MATCH_ID } from '../src/state.js';
import { loadDictionary } from '../src/dict.js';
import { sha256sync, hexToBytes } from '../src/crypto.js';

before(function () {
  var buf = readFileSync(new URL('../public/dict.bin', import.meta.url));
  globalThis.fetch = function () {
    return Promise.resolve({ arrayBuffer: function () { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } });
  };
  return loadDictionary();
});

function apply(state, payloads) {
  for (var i = 0; i < payloads.length; i++) state = reduce(state, { payload: payloads[i] });
  return state;
}

var NONCES = { a: '01020304', b: 'a0b0c0d0', c: 'deadbeef', d: '0badf00d' };

function seed(state, matchId, addrs) {
  var ups = [];
  addrs.forEach(function (a) { ups.push({ type: 'commit', matchId: matchId, addr: a, hash: sha256sync(hexToBytes(NONCES[a])) }); });
  addrs.forEach(function (a) { ups.push({ type: 'reveal', matchId: matchId, addr: a, nonce: NONCES[a] }); });
  return apply(state, ups);
}

function lobby(id, players, max) {
  var ups = [{ type: 'create', matchId: id, addr: players[0], name: players[0].toUpperCase(), maxPlayers: max }];
  for (var i = 1; i < players.length; i++) ups.push({ type: 'join', matchId: id, addr: players[i], name: players[i].toUpperCase() });
  return apply(initialState(), ups);
}

test('create and join respect maxPlayers', function () {
  var s = lobby('m1', ['a', 'b', 'c'], 2);
  assert.deepEqual(s.matches.m1.playerOrder, ['a', 'b']);
  assert.equal(s.matches.m1.host, 'a');
  assert.equal(getSummary(s), 'Games: 1 open');
});

test('maxPlayers is clamped to 2..4', function () {
  var s = apply(initialState(), [
    { type: 'create', matchId: 'x', addr: 'a', name: 'A', maxPlayers: 9 },
    { type: 'create', matchId: 'y', addr: 'a', name: 'A', maxPlayers: 1 },
  ]);
  assert.equal(s.matches.x.maxPlayers, 4);
  assert.equal(s.matches.y.maxPlayers, 2);
});

test('duplicate create is ignored', function () {
  var s = apply(lobby('m1', ['a'], 2), [{ type: 'create', matchId: 'm1', addr: 'b', name: 'B', maxPlayers: 4 }]);
  assert.equal(s.matches.m1.host, 'a');
  assert.equal(s.order.length, 1);
});

test('matches are independent', function () {
  var s = lobby('m1', ['a', 'b'], 2);
  s = apply(s, [{ type: 'create', matchId: 'm2', addr: 'c', name: 'C', maxPlayers: 3 }, { type: 'start', matchId: 'm1', addr: 'a' }]);
  assert.equal(s.matches.m1.phase, 'seeding');
  assert.equal(s.matches.m2.phase, 'waiting');
  assert.deepEqual(s.order, ['m1', 'm2']);
});

test('leave hands off host and last leave removes the match', function () {
  var s = apply(lobby('m1', ['a', 'b'], 3), [{ type: 'leave', matchId: 'm1', addr: 'a' }]);
  assert.equal(s.matches.m1.host, 'b');
  s = apply(s, [{ type: 'leave', matchId: 'm1', addr: 'b' }]);
  assert.equal(s.matches.m1, undefined);
  assert.deepEqual(s.order, []);
});

test('cannot start alone', function () {
  var s = apply(lobby('m1', ['a'], 4), [{ type: 'start', matchId: 'm1', addr: 'a' }]);
  assert.equal(s.matches.m1.phase, 'waiting');
});

test('4-player commit-reveal deals every rack from one shared seed', function () {
  var s = apply(lobby('m1', ['a', 'b', 'c', 'd'], 4), [{ type: 'start', matchId: 'm1', addr: 'a' }]);
  var ups = ['a', 'b', 'c', 'd'].map(function (a) {
    return { type: 'commit', matchId: 'm1', addr: a, hash: sha256sync(hexToBytes(NONCES[a])) };
  });
  ['a', 'b', 'c'].forEach(function (a) { ups.push({ type: 'reveal', matchId: 'm1', addr: a, nonce: NONCES[a] }); });
  s = apply(s, ups);
  assert.equal(s.matches.m1.phase, 'seeding');
  s = apply(s, [{ type: 'reveal', matchId: 'm1', addr: 'd', nonce: NONCES.d }]);
  var m = s.matches.m1;
  assert.equal(m.phase, 'playing');
  assert.equal(m.turn, 'a');
  ['a', 'b', 'c', 'd'].forEach(function (a) { assert.equal(m.racks[a].length, 7); });
  assert.equal(m.bag.length, 100 - 28);
  assert.equal(m.seed, (0x01020304 ^ 0xa0b0c0d0 ^ 0xdeadbeef ^ 0x0badf00d) >>> 0);
});

function playing(players) {
  var s = apply(lobby('m1', players, players.length), [{ type: 'start', matchId: 'm1', addr: players[0] }]);
  return seed(s, 'm1', players);
}

test('turns rotate through 3 players and the game ends when all pass', function () {
  var s = playing(['a', 'b', 'c']);
  s = apply(s, [
    { type: 'pass', matchId: 'm1', addr: 'a', moveNumber: 1 },
    { type: 'pass', matchId: 'm1', addr: 'b', moveNumber: 2 },
  ]);
  assert.equal(s.matches.m1.turn, 'c');
  assert.equal(s.matches.m1.phase, 'playing');
  s = apply(s, [{ type: 'pass', matchId: 'm1', addr: 'c', moveNumber: 3 }]);
  assert.equal(s.matches.m1.phase, 'finished');
  assert.equal(s.matches.m1.gameOverReason, 'consecutivePasses');
});

test('resigning in a 3-player game skips that player; last one standing wins', function () {
  var s = playing(['a', 'b', 'c']);
  s = apply(s, [{ type: 'resign', matchId: 'm1', addr: 'a' }]);
  var m = s.matches.m1;
  assert.equal(m.phase, 'playing');
  assert.equal(m.turn, 'b');
  s = apply(s, [
    { type: 'pass', matchId: 'm1', addr: 'b', moveNumber: 2 },
    { type: 'pass', matchId: 'm1', addr: 'c', moveNumber: 3 },
  ]);
  // Two active players passed: game over
  assert.equal(s.matches.m1.phase, 'finished');

  s = playing(['a', 'b', 'c']);
  s = apply(s, [{ type: 'resign', matchId: 'm1', addr: 'b' }, { type: 'resign', matchId: 'm1', addr: 'a' }]);
  assert.equal(s.matches.m1.phase, 'finished');
  assert.equal(s.matches.m1.winner, 'c');
});

test('placing a word scores and passes the turn', function () {
  var s = playing(['a', 'b']);
  s.matches.m1.racks.a = [
    { letter: 'C', value: 3, id: 1 }, { letter: 'A', value: 1, id: 2 }, { letter: 'T', value: 1, id: 3 },
  ];
  s = apply(s, [{ type: 'place', matchId: 'm1', addr: 'a', moveNumber: 1, tiles: [
    { rackIndex: 0, row: 7, col: 6 }, { rackIndex: 1, row: 7, col: 7 }, { rackIndex: 2, row: 7, col: 8 },
  ] }]);
  var m = s.matches.m1;
  assert.equal(m.players.a.score, 10);
  assert.equal(m.turn, 'b');
  assert.equal(m.board[7 * 15 + 7].letter, 'A');
  assert.equal(m.board[7 * 15 + 7].by, 'a');
});

test('rematch resets scores and resignations', function () {
  var s = playing(['a', 'b']);
  s = apply(s, [{ type: 'resign', matchId: 'm1', addr: 'a' }, { type: 'newgame', matchId: 'm1', addr: 'b' }]);
  var m = s.matches.m1;
  assert.equal(m.phase, 'waiting');
  assert.equal(m.gameNumber, 1);
  assert.equal(m.gameHistory[0].winner, 'b');
  assert.equal(m.players.a.resigned, undefined);
});

test('updates without matchId replay into the legacy match', function () {
  var s = apply(initialState(), [
    { type: 'join', addr: 'a', name: 'A' },
    { type: 'join', addr: 'b', name: 'B' },
    { type: 'start', addr: 'a' },
  ]);
  var m = s.matches[LEGACY_MATCH_ID];
  assert.equal(m.maxPlayers, 2);
  assert.equal(m.phase, 'seeding');
});
