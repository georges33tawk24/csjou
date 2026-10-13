import type JSZip from 'jszip'
import {type Net, Xash3D} from 'xash3d-fwgs'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import '@fontsource/black-ops-one/latin-400.css' // stencil title font (OFL)
import {mapsIn, openGameFiles, savedGameFiles, saveGameFiles, savedNav, saveNav} from './files'
import {CODE_RE, findLobby, hostLobby, type Lobby, type LobbyInfo, newLobbyCode} from './lobby'
import {initMenus, menuBackground} from './menus'
import {onPadActivity} from './pad'
import {applySettings, initSettings, loadSettings, setInputDevice} from './settings'

const SKILLS = ['Easy', 'Normal', 'Hard', 'Expert']
const MAP_RE = /^[a-z0-9_]+$/
const PASSWORD_RE = /^[A-Za-z0-9_-]{1,24}$/

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// localStorage can throw (private mode, blocked storage); these are conveniences only
const store = {
    get: (k: string, d = '') => { try { return localStorage.getItem(k) ?? d } catch { return d } },
    set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

const ENGINE = {
    arguments: ['-windowed', '-game', 'cstrike'],
    libraries: {
        client: 'cstrike/cl_dlls/client_emscripten_wasm32.wasm',
        server: 'cstrike/dlls/cs_emscripten_wasm32.wasm',
        menu: 'cstrike/cl_dlls/menu_emscripten_wasm32.wasm',
        extras: 'cstrike/extras.pk3',
        filesystem: 'filesystem_stdio.wasm',
    },
    dynamicLibraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
    filesMap: {
        'dlls/cs_emscripten_wasm32.wasm': 'cstrike/dlls/cs_emscripten_wasm32.wasm',
        '/rodir/filesystem_stdio.wasm': 'filesystem_stdio.wasm',
    },
}

// ---------- game modes (ReGameDLL settings) ----------
// Every mode sets all of these, so the host can switch modes between maps.

type ModeId = 'classic' | 'tdm' | 'ffa' | 'knife'
type Cvars = Record<string, string | number>

const BOT_WEAPONS = ['pistols', 'shotguns', 'sub_machine_guns', 'rifles', 'machine_guns', 'grenades', 'snipers', 'shield']
const CLASSIC: Cvars = {
    mp_forcerespawn: 0, mp_round_infinite: 0, mp_buy_anywhere: 0, mp_buytime: 1.5, mp_startmoney: 800,
    mp_freeforall: 0, mp_respawn_immunitytime: 0, mp_give_player_c4: 1, mp_weapons_allow_map_placed: 1,
    mp_t_default_weapons_secondary: 'glock18', mp_ct_default_weapons_secondary: 'usp', mp_freezetime: 6,
    mp_item_staytime: 300, bot_deathmatch: 0, mp_maxmoney: 16000, mp_free_armor: 0, mp_kill_reward: 300,
    ...Object.fromEntries(BOT_WEAPONS.map(w => [`bot_allow_${w}`, 1])),
}
const DEATHMATCH: Cvars = {
    // respawn in 1 s with a pistol and armor, buy anywhere; guns are paid for with kills
    ...CLASSIC, mp_forcerespawn: 1, mp_round_infinite: 1, mp_buy_anywhere: 1, mp_buytime: -1,
    mp_startmoney: 1000, mp_kill_reward: 750, mp_free_armor: 2,
    mp_respawn_immunitytime: 2, mp_give_player_c4: 0, mp_freezetime: 0, mp_item_staytime: 15, bot_deathmatch: 1,
}
const MODES: Record<ModeId, { label: string; cvars: Cvars }> = {
    classic: {label: 'Classic: bomb & hostage rounds', cvars: CLASSIC},
    tdm: {label: 'Team deathmatch', cvars: DEATHMATCH},
    ffa: {label: 'Free-for-all deathmatch', cvars: {...DEATHMATCH, mp_freeforall: 1}},
    knife: {label: 'Knife arena', cvars: {
        ...DEATHMATCH, mp_buytime: 0, mp_buy_anywhere: 0, mp_weapons_allow_map_placed: 0,
        mp_t_default_weapons_secondary: '', mp_ct_default_weapons_secondary: '',
        ...Object.fromEntries(BOT_WEAPONS.map(w => [`bot_allow_${w}`, 0])),
    }},
}
const isMode = (m: string): m is ModeId => m in MODES

type ServerSetup = { name: string; map: string; mode: ModeId; maxPlayers: number; bots: number; skill: number; offline?: boolean }

// ---------- game files ----------

let zip: JSZip | undefined
let zipBlob: Blob | undefined
let maps: string[] = []

const filesCard = $('files')
function showFiles(state: 'missing' | 'busy' | 'ready' | 'error', text: string, percent = state === 'ready' ? 100 : 0) {
    filesCard.dataset.state = state
    $('filesText').textContent = text
    $('dataBar').style.width = `${percent}%`
}

function showArt(url: string) {
    if (url) document.body.style.setProperty('--art', `url("${url}")`)
}
showArt(store.get('joucsArt'))

async function useGameFiles(blob: Blob, save: boolean) {
    showFiles('busy', 'Opening the game files…')
    const z = await openGameFiles(blob)
    const kept = !save || await saveGameFiles(blob)
    zip = z
    zipBlob = blob
    maps = mapsIn(z)
    fillMaps()
    showFiles('ready', `Game files ready · ${maps.length} maps · ` +
        (kept ? 'saved on this device' : 'this browser could not keep them, so you will need to load them again next time'))
    menuBackground(z).then(url => { store.set('joucsArt', url); showArt(url) }).catch(() => undefined)
}

const MISSING = 'This device needs the CS 1.6 game files once (about 250 MB). ' +
    'Join a lobby and the host sends them to you, or load your own valve.zip.'
savedGameFiles()
    .then(blob => blob ? useGameFiles(blob, false) : showFiles('missing', MISSING))
    .catch(() => showFiles('missing', MISSING))

$<HTMLInputElement>('filesInput').addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) useGameFiles(file, true).catch(err => showFiles('error', (err as Error).message))
})

