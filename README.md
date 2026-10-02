# Scramble - A 2-4 player webxdc letter tile word game
<p align="center">
    <img src="public/icon.png" alt="Scramble Icon">
</p>
The code for this project was made with Claude and is a webxdc word game for 2 to 4 players. One Scramble message in a chat holds any number of games: open the home menu to create a game, join one, or watch.  Tile art by Gruel <3.

<p align="center">
    <img src="screenshot.jpg" alt="Scramble Screenshot">
</p>

## building
To build, simply run 
```bash
npm run build
```
and you'll have a new dist/scramble.xdc to try.

## web embed and matchmaking
Outside Delta Chat the same build runs as a web page, backed by the Scramble server in [server/](server/README.md): it serves the app, relays updates between players and runs the *Find Match* queue.
```bash
npm run build
cd server && npm ci && npm start   # http://localhost:8787
```

Inside Delta Chat, matchmaking goes through a bot: players message it `/play 2` and it puts them in a new group with the game (`cd server && npm run bot`, see [server/README.md](server/README.md#delta-chat-matchmaking-bot)).

## developing
```bash
npm run dev   # each browser tab is a separate player (use "Add Peer")
npm test      # reducer tests
(cd server && npm test)   # relay and matchmaking tests
```
