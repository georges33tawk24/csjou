import {loadAsync} from 'jszip'
import {Xash3D} from 'xash3d-fwgs'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import {Xash3DWebRTC} from "./webrtc"
import {initMenus} from "./menus"

type EngineConfig = {
    arguments: string[];
    console: string[];
    game_dir: string;
    libraries: { client: string; server: string; extras: string; menu: string; filesystem: string };
    dynamic_libraries: string[];
    files_map: Record<string, string>;
}

type ServerState = { map: string; bots: number; difficulty: number; players: number }

const SKILLS = ['Easy', 'Normal', 'Hard', 'Expert']
const MAP_RE = /^[a-z0-9_]+$/

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// localStorage can throw (private mode, blocked storage); settings are a convenience only
const store = {
    get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } },
    set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

// ---------- game data: start downloading right away ----------

async function fetchWithProgress(url: string) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    const total = Number(res.headers.get('Content-Length')) || 0
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
        const {done, value} = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        if (total) {
            $('dataBar').style.width = `${(received / total) * 100}%`
            $('dataText').textContent = `Downloading game files… ${Math.round((received / total) * 100)}%`
        }
    }
    $('dataBar').style.width = '100%'
    $('dataText').textContent = 'Game files ready'
    return new Blob(chunks as BlobPart[]).arrayBuffer()
}

const configPromise: Promise<EngineConfig> = fetch('/config').then(r => r.json())
const filesPromise = Promise.all([
    fetchWithProgress('valve.zip').then(loadAsync),
    configPromise.then(c => fetch(c.libraries.extras)).then(r => r.arrayBuffer()),
])
filesPromise.catch(e => {
    $('dataText').textContent = `Could not load game files (${e.message}). Refresh to retry.`
})

// ---------- homepage ----------

const username = $<HTMLInputElement>('username')
username.value = store.get('username')

const touchControls = $<HTMLInputElement>('touchControls')
touchControls.checked = store.get('touchControls', String(!matchMedia('(hover: hover)').matches)) === 'true'
touchControls.addEventListener('change', () => store.set('touchControls', String(touchControls.checked)))

function selectTab(offline: boolean) {
    $('tabOnline').setAttribute('aria-selected', String(!offline))
    $('tabOffline').setAttribute('aria-selected', String(offline))
    $('online').hidden = offline
    $('offline').hidden = !offline
    store.set('mode', offline ? 'offline' : 'online')
}
$('tabOnline').addEventListener('click', () => selectTab(false))
$('tabOffline').addEventListener('click', () => selectTab(true))
selectTab(store.get('mode') === 'offline')

function bindRange(id: string) {
    const input = $<HTMLInputElement>(id)
    const out = $(id + 'Out')
    const sync = () => { out.textContent = input.value }
    input.addEventListener('input', sync)
    return {input, sync}
}
const offBots = bindRange('offBots')
const hostBots = bindRange('hostBots')

for (const id of ['offDifficulty', 'hostDifficulty']) {
    $(id).append(...SKILLS.map((s, i) => new Option(s, String(i))))
}

const offMap = $<HTMLSelectElement>('offMap')
const offDifficulty = $<HTMLSelectElement>('offDifficulty')
const hostMap = $<HTMLSelectElement>('hostMap')
const hostDifficulty = $<HTMLSelectElement>('hostDifficulty')
const hostPassword = $<HTMLInputElement>('hostPassword')
hostPassword.value = store.get('hostPassword')

offBots.input.value = store.get('offBots', '6')
offBots.sync()
offDifficulty.value = store.get('offDifficulty', '1')

// nav = the server already has bot navigation data for the map
fetch('/api/maps').then(r => r.json()).then((maps: { name: string; nav: boolean }[]) => {
    offMap.append(...maps.map(m => new Option(m.name, m.name)))
    // online bots on a map without nav data take many minutes to appear the
    // first time; playing that map offline once uploads the data instantly
    hostMap.append(...maps.map(m => new Option(m.nav ? m.name : `${m.name} (play offline first for bots)`, m.name)))
    offMap.value = store.get('offMap', 'de_dust2')
    if (!offMap.value && maps.length) offMap.value = maps[0].name
})

let hostTouched = false
for (const el of [hostMap, hostDifficulty, hostBots.input]) el.addEventListener('input', () => { hostTouched = true })

async function refreshStatus() {
    try {
        const s: ServerState = await fetch('/api/status').then(r => r.json())
        $('statusDot').classList.add('on')
        $('statusText').textContent =
            `${s.map} · ${s.bots} bot${s.bots === 1 ? '' : 's'} (${SKILLS[s.difficulty] ?? '?'}) · ${s.players} online`
        if (!hostTouched) {
            hostMap.value = s.map
            hostDifficulty.value = String(s.difficulty)
            hostBots.input.value = String(s.bots)
            hostBots.sync()
        }
    } catch {
        $('statusDot').classList.remove('on')
        $('statusText').textContent = 'Server is offline'
    }
}
refreshStatus()
const statusTimer = setInterval(refreshStatus, 5000)