// the touch layout and other client extras, served with the page
const extrasPromise = fetch(ENGINE.libraries.extras).then(r => {
    if (!r.ok) throw new Error(`${ENGINE.libraries.extras}: ${r.status}`)
    return r.arrayBuffer()
})

// ---------- homepage ----------

const username = $<HTMLInputElement>('username')
username.value = store.get('username')

const touchControls = $<HTMLInputElement>('touchControls')
touchControls.checked = store.get('touchControls', String(!matchMedia('(hover: hover)').matches)) === 'true'
touchControls.addEventListener('change', () => store.set('touchControls', String(touchControls.checked)))

const fullscreen = $<HTMLInputElement>('fullscreen')
fullscreen.checked = store.get('fullscreen', String(matchMedia('(hover: hover)').matches)) === 'true'
fullscreen.addEventListener('change', () => store.set('fullscreen', String(fullscreen.checked)))

const TABS = ['join', 'host', 'offline'] as const
type Tab = typeof TABS[number]
function selectTab(tab: Tab) {
    for (const t of TABS) {
        $(`tab-${t}`).setAttribute('aria-selected', String(t === tab))
        $(t).hidden = t !== tab
    }
    store.set('tab', tab)
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => selectTab(t))
const savedTab = store.get('tab') as Tab
selectTab(TABS.includes(savedTab) ? savedTab : 'join')

/** an input or select that remembers its value */
function remember<T extends HTMLInputElement | HTMLSelectElement>(id: string, fallback: string): T {
    const el = $<T>(id)
    el.value = store.get(id, fallback)
    if (!el.value) el.value = fallback
    el.addEventListener('change', () => store.set(id, el.value))
    return el
}

