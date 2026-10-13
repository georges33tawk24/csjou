# JOUCS

Counter-Strike 1.6 in the browser, served from your own machine.

- **Online**: friends open your link and join your server. The host picks the map and up to 12 bots from the homepage.
- **Offline with bots**: the whole game, server included, runs in your browser. No port forwarding.

Rebuilt from the MIT-licensed [webxash3d-fwgs](https://github.com/daShao999/WebXash3D-Fwgs-yohimik)
`cs-web-server` after the original repo, npm packages and Docker images were deleted.
`fetch-sources.sh` pins the exact engine, client and Go versions it used. Game logic is the official
[ReGameDLL](https://github.com/rehlds/ReGameDLL_CS) release, which includes the bots.

GitHub Actions builds the image and pushes it to `ghcr.io/<owner>/cs-web-server:latest`.

## Run

You need `valve.zip` with `valve/` and `cstrike/` at the zip root, e.g. from Valve's free dedicated server:
`steamcmd +force_install_dir ./cs16 +login anonymous +app_update 90 +quit`.

```bash
docker run -d --name joucs --restart unless-stopped --platform linux/386 \
  -p 27016:27016 -p 27018:27018/udp \
  -e IP=<your-public-ip> -e PORT=27018 -e ADMIN_PASSWORD=<pick-one> \
  -v "$PWD/valve.zip:/xashds/public/valve.zip:ro" \
  ghcr.io/<owner>/cs-web-server:latest
```

Open `http://localhost:27016`. For friends, forward UDP 27018 on your router and share the page
(e.g. through a Cloudflare tunnel for HTTPS). Host controls on the homepage need `ADMIN_PASSWORD`.

On Apple Silicon with Colima, start it with `--port-forwarder grpc` so UDP reaches the Mac,
and register 32-bit x86 emulation once per VM start: `docker run --privileged --rm tonistiigi/binfmt --install 386`.
