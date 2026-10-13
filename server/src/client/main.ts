import {loadAsync} from 'jszip'
import {Xash3D} from 'xash3d-fwgs'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import {Xash3DWebRTC} from "./webrtc"

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

fetch('/api/maps').then(r => r.json()).then((maps: string[]) => {
    for (const sel of [offMap, hostMap]) sel.append(...maps.map(m => new Option(m, m)))
    offMap.value = store.get('offMap', 'de_dust2')
    if (!offMap.value && maps.length) offMap.value = maps[0]
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

// ---------- starting the game ----------

function playerName() {
    const name = username.value.replace(/[";\\]/g, '').trim().slice(0, 24) || 'Player'
    store.set('username', name)
    return name
}

async function launch(online: boolean, afterStart: (x: Xash3D) => Promise<void> | void) {
    const name = playerName()
    clearInterval(statusTimer)
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
    }
    const x = online ? new Xash3DWebRTC(opts) : new Xash3D(opts)
    const [[zip, extras]] = await Promise.all([filesPromise, x.init()])

    await Promise.all(Object.entries(zip.files).map(async ([filename, file]) => {
        if (file.dir) return
        const path = '/rodir/' + filename
        x.em!.FS.mkdirTree(path.split('/').slice(0, -1).join('/'))
        x.em!.FS.writeFile(path, await file.async('uint8array'))
    }))
    x.em!.FS.writeFile(`/rodir/${config.game_dir}/extras.pk3`, new Uint8Array(extras))
    x.em!.FS.chdir('/rodir')

    $('logo').classList.add('done')
    x.main()
    if (touchControls.checked) x.Cmd_ExecuteString('touch_enable 1')
    x.Cmd_ExecuteString(`name "${name}"`)
    for (const cmd of config.console ?? []) x.Cmd_ExecuteString(cmd)
    await afterStart(x)

    window.addEventListener('beforeunload', e => e.preventDefault())
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
        x.Cmd_ExecuteString('maxplayers 16')
        x.Cmd_ExecuteString('sv_lan 1')
        // bot cvars only exist once the map (and game rules) are loaded
        await x.waitLog('player server started', `map ${map}`, 120_000).catch(() => undefined)
        for (const cmd of ['bot_join_after_player 0', 'bot_quota_mode normal', `bot_difficulty ${skill}`, `bot_quota ${bots}`]) {
            x.Cmd_ExecuteString(cmd)
        }
    })
})
