#!/bin/sh
# JOUCS: gets Counter-Strike 1.6's game files straight from Valve (its free
# Half-Life Dedicated Server, through Valve's own SteamCMD) and packs them into
# valve.zip, ready to load in JOUCS. Nothing else is installed or changed.
#   curl -fsSL https://georges33tawk24.github.io/csjou/get-cs.sh | sh
set -e
dir="${JOUCS_DIR:-$HOME/JOUCS}"
mkdir -p "$dir/steamcmd"
cd "$dir"

case "$(uname)" in
    Darwin)
        pkg=steamcmd_osx.tar.gz
        # SteamCMD is an Intel program: Apple Silicon Macs run it through Rosetta
        if [ "$(uname -m)" = arm64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
            echo "This Mac needs Rosetta first. Run:  softwareupdate --install-rosetta --agree-to-license"
            exit 1
        fi ;;
    *) pkg=steamcmd_linux.tar.gz ;;
esac

if [ ! -x steamcmd/steamcmd.sh ]; then
    echo "Downloading SteamCMD from Valve..."
    curl -fsSL "https://steamcdn-a.akamaihd.net/client/installer/$pkg" | tar -xz -C steamcmd
fi

# the game files are the same on every system; Valve's Windows set always exists
echo "Downloading the game files from Valve (about 500 MB)..."
for try in 1 2 3; do
    steamcmd/steamcmd.sh +@sSteamCmdForcePlatformType windows +force_install_dir "$dir/hlds" \
        +login anonymous +app_set_config 90 mod cstrike +app_update 90 validate +quit || true
    [ -f hlds/cstrike/liblist.gam ] && break # SteamCMD often needs a second go at this one
done
if [ ! -f hlds/cstrike/liblist.gam ]; then
    echo "The download didn't finish. Run the same command again to continue."
    exit 1
fi

echo "Packing valve.zip..."
# Half-Life's own maps, music and the server programs: the browser game never uses them
rm -rf hlds/valve/maps hlds/valve/media hlds/valve/overviews hlds/valve/dlls hlds/valve/cl_dlls hlds/cstrike/dlls hlds/cstrike/cl_dlls
rm -f valve.zip
(cd hlds && zip -qr ../valve.zip valve cstrike)
rm -rf hlds # the zip has everything JOUCS needs
echo
echo "Done: $dir/valve.zip"
echo "Open JOUCS, press \"Load valve.zip from this device\" and pick it. Only needed once."
[ "$(uname)" = Darwin ] && open -R "$dir/valve.zip" || true
