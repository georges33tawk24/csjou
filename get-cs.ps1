# JOUCS: gets Counter-Strike 1.6's game files straight from Valve (its free
# Half-Life Dedicated Server, through Valve's own SteamCMD) and packs them into
# valve.zip, ready to load in JOUCS. Nothing else is installed or changed.
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; iex (New-Object Net.WebClient).DownloadString('https://georges33tawk24.github.io/csjou/get-cs.ps1')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the download progress bar makes Invoke-WebRequest very slow
$dir = Join-Path $env:USERPROFILE 'JOUCS'
New-Item -ItemType Directory -Force -Path (Join-Path $dir 'steamcmd') | Out-Null
Set-Location $dir

if (-not (Test-Path 'steamcmd\steamcmd.exe')) {
    Write-Host 'Downloading SteamCMD from Valve...'
    Invoke-WebRequest 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile 'steamcmd.zip' -UseBasicParsing
    Expand-Archive 'steamcmd.zip' -DestinationPath 'steamcmd' -Force
    Remove-Item 'steamcmd.zip'
}

Write-Host 'Downloading the game files from Valve (about 900 MB)...'
foreach ($try in 1..3) {
    & '.\steamcmd\steamcmd.exe' +force_install_dir "$dir\hlds" +login anonymous +app_set_config 90 mod cstrike +app_update 90 validate +quit
    if (Test-Path 'hlds\cstrike\liblist.gam') { break } # SteamCMD often needs a second go at this one
}

if (Test-Path 'hlds\cstrike\liblist.gam') {
    Write-Host 'Packing valve.zip...'
    # Half-Life's own maps, music and the server programs: the browser game never uses them
    foreach ($extra in 'valve\maps', 'valve\media', 'valve\overviews', 'valve\dlls', 'valve\cl_dlls', 'cstrike\dlls', 'cstrike\cl_dlls') {
        if (Test-Path "hlds\$extra") { Remove-Item "hlds\$extra" -Recurse -Force }
    }
    if (Test-Path 'valve.zip') { Remove-Item 'valve.zip' }
    tar.exe -a -c -f 'valve.zip' -C 'hlds' valve cstrike # Windows 10 and 11 come with tar
    Remove-Item 'hlds' -Recurse -Force # the zip has everything JOUCS needs
    Write-Host ''
    Write-Host "Done: $dir\valve.zip"
    Write-Host 'Open JOUCS, press "Load valve.zip from this device" and pick it. Only needed once.'
    explorer.exe "/select,$dir\valve.zip"
} else {
    Write-Host "The download didn't finish. Paste the same command again to continue."
}