function range(id: string, fallback: string) {
    const input = remember<HTMLInputElement>(id, fallback)
    const out = $(`${id}Out`)
    const sync = () => { out.textContent = input.value }
    input.addEventListener('input', sync)
    sync()
    return {input, sync}
}

for (const id of ['hostMode', 'offMode']) {
    $(id).append(...Object.entries(MODES).map(([value, m]) => new Option(m.label, value)))
}
for (const id of ['hostSkill', 'offSkill']) {
    $(id).append(...SKILLS.map((s, i) => new Option(s, String(i))))
}

const hostName = remember<HTMLInputElement>('hostName', '')
const hostMode = remember<HTMLSelectElement>('hostMode', 'classic')
const hostMap = $<HTMLSelectElement>('hostMap')
const hostSkill = remember<HTMLSelectElement>('hostSkill', '1')
const hostMax = range('hostMax', '10')
const hostBots = range('hostBots', '0')
const hostAccess = remember<HTMLSelectElement>('hostAccess', 'public')
const hostPassword = remember<HTMLInputElement>('hostPassword', '')
const offMode = remember<HTMLSelectElement>('offMode', 'classic')
const offMap = $<HTMLSelectElement>('offMap')
const offSkill = remember<HTMLSelectElement>('offSkill', '1')
const offBots = range('offBots', '6')

// bots take player slots; keep one for the host and at least one for a friend
function limitBots() {
    hostBots.input.max = String(Math.min(12, Number(hostMax.input.value) - 2))
    hostBots.sync()
}
hostMax.input.addEventListener('input', limitBots)
limitBots()

const showPasswordField = () => { $('hostPasswordField').hidden = hostAccess.value !== 'private' }
hostAccess.addEventListener('change', showPasswordField)
showPasswordField()

// the maps come from the game files, so until those are loaded the list says so
function fillMaps() {
    for (const [select, key] of [[hostMap, 'hostMap'], [offMap, 'offMap']] as const) {
        select.replaceChildren(...maps.length ? maps.map(m => new Option(m, m)) : [new Option('Load the game files first (top of the page)', '')])
        select.value = store.get(key, 'de_dust2')
        if (!select.value) select.value = maps.includes('de_dust2') ? 'de_dust2' : maps[0] ?? ''
        select.onchange = () => store.set(key, select.value)
    }
}
fillMaps()

// this browser's lobby code never changes, so an invite link keeps working
let hostCode = store.get('lobbyCode')
if (!CODE_RE.test(hostCode)) {
    hostCode = newLobbyCode()
    store.set('lobbyCode', hostCode)
}
const inviteLink = (code: string) => `${location.origin}${location.pathname}#join=${code}`
$('hostCode').textContent = hostCode

$('copyInvite').addEventListener('click', async e => {
    const button = e.currentTarget as HTMLElement
    try {
        await navigator.clipboard.writeText(inviteLink(hostCode))
        button.textContent = 'Copied!'
    } catch {
        button.textContent = inviteLink(hostCode)
    }
    setTimeout(() => { button.textContent = 'Copy invite link' }, 4000)
})

// ---------- joining a lobby ----------

const joinCode = $<HTMLInputElement>('joinCode')
const joinPassword = $<HTMLInputElement>('joinPassword')
const joinMsg = $('joinMsg')
let lobby: Lobby | undefined
let lobbyInfo: LobbyInfo | undefined
let lookingFor = ''
let playing = false

function showLobby(text: string, error = false) {
    $('lobbyCard').hidden = false
    $('lobbyDot').classList.toggle('on', !!lobbyInfo)
    $('lobbyName').textContent = lobbyInfo?.name ?? text
    $('lobbyName').classList.toggle('err', error)
    $('lobbyLock').hidden = !lobbyInfo?.private
    $('joinPasswordField').hidden = !lobbyInfo?.private
    $('lobbyInfo').textContent = lobbyInfo
        ? `${lobbyInfo.map} · ${lobbyInfo.mode} · ${lobbyInfo.players}/${lobbyInfo.maxPlayers} players`
        : error ? '' : 'Connecting to the host…'
}

