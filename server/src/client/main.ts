import {loadAsync} from 'jszip'
import {Xash3D} from 'xash3d-fwgs'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import {Xash3DGameSocket} from "./gamesocket"
import {initMenus} from "./menus"
import {applySettings, initSettings, loadSettings} from "./settings"

type EngineConfig = {
    arguments: string[];
    console: string[];
    game_dir: string;
    libraries: { client: string; server: string; extras: string; menu: string; filesystem: string };
    dynamic_libraries: string[];
    files_map: Record<string, string>;
}

type ServerState = {
    name: string; map: string; maxPlayers: number; bots: number; difficulty: number; private: boolean; players: number
}

const SKILLS = ['Easy', 'Normal', 'Hard', 'Expert']
const MAP_RE = /^[a-z0-9_]+$/

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// localStorage can throw (private mode, blocked storage); settings are a convenience only
const store = {
    get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } },
    set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

// ---------- where the lobby server is ----------
// The page is served by the JOUCS server itself (localhost, or the host's
// Cloudflare link) or from GitHub Pages. Pages has a fixed address, so browsers
// keep the game files between sessions; there, link.json (written by
// `joucs.sh online`) says where the host's server currently is.

const LINK_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/
const onPages = location.hostname.endsWith('.github.io')

async function findServer(): Promise<URL | undefined> {
    if (!onPages) return new URL('./', location.href)
    const owner = location.hostname.split('.')[0]
    const repo = location.pathname.split('/')[1]
    let link: { url?: string } | undefined
    try {
        // the API is fresher than the site's 10-minute cache
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/link.json?ref=gh-pages`,
            {cache: 'no-store', headers: {Accept: 'application/vnd.github.raw+json'}})
        if (res.ok) link = await res.json()
    } catch { /* fall back below */ }
    link ??= await fetch(`link.json?${Date.now()}`, {cache: 'no-store'}).then(r => r.json()).catch(() => undefined)
    return link?.url && LINK_RE.test(link.url) ? new URL(link.url.replace(/\/?$/, '/')) : undefined
}

const serverPromise = findServer()
let server: URL | undefined
const api = (path: string) => new URL(path, server).href

// same values the server image hands out at /config
const ENGINE: EngineConfig = {
    arguments: ['-windowed', '-game', 'cstrike'],
    console: ['_vgui_menus 1'],
    game_dir: 'cstrike',
    libraries: {
        client: 'cstrike/cl_dlls/client_emscripten_wasm32.wasm',
        server: 'cstrike/dlls/cs_emscripten_wasm32.wasm',
        menu: 'cstrike/cl_dlls/menu_emscripten_wasm32.wasm',
        extras: 'cstrike/extras.pk3',
        filesystem: 'filesystem_stdio.wasm',
    },
    dynamic_libraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
    files_map: {
        'dlls/cs_emscripten_wasm32.wasm': 'cstrike/dlls/cs_emscripten_wasm32.wasm',
        '/rodir/filesystem_stdio.wasm': 'filesystem_stdio.wasm',
    },
}

// ---------- game data: start downloading right away ----------

function showData(percent: number, text: string) {
    $('dataBar').style.width = `${percent}%`
    $('dataText').textContent = text
}

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
        if (total) showData(received / total * 100, `Downloading game files from the host… ${Math.round(received / total * 100)}% (only the first time)`)
    }
    return new Blob(chunks as BlobPart[]).arrayBuffer()
}

/** The host's valve.zip, kept in the browser and only downloaded again when the host's file changes. */
async function gameFiles(): Promise<ArrayBuffer> {
    const cache = typeof caches === 'undefined' ? undefined : await caches.open('joucs-game-files').catch(() => undefined)
    const cached = await cache?.match('valve.zip')
    let version = ''
    if (server) {
        const head = await fetch(api('valve.zip'), {method: 'HEAD'}).catch(() => undefined)
        if (head?.ok) version = `${head.headers.get('Content-Length')}-${head.headers.get('Last-Modified')}`
    }
    if (cached && (!version || cached.headers.get('X-Joucs-Version') === version)) {
        showData(100, 'Game files ready (saved on this device)')
        return cached.arrayBuffer()
    }
    if (!server) throw new Error('the lobby is offline and this device has no saved game files yet')
    const data = await fetchWithProgress(api('valve.zip'))
    await cache?.put('valve.zip', new Response(data, {headers: {'X-Joucs-Version': version}})).catch(() => undefined)
    showData(100, 'Game files ready')
    return data
}

const filesPromise = serverPromise.then(found => {
    server = found
    return Promise.all([
        gameFiles().then(loadAsync),
        fetch(ENGINE.libraries.extras).then(r => r.arrayBuffer()),
    ])
})
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
const hostMax = bindRange('hostMax')
// bots take player slots, so keep at least one free for a human
function limitBots() {
    hostBots.input.max = String(Math.min(12, Number(hostMax.input.value) - 1))
    hostBots.sync()
}
hostMax.input.addEventListener('input', limitBots)

for (const id of ['offDifficulty', 'hostDifficulty']) {
    $(id).append(...SKILLS.map((s, i) => new Option(s, String(i))))
}

const offMap = $<HTMLSelectElement>('offMap')
const offDifficulty = $<HTMLSelectElement>('offDifficulty')
const hostMap = $<HTMLSelectElement>('hostMap')
const hostDifficulty = $<HTMLSelectElement>('hostDifficulty')
const hostPassword = $<HTMLInputElement>('hostPassword')
hostPassword.value = store.get('hostPassword')
const lobbyNameInput = $<HTMLInputElement>('lobbyNameInput')
const hostVisibility = $<HTMLSelectElement>('hostVisibility')
const lobbyPasswordInput = $<HTMLInputElement>('lobbyPasswordInput')
const joinPassword = $<HTMLInputElement>('joinPassword')
joinPassword.value = store.get('joinPassword')
const PASSWORD_RE = /^[A-Za-z0-9_-]{1,24}$/
const showLobbyPassword = () => { $('lobbyPasswordField').hidden = hostVisibility.value !== 'private' }
hostVisibility.addEventListener('change', showLobbyPassword)

offBots.input.value = store.get('offBots', '6')
offBots.sync()
offDifficulty.value = store.get('offDifficulty', '1')

// nav = the server already has bot navigation data for the map. Without a
// server (lobby offline, playing from GitHub Pages) the saved game files list the maps.
type MapInfo = { name: string; nav: boolean }
async function listMaps(): Promise<MapInfo[]> {
    await serverPromise
    if (server) {
        const maps = await fetch(api('api/maps')).then(r => r.json()).catch(() => undefined)
        if (maps) return maps
    }
    const [zip] = await filesPromise
    return Object.keys(zip.files).filter(f => /^cstrike\/maps\/[a-z0-9_]+\.bsp$/.test(f))
        .map(f => ({name: f.slice('cstrike/maps/'.length, -'.bsp'.length), nav: false})).sort((a, b) => a.name.localeCompare(b.name))
}
listMaps().then(maps => {
    offMap.append(...maps.map(m => new Option(m.name, m.name)))
    // online bots on a map without nav data take many minutes to appear the
    // first time; playing that map offline once uploads the data instantly
    hostMap.append(...maps.map(m => new Option(m.nav ? m.name : `${m.name} (play offline first for bots)`, m.name)))
    offMap.value = store.get('offMap', 'de_dust2')
    if (!offMap.value && maps.length) offMap.value = maps[0].name
}).catch(() => undefined)

let hostTouched = false
for (const el of [lobbyNameInput, hostMap, hostDifficulty, hostMax.input, hostBots.input, hostVisibility, lobbyPasswordInput]) {
    el.addEventListener('input', () => { hostTouched = true })
}

let lobby: ServerState | undefined

async function refreshStatus() {
    try {
        await serverPromise
        if (!server) throw new Error('no lobby link')
        const s: ServerState = await fetch(api('api/status')).then(r => r.json())
        lobby = s
        $('statusDot').classList.add('on')
        $('lobbyName').textContent = s.name
        $('lobbyLock').hidden = !s.private
        $('joinPasswordField').hidden = !s.private
        $('statusText').textContent = `${s.map} · ${s.players}/${s.maxPlayers} players · ` +
            `${s.bots} bot${s.bots === 1 ? '' : 's'} (${SKILLS[s.difficulty] ?? '?'})`
        if (!hostTouched) {
            lobbyNameInput.value = s.name
            hostMap.value = s.map
            hostDifficulty.value = String(s.difficulty)
            hostMax.input.value = String(s.maxPlayers)
            hostMax.sync()
            limitBots()
            hostBots.input.value = String(s.bots)
            hostBots.sync()
            hostVisibility.value = s.private ? 'private' : 'public'
            lobbyPasswordInput.placeholder = s.private ? 'leave empty to keep the current one' : ''
            showLobbyPassword()
        }
    } catch {
        lobby = undefined
        $('statusDot').classList.remove('on')
        $('lobbyName').textContent = 'Lobby is offline'
        $('lobbyLock').hidden = true
        $('statusText').textContent = onPages
            ? 'The host has not started JOUCS online. Refresh when they have. You can still play offline with bots.'
            : 'The host has not started the server.'
    }
    $<HTMLButtonElement>('join').disabled = !lobby
}
refreshStatus()
const statusTimer = setInterval(refreshStatus, 5000)

$('apply').addEventListener('click', async () => {
    const msg = $('hostMsg')
    const isPrivate = hostVisibility.value === 'private'
    const pw = lobbyPasswordInput.value.trim()
    if (isPrivate && pw && !PASSWORD_RE.test(pw)) {
        msg.className = 'msg err'
        msg.textContent = 'Lobby password: 1–24 letters, numbers, - or _'
        return
    }
    msg.className = 'msg'
    msg.textContent = 'Creating the lobby…'
    store.set('hostPassword', hostPassword.value)
    try {
        if (!server) throw new Error('The lobby server is offline.')
        const res = await fetch(api('api/server'), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                password: hostPassword.value,
                name: lobbyNameInput.value.trim(),
                map: hostMap.value,
                maxPlayers: Number(hostMax.input.value),
                bots: Number(hostBots.input.value),
                difficulty: Number(hostDifficulty.value),
                private: isPrivate,
                lobbyPassword: isPrivate ? pw : '',
            }),
        })
        if (!res.ok) throw new Error((await res.text()).trim())
        const s: ServerState = await res.json()
        hostTouched = false
        lobbyPasswordInput.value = ''
        if (isPrivate && pw) { joinPassword.value = pw; store.set('joinPassword', pw) } // the host joins too
        msg.className = 'msg ok'
        msg.textContent = `Lobby "${s.name}" is ready${s.private ? ' (private)' : ''}. A map change takes a few seconds.`
        refreshStatus()
    } catch (e) {
        msg.className = 'msg err'
        msg.textContent = (e as Error).message || 'Could not reach the server'
    }
})

// a join that failed (wrong password, full lobby) reloads the page; say why
let joinError: string | null = null
try {
    joinError = sessionStorage.getItem('joucsError')
    sessionStorage.removeItem('joucsError')
} catch { /* storage blocked */ }
if (joinError) {
    selectTab(false)
    $('joinMsg').textContent = joinError
}

// ---------- controller + fullscreen ----------

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
    if (line.includes('Issuing host shutdown')) stopEngine()
    if (line.includes('JOUCS_MENU quit')) setTimeout(backToHome, 0) // the game menu's Quit (patched at build)
    if (line.includes('invalid password')) setTimeout(() => backToHome('Wrong lobby password.'), 0)
    if (line.includes('server is full')) setTimeout(() => backToHome('This lobby is full.'), 0)
    // The touch layout loads while connecting, so retarget its gear (edit) button once the
    // team screen shows: it opens the JOUCS pause screen, which has "Edit touch layout".
    if (line.includes('JOUCS_MENU team') && touchControls.checked) {
        setTimeout(() => engine?.Cmd_ExecuteString('touch_setcommand touch_edit joucs_pause'), 0)
    }
    menus?.onLine(line)
    settingsUi.onLine(line)
}

// Quit from the engine's own menu frees all engine memory, but the browser
// keeps calling its frame loop and the next frame crashes on freed memory.
let engineStopped = false
function stopEngine() {
    engineStopped = true
    const em = engine?.em as { Module?: { pauseMainLoop?: () => void } } | undefined
    em?.Module?.pauseMainLoop?.()
    setTimeout(backToHome, 0) // the engine writes config.cfg right after this line
}

// The browser filesystem is wiped on every load, so keep the engine's
// config.cfg (keybinds, sensitivity, video) in localStorage.
const CONFIG_PATH = '/rodir/cstrike/config.cfg'
let engine: Xash3D | undefined
let menus: ReturnType<typeof initMenus> | undefined

const settingsUi = initSettings({
    engine: () => engineStopped ? undefined : engine,
    quitHome: backToHome,
    touch: () => touchControls.checked,
    enterFullscreen,
})
$('openSettings').addEventListener('click', () => settingsUi.openSettings())

function saveConfig(write: boolean) {
    if (menus?.isOpen() || settingsUi.isOpen()) return // these switch the controller off while open
    try {
        if (write && !engineStopped) engine!.Cmd_ExecuteString('host_writeconfig')
        store.set('engineConfig', new TextDecoder().decode(engine!.em!.FS.readFile(CONFIG_PATH)))
    } catch { /* engine not running yet */ }
}

function backToHome(error?: string) {
    try { if (error) sessionStorage.setItem('joucsError', error) } catch { /* storage blocked */ }
    saveConfig(!engineStopped)
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

    const config = ENGINE
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
    const x = online ? new Xash3DGameSocket(server!, opts) : new Xash3D(opts)
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
    if (touchControls.checked) {
        x.Cmd_ExecuteString('touch_enable 1')
        fsButton.remove() // it would cover touch buttons; Fullscreen is in the pause screen instead
    }
    x.Cmd_ExecuteString(`name "${name}"`)
    for (const cmd of config.console ?? []) x.Cmd_ExecuteString(cmd)
    x.Cmd_ExecuteString('_vgui_menus 1') // server sends team/buy menus as VGUI, which open the JOUCS screens
    x.Cmd_ExecuteString('con_notifytime 0') // no console text over the game (chat and kill feed are HUD)
    x.Cmd_ExecuteString('hud_fastswitch 1') // weapon cycling switches right away
    applySettings(x, loadSettings()) // controller layout, sensitivity, video, audio
    setInterval(() => saveConfig(true), 30_000)
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveConfig(true) })
    window.addEventListener('beforeunload', confirmLeave)
    await afterStart(x)
}

$('join').addEventListener('click', async () => {
    const joinMsg = $('joinMsg')
    joinMsg.textContent = ''
    if (lobby && lobby.players + lobby.bots >= lobby.maxPlayers) {
        joinMsg.textContent = 'This lobby is full.'
        return
    }
    let pw = ''
    if (lobby?.private) {
        pw = joinPassword.value.trim()
        if (!PASSWORD_RE.test(pw)) {
            joinMsg.textContent = 'Enter the lobby password (ask the host).'
            joinPassword.focus()
            return
        }
        store.set('joinPassword', pw)
        // the engine would only show a rejection inside its own menu, so check first
        const res = await fetch(api('api/join'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: pw})})
            .catch(() => undefined)
        if (!res?.ok) {
            joinMsg.textContent = res ? (await res.text()).trim() : 'Could not reach the lobby.'
            joinPassword.select()
            return
        }
    }
    launch(true, x => {
        x.Cmd_ExecuteString(`password "${pw}"`) // sent with the connection request
        x.Cmd_ExecuteString('connect 127.0.0.1:8080')
    })
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
        const nav = server ? await fetch(api(`api/nav/${map}`)).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null) : null
        if (nav) x.em!.FS.writeFile(navPath, new Uint8Array(nav))

        x.Cmd_ExecuteString('maxplayers 16')
        x.Cmd_ExecuteString('sv_lan 1')
        // bots are added once the local player is in the game
        await x.waitLog('propagation complete', `map ${map}`, 120_000).catch(() => undefined)
        for (const cmd of ['bot_join_after_player 0', 'bot_quota_mode normal', `bot_difficulty ${skill}`, `bot_quota ${bots}`]) {
            x.Cmd_ExecuteString(cmd)
        }

        // first bots on this map: the game builds nav data (~30s), share it with the server
        if (!nav && bots > 0 && server) {
            await x.waitLog(`${map}.nav' saved`, undefined, 15 * 60_000)
            await fetch(api(`api/nav/${map}`), {method: 'POST', body: x.em!.FS.readFile(navPath)})
        }
    })
})
