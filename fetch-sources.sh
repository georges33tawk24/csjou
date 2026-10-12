#!/usr/bin/env bash
# Fetch the exact source versions yohimik/webxash3d-fwgs was built from.
# The original forks were deleted; these commits survive in the upstream repos.
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

# Engine with the Go/WebRTC network hooks ("merged" branch, Jan 2026)
E=src/xash3d-fwgs
fetch $E https://github.com/FWGS/xash3d-fwgs f85aa0c8f7d46c27191132b44d872c8e331308de
fetch $E/3rdparty/MultiEmulator https://github.com/FWGS/MultiEmulator 11ff077ca58b9394a0eff0e89dd8980c2c252956
fetch $E/3rdparty/bzip2/bzip2 https://gitlab.com/bzip2/bzip2 66c46b8c9436613fd81bc5d03f63a61933a4dcc3
fetch $E/3rdparty/extras/xash-extras https://github.com/FWGS/xash-extras 0c83a63d000492e65c1620125f8d9a07d36495f8
fetch $E/3rdparty/libbacktrace/libbacktrace https://github.com/ianlancetaylor/libbacktrace 793921876c981ce49759114d7bb89bb89b2d3a2d
fetch $E/3rdparty/library_suffix https://github.com/ololoken/library-suffix 73569f7c13fa3e36ef17f9624d8603770dd92f5b
fetch $E/3rdparty/opus/opus https://github.com/xiph/opus 82ac57d9f1aaf575800cf17373348e45b7ce6c0d
fetch $E/3rdparty/libogg/libogg https://github.com/xiph/ogg 7cf42ea17aef7bc1b7b21af70724840a96c2e7d0
fetch $E/3rdparty/vorbis/vorbis-src https://github.com/xiph/vorbis bb4047de4c05712bf1fd49b9584c360b8e4e0adf
fetch $E/3rdparty/opusfile/opusfile https://github.com/xiph/opusfile 3ecc22aa0a4430f61c2403d57370a089536d197a

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

# Go wrapper around the engine (surviving copy of yohimik/goxash3d-fwgs)
fetch src/goxash3d-fwgs https://github.com/kzzalews/goxash3d-fwgs dd563e429ad3c4a0e96ad929b1e87911d7f94c6d
