// matchmaker.js - Queue players by table size and seat them in groups
//
// Transport-agnostic: the WebSocket relay uses it today, and a Delta Chat
// bot can drive the same queue later.

import { randomInt } from 'node:crypto';

export var SIZES = [2, 3, 4];

export class Matchmaker {
  constructor() {
    this.queues = {};        // size -> [{addr, name, since}]
    this.where = new Map();  // addr -> size it is queued for
    for (var i = 0; i < SIZES.length; i++) this.queues[SIZES[i]] = [];
  }

  // Queue a player. Returns a table [{addr, name}] in random seat order when
  // this player completes one, otherwise null.
  enqueue(addr, name, size) {
    size = Number(size);
    if (SIZES.indexOf(size) < 0) throw new Error('bad size');
    this.cancel(addr);
    var q = this.queues[size];
    q.push({ addr: addr, name: name, since: Date.now() });
    this.where.set(addr, size);
    if (q.length < size) return null;
    var table = q.splice(0, size);
    for (var i = 0; i < table.length; i++) this.where.delete(table[i].addr);
    shuffle(table);
    return table.map(function (p) { return { addr: p.addr, name: p.name }; });
  }

  cancel(addr) {
    var size = this.where.get(addr);
    if (size === undefined) return false;
    this.queues[size] = this.queues[size].filter(function (p) { return p.addr !== addr; });
    this.where.delete(addr);
    return true;
  }

  queuedFor(addr) {
    var size = this.where.get(addr);
    return size === undefined ? null : size;
  }

  waiting(size) {
    return this.queues[size] ? this.queues[size].length : 0;
  }
}

// Fisher-Yates with a CSPRNG, so nobody can predict who moves first
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = randomInt(i + 1);
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
}
