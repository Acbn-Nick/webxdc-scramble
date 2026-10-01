// relay.js - Update relay and matchmaking for the web embed
//
// Plays the part Delta Chat plays inside a chat: every match is a room with
// an append-only update log that is fanned out to the room's members. The
// game rules stay in the clients' reducer; the relay only checks who may
// write where. Unlike a chat, it also checks that an update's `addr` is the
// sender's own, so web players can't move for each other.
//
// Socket-agnostic: index.js wires it to WebSockets, tests drive it directly.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Matchmaker, SIZES } from './matchmaker.js';

var ADDR_RE = /^[0-9a-f]{8,32}@web$/;
var ROOM_RE = /^[0-9a-f]{8,32}$/;
var MAX_PAYLOAD = 32 * 1024;
var MAX_LOG = 5000;
var MAX_ROOMS_PER_ADDR = 500;
// Updates that belong to the player rather than a match; they reach every
// room the player is in, and seed the rooms the matchmaker creates for them
var UNSCOPED_TYPES = ['skin'];

function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function cleanName(name, addr) {
  name = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24);
  return name || 'Player ' + addr.slice(0, 4);
}

export class Relay {
  constructor(opts) {
    opts = opts || {};
    this.dataFile = opts.dataFile || null;
    this.log = opts.log || function () {};
    this.matchmaker = new Matchmaker();
    this.users = new Map();  // addr -> {tokenHash, name, rooms: Set, unscoped: {type: payload}}
    this.rooms = new Map();  // id -> {id, members: Set, log: []}
    this.conns = new Map();  // addr -> Set of connections
    this.saveTimer = null;
    if (this.dataFile) this.load();
  }

  // --- connections ---

  // `send(msg)` delivers one JSON-able message to the client.
  // Returns {message(obj), close()} for the socket layer to call.
  connect(send) {
    var relay = this;
    var conn = { send: send, addr: null };
    return {
      message: function (msg) {
        try {
          relay.handle(conn, msg);
        } catch (e) {
          send({ t: 'error', error: 'bad request' });
        }
      },
      close: function () { relay.disconnect(conn); },
    };
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (!conn.addr) return conn.send({ t: 'error', error: 'say hello first' });
    if (msg.t === 'send') return this.sendUpdate(conn, msg.payload);
    if (msg.t === 'watch') return this.watch(conn, msg.room);
    if (msg.t === 'queue') return this.queue(conn, msg.size);
    if (msg.t === 'cancel') return this.cancel(conn);
    if (msg.t === 'ping') return conn.send({ t: 'pong' });
  }

  hello(conn, msg) {
    if (conn.addr) return;
    var addr = String(msg.addr || '');
    var token = String(msg.token || '');
    if (!ADDR_RE.test(addr) || token.length < 32) return conn.send({ t: 'error', error: 'bad identity' });
    var user = this.users.get(addr);
    if (user && user.tokenHash !== sha256(token)) return conn.send({ t: 'error', error: 'identity taken' });
    if (!user) {
      // First come, first served: the token is the player's password from now on
      user = { tokenHash: sha256(token), name: '', rooms: new Set(), unscoped: {} };
      this.users.set(addr, user);
    }
    user.name = cleanName(msg.name, addr);
    conn.addr = addr;
    if (!this.conns.has(addr)) this.conns.set(addr, new Set());
    this.conns.get(addr).add(conn);
    this.dirty();

    conn.send({ t: 'welcome', addr: addr, name: user.name });
    var self = this;
    user.rooms.forEach(function (id) { self.stream(conn, self.rooms.get(id), 0); });
    conn.send({ t: 'synced' });
    var size = this.matchmaker.queuedFor(addr);
    if (size) conn.send({ t: 'queue', size: size, waiting: this.matchmaker.waiting(size) });
  }

  disconnect(conn) {
    if (!conn.addr) return;
    var set = this.conns.get(conn.addr);
    if (!set) return;
    set.delete(conn);
    if (set.size > 0) return;
    this.conns.delete(conn.addr);
    // Nobody left to play: don't seat an absent player at a table
    var size = this.matchmaker.queuedFor(conn.addr);
    if (this.matchmaker.cancel(conn.addr)) this.queueChanged(size);
  }

  // --- rooms ---

  stream(conn, room, from) {
    for (var i = from; i < room.log.length; i++) {
      conn.send({ t: 'update', room: room.id, serial: i + 1, payload: room.log[i] });
    }
  }

  addMember(room, addr) {
    var user = this.users.get(addr);
    if (room.members.has(addr)) return true;
    if (user.rooms.size >= MAX_ROOMS_PER_ADDR) return false;
    room.members.add(addr);
    user.rooms.add(room.id);
    var self = this;
    // Catch every open tab of this player up on the room
    this.eachConn(addr, function (c) { self.stream(c, room, 0); });
    return true;
  }

  createRoom(id) {
    var room = { id: id, members: new Set(), log: [] };
    this.rooms.set(id, room);
    return room;
  }

  append(room, payload) {
    if (room.log.length >= MAX_LOG) return false;
    room.log.push(payload);
    var serial = room.log.length;
    var self = this;
    room.members.forEach(function (addr) {
      self.eachConn(addr, function (c) {
        c.send({ t: 'update', room: room.id, serial: serial, payload: payload });
      });
    });
    this.dirty();
    return true;
  }

  eachConn(addr, fn) {
    var set = this.conns.get(addr);
    if (set) set.forEach(fn);
  }

