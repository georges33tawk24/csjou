#!/usr/bin/env bash
# Fetch the exact CS client version yohimik/webxash3d-fwgs was built from
# (the engine itself comes from the xash3d-fwgs npm package). The original
# forks were deleted; these commits survive in the upstream repos.
set -euo pipefail
cd "$(dirname "$0")"

fetch() { # dir url sha
    rm -rf "$1"
    git init -q "$1"
    git -C "$1" remote add origin "$2"
    git -C "$1" fetch -q --depth 1 origin "$3"
    git -C "$1" checkout -q FETCH_HEAD
    echo "ok $1 @ ${3:0:8}"
}

# CS 1.6 client + ReGameDLL server, with web (Emscripten) support
C=src/cs16-client
fetch $C https://github.com/Velaron/cs16-client 2490c5e9b66928e86df191ec1cdd802b6357a71c
fetch $C/3rdparty/ReGameDLL_CS https://github.com/rehlds/ReGameDLL_CS 1bffd442191715a956a9db3a63cbe43956f92953
fetch $C/3rdparty/ReGameDLL_CS/regamedll/extra/cssdk https://github.com/s1lentq/CSSDK a09ee092843489fa95a8c002a44860427812094c
fetch $C/3rdparty/mainui_cpp https://github.com/FWGS/mainui_cpp e6d8da7e534e88e57a4f0724119444b22ada9421
fetch $C/3rdparty/mainui_cpp/miniutl https://github.com/FWGS/MiniUTL 66bb8ce932649907a33007b89c09deb30cebd49e
fetch $C/3rdparty/miniutl https://github.com/FWGS/MiniUTL 66bb8ce932649907a33007b89c09deb30cebd49e
fetch $C/3rdparty/yapb https://github.com/yapb/yapb 34772be5cadfd1538758a5cc03def63ea6e958fa
fetch $C/3rdparty/yapb/ext/crlib https://github.com/yapb/crlib b5f7ccc23dec2d018048b40085f78255cc232e52
fetch $C/3rdparty/yapb/ext/linkage https://github.com/yapb/linkage a21540a52d7559333ad9d8326411daf78af62891