async function refreshLobby() {
    if (!lobby) return
    lobbyInfo = await lobby.info()
    showLobby('')
}

async function lookUp(code: string) {
    code = code.toUpperCase()
    if (code === lookingFor && lobby) return lobby
    lobby?.close()
    lobby = lobbyInfo = undefined
    lookingFor = code
    showLobby('Looking for the lobby…')
    try {
        const found = await findLobby(code)
        if (lookingFor !== code) { found.close(); return undefined }
        lobby = found
        found.onClose(reason => {
            if (playing) setTimeout(() => backToHome(reason ?? 'The host closed the lobby.'), 0)
            else if (lobby === found) { lobby = lobbyInfo = undefined; showLobby('The host closed this lobby.', true) }
        })
        await refreshLobby()
        return found
    } catch (e) {
        if (lookingFor === code) showLobby((e as Error).message, true)
        return undefined
    }
}

joinCode.addEventListener('input', () => {
    joinCode.value = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    joinMsg.textContent = ''
    if (CODE_RE.test(joinCode.value)) lookUp(joinCode.value)
})
setInterval(() => { if (!playing) refreshLobby().catch(() => undefined) }, 4000)

// invite links open straight on the lobby
const invited = /^#join=([A-Za-z0-9]{6})$/.exec(location.hash)?.[1]
if (invited) {
    selectTab('join')
    joinCode.value = invited.toUpperCase()
    lookUp(joinCode.value)
}

$('joinBtn').addEventListener('click', async e => {
    const button = e.currentTarget as HTMLButtonElement
    joinMsg.textContent = ''
    if (!CODE_RE.test(joinCode.value)) {
        joinMsg.textContent = 'Enter the 6-character lobby code from the host.'
        joinCode.focus()
        return
    }
    button.disabled = true
    try {
        const found = await lookUp(joinCode.value)
        if (!found || !lobbyInfo) return
        const pw = joinPassword.value.trim()
        if (lobbyInfo.private && !pw) throw new Error('This lobby needs a password. Ask the host.')
        let started = 0
        const result = await found.join(playerName(), pw, !zip, (got, total) => {
            started ||= performance.now()
            const mbps = got / 1e6 / Math.max(1, (performance.now() - started) / 1000)
            showFiles('busy', `Getting the game files from the host: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB ` +
                `(${mbps.toFixed(1)} MB/s). Only needed once.`, got / total * 100)
        })
        if (result.files) await useGameFiles(result.files, true)
        if (!zip) throw new Error('No game files.')
        const isFfa = (info: LobbyInfo) => info.mode === MODES.ffa.label
        found.onInfo(info => engine?.Cmd_ExecuteString(`cl_aimassist_ffa ${isFfa(info) ? 1 : 0}`))
        await launch(result.net, x => {
            x.Cmd_ExecuteString(`cl_aimassist_ffa ${lobbyInfo && isFfa(lobbyInfo) ? 1 : 0}`)
            x.Cmd_ExecuteString('connect 127.0.0.1:8080')
        })
    } catch (err) {
        joinMsg.textContent = (err as Error).message
        if (filesCard.dataset.state === 'busy') showFiles(zip ? 'ready' : 'missing', zip ? 'Game files ready' : MISSING)
    } finally {
        button.disabled = false
    }
})

// ---------- hosting ----------

let hosting: { setup: ServerSetup; lobby: Awaited<ReturnType<typeof hostLobby>> } | undefined