  // Start following a room by its id (an invite link); spectators see every
  // update and may then send a join
  watch(conn, id) {
    id = String(id || '');
    var room = ROOM_RE.test(id) && this.rooms.get(id);
    if (!room) return conn.send({ t: 'error', error: 'no such game' });
    if (!this.addMember(room, conn.addr)) return conn.send({ t: 'error', error: 'too many games' });
    conn.send({ t: 'watched', room: room.id });
  }

  sendUpdate(conn, payload) {
    var addr = conn.addr;
    var reject = function (why) { conn.send({ t: 'error', error: why }); };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reject('bad update');
    if (JSON.stringify(payload).length > MAX_PAYLOAD) return reject('update too large');
    if (payload.addr !== undefined && payload.addr !== addr) return reject('not your update');
    // Only the matchmaker seats players
    if (payload.type === 'matched') return reject('not allowed');

    var user = this.users.get(addr);
    if (payload.matchId === undefined) {
      if (UNSCOPED_TYPES.indexOf(payload.type) < 0) return reject('update needs a matchId');
      user.unscoped[payload.type] = payload;
      var self = this;
      // A personal room carries it back to this player even before any game
      var own = this.rooms.get(addr) || this.createRoom(addr);
      this.addMember(own, addr);
      user.rooms.forEach(function (id) { self.append(self.rooms.get(id), payload); });
      return;
    }

    var id = String(payload.matchId);
    var room = this.rooms.get(id);
    if (!room) {
      if (payload.type !== 'create' || !ROOM_RE.test(id)) return reject('no such game');
      room = this.createRoom(id);
    }
    if (!room.members.has(addr)) {
      // Joining needs the room first (create, watch, or the matchmaker)
      if (payload.type !== 'create' || room.log.length) return reject('watch the game first');
      if (!this.addMember(room, addr)) return reject('too many games');
    }
    if (!this.append(room, payload)) reject('game log full');
  }

  // --- matchmaking ---

  queue(conn, size) {
    size = Number(size);
    if (SIZES.indexOf(size) < 0) return conn.send({ t: 'error', error: 'bad table size' });
    var user = this.users.get(conn.addr);
    var before = this.matchmaker.queuedFor(conn.addr);
    var table = this.matchmaker.enqueue(conn.addr, user.name, size);
    if (before && before !== size) this.queueChanged(before);
    if (!table) return this.queueChanged(size);
    this.seat(table);
    this.queueChanged(size);
  }

  cancel(conn) {
    var size = this.matchmaker.queuedFor(conn.addr);
    this.matchmaker.cancel(conn.addr);
    this.eachConn(conn.addr, function (c) { c.send({ t: 'queue', size: null }); });
    if (size) this.queueChanged(size);
  }

  queueChanged(size) {
    var waiting = this.matchmaker.waiting(size);
    var self = this;
    this.matchmaker.queues[size].forEach(function (p) {
      self.eachConn(p.addr, function (c) { c.send({ t: 'queue', size: size, waiting: waiting }); });
    });
  }

  seat(table) {
    var id = randomBytes(6).toString('hex');
    var room = this.createRoom(id);
    var players = {};
    var order = [];
    var self = this;
    table.forEach(function (p) {
      order.push(p.addr);
      players[p.addr] = { name: p.name };
    });
    // Equipped skins first, so the opponents' tiles look right from move one
    table.forEach(function (p) {
      var unscoped = self.users.get(p.addr).unscoped;
      Object.keys(unscoped).forEach(function (k) { room.log.push(unscoped[k]); });
    });
    table.forEach(function (p) { self.addMember(room, p.addr); });
    this.append(room, { type: 'matched', matchId: id, playerOrder: order, players: players });
    table.forEach(function (p) {
      self.eachConn(p.addr, function (c) {
        c.send({ t: 'queue', size: null });
        c.send({ t: 'matched', room: id });
      });
    });
    this.log('matched ' + id + ': ' + order.join(', '));
    return id;
  }

  // --- persistence (optional JSON snapshot) ---

  dirty() {
    if (!this.dataFile || this.saveTimer) return;
    var self = this;
    this.saveTimer = setTimeout(function () { self.saveTimer = null; self.save(); }, 500);
  }

  save() {
    var users = {};
    this.users.forEach(function (u, addr) {
      users[addr] = { tokenHash: u.tokenHash, name: u.name, rooms: Array.from(u.rooms), unscoped: u.unscoped };
    });
    var rooms = {};
    this.rooms.forEach(function (r, id) { rooms[id] = { members: Array.from(r.members), log: r.log }; });
    var tmp = this.dataFile + '.tmp';
    writeFileSync(tmp, JSON.stringify({ version: 1, users: users, rooms: rooms }));
    renameSync(tmp, this.dataFile);
  }

  load() {
    var data;
    try {
      data = JSON.parse(readFileSync(this.dataFile, 'utf8'));
    } catch (e) {
      return;
    }
    var self = this;
    Object.keys(data.users || {}).forEach(function (addr) {
      var u = data.users[addr];
      self.users.set(addr, { tokenHash: u.tokenHash, name: u.name, rooms: new Set(u.rooms), unscoped: u.unscoped || {} });
    });
    Object.keys(data.rooms || {}).forEach(function (id) {
      var r = data.rooms[id];
      self.rooms.set(id, { id: id, members: new Set(r.members), log: r.log });
    });
  }
}
