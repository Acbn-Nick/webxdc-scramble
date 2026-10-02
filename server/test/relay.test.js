// Relay and matchmaker tests: run with `npm test` (node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Relay } from '../relay.js';
import { Matchmaker } from '../matchmaker.js';

var TOKEN = 'x'.repeat(32);

function client(relay, id, name, token) {
  var c = { inbox: [], addr: id + '0000@web' };
  c.session = relay.connect(function (m) { c.inbox.push(m); });
  c.say = function (m) { c.session.message(m); };
  c.say({ t: 'hello', addr: c.addr, token: token || TOKEN, name: name || id });
  c.updates = function () {
    return c.inbox.filter(function (m) { return m.t === 'update'; }).map(function (m) { return m.payload; });
  };
  c.last = function (t) {
    return c.inbox.filter(function (m) { return m.t === t; }).pop();
  };
  return c;
}

test('matchmaker seats a table once enough players queue', function () {
  var mm = new Matchmaker();
  assert.equal(mm.enqueue('a', 'A', 3), null);
  assert.equal(mm.enqueue('b', 'B', 2), null);
  assert.equal(mm.enqueue('c', 'C', 3), null);
  assert.equal(mm.waiting(3), 2);
  var table = mm.enqueue('d', 'D', 3);
  assert.deepEqual(table.map(function (p) { return p.addr; }).sort(), ['a', 'c', 'd']);
  assert.equal(mm.waiting(3), 0);
  assert.equal(mm.queuedFor('b'), 2);
});

test('requeueing moves a player and cancel removes them', function () {
  var mm = new Matchmaker();
  mm.enqueue('a', 'A', 2);
  mm.enqueue('a', 'A', 4);
  assert.equal(mm.waiting(2), 0);
  assert.equal(mm.waiting(4), 1);
  assert.equal(mm.cancel('a'), true);
  assert.equal(mm.waiting(4), 0);
  assert.equal(mm.cancel('a'), false);
});

test('hello binds an address to its token', function () {
  var r = new Relay();
  var a = client(r, 'aaaa');
  assert.equal(a.last('welcome').addr, 'aaaa0000@web');
  var imposter = client(r, 'aaaa', 'evil', 'y'.repeat(32));
  assert.equal(imposter.last('error').error, 'identity taken');
  var bad = client(r, 'NOPE');
  assert.equal(bad.last('error').error, 'bad identity');
});

test('two queued players are matched into a fresh room', function () {
  var r = new Relay();
  var a = client(r, 'aaaa', 'Ann');
  var b = client(r, 'bbbb', 'Bob');
  a.say({ t: 'send', payload: { type: 'skin', addr: a.addr, skinId: 'neon' } });
  a.say({ t: 'queue', size: 2 });
  assert.deepEqual(a.last('queue'), { t: 'queue', size: 2, waiting: 1 });
  b.say({ t: 'queue', size: 2 });

  var room = a.last('matched').room;
  assert.equal(b.last('matched').room, room);
  var matched = b.updates().filter(function (p) { return p.type === 'matched'; })[0];
  assert.equal(matched.matchId, room);
  assert.deepEqual(matched.playerOrder.slice().sort(), [a.addr, b.addr]);
  assert.equal(matched.players[a.addr].name, 'Ann');
  // Bob sees Ann's skin in the new room before the game starts
  assert.ok(b.updates().some(function (p) { return p.type === 'skin' && p.addr === a.addr; }));

  // Moves fan out to both players with per-room serials
  a.say({ t: 'send', payload: { type: 'commit', matchId: room, addr: a.addr, hash: 'h' } });
  var last = b.inbox[b.inbox.length - 1];
  assert.equal(last.room, room);
  assert.equal(last.payload.type, 'commit');
  assert.equal(last.serial, r.rooms.get(room).log.length);
});

test('the relay rejects updates for other players and unjoined rooms', function () {
  var r = new Relay();
  var a = client(r, 'aaaa');
  var b = client(r, 'bbbb');
  a.say({ t: 'send', payload: { type: 'create', matchId: 'abcdef012345', addr: b.addr, name: 'x' } });
  assert.equal(a.last('error').error, 'not your update');
  a.say({ t: 'send', payload: { type: 'create', matchId: 'abcdef012345', addr: a.addr, name: 'A', maxPlayers: 2 } });
  b.say({ t: 'send', payload: { type: 'join', matchId: 'abcdef012345', addr: b.addr, name: 'B' } });
  assert.equal(b.last('error').error, 'watch the game first');
  b.say({ t: 'send', payload: { type: 'matched', matchId: 'ffffffffffff', playerOrder: [], players: {} } });
  assert.equal(b.last('error').error, 'not allowed');
  b.say({ t: 'send', payload: { type: 'place', addr: b.addr } });
  assert.equal(b.last('error').error, 'update needs a matchId');
});

test('an invite link lets a player watch and then join', function () {
  var r = new Relay();
  var a = client(r, 'aaaa');
  var b = client(r, 'bbbb');
  a.say({ t: 'send', payload: { type: 'create', matchId: 'abcdef012345', addr: a.addr, name: 'A', maxPlayers: 2 } });
  b.say({ t: 'watch', room: 'abcdef012345' });
  assert.equal(b.updates()[0].type, 'create');
  b.say({ t: 'send', payload: { type: 'join', matchId: 'abcdef012345', addr: b.addr, name: 'B' } });
  assert.equal(a.updates().pop().type, 'join');
  b.say({ t: 'watch', room: '000000000000' });
  assert.equal(b.last('error').error, 'no such game');
});

test('a reconnecting player gets every room replayed', function () {
  var r = new Relay();
  var a = client(r, 'aaaa');
  var b = client(r, 'bbbb');
  a.say({ t: 'queue', size: 2 });
  b.say({ t: 'queue', size: 2 });
  b.session.close();
  var again = client(r, 'bbbb');
  assert.equal(again.updates()[0].type, 'matched');
  assert.equal(again.last('synced').t, 'synced');
});

test('leaving the site drops a player from the queue', function () {
  var r = new Relay();
  var a = client(r, 'aaaa');
  a.say({ t: 'queue', size: 2 });
  a.session.close();
  var b = client(r, 'bbbb');
  b.say({ t: 'queue', size: 2 });
  assert.equal(b.last('matched'), undefined);
  assert.equal(b.last('queue').waiting, 1);
});

test('state survives a restart through the data file', function () {
  var file = join(mkdtempSync(join(tmpdir(), 'scramble-')), 'data.json');
  var r = new Relay({ dataFile: file });
  var a = client(r, 'aaaa');
  var b = client(r, 'bbbb');
  a.say({ t: 'queue', size: 2 });
  b.say({ t: 'queue', size: 2 });
  clearTimeout(r.saveTimer);
  r.save();
  var r2 = new Relay({ dataFile: file });
  var back = client(r2, 'aaaa');
  assert.equal(back.updates()[0].type, 'matched');
  var imposter = client(r2, 'bbbb', 'x', 'z'.repeat(32));
  assert.equal(imposter.last('error').error, 'identity taken');
});