$('hostBtn').addEventListener('click', async e => {
    const button = e.currentTarget as HTMLButtonElement
    const msg = $('hostMsg')
    msg.className = 'msg err'
    if (!zip || !zipBlob) {
        msg.textContent = 'Load the game files first (top of the page).'
        return
    }
    const isPrivate = hostAccess.value === 'private'
    const password = hostPassword.value.trim()
    if (isPrivate && !PASSWORD_RE.test(password)) {
        msg.textContent = 'Lobby password: 1–24 letters, numbers, - or _'
        hostPassword.focus()
        return
    }
    const maxPlayers = clamp(Number(hostMax.input.value), 2, 16)
    const setup: ServerSetup = {
        name: cleanName(hostName.value, `${playerName()}'s lobby`, 32),
        map: MAP_RE.test(hostMap.value) ? hostMap.value : 'de_dust2',
        mode: isMode(hostMode.value) ? hostMode.value : 'classic',
        maxPlayers,
        bots: clamp(Number(hostBots.input.value), 0, Math.min(12, maxPlayers - 2)),
        skill: clamp(Number(hostSkill.value), 0, 3),
    }
    msg.className = 'msg'
    msg.textContent = 'Opening your lobby…'
    button.disabled = true
    try {
        const files = zipBlob
        const lobbyHost = await hostLobby({
            code: hostCode,
            password: isPrivate ? password : '',
            info: () => ({name: setup.name, map: setup.map, mode: MODES[setup.mode].label, maxPlayers: setup.maxPlayers, bots: setup.bots}),
            gameFiles: async () => files,
        })
        hosting = {setup, lobby: lobbyHost}
        keepRunningWhenHidden()
        await launch(lobbyHost.net, x => startServer(x, setup))
    } catch (err) {
        msg.className = 'msg err'
        msg.textContent = (err as Error).message
        button.disabled = false
    }
})

/**
 * A hidden tab gets no animation frames, so the engine (the server everyone is
 * playing on) would stop when the host switches tabs. While hidden, frames come
 * from a worker's timer, which the browser doesn't throttle like the page's.
 */
function keepRunningWhenHidden() {
    const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16)'], {type: 'text/javascript'})))
    const queue: FrameRequestCallback[] = []
    worker.onmessage = () => { for (const cb of queue.splice(0)) cb(performance.now()) }
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = cb => {
        if (!document.hidden) return raf(cb)
        queue.push(cb)
        return 0
    }
}

// ---------- offline ----------

$('offBtn').addEventListener('click', () => {
    if (!zip) {
        $('offMsg').textContent = 'Load the game files first (top of the page).'
        return
    }
    offlineGame = true
    launch(undefined, x => startServer(x, {
        name: 'JOUCS offline',
        map: MAP_RE.test(offMap.value) ? offMap.value : 'de_dust2',
        mode: isMode(offMode.value) ? offMode.value : 'classic',
        maxPlayers: 16,
        bots: clamp(Number(offBots.input.value), 0, 12),
        skill: clamp(Number(offSkill.value), 0, 3),
        offline: true,
    }))
})

// ---------- the game's server (host and offline) ----------

function writeServerConfig(x: Xash3D, s: ServerSetup) {
    // the game runs listenserver.cfg at every map start, after its own configs
    const cvars: Cvars = {
        ...MODES[s.mode].cvars,
        bot_join_after_player: 0, bot_quota_mode: 'normal', bot_difficulty: s.skill, bot_quota: s.bots,
        pausable: s.offline ? 1 : 0, // the pause menu pauses offline games; a lobby keeps running for friends
    }
    x.em!.FS.writeFile('/rodir/cstrike/listenserver.cfg',
        Object.entries(cvars).map(([k, v]) => `${k} "${v}"\n`).join(''))
}

/** bots need a navigation mesh per map, built in about a minute the first time, so keep them */
async function prepareNav(x: Xash3D, map: string, bots: number) {
    const path = `/rodir/cstrike/maps/${map}.nav`
    const nav = await savedNav(map)
    if (nav) {
        x.em!.FS.writeFile(path, new Uint8Array(nav))
        return
    }
    if (bots > 0) showNotice(`Bots are learning ${map}. This happens once per map and takes a minute or two; ` +
        'the round restarts when they are ready.')
    x.waitLog(`${map}.nav' saved`, undefined, 30 * 60_000)
        .then(() => saveNav(map, x.em!.FS.readFile(path)))
        .catch(() => undefined)
        .finally(() => showNotice(''))
}

