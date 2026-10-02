# Scramble server

One small Node service for the **web embed** of Scramble:

- serves the built app (`../dist`) over HTTP, and
- runs a WebSocket relay on `/ws` that stands in for Delta Chat: every match
  is a room with an append-only update log, fanned out to its members, and
- runs the **matchmaking queue**: players pick 2, 3 or 4 players, press
  *Find Match*, and the server seats a full table in a fresh room.

Inside Delta Chat nothing changes: `window.webxdc` exists, the chat carries
the updates, and the app never talks to this server (a webxdc has no network
access there).

## Running it locally

```bash
npm ci && npm run build          # in the repo root: builds dist/
cd server && npm ci && npm start # http://localhost:8787
```

Open http://localhost:8787 in two browsers (or two private windows), press
*Find Match* in both, and they land in the same game. `?player=name` keeps a
separate identity per name, so one browser can also be several players.

Options (flag or environment variable):

| flag | env | default | |
|---|---|---|---|
| `--port` | `PORT` | `8787` | HTTP + WebSocket port |
| `--static` | `SCRAMBLE_STATIC` | `../dist` | directory with the built app |
| `--data` | `SCRAMBLE_DATA` | none | JSON file to keep rooms and identities across restarts; in memory only without it |

`GET /healthz` answers `ok`. Put it behind a TLS proxy for `wss://` in
production; nothing here is deployed anywhere yet.

### With the Vite dev server

Run `npm start` here and `npm run dev` in the root, then open
http://localhost:5173/?relay . The `relay` parameter turns off the
BroadcastChannel dev shim, and Vite proxies `/ws` to port 8787.

### Hosting the app somewhere else

The client connects to `/ws` on its own origin. To embed the built
`index.html` on another site, point it at the server with
`?relay=wss://your-host/ws` or a `<meta name="scramble-relay" content="wss://your-host/ws">`
tag.

## How it fits the game

The game rules stay in the clients' reducer (`src/state.js`); the relay only
decides who may write where:

- an update's `addr` must be the sender's own address (Delta Chat can't
  check this; the relay does),
- `create` opens a room, anything else needs membership: from `create`,
  from the matchmaker, or from `watch` (what an invite link does),
- only the server may send `matched`, the update that seats a matchmade
  table and skips the lobby,
- per-player updates (`skin`) go to every room the player is in, and are
  copied into a new matchmade room so opponents see each other's tiles.

Players are a random `…@web` address plus a secret token stored in the
browser; the first hello binds the two.

## Protocol

JSON messages over the WebSocket.

| client → server | |
|---|---|
| `{t:'hello', addr, token, name}` | first message; `addr` is `<hex>@web`, `token` ≥ 32 chars |
| `{t:'send', payload}` | append a webxdc update payload to its match's room |
| `{t:'watch', room}` | follow a room by id (invite links) |
| `{t:'queue', size}` / `{t:'cancel'}` | join / leave the matchmaking queue for 2, 3 or 4 players |

| server → client | |
|---|---|
| `{t:'welcome', addr, name}` then every `{t:'update', room, serial, payload}` then `{t:'synced'}` | after hello; serials count per room |
| `{t:'queue', size, waiting}` | queue status (`size: null` when out of the queue) |
| `{t:'matched', room}` | a table was seated; the room's `matched` update follows |
| `{t:'error', error}` | a rejected request |

## Not done yet: Delta Chat matchmaking bot

Matching strangers *inside* Delta Chat needs a bot account (deltachat-rpc)
that players message, which then creates a group with them and the .xdc,
and posts the same `matched` update into it. `matchmaker.js` has no socket
code so the bot can reuse the queue. It needs an email/chatmail account to
run, so it is left for a follow-up.

## Tests

```bash
npm test
```
