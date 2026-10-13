// `npm run check`: the page's parsing rules (also run by the Docker build)
import {extraPath} from './files'
import {shapeStick} from './pad'
import {createStats, parseKill} from './stats'

function eq(got: unknown, want: unknown, what: string) {
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// kill lines as cl_dll/death.cpp prints them
eq(parseKill('[21:00:01] Bob killed Alice with ak47'), {killer: 'Bob', victim: 'Alice', headshot: false}, 'kill')
eq(parseKill('*** Bob killed Alice with a headshot from deagle ***'), {killer: 'Bob', victim: 'Alice', headshot: true}, 'headshot')
eq(parseKill('Big Bob killed Mr Smith with usp'), {killer: 'Big Bob', victim: 'Mr Smith', headshot: false}, 'names with spaces')
eq(parseKill('Alice died'), {victim: 'Alice', headshot: false}, 'world')
eq(parseKill('Alice killed self with hegrenade'), {victim: 'Alice', headshot: false}, 'suicide')
eq(parseKill('Bob killed his teammate Alice'), {victim: 'Alice', headshot: false}, 'teamkill')
eq(parseKill('Bob killed a hostage'), undefined, 'hostage')
eq(parseKill('GuestGal : I killed Bob with style'), undefined, 'chat')
const stats = createStats(() => 'Bob')
for (const l of ['Bob killed Alice with ak47', '*** Bob killed Carl with a headshot from ak47 ***', 'Carl killed Bob with m4a1', 'JOUCS_GUNGAME 3 Bob']) stats.onLine(l)
eq(stats.summary('de_dust2', 'x').rows[0], {name: 'Bob', kills: 2, deaths: 1, headshots: 1, level: 3}, 'stats')

// where files from a map download go
eq(extraPath('aim_map.bsp'), 'cstrike/maps/aim_map.bsp', 'bare bsp')
eq(extraPath('Downloads/fy_snow/cstrike/maps/fy_snow.bsp'), 'cstrike/maps/fy_snow.bsp', 'zip with cstrike/')
eq(extraPath('snow.wad'), 'cstrike/snow.wad', 'wad')
eq(extraPath('../../etc/passwd'), undefined, 'outside the game folder')
eq(extraPath('cstrike/../valve/x.bsp'), undefined, '..')
eq(extraPath('evil.exe'), undefined, 'not a game file')

// right stick: deadzone, curve, full tilt stays full
eq(shapeStick(0.1, 0, 0.12, 2), [0, 0], 'deadzone')
eq(shapeStick(1, 0, 0.12, 2).map(v => Math.round(v * 1000)), [1000, 0], 'full tilt')
eq(Math.round(shapeStick(0.56, 0, 0.12, 2)[0] * 100), 25, 'curve')

console.log('checks ok')
