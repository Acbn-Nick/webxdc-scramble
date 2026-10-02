// bot.js - Delta Chat matchmaking bot
//
// Players message the bot ("/play 2"); once a table is full it creates a
// group chat with them, posts the Scramble .xdc there and opens an empty
// table in it with one `table` update. The players' own clients join and
// start that table (src/main.js), because only they know their webxdc
// addresses. Same queue as the web relay (matchmaker.js).
//
//   node bot.js
//
// Environment:
//   SCRAMBLE_BOT_DIR       account data directory (default ./bot-data)
//   SCRAMBLE_BOT_CHATMAIL  chatmail server the bot makes its account on,
//                          first run only (default nine.testrun.org)
//   SCRAMBLE_BOT_NAME      display name (default "Scramble Matchmaker")
//   SCRAMBLE_XDC           path to the built app (default ../dist/scramble.xdc)

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matchmaker, SIZES } from './matchmaker.js';

var HELP = [
  'Hi! I find Scramble opponents.',
  '',
  '/play 2 (or 3, 4) to join the queue for that many players',
  '/cancel to leave the queue',
  '',
  'When the table is full I make a group with everyone and the game in it.',
].join('\n');

// '/play 3', 'play 3', '3' -> {cmd: 'play', size: 3}
export function parseCommand(text) {
  var t = String(text || '').trim().toLowerCase().replace(/^\//, '');
  var m = /^(?:play|queue|find)?\s*(\d)\b/.exec(t);
  if (m && SIZES.indexOf(Number(m[1])) >= 0) return { cmd: 'play', size: Number(m[1]) };
  if (/^(?:play|queue|find)\s*$/.test(t)) return { cmd: 'play', size: 2 };
  if (/^(?:cancel|stop|leave)\b/.test(t)) return { cmd: 'cancel' };
  return { cmd: 'help' };
}

export class MatchBot {
  // rpc: the deltachat jsonrpc client (dc.rpc); xdcPath: the built .xdc
  constructor(rpc, accountId, opts) {
    this.rpc = rpc;
    this.acc = accountId;
    this.xdcPath = opts.xdcPath;
    this.log = opts.log || function () {};
    this.matchmaker = new Matchmaker();
    this.dm = new Map();  // contactId -> 1:1 chat id, for queue replies
  }

  say(chatId, text) {
    return this.rpc.miscSendTextMessage(this.acc, chatId, text);
  }

  async handleIncoming(chatId, msgId) {
    var msg = await this.rpc.getMessage(this.acc, msgId);
    if (msg.isInfo || msg.isBot || msg.fromId <= 9) return;
    var chat = await this.rpc.getBasicChatInfo(this.acc, chatId);
    // Only direct messages are commands; the game groups are the players' own
    if (chat.chatType !== 'Single') return;
    var player = String(msg.fromId);
    this.dm.set(player, chatId);
    var c = parseCommand(msg.text);

    if (c.cmd === 'cancel') {
      var was = this.matchmaker.cancel(player);
      return this.say(chatId, was ? 'You left the queue.' : "You're not in the queue. /play 2 to join it.");
    }
    if (c.cmd === 'help') return this.say(chatId, HELP);

    var name = msg.sender.displayName || msg.sender.address;
    var table = this.matchmaker.enqueue(player, name, c.size);
    if (!table) {
      var waiting = this.matchmaker.waiting(c.size);
      return this.say(chatId, "You're in the queue for a " + c.size + '-player game (' + waiting + '/' + c.size +
        ' waiting). I\'ll make a group as soon as the table is full. /cancel to leave.');
    }
    return this.seat(table);
  }

  async seat(table) {
    var names = table.map(function (p) { return p.name; });
    var matchId = randomBytes(6).toString('hex');
    var chatId = await this.rpc.createGroupChat(this.acc, 'Scramble: ' + names.join(' vs '), false);
    for (var i = 0; i < table.length; i++) {
      await this.rpc.addContactToChat(this.acc, chatId, Number(table[i].addr));
    }
    var xdcId = await this.rpc.sendMsg(this.acc, chatId, {
      text: 'Your ' + table.length + '-player match is ready. Open Scramble to play!',
      html: null, viewtype: null, file: this.xdcPath, filename: 'scramble.xdc',
      location: null, overrideSenderName: null, quotedMessageId: null, quotedText: null,
    });
    await this.rpc.sendWebxdcStatusUpdate(this.acc, xdcId,
      JSON.stringify({ payload: { type: 'table', matchId: matchId, maxPlayers: table.length } }), null);
    for (var j = 0; j < table.length; j++) {
      var dm = this.dm.get(table[j].addr);
      if (dm) await this.say(dm, 'Match found! Your game is in the new group "Scramble: ' + names.join(' vs ') + '".');
    }
    this.log('seated ' + matchId + ' in chat ' + chatId + ': ' + names.join(', '));
    return chatId;
  }
}

async function main() {
  var here = fileURLToPath(new URL('.', import.meta.url));
  var dir = resolve(process.env.SCRAMBLE_BOT_DIR || resolve(here, 'bot-data'));
  var chatmail = process.env.SCRAMBLE_BOT_CHATMAIL || 'nine.testrun.org';
  var botName = process.env.SCRAMBLE_BOT_NAME || 'Scramble Matchmaker';
  var xdcPath = resolve(process.env.SCRAMBLE_XDC || resolve(here, '../dist/scramble.xdc'));
  if (!existsSync(xdcPath)) throw new Error('No .xdc at ' + xdcPath + ': run npm run build in the repo root first');

  var { startDeltaChat } = await import('@deltachat/stdio-rpc-server');
  var dc = startDeltaChat(dir);
  var rpc = dc.rpc;
  var ids = await rpc.getAllAccountIds();
  var acc = ids[0] || await rpc.addAccount();

  if (!(await rpc.isConfigured(acc))) {
    console.log('Creating the bot account on ' + chatmail + '...');
    await rpc.batchSetConfig(acc, { bot: '1', displayname: botName, selfavatar: resolve(here, '../public/icon.png') });
    // A chatmail server hands out a fresh address to whoever asks
    await rpc.addTransportFromQr(acc, 'DCACCOUNT:https://' + chatmail + '/new');
  }
  await rpc.batchSetConfig(acc, { bot: '1', displayname: botName });
  await rpc.startIo(acc);

  var bot = new MatchBot(rpc, acc, { xdcPath: xdcPath, log: function (s) { console.log(s); } });
  dc.on('IncomingMsg', function (accountId, ev) {
    if (accountId !== acc) return;
    bot.handleIncoming(ev.chatId, ev.msgId).catch(function (e) { console.error('message failed:', e); });
  });

  var invite = await rpc.getChatSecurejoinQrCode(acc, null);
  console.log('Scramble bot is running as ' + (await rpc.getConfig(acc, 'configured_addr')));
  console.log('Players start a chat with it through this invite link:\n' + invite);

  function shutdown() { dc.close(); process.exit(0); }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(function (e) { console.error(e); process.exit(1); });
}
