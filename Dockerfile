# JOUCS: Counter-Strike 1.6 in the browser, rebuilt from the sources
# yohimik/webxash3d-fwgs used (that repo, its npm packages and Docker images
# were deleted in Sept 2026). The result is a static site: lobbies run in the
# players' own browsers and the game files never leave their devices.
#   ./fetch-sources.sh && docker build --target web --output type=local,dest=page .

# ---- CS client, ReGameDLL server and menu as WebAssembly ----
FROM emscripten/emsdk:4.0.17 AS cswasm
WORKDIR /cs
COPY src/cs16-client .
# The engine's own quit crashes the web build (it frees memory the next frame
# still uses), so the menu's Quit asks the page to go back to the homepage instead.
RUN sed -i 's|"quit\\n"|"echo JOUCS_MENU quit\\n"|' 3rdparty/mainui_cpp/menus/Main.cpp \
    && grep -q 'JOUCS_MENU quit' 3rdparty/mainui_cpp/menus/Main.cpp
RUN emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/cs/out \
    && cmake --build build -j"$(nproc)" --target install

# ---- the page ----
FROM node:22-alpine AS client
WORKDIR /client
COPY server/package.json server/package-lock.json server/vite.config.ts server/tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY server/src/client src/client
RUN npx tsc --noEmit -p . && npx vite build

FROM scratch AS web
COPY --from=client /client/src/client/dist /
COPY --from=client /client/node_modules/xash3d-fwgs/dist/filesystem_stdio.wasm /filesystem_stdio.wasm
COPY --from=cswasm /cs/out/cstrike /cstrike
