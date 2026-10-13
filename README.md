# JOUCS

Counter-Strike 1.6 in the browser: **https://georges33tawk24.github.io/csjou/**

- **Host**: whoever creates a lobby runs the game server in their own browser and shares an invite
  link or 6-character code. Pick the game mode (classic, team deathmatch, free-for-all, knife arena),
  map, max players, bots and an optional password. From the pause menu the host can change map and
  mode, add or remove bots, change their skill and remove players.
- **Join**: open the invite link. Friends connect straight to the host's browser (WebRTC through
  PeerJS's free public service, which also relays traffic when a network blocks direct connections).
  No router setup, no server to keep running.
- **Offline**: the same game modes against bots, entirely in the browser; the pause menu pauses.
- **Controller**: every action can be bound, a quick menu has drop, radio and chat, the right stick
  has a response curve, and aim assist (controller and touch only, never mouse) slows the view and
  pulls gently towards visible enemies.
- **Voice chat** between the players of a lobby (WebRTC audio, push-to-talk or always on).
- Touch controls on phones, a crosshair editor, and team, character and buy screens drawn from the
  game's own art.

Deathmatch modes respawn you after a second with a pistol and armor; guns cost money, which you
earn per kill ($750, start $1000). Classic keeps the normal CS economy.

## Game files

The Counter-Strike files (`valve/` + `cstrike/`, about 250 MB) are Valve's, so JOUCS never publishes
them. Each browser keeps its own copy (Cache Storage, per site), obtained once by either:

- loading a `valve.zip` with `valve/` and `cstrike/` at the zip root, e.g. made from Valve's free
  dedicated server: `steamcmd +force_install_dir ./cs16 +login anonymous +app_update 90 +quit`, or
- joining a lobby: the host's browser sends its copy to friends who don't have one yet.

Bot navigation meshes (built in ~30 s the first time bots play a map) are kept the same way.

## Build

Rebuilt from the MIT-licensed [webxash3d-fwgs](https://github.com/daShao999/WebXash3D-Fwgs-yohimik)
after the original repo, npm packages and Docker images were deleted. `fetch-sources.sh` pins the CS
client and [ReGameDLL](https://github.com/rehlds/ReGameDLL_CS) (game logic and bots) versions it used;
the engine comes from the `xash3d-fwgs` npm package. `patches/` holds the JOUCS changes to them: aim
assist in the client, an `mp_kill_reward` setting, and bot map analysis that doesn't stall the game.

```bash
./fetch-sources.sh
docker build --target web --output type=local,dest=page .
```

`page/` is the whole site. GitHub Actions builds it on every push and publishes `main` to the
`gh-pages` branch (the live site) and other branches to `page-<branch>` for testing.
