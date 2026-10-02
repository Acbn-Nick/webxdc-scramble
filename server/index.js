// index.js - Scramble web server: serves the built app and runs the
// matchmaking relay on /ws
//
//   node index.js [--port 8787] [--static ../dist] [--data scramble-data.json]
//
// PORT, SCRAMBLE_STATIC and SCRAMBLE_DATA work as environment variables too.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Relay } from './relay.js';

var here = fileURLToPath(new URL('.', import.meta.url));

function arg(name, env, fallback) {
  var i = process.argv.indexOf('--' + name);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[env] || fallback;
}

var port = Number(arg('port', 'PORT', 8787));
var staticDir = resolve(here, arg('static', 'SCRAMBLE_STATIC', '../dist'));
var dataFile = arg('data', 'SCRAMBLE_DATA', null);

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bin': 'application/octet-stream',
  '.xdc': 'application/zip',
};

var server = createServer(function (req, res) {
  var path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (path === '/webxdc.js') {
    // Delta Chat injects webxdc.js; on the web the app's own transport takes over
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    return res.end('// Scramble web embed: no webxdc runtime here, the app connects to /ws\n');
  }
  if (path.endsWith('/')) path += 'index.html';
  var file = resolve(join(staticDir, path));
  if (file !== staticDir && !file.startsWith(staticDir + sep)) {
    res.writeHead(403);
    return res.end();
  }
  readFile(file).then(function (body) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  }, function () {
    res.writeHead(404);
    res.end('not found');
  });
});

var relay = new Relay({ dataFile: dataFile, log: function (s) { console.log(s); } });
var wss = new WebSocketServer({ server: server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', function (ws) {
  var session = relay.connect(function (msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });
  ws.isAlive = true;
  ws.on('pong', function () { ws.isAlive = true; });
  ws.on('message', function (data) {
    var msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    session.message(msg);
  });
  ws.on('close', session.close);
});

// Drop sockets that stopped answering, so they leave the queue
var heartbeat = setInterval(function () {
  wss.clients.forEach(function (ws) {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function shutdown() {
  clearInterval(heartbeat);
  if (dataFile) relay.save();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, function () {
  console.log('Scramble server on http://localhost:' + port + ' (static ' + staticDir + ', relay /ws' + (dataFile ? ', data ' + dataFile : '') + ')');
});
