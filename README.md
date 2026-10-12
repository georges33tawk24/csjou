# CS 1.6 web server

Counter-Strike 1.6 multiplayer in the browser, served from your own machine.
Rebuilt from the MIT-licensed [webxash3d-fwgs](https://github.com/daShao999/WebXash3D-Fwgs-yohimik)
`cs-web-server` after the original repo, npm packages and Docker images were deleted.
`fetch-sources.sh` pins the exact engine, client and Go versions it used.

GitHub Actions builds the image and pushes it to `ghcr.io/<owner>/cs-web-server:latest`.

## Run

You need `valve.zip` made from your own Steam copy of CS 1.6 (`valve/` and `cstrike/` at the zip root).

```bash
docker run -d --name cs --platform linux/386 \
  -p 27016:27016 -p 27018:27018/udp \
  -e IP=<your-public-ip> -e PORT=27018 \
  -v "$PWD/valve.zip:/xashds/public/valve.zip:ro" \
  ghcr.io/<owner>/cs-web-server:latest
```

Players open `http://<your-ip>:27016`. Forward UDP 27018 (game traffic) and TCP 27016 (page + signalling) on your router.
