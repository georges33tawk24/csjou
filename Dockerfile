# CS 1.6 browser server, rebuilt from the sources yohimik/webxash3d-fwgs used
# (that repo, its npm packages and Docker images were deleted in Sept 2026).
#   ./fetch-sources.sh && docker build -t cs-web-server .

# Legacy `docker build` lacks BuildKit's automatic BUILDPLATFORM; pass it explicitly.
ARG BUILDPLATFORM=linux/amd64

# ---- engine (32-bit x86) + native CS server dll ----
FROM --platform=linux/386 debian:trixie-slim AS engine
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential python3 ca-certificates libbsd-dev curl unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /xash
COPY src/xash3d-fwgs .
RUN ./waf configure -T release -d --enable-openmp && ./waf build
# CS game logic: official ReGameDLL release (drop-in for Valve's cs.so)
ARG REGAMEDLL=5.30.0.814
ARG REGAMEDLL_SHA256=457f5c96a4d10280fcad47f106cbd5be86363a47df1ccab91c514e9d1bc6fd18
RUN curl -fsSL -o /tmp/regamedll.zip \
        https://github.com/rehlds/ReGameDLL_CS/releases/download/$REGAMEDLL/regamedll-bin-$REGAMEDLL.zip \
    && echo "$REGAMEDLL_SHA256  /tmp/regamedll.zip" | sha256sum -c - \
    && unzip -q /tmp/regamedll.zip 'bin/linux32/*' -d /tmp/regamedll \
    && mkdir -p /cs/out && mv /tmp/regamedll/bin/linux32/cstrike /cs/out/

# ---- Go WebRTC server linked against the engine ----
FROM --platform=linux/386 golang:1.25.1 AS go
WORKDIR /build
COPY src/goxash3d-fwgs goxash
COPY --from=engine /xash/build/engine/libxash.a \
     /xash/build/public/libbuild_vcs.a \
     /xash/build/public/libpublic.a \
     /xash/build/3rdparty/libbacktrace/libbacktrace.a \
     /xash/build/3rdparty/library_suffix/liblibrary_suffix.a \
     goxash/pkg/
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
# ponytail: the original module is gone from GitHub and the Go proxy; use the fetched copy
RUN go mod edit -replace github.com/yohimik/goxash3d-fwgs=../goxash && go mod download
COPY server/src/server src/server
ENV CGO_ENABLED=1 \
    CGO_CFLAGS="-fopenmp -fno-ipa-cp" \
    CGO_LDFLAGS="-fopenmp -L/build/goxash/pkg"
RUN go build -o /xash ./src/server

# ---- browser game libraries (WebAssembly) ----
FROM --platform=$BUILDPLATFORM emscripten/emsdk:4.0.17 AS cswasm
WORKDIR /cs
COPY src/cs16-client .
RUN emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/cs/out \
    && cmake --build build -j"$(nproc)" --target install

# ---- browser page ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS client
WORKDIR /client
COPY server/package.json server/vite.config.ts server/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY server/src/client src/client
RUN npx vite build

# ---- runtime ----
FROM --platform=linux/386 debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgcc-s1 libstdc++6 libgomp1 ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m xashds
WORKDIR /xashds
COPY --from=go /xash ./xash
COPY --from=engine /xash/build/filesystem/filesystem_stdio.so ./
COPY --from=engine /cs/out/ ./
COPY server/configs/valve valve
COPY server/configs/cstrike cstrike
# bot names/skills for ReGameDLL's built-in bots
COPY src/cs16-client/3rdparty/cs16client-extras/BotProfile.db \
     src/cs16-client/3rdparty/cs16client-extras/BotChatter.db cstrike/
COPY --from=client /client/src/client/dist ./public
COPY --from=cswasm /cs/out/cstrike ./public/cstrike
COPY --from=client /client/node_modules/xash3d-fwgs/dist/filesystem_stdio.wasm ./public/filesystem_stdio.wasm
COPY entrypoint.sh /entrypoint.sh
RUN chown -R xashds:xashds /xashds
USER xashds

ENV XASH3D_BASEDIR=/xashds \
    LD_LIBRARY_PATH=/xashds \
    GAME_DIR="cstrike" \
    ENGINE_ARGS="-windowed,-game,cstrike" \
    ENGINE_CONSOLE="_vgui_menus 0" \
    CLIENT_WASM_PATH="cstrike/cl_dlls/client_emscripten_wasm32.wasm" \
    SERVER_WASM_PATH="cstrike/dlls/cs_emscripten_wasm32.wasm" \
    MENU_WASM_PATH="cstrike/cl_dlls/menu_emscripten_wasm32.wasm" \
    EXTRAS_PATH="cstrike/extras.pk3" \
    FILESYSTEM_WASM_PATH="filesystem_stdio.wasm" \
    DYNAMIC_LIBRARIES="dlls/cs_emscripten_wasm32.wasm,/rodir/filesystem_stdio.wasm" \
    FILES_MAP="dlls/cs_emscripten_wasm32.wasm:cstrike/dlls/cs_emscripten_wasm32.wasm,/rodir/filesystem_stdio.wasm:filesystem_stdio.wasm"

EXPOSE 27016/tcp 27018/udp
ENTRYPOINT ["/entrypoint.sh"]
CMD ["+map", "de_dust2", "+maxplayers", "16", "+bot_join_after_player", "0", "+bot_quota_mode", "normal", "+bot_difficulty", "1", "+bot_quota", "0"]
