// transport.js - Picks how updates travel, before anything reads window.webxdc
//
// Inside Delta Chat (or the dev shim) window.webxdc already exists and the
// chat carries the updates. Anywhere else the app is a web embed: this module
// installs a webxdc-shaped object backed by the Scramble server's WebSocket
// relay, which also runs the matchmaking queue.
//
// Relay address: ?relay=wss://host/ws, else <meta name="scramble-relay">,
// else /ws on the page's own origin.

var params = new URLSearchParams(location.search);

export var transport = window.webxdc ? nativeTransport() : relayTransport(relayUrl());

function nativeTransport() {
  return {
    kind: 'native',
    matchmaking: false,
    on: function () {},
    queue: function () {},
    cancel: function () {},
    watch: function () {},
  };
}

function relayUrl() {
  var p = params.get('relay');
  if (p && /^wss?:\/\//.test(p)) return p;
  var meta = document.querySelector('meta[name="scramble-relay"]');
  if (meta && meta.content) return meta.content;
  if (!/^https?:$/.test(location.protocol)) return null;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function randomHex(bytes) {
  var a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  var s = '';
  for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
  return s;
}

// The relay knows a player by a random address plus a secret token kept in
// this browser. ?player=name keeps a separate identity per name, so one
// browser can be several players while testing.
function loadIdentity() {
  var player = params.get('player');
  var key = 'scramble-relay-identity' + (player ? '-' + player : '');
  var id = null;
  try { id = JSON.parse(localStorage.getItem(key)); } catch (e) {}
  if (!id || !id.addr || !id.token) {
    id = { addr: randomHex(8) + '@web', token: randomHex(32) };
  }
  if (player) id.name = player;
  if (!id.name) id.name = 'Player ' + id.addr.slice(0, 4).toUpperCase();
  try { localStorage.setItem(key, JSON.stringify(id)); } catch (e) {}
  return id;
}

function relayTransport(url) {
  var id = loadIdentity();
  var ws = null;
  var online = false;
  var retry = 1000;
  var outbox = [];        // messages sent while offline
  var log = [];           // every update received, in arrival order
  var seen = {};          // room -> highest serial received
  var listener = null;
  var delivered = 0;
  var synced = null;
  var syncedResolve = null;
  var handlers = [];
  var watching = {};      // rooms to (re)watch on every connect

  synced = new Promise(function (resolve) { syncedResolve = resolve; });

  function emit(ev) {
    for (var i = 0; i < handlers.length; i++) handlers[i](ev);
  }

  function deliver() {
    if (!listener) return;
    while (delivered < log.length) {
      var i = delivered++;
      listener({ serial: i + 1, max_serial: log.length, payload: log[i] });
    }
  }

  function raw(msg) {
    if (online && ws.readyState === 1) ws.send(JSON.stringify(msg));
    else outbox.push(msg);
  }

  function connect() {
    if (!url) {
      emit({ t: 'status', online: false, error: 'No matchmaking server configured' });
      if (syncedResolve) syncedResolve();
      return;
    }
    ws = new WebSocket(url);
    ws.onopen = function () {
      retry = 1000;
      ws.send(JSON.stringify({ t: 'hello', addr: id.addr, token: id.token, name: id.name }));
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'welcome') {
        online = true;
        api.webxdc.selfName = msg.name;
        Object.keys(watching).forEach(function (room) { ws.send(JSON.stringify({ t: 'watch', room: room })); });
        var pending = outbox;
        outbox = [];
        pending.forEach(raw);
        emit({ t: 'status', online: true });
      } else if (msg.t === 'update') {
        // A reconnect replays every room; keep only what's new
        if (msg.serial <= (seen[msg.room] || 0)) return;
        seen[msg.room] = msg.serial;
        log.push(msg.payload);
        deliver();
      } else if (msg.t === 'synced') {
        if (syncedResolve) { syncedResolve(); syncedResolve = null; }
      } else if (msg.t === 'queue' || msg.t === 'matched' || msg.t === 'error' || msg.t === 'watched') {
        emit(msg);
      }
    };
    ws.onclose = function () {
      var was = online;
      online = false;
      if (was) emit({ t: 'status', online: false });
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 15000);
    };
  }

  var api = {
    kind: 'relay',
    matchmaking: true,
    // New listeners hear the current connection state right away
    on: function (cb) {
      handlers.push(cb);
      cb({ t: 'status', online: online, error: url ? null : 'No matchmaking server configured' });
    },
    queue: function (size) { raw({ t: 'queue', size: size }); },
    cancel: function () { raw({ t: 'cancel' }); },
    watch: function (room) {
      watching[room] = true;
      // While offline, the next welcome sends it
      if (online) raw({ t: 'watch', room: room });
    },
    isOnline: function () { return online; },
    webxdc: {
      selfAddr: id.addr,
      selfName: id.name,
      setUpdateListener: function (cb, startSerial) {
        listener = cb;
        delivered = startSerial || 0;
        deliver();
        return synced;
      },
      sendUpdate: function (update) {
        raw({ t: 'send', payload: update.payload });
      },
      sendToChat: function () {
        return Promise.reject(new Error('sendToChat is not available on the web'));
      },
    },
  };

  window.webxdc = api.webxdc;
  connect();
  return api;
}