$('apply').addEventListener('click', async () => {
    const msg = $('hostMsg')
    msg.className = 'msg'
    msg.textContent = 'Applying…'
    store.set('hostPassword', hostPassword.value)
    try {
        const res = await fetch('/api/server', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                password: hostPassword.value,
                map: hostMap.value,
                bots: Number(hostBots.input.value),
                difficulty: Number(hostDifficulty.value),
            }),
        })
        if (!res.ok) throw new Error((await res.text()).trim())
        hostTouched = false
        msg.className = 'msg ok'
        msg.textContent = 'Server updated. A map change takes a few seconds.'
        refreshStatus()
    } catch (e) {
        msg.className = 'msg err'
        msg.textContent = (e as Error).message || 'Could not reach the server'
    }
})

// ---------- controller + fullscreen ----------

// CS layout for gamepads (Xash's defaults are Half-Life's). Sticks: move / aim.
// [engine key, command, button label, what it does]
const CONTROLLER: [string, string, string, string][] = [
    ['RTRIGGER', '+attack', 'RT', 'Shoot'],
    ['LTRIGGER', '+attack2', 'LT', 'Scope / alt fire'],
    ['R1_BUTTON', 'invnext', 'RB', 'Next weapon'],
    ['L1_BUTTON', 'invprev', 'LB', 'Previous weapon'],
    ['A_BUTTON', '+jump', 'A', 'Jump'],
    ['B_BUTTON', '+duck', 'B', 'Crouch'],
    ['X_BUTTON', '+reload', 'X', 'Reload'],
    ['Y_BUTTON', '+use', 'Y', 'Use / defuse'],
    ['STICK1', '+speed', 'Left stick click', 'Walk quietly'],
    ['STICK2', 'slot3', 'Right stick click', 'Knife'],
    ['DPAD_UP', 'buy', 'D-pad up', 'Open the shop'],
    ['DPAD_DOWN', 'rebuy', 'D-pad down', 'Rebuy last round'],
    ['DPAD_LEFT', 'slot1', 'D-pad left', 'Primary weapon · menu option 1 (e.g. Terrorists)'],
    ['DPAD_RIGHT', 'slot2', 'D-pad right', 'Pistol · menu option 2 (e.g. Counter-Terrorists)'],
    ['BACK', '+showscores', 'View / Back', 'Scoreboard'],
    ['START', 'togglemenu', 'Menu / Options', 'Game menu and settings'],
]

$('controllerLayout').append(
    ...[['Left stick', 'Move'], ['Right stick', 'Aim'], ...CONTROLLER.map(c => [c[2], c[3]])].map(([button, action]) => {
        const row = document.createElement('tr')
        row.append(Object.assign(document.createElement('th'), {textContent: button}),
            Object.assign(document.createElement('td'), {textContent: action}))
        return row
    }))

const fullscreen = $<HTMLInputElement>('fullscreen')
fullscreen.checked = store.get('fullscreen', String(matchMedia('(hover: hover)').matches)) === 'true'
fullscreen.addEventListener('change', () => store.set('fullscreen', String(fullscreen.checked)))

function enterFullscreen() {
    document.documentElement.requestFullscreen?.({navigationUI: 'hide'}).catch(() => undefined)
}
const fsButton = $('fsButton')
fsButton.hidden = !document.fullscreenEnabled
fsButton.addEventListener('click', enterFullscreen)
document.addEventListener('fullscreenchange', () => {
    fsButton.hidden = !document.fullscreenEnabled || !!document.fullscreenElement
})

// ---------- starting the game ----------

// last engine console lines, readable as window.joucsLog from devtools
const engineLog: string[] = []
Object.assign(window, {joucsLog: engineLog})
function keepLog(line: string) {
    engineLog.push(line)
    if (engineLog.length > 500) engineLog.shift()
    // Quit in the game menu stops the engine; the frozen canvas would stay up.
    // The engine writes config.cfg right after this line, so wait a tick.
    if (line.includes('Issuing host shutdown')) setTimeout(backToHome, 0)
    menus?.onLine(line)
}

// The browser filesystem is wiped on every load, so keep the engine's
// config.cfg (keybinds, sensitivity, video) in localStorage.
const CONFIG_PATH = '/rodir/cstrike/config.cfg'
const PAD_LAYOUT = '3' // bump to re-apply CONTROLLER binds over saved configs
let engine: Xash3D | undefined
let menus: ReturnType<typeof initMenus> | undefined

function saveConfig(write: boolean) {
    if (menus?.isOpen()) return // menus switch the controller off while open
    try {
        if (write) engine!.Cmd_ExecuteString('host_writeconfig')
        store.set('engineConfig', new TextDecoder().decode(engine!.em!.FS.readFile(CONFIG_PATH)))
    } catch { /* engine not running yet */ }
}