function showNotice(text: string) {
    $('notice').textContent = text
    $('notice').hidden = !text
}

const setFfa = (x: Xash3D, mode: ModeId) => x.Cmd_ExecuteString(`cl_aimassist_ffa ${mode === 'ffa' ? 1 : 0}`)

async function startServer(x: Xash3D, s: ServerSetup) {
    writeServerConfig(x, s)
    await prepareNav(x, s.map, s.bots)
    setFfa(x, s.mode)
    x.Cmd_ExecuteString(`maxplayers ${s.maxPlayers}`)
    x.Cmd_ExecuteString('sv_lan 1') // friends show up on made-up local addresses
    x.Cmd_ExecuteString('sv_timeout 30') // drop a friend whose browser vanished after 30 s, not 65
    x.Cmd_ExecuteString(`hostname "${s.name}"`)
    x.Cmd_ExecuteString(`map ${s.map}`)
}

async function changeMap(map: string, mode: string) {
    if (!hosting || !engine || !maps.includes(map) || !isMode(mode)) return
    Object.assign(hosting.setup, {map, mode}) // the lobby info friends see reads this too
    writeServerConfig(engine, hosting.setup)
    await prepareNav(engine, map, hosting.setup.bots)
    setFfa(engine, mode)
    engine.Cmd_ExecuteString(`changelevel ${map}`) // friends stay connected
    hosting.lobby.broadcastInfo()
}

function setBots(n: number) {
    if (!hosting || !engine) return
    const s = hosting.setup
    s.bots = clamp(n, 0, Math.min(12, s.maxPlayers - 1 - hosting.lobby.guests()))
    writeServerConfig(engine, s) // so it lasts through map changes
    engine.Cmd_ExecuteString(`bot_quota ${s.bots}`)
    hosting.lobby.broadcastInfo()
}

function kick(key: string) {
    const player = hosting?.lobby.players().find(p => p.key === key)
    if (!player) return
    hosting!.lobby.kick(key)
    engine?.Cmd_ExecuteString(`kick "${cleanName(player.name, '')}"`)
}

// offline, the pause menu really pauses (bots included)
let paused = false
let offlineGame = false
function pauseOffline(pause: boolean) {
    if (!engine || !offlineGame || pause === paused) return
    paused = pause
    engine.Cmd_ExecuteString('pause')
}

// ---------- in game ----------

function enterFullscreen() {
    document.documentElement.requestFullscreen?.({navigationUI: 'hide'}).catch(() => undefined)
}
const fsButton = $('fsButton')
fsButton.hidden = !document.fullscreenEnabled
fsButton.addEventListener('click', enterFullscreen)
document.addEventListener('fullscreenchange', () => {
    fsButton.hidden = !document.fullscreenEnabled || !!document.fullscreenElement
})

// last engine console lines, readable as window.joucsLog from devtools
const engineLog: string[] = []
Object.assign(window, {joucsLog: engineLog})
function keepLog(line: string) {
    engineLog.push(line)
    if (engineLog.length > 500) engineLog.shift()
    if (line.includes('Issuing host shutdown')) stopEngine()
    if (line.includes('JOUCS_MENU quit')) setTimeout(backToHome, 0) // the game menu's Quit (patched at build)
    if (line.includes('server is full')) setTimeout(() => backToHome('This lobby is full.'), 0)
    if (line.includes('Server connection timed out')) setTimeout(() => backToHome('Lost the connection to the host.'), 0)
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
    openQuick: () => menus?.openQuick(),
    host: () => hosting && {
        code: hostCode,
        link: inviteLink(hostCode),
        guests: hosting.lobby.guests(),
        maps,
        modes: Object.entries(MODES).map(([id, m]) => [id, m.label]),
        map: hosting.setup.map,
        mode: hosting.setup.mode,
        change: changeMap,
        bots: hosting.setup.bots,
        setBots,
        players: hosting.lobby.players(),
        kick,
    },
    onPause: pauseOffline,
})
$('openSettings').addEventListener('click', () => settingsUi.openSettings())

