// `npm run check`: the page's parsing rules (also run by the Docker build)
import {extraPath, nextFileRate} from './files'
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

// game files while friends play: a home upload carrying 30 KB/s of game traffic,
// with a router that queues up to 256 KB before dropping. Players' ping is 60 ms
// plus that queue plus their own wobble (wired, Wi-Fi with spikes, mobile data).
// Four minutes, a step per ping (0.5 s).
{
    let seed = 7
    const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647
    const wobble = {
        wired: () => rnd() * 4,
        wifi: () => rnd() * 20 + (rnd() < 0.1 ? 50 + rnd() * 100 : 0),
        mobile: () => rnd() * 60 + (rnd() < 0.15 ? 100 + rnd() * 200 : 0),
    }
    const cases: [number, (keyof typeof wobble)[]][] = [
        [400_000, ['wired']], [400_000, ['mobile']], [400_000, ['wired', 'wifi', 'mobile']], [200_000, ['wifi', 'wifi']],
    ]
    for (const [link, players] of cases) {
        seed = 7
        const game = 30_000, buffer = 256_000
        let rate = Infinity, queue = 0, delivered = 0
        const pings: number[][] = players.map(() => []), added: number[] = []
        for (let step = 0; step < 480; step++) {
            const offered = (Math.min(rate, link) + game) / 2
            const overflow = Math.max(0, queue + offered - link / 2 - buffer)
            queue = Math.min(buffer, Math.max(0, queue + offered - link / 2))
            delivered += Math.min(rate, link) / 2 - overflow
            const delay = queue / link * 1000
            players.forEach((kind, i) => pings[i].push(60 + delay + wobble[kind]()))
            if (step >= 20) added.push(delay)
            rate = nextFileRate(rate, pings.map(p => p.slice(-120)))
        }
        added.sort((a, b) => a - b)
        const mean = added.reduce((a, b) => a + b) / added.length, p95 = added[Math.floor(added.length * 0.95)]
        const share = delivered / 240 / (link - game)
        const text = `file pacing, ${link / 1000} KB/s upload, ${players.join(' + ')}: friends' ping +${mean.toFixed(0)} ms ` +
            `average, +${p95.toFixed(0)} ms at worst (95%); files got ${(share * 100).toFixed(0)}% of the spare upload`
        if (mean > 20 || p95 > 100 || share < 0.6) throw new Error(text)
        console.log(text)
    }
}

console.log('checks ok')
