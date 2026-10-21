# JOUCS

Counter-Strike 1.6 in the browser: **https://georges33tawk24.github.io/csjou/**

- **Host**: whoever creates a lobby runs the game server in their own browser and shares an invite
  link or 6-character code. Pick the game mode (classic, co-op vs bots, team deathmatch, free-for-all,
  Gun Game, knife arena), map, max players, bots and an optional password. From the pause menu the host can change map and
  mode, add or remove bots, change their skill and remove players.
- **Join**: open the invite link, or pick the lobby from *Recent lobbies*. Friends connect straight to
  the host's browser (WebRTC; PeerJS's free public service introduces them, and Cloudflare's free relay
  carries the traffic when a network blocks direct connections). No router setup, no server to keep
  running. A friend whose connection drops rejoins automatically and keeps their place. The pause
  menu shows each connection's ping and whether it is direct or relayed. A friend who still needs
  the game files gets them without lagging the others: while friends play, the host watches their
  ping and sends the files only as fast as the upload allows without raising it.
- **Map vote**: after 20 minutes on a map, after a Gun Game win, or whenever anyone asks from the
  pause menu, everyone picks the next map within 20 seconds (staying is an option).
- **Netcode**: an update and a command every frame (up to 100 a second), other players drawn 50 ms
  behind (the engine's default is 20 updates a second and 100 ms). In a friend's game that delay
  follows the connection: it rises (up to 100 ms) while updates arrive unevenly, so players glide
  instead of jumping, and drops back on a good link; *Settings → Connection → Smoothing* is the
  lowest it goes. Tested with lag, jitter, loss, duplicates, bandwidth caps, one-way and full
  dropouts of up to 40 s, a broken connection, and map changes and rejoins over bad Wi-Fi: friends
  stay in the game and keep their place. No idle kicks, no speed-hack kicks.
- **Extra maps**: load fan maps (.bsp, .wad or a .zip) on the homepage; a host sends them to friends.
- **Offline**: the same game modes against bots, entirely in the browser; the pause menu pauses.
- **Controller**: every action can be bound, a quick menu has drop, radio and chat, the right stick
  has a response curve, and aim assist (controller and touch only, never mouse) slows the view and
  pulls gently towards visible enemies.
- **Voice chat** between the players of a lobby (WebRTC audio, push-to-talk or always on).
- **Match stats**: kills, deaths, headshots and the MVP when a map ends (and from the pause menu),
  the last match and all-time totals on the homepage.
- **Controller vibration** on shots, hits, kills and deaths.
- Touch controls on phones, a crosshair editor, and team, character and buy screens drawn from the
  game's own art.

Deathmatch modes respawn you after a second with a pistol and armor; guns cost money, which you
earn per kill ($750, start $1000). Classic keeps the normal CS economy. Co-op puts every human on
the Counter-Terrorist side against bots. Gun Game: every kill gives you the next of 19 weapons; the
first kill with the knife wins and the game restarts.

## Game files

The Counter-Strike files (`valve/` + `cstrike/`, about 250 MB) are Valve's, so JOUCS never publishes
them. Each browser keeps its own copy (Cache Storage, per site), obtained once by either:

- loading a `valve.zip` with `valve/` and `cstrike/` at the zip root, e.g. made from Valve's free
  dedicated server: `steamcmd +force_install_dir ./cs16 +login anonymous +app_update 90 +quit`, or
- joining a lobby: the host's browser sends its copy to friends who don't have one yet, or
- on a computer, one command from the homepage that downloads Valve's free dedicated server with
  Valve's SteamCMD and packs the same `valve.zip` (`get-cs.ps1` for Windows PowerShell, `get-cs.sh`
  for Mac and Linux, in `server/src/client/public/`). Faster than a host's upload, and the host's
  upload stays free for the match.

Bot navigation meshes (built in ~30 s the first time bots play a map) are kept the same way.

## Build

Rebuilt from the MIT-licensed [webxash3d-fwgs](https://github.com/daShao999/WebXash3D-Fwgs-yohimik)
after the original repo, npm packages and Docker images were deleted. `fetch-sources.sh` pins the CS
client and [ReGameDLL](https://github.com/rehlds/ReGameDLL_CS) (game logic and bots) versions it used;
the engine comes from the `xash3d-fwgs` npm package. `patches/` holds the JOUCS changes to them: aim
assist and vibration events in the client; Gun Game (`mp_gungame`), an `mp_kill_reward` setting and
bot map analysis that doesn't stall the game in ReGameDLL.

```bash
./fetch-sources.sh
docker build --target web --output type=local,dest=page .
```

`turn-worker/` is the Cloudflare Worker that hands out relay passwords (Cloudflare Realtime TURN,
1,000 GB a month free): `npx wrangler deploy` there, then set its `TURN_KEY_ID` and
`TURN_KEY_API_TOKEN` secrets from a TURN key made in the Cloudflare dashboard (Realtime → TURN Server).
Without it, lobbies still work wherever a direct connection does.

`page/` is the whole site. GitHub Actions builds it on every push and publishes `main` to the
`gh-pages` branch (the live site) and other branches to `page-<branch>` for testing.