function saveConfig(write: boolean) {
    if (menus?.isOpen() || settingsUi.isOpen()) return // the controller is unbound while these are open
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

// a game that ended badly reloads the page; say why
try {
    const error = sessionStorage.getItem('joucsError')
    sessionStorage.removeItem('joucsError')
    if (error) joinMsg.textContent = error
} catch { /* storage blocked */ }

function confirmLeave(e: BeforeUnloadEvent) {
    saveConfig(true)
    e.preventDefault()
}

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.round(n) || 0))
}

/** a name as a console argument: no quotes or separators */
function cleanName(name: string, fallback: string, max = 24) {
    return name.replace(/["\\;\u0000-\u001f]/g, '').trim().slice(0, max) || fallback
}

function playerName() {
    const name = cleanName(username.value, 'Player')
    store.set('username', name)
    return name
}

async function launch(net: Net | undefined, afterStart: (x: Xash3D) => Promise<void> | void) {
    const name = playerName()
    playing = true
    // needs a recent click: after a long download this fails quietly and the in-game button stays
    if (fullscreen.checked) enterFullscreen()
    document.body.classList.add('playing')

    const x = new Xash3D({
        canvas: $<HTMLCanvasElement>('canvas'),
        arguments: ENGINE.arguments,
        libraries: {
            filesystem: ENGINE.libraries.filesystem,
            xash: xashURL,
            menu: ENGINE.libraries.menu,
            server: ENGINE.libraries.server,
            client: ENGINE.libraries.client,
            render: {gl4es: gl4esURL},
        },
        dynamicLibraries: ENGINE.dynamicLibraries,
        filesMap: ENGINE.filesMap,
        module: {print: keepLog, printErr: keepLog},
    })
    if (net) x.net = net
    Object.assign(window, {joucs: x}) // for troubleshooting from devtools
    const [extras] = await Promise.all([extrasPromise, x.init()])

    await Promise.all(Object.entries(zip!.files).map(async ([filename, file]) => {
        if (file.dir) return
        const path = '/rodir/' + filename
        x.em!.FS.mkdirTree(path.split('/').slice(0, -1).join('/'))
        x.em!.FS.writeFile(path, await file.async('uint8array'))
    }))
    x.em!.FS.writeFile('/rodir/cstrike/extras.pk3', new Uint8Array(extras))
    const savedConfig = store.get('engineConfig')
    if (savedConfig) x.em!.FS.writeFile(CONFIG_PATH, savedConfig)
    x.em!.FS.chdir('/rodir')
    engine = x
    menus = initMenus(x, zip!)

    $('logo').classList.add('done')
    x.main()
    if (touchControls.checked) {
        x.Cmd_ExecuteString('touch_enable 1')
        fsButton.remove() // it would cover touch buttons; Fullscreen is in the pause screen instead
    }
    x.Cmd_ExecuteString(`name "${name}"`)
    x.Cmd_ExecuteString('_vgui_menus 1') // server sends team/buy menus as VGUI, which open the JOUCS screens
    x.Cmd_ExecuteString('con_notifytime 0') // no console text over the game (chat and kill feed are HUD)
    x.Cmd_ExecuteString('hud_fastswitch 1') // weapon cycling switches right away
    applySettings(x, loadSettings()) // controller layout, crosshair, sensitivity, video, audio
    // aim assist follows the input in use: controller or touch on, mouse off
    setInputDevice(x, touchControls.checked ? 'touch' : 'mouse')
    onPadActivity(() => setInputDevice(x, 'pad'))
    window.addEventListener('mousemove', e => {
        if (document.pointerLockElement && (e.movementX || e.movementY)) setInputDevice(x, 'mouse')
    })
    window.addEventListener('touchstart', () => setInputDevice(x, 'touch'), {passive: true})
    setInterval(() => saveConfig(true), 30_000)
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveConfig(true) })
    window.addEventListener('beforeunload', confirmLeave)
    await afterStart(x)
}