function backToHome() {
    saveConfig(false)
    window.removeEventListener('beforeunload', confirmLeave)
    location.reload()
}

function confirmLeave(e: BeforeUnloadEvent) {
    saveConfig(true)
    e.preventDefault()
}

function playerName() {
    const name = username.value.replace(/[";\\]/g, '').trim().slice(0, 24) || 'Player'
    store.set('username', name)
    return name
}

async function launch(online: boolean, afterStart: (x: Xash3D) => Promise<void> | void) {
    const name = playerName()
    clearInterval(statusTimer)
    // still inside the click handler, so the browser allows fullscreen here
    if (fullscreen.checked) enterFullscreen()
    document.body.classList.add('playing')

    const config = await configPromise
    const opts = {
        canvas: $<HTMLCanvasElement>('canvas'),
        arguments: config.arguments || ['-windowed'],
        libraries: {
            filesystem: config.libraries.filesystem,
            xash: xashURL,
            menu: config.libraries.menu,
            server: config.libraries.server,
            client: config.libraries.client,
            render: {gl4es: gl4esURL},
        },
        dynamicLibraries: config.dynamic_libraries,
        filesMap: config.files_map,
        module: {print: keepLog, printErr: keepLog},
    }
    const x = online ? new Xash3DWebRTC(opts) : new Xash3D(opts)
    Object.assign(window, {joucs: x}) // for troubleshooting from devtools
    const [[zip, extras]] = await Promise.all([filesPromise, x.init()])

    await Promise.all(Object.entries(zip.files).map(async ([filename, file]) => {
        if (file.dir) return
        const path = '/rodir/' + filename
        x.em!.FS.mkdirTree(path.split('/').slice(0, -1).join('/'))
        x.em!.FS.writeFile(path, await file.async('uint8array'))
    }))
    x.em!.FS.writeFile(`/rodir/${config.game_dir}/extras.pk3`, new Uint8Array(extras))
    const savedConfig = store.get('engineConfig')
    if (savedConfig) x.em!.FS.writeFile(CONFIG_PATH, savedConfig)
    x.em!.FS.chdir('/rodir')
    engine = x
    menus = initMenus(x, zip)

    $('logo').classList.add('done')
    x.main()
    if (touchControls.checked) x.Cmd_ExecuteString('touch_enable 1')
    x.Cmd_ExecuteString(`name "${name}"`)
    for (const cmd of config.console ?? []) x.Cmd_ExecuteString(cmd)
    x.Cmd_ExecuteString('_vgui_menus 1') // server sends team/buy menus as VGUI, which open the JOUCS screens
    x.Cmd_ExecuteString('con_notifytime 0') // no console text over the game (chat and kill feed are HUD)
    // apply the JOUCS controller layout once; after that, binds changed in
    // Options > Controls are kept in the saved config
    if (store.get('padLayout') !== PAD_LAYOUT) {
        x.Cmd_ExecuteString('hud_fastswitch 1') // weapon cycling switches right away
        for (const [key, cmd] of CONTROLLER) x.Cmd_ExecuteString(`bind ${key} "${cmd}"`)
        store.set('padLayout', PAD_LAYOUT)
    }
    setInterval(() => saveConfig(true), 30_000)
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveConfig(true) })
    window.addEventListener('beforeunload', confirmLeave)
    await afterStart(x)
}

$('join').addEventListener('click', () => {
    launch(true, x => x.Cmd_ExecuteString('connect 127.0.0.1:8080'))
})

$('playOffline').addEventListener('click', () => {
    const map = MAP_RE.test(offMap.value) ? offMap.value : 'de_dust2'
    const bots = Math.min(12, Math.max(0, Number(offBots.input.value) | 0))
    const skill = Math.min(3, Math.max(0, Number(offDifficulty.value) | 0))
    store.set('offMap', map)
    store.set('offBots', String(bots))
    store.set('offDifficulty', String(skill))

    launch(false, async x => {
        const navPath = `/rodir/cstrike/maps/${map}.nav`
        // reuse the server's bot navigation data when it has it
        const nav = await fetch(`/api/nav/${map}`).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
        if (nav) x.em!.FS.writeFile(navPath, new Uint8Array(nav))

        x.Cmd_ExecuteString('maxplayers 16')
        x.Cmd_ExecuteString('sv_lan 1')
        // bots are added once the local player is in the game
        await x.waitLog('propagation complete', `map ${map}`, 120_000).catch(() => undefined)
        for (const cmd of ['bot_join_after_player 0', 'bot_quota_mode normal', `bot_difficulty ${skill}`, `bot_quota ${bots}`]) {
            x.Cmd_ExecuteString(cmd)
        }

        // first bots on this map: the game builds nav data (~30s), share it with the server
        if (!nav && bots > 0) {
            await x.waitLog(`${map}.nav' saved`, undefined, 15 * 60_000)
            await fetch(`/api/nav/${map}`, {method: 'POST', body: x.em!.FS.readFile(navPath)})
        }
    })
})
