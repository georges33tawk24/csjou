#!/bin/sh
set -e
cd /xashds
# Game content comes from your own Steam copy (valve/ + cstrike/ in valve.zip).
# -n keeps the rebuilt server dll and configs already in the image.
if [ ! -f public/valve.zip ]; then
    echo "Mount your valve.zip at /xashds/public/valve.zip" >&2
    exit 1
fi
[ -f valve/delta.lst ] || unzip -n -q public/valve.zip -d /xashds
exec ./xash +ip 0.0.0.0 -port 27015 -game cstrike "$@"
