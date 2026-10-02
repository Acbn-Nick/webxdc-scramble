# Scramble server

One small Node service for the **web embed** of Scramble:

- serves the built app (`../dist`) over HTTP, and
- runs a WebSocket relay on `/ws` that stands in for Delta Chat: every match
  is a room with an append-only update log, fanned out to its members, and
- runs the **matchmaking queue**: players pick 2, 3 or 4 players, press
  *Find Match*, and the server seats a full table in a fresh room.

`bot.js` is the Delta Chat side of matchmaking; see
[Delta Chat matchmaking bot](#delta-chat-matchmaking-bot).

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

## Delta Chat matchmaking bot

Inside Delta Chat a webxdc can't reach a server, so matchmaking there is a
bot: players message it, and when a table is full it creates a group with
them, posts the Scramble .xdc and opens an empty table in it. The players'
games join that table and start it on their own. It uses the same queue as
the web relay (`matchmaker.js`).

```bash
npm run build                 # in the repo root: builds dist/scramble.xdc
cd server && npm ci
npm run bot
```

On first run the bot creates its own chatmail account and saves it in
`bot-data/` (keep that directory: it holds the bot's address and keys).
It prints an invite link; share it, and players who open it get a chat with
the bot.

| env | default | |
|---|---|---|
| `SCRAMBLE_BOT_DIR` | `./bot-data` | account data directory |
| `SCRAMBLE_BOT_CHATMAIL` | `nine.testrun.org` | chatmail server for the bot's account, first run only |
| `SCRAMBLE_BOT_NAME` | `Scramble Matchmaker` | display name |
| `SCRAMBLE_XDC` | `../dist/scramble.xdc` | the game it posts into each group |

Commands players send it: `/play 2` (or 3, 4), `/cancel`; anything else
gets the help text. Run it under systemd like the web server; it needs no
open ports, only outgoing access to the chatmail server.

Why a `table` and not `matched`: Delta Chat gives each player a different,
private `selfAddr` inside the game, so the bot can't name the players. It
opens an empty table for the group's size instead, and every member's game
joins it and sends `start` once it's full.

## Tests

```bash
npm test
```
