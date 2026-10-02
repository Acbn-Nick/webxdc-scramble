// Matchmaking bot tests against a fake Delta Chat RPC: run with `npm test`

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchBot, parseCommand } from '../bot.js';

function fakeRpc() {
  var rpc = { calls: [], texts: [], nextId: 100, msgs: {}, chats: {} };
  rpc.getMessage = async function (acc, id) { return rpc.msgs[id]; };
  rpc.getBasicChatInfo = async function (acc, id) { return rpc.chats[id]; };
  rpc.miscSendTextMessage = async function (acc, chatId, text) { rpc.texts.push({ chatId: chatId, text: text }); return rpc.nextId++; };
  ['createGroupChat', 'addContactToChat', 'sendMsg', 'sendWebxdcStatusUpdate'].forEach(function (name) {
    rpc[name] = async function () {
      rpc.calls.push([name].concat(Array.prototype.slice.call(arguments, 1)));
      return rpc.nextId++;
    };
  });
  // A player with contact id `from` writes `text` in their 1:1 chat with the bot
  rpc.incoming = function (from, name, text) {
    var id = rpc.nextId++;
    rpc.chats[1000 + from] = { chatType: 'Single' };
    rpc.msgs[id] = { fromId: from, text: text, isInfo: false, isBot: false, sender: { displayName: name, address: name + '@x' } };
    return [1000 + from, id];
  };
  return rpc;
}

test('parseCommand understands play sizes, cancel and anything else', function () {
  assert.deepEqual(parseCommand('/play 3'), { cmd: 'play', size: 3 });
  assert.deepEqual(parseCommand('Play'), { cmd: 'play', size: 2 });
  assert.deepEqual(parseCommand(' 4 '), { cmd: 'play', size: 4 });
  assert.deepEqual(parseCommand('/cancel'), { cmd: 'cancel' });
  assert.deepEqual(parseCommand('/play 7'), { cmd: 'help' });
  assert.deepEqual(parseCommand('hello'), { cmd: 'help' });
});

test('two players who ask for a 2-player game get a group with the game', async function () {
  var rpc = fakeRpc();
  var bot = new MatchBot(rpc, 1, { xdcPath: '/x/scramble.xdc' });
  await bot.handleIncoming.apply(bot, rpc.incoming(11, 'Ann', '/play 2'));
  assert.match(rpc.texts.pop().text, /queue for a 2-player game \(1\/2 waiting\)/);
  assert.equal(rpc.calls.length, 0);
  await bot.handleIncoming.apply(bot, rpc.incoming(12, 'Bob', 'play 2'));

  var names = rpc.calls.map(function (c) { return c[0]; });
  assert.deepEqual(names, ['createGroupChat', 'addContactToChat', 'addContactToChat', 'sendMsg', 'sendWebxdcStatusUpdate']);
  var group = rpc.calls[0];
  assert.match(group[1], /^Scramble: (Ann vs Bob|Bob vs Ann)$/);
  assert.deepEqual([rpc.calls[1][2], rpc.calls[2][2]].sort(), [11, 12]);
  assert.equal(rpc.calls[3][2].file, '/x/scramble.xdc');
  var update = JSON.parse(rpc.calls[4][2]).payload;
  assert.equal(update.type, 'table');
  assert.equal(update.maxPlayers, 2);
  assert.match(update.matchId, /^[0-9a-f]{12}$/);
  // Both players hear about it in their own chat
  assert.deepEqual(rpc.texts.slice(-2).map(function (t) { return t.chatId; }).sort(), [1011, 1012]);
});

test('cancel leaves the queue and other messages get help', async function () {
  var rpc = fakeRpc();
  var bot = new MatchBot(rpc, 1, { xdcPath: 'x' });
  await bot.handleIncoming.apply(bot, rpc.incoming(11, 'Ann', '/play 3'));
  await bot.handleIncoming.apply(bot, rpc.incoming(11, 'Ann', '/cancel'));
  assert.equal(rpc.texts.pop().text, 'You left the queue.');
  assert.equal(bot.matchmaker.waiting(3), 0);
  await bot.handleIncoming.apply(bot, rpc.incoming(11, 'Ann', 'hi'));
  assert.match(rpc.texts.pop().text, /\/play 2/);
});

test('group messages and system messages are ignored', async function () {
  var rpc = fakeRpc();
  var bot = new MatchBot(rpc, 1, { xdcPath: 'x' });
  var m = rpc.incoming(11, 'Ann', '/play 2');
  rpc.chats[m[0]] = { chatType: 'Group' };
  await bot.handleIncoming.apply(bot, m);
  var info = rpc.incoming(12, 'Bob', '/play 2');
  rpc.msgs[info[1]].isInfo = true;
  await bot.handleIncoming.apply(bot, info);
  assert.equal(rpc.texts.length, 0);
  assert.equal(bot.matchmaker.waiting(2), 0);
});
