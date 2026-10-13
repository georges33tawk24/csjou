import type {Xash3D} from 'xash3d-fwgs'
import {BTN, pressedNow, watchPad} from './pad'

// JOUCS settings (controller, mouse, crosshair, video, audio) and the pause
// screen. Settings live in localStorage and are applied as console commands on
// every launch and whenever they change in game.

export type Settings = {
    lookX: number
    lookY: number
    invertLook: boolean
    deadzone: number // percent of stick travel
    crouchToggle: boolean
    mouseSens: number
    invertMouse: boolean
    brightness: number
    showFps: boolean
    volume: number
    music: number
    crossStyle: 'classic' | 'custom'
    crossColor: string // #rrggbb
    crossAlpha: number // 0-255
    crossClassicSize: 'auto' | 'small' | 'medium' | 'large'
    crossSize: number // custom: line length, in 640x480 pixels like the game
    crossGap: number
    crossThick: number
    crossOutline: boolean
    crossDot: boolean
    crossT: boolean
    crossDynamic: boolean
    pad: Record<string, string> // action id -> engine key name ('' = none)
}

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings]
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]

type Action = { id: string; label: string; cmd: string; key: string }

// Everything a keyboard player can do. cmd is what the button runs; key is the
// default button (engine key names). Radio and chat are in the quick menu.
const ACTIONS: Action[] = [
    {id: 'shoot', label: 'Shoot', cmd: '+attack', key: 'RTRIGGER'},
    {id: 'scope', label: 'Scope / alt fire', cmd: '+attack2', key: 'LTRIGGER'},
    {id: 'jump', label: 'Jump', cmd: '+jump', key: 'A_BUTTON'},
    {id: 'crouch', label: 'Crouch', cmd: '+duck', key: 'B_BUTTON'},
    {id: 'reload', label: 'Reload', cmd: '+reload', key: 'X_BUTTON'},
    {id: 'use', label: 'Use / defuse / hostages', cmd: '+use', key: 'Y_BUTTON'},
    {id: 'next', label: 'Next weapon', cmd: 'invnext', key: 'R1_BUTTON'},
    {id: 'prev', label: 'Previous weapon', cmd: 'invprev', key: 'L1_BUTTON'},
    {id: 'walk', label: 'Walk (silent steps)', cmd: '+speed', key: 'STICK1'},
    {id: 'knife', label: 'Knife', cmd: 'slot3', key: 'STICK2'},
    {id: 'shop', label: 'Buy menu', cmd: 'buy', key: 'DPAD_UP'},
    {id: 'quick', label: 'Quick menu (drop, radio, chat…)', cmd: 'joucs_quick', key: 'DPAD_DOWN'},
    {id: 'last', label: 'Last used weapon', cmd: 'lastinv', key: 'DPAD_LEFT'},
    {id: 'grenade', label: 'Grenades', cmd: 'slot4', key: 'DPAD_RIGHT'},
    {id: 'scores', label: 'Scoreboard', cmd: '+showscores', key: 'BACK'},
    {id: 'pause', label: 'Pause menu', cmd: 'joucs_pause', key: 'START'},
    {id: 'drop', label: 'Drop weapon (to pick up another)', cmd: 'drop', key: ''},
    {id: 'primary', label: 'Primary weapon', cmd: 'slot1', key: ''},
    {id: 'pistol', label: 'Pistol', cmd: 'slot2', key: ''},
    {id: 'bomb', label: 'C4 bomb', cmd: 'slot5', key: ''},
    {id: 'rebuy', label: 'Rebuy last round', cmd: 'rebuy', key: ''},
    {id: 'autobuy', label: 'Auto-buy', cmd: 'autobuy', key: ''},
    {id: 'ammo1', label: 'Buy primary ammo', cmd: 'buyammo1', key: ''},
    {id: 'ammo2', label: 'Buy pistol ammo', cmd: 'buyammo2', key: ''},
    {id: 'nvg', label: 'Night vision', cmd: 'nightvision', key: ''},
    {id: 'light', label: 'Flashlight', cmd: 'impulse 100', key: ''},
    {id: 'spray', label: 'Spray logo', cmd: 'impulse 201', key: ''},
    {id: 'team', label: 'Change team', cmd: 'chooseteam', key: ''},
]

// index = standard Gamepad API button; these are the engine's names for them
const PAD_BUTTONS = [
    {key: 'A_BUTTON', label: 'A / ✕'}, {key: 'B_BUTTON', label: 'B / ○'},
    {key: 'X_BUTTON', label: 'X / □'}, {key: 'Y_BUTTON', label: 'Y / △'},
    {key: 'L1_BUTTON', label: 'LB / L1'}, {key: 'R1_BUTTON', label: 'RB / R1'},
    {key: 'LTRIGGER', label: 'LT / L2'}, {key: 'RTRIGGER', label: 'RT / R2'},
    {key: 'BACK', label: 'View / Share'}, {key: 'START', label: 'Menu / Options'},
    {key: 'STICK1', label: 'Left stick click'}, {key: 'STICK2', label: 'Right stick click'},
    {key: 'DPAD_UP', label: 'D-pad up'}, {key: 'DPAD_DOWN', label: 'D-pad down'},
    {key: 'DPAD_LEFT', label: 'D-pad left'}, {key: 'DPAD_RIGHT', label: 'D-pad right'},
]

const defaultPad = () => Object.fromEntries(ACTIONS.map(a => [a.id, a.key]))

const DEFAULTS: Omit<Settings, 'pad'> = {
    lookX: 200, lookY: 140, invertLook: false, deadzone: 12, crouchToggle: false,
    mouseSens: 3, invertMouse: false, brightness: 0, showFps: false, volume: 0.7, music: 1,
    crossStyle: 'classic', crossColor: '#32fa32', crossAlpha: 255, crossClassicSize: 'auto',
    crossSize: 5, crossGap: 0, crossThick: 1, crossOutline: false, crossDot: false, crossT: false, crossDynamic: true,
}

export function loadSettings(): Settings {
    try {
        const saved = JSON.parse(localStorage.getItem('joucsSettings') ?? '{}')
        // layouts saved before the quick menu existed used D-pad down for rebuy
        const pad = saved.pad && 'quick' in saved.pad ? {...defaultPad(), ...saved.pad} : defaultPad()
        return {...DEFAULTS, ...saved, pad}
    } catch {
        return {...DEFAULTS, pad: defaultPad()}
    }
}

function saveSettings(s: Settings) {
    try { localStorage.setItem('joucsSettings', JSON.stringify(s)) } catch { /* settings just won't persist */ }
}

const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16) || 0
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function engineCommands(s: Settings, controllerFree: boolean): string[] {
    const dz = Math.round(s.deadzone / 100 * 32767)
    const [r, g, b] = rgb(s.crossColor)
    const custom = s.crossStyle === 'custom' ? 1 : 0
    const dyn = s.crossDynamic ? 1 : 0
    return [
        ...['forward', 'side', 'pitch', 'yaw'].map(axis => `joy_${axis}_deadzone ${dz}`),
        `sensitivity ${s.mouseSens}`,
        `m_pitch ${s.invertMouse ? -0.022 : 0.022}`,
        `brightness ${s.brightness}`,
        `cl_showfps ${s.showFps ? 1 : 0}`,
        `volume ${s.volume}`,
        `MP3Volume ${s.music}`,
        // classic CS crosshair, and the client's custom one (xhair_*)
        `cl_crosshair_color "${r} ${g} ${b}"`,
        `cl_crosshair_size ${s.crossClassicSize}`,
        `cl_crosshair_translucent ${s.crossAlpha < 255 ? 1 : 0}`,
        `cl_dynamiccrosshair ${dyn}`,
        `xhair_enable ${custom}`,
        `xhair_color "${r} ${g} ${b} ${Math.round(s.crossAlpha)}"`,
        `xhair_size ${s.crossSize}`,
        `xhair_gap ${s.crossGap}`,
        `xhair_thick ${s.crossThick}`,
        `xhair_pad ${s.crossOutline ? 1 : 0}`,
        `xhair_dot ${s.crossDot ? 1 : 0}`,
        `xhair_t ${s.crossT ? 1 : 0}`,
        `xhair_dynamic_move ${dyn}`,
        `xhair_dynamic_scale ${dyn}`,
        // toggle crouch: a non-"+" bind runs on press only, so the alias flips itself
        'alias joucs_crouch_on "+duck; alias joucs_crouch joucs_crouch_off"',
        'alias joucs_crouch_off "-duck; alias joucs_crouch joucs_crouch_on"',
        'alias joucs_crouch joucs_crouch_on',
        'alias joucs_pause "echo JOUCS_MENU pause"',
        'alias joucs_quick "echo JOUCS_MENU quick"',
        ...(controllerFree ? [
            'joy_forward 1',
            'joy_side 1',
            // the client multiplies stick look by the mouse sensitivity as well, so take it back out
            `joy_yaw ${(s.lookX / s.mouseSens).toFixed(2)}`,
            `joy_pitch ${((s.invertLook ? -s.lookY : s.lookY) / s.mouseSens).toFixed(2)}`,
            ...PAD_BUTTONS.map(b => `unbind ${b.key}`),
            ...ACTIONS.filter(a => s.pad[a.id]).map(a =>
                `bind ${s.pad[a.id]} "${a.id === 'crouch' && s.crouchToggle ? 'joucs_crouch' : a.cmd}"`),
        ] : []),
    ]
}

export function applySettings(x: Xash3D, s: Settings) {
    for (const cmd of engineCommands(s, !openScreens.size)) x.Cmd_ExecuteString(cmd)
}

// ---------- JOUCS screens take the controller ----------
// The engine reads the controller as well, so while any JOUCS screen is open
// its sticks do nothing, its buttons are unbound and held actions released
// (pressing A in a menu must not jump). Everything comes back once every screen
// is closed and the button that closed it is up. (joy_enable can't be used:
// the engine locks it while connected.)

const HELD = ['attack', 'attack2', 'jump', 'duck', 'reload', 'use', 'speed', 'showscores']
const openScreens = new Set<string>()

export function screenOpen(x: Xash3D | undefined, screen: string, open: boolean) {
    const wasFree = !openScreens.size
    if (open) openScreens.add(screen)
    else openScreens.delete(screen)
    if (!x) return
    if (open && wasFree) {
        for (const axis of ['forward', 'side', 'pitch', 'yaw']) x.Cmd_ExecuteString(`joy_${axis} 0`)
        for (const b of PAD_BUTTONS) x.Cmd_ExecuteString(`unbind ${b.key}`)
        for (const a of HELD) x.Cmd_ExecuteString(`-${a}`)
    } else if (!open && !openScreens.size) {
        const restore = () => {
            if (openScreens.size) return
            if (pressedNow().some(Boolean)) return void requestAnimationFrame(restore)
            applySettings(x, loadSettings())
        }
        requestAnimationFrame(restore)
    }
}

function keyLabel(key: string) {
    return PAD_BUTTONS.find(b => b.key === key)?.label ?? 'Not set'
}

// ---------- crosshair preview (same geometry as the client's custom crosshair) ----------

function drawCrosshair(c: HTMLCanvasElement, s: Settings) {
    const g = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    g.clearRect(0, 0, c.width, c.height)
    const k = 2.25 * dpr // game units are 640x480 pixels; this is a 1080p screen
    const cx = Math.round(c.width / 2), cy = Math.round(c.height / 2)
    const [r, gg, b] = rgb(s.crossColor)
    const alpha = s.crossAlpha / 255
    const rects: [number, number, number, number][] = []
    let pad = 0
    if (s.crossStyle === 'custom') {
        const gap = Math.round((4 + s.crossGap) * k)
        const len = Math.round(s.crossSize * k)
        const th = Math.max(1, Math.round(s.crossThick * k))
        const x0 = cx - (th >> 1), y0 = cy - (th >> 1), x1 = x0 + th, y1 = y0 + th
        const il = cx - gap - (th >> 1), ir = il + 2 * gap + th
        const it = cy - gap - (th >> 1), ib = it + 2 * gap + th
        if (s.crossDot) rects.push([x0, y0, x1, y1])
        if (!s.crossT) rects.push([x0, it - len, x1, it])
        rects.push([x0, ib, x1, ib + len], [il - len, y0, il, y1], [ir, y0, ir + len, y1])
        pad = s.crossOutline ? Math.max(1, Math.round(dpr)) : 0
    } else {
        // ponytail: classic crosshair drawn approximately (its size depends on the weapon)
        const len = {small: 5, auto: 6, medium: 6, large: 8}[s.crossClassicSize] * k
        const gap = 5 * k
        const th = Math.max(1, Math.round(k / 2))
        rects.push([cx - th / 2, cy - gap - len, cx + th / 2, cy - gap], [cx - th / 2, cy + gap, cx + th / 2, cy + gap + len],
            [cx - gap - len, cy - th / 2, cx - gap, cy + th / 2], [cx + gap, cy - th / 2, cx + gap + len, cy + th / 2])
    }
    if (pad) {
        g.fillStyle = `rgba(0,0,0,${alpha})`
        for (const [x0, y0, x1, y1] of rects) g.fillRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)
    }
    g.fillStyle = `rgba(${r},${gg},${b},${alpha})`
    for (const [x0, y0, x1, y1] of rects) g.fillRect(x0, y0, x1 - x0, y1 - y0)
}

const CROSS_COLORS: [string, string][] = [
    ['Green', '#32fa32'], ['Red', '#ff3232'], ['Yellow', '#ffe632'], ['Cyan', '#32e6ff'], ['Pink', '#ff50dc'], ['White', '#ffffff'],
]

// ---------- DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    Object.assign(e, props)
    e.append(...kids)
    return e
}

function button(label: string, fn: () => void, className = 'secondary') {
    const b = el('button', {className, textContent: label})
    b.addEventListener('click', fn)
    return b
}

/** what the pause screen shows the lobby host */
export type HostPanel = {
    code: string
    link: string
    guests: number
    maps: string[]
    modes: [string, string][]
    map: string
    mode: string
    change: (map: string, mode: string) => void
}

type Hooks = {
    engine: () => Xash3D | undefined // undefined on the homepage
    quitHome: () => void
    touch: () => boolean
    enterFullscreen: () => void
    openQuick: () => void
    host: () => HostPanel | undefined
}

export function initSettings(hooks: Hooks) {
    const s = loadSettings()
    const root = document.getElementById('settings')!
    const title = el('h2')
    const tabs = el('nav', {className: 'menu-tabs'})
    const body = el('div', {className: 'settings-body'})
    const backBtn = el('button', {className: 'secondary'})
    const hint = el('span')
    root.append(el('div', {className: 'menu-panel'},
        el('header', {className: 'menu-head'}, title, tabs),
        body,
        el('footer', {className: 'menu-foot'}, backBtn, hint)))

    let view: 'pause' | 'settings' | undefined
    let fromPause = false
    let tab = 0
    let capturing: string | undefined
    let gameMenuOpen = false // the engine's own menu is up; leave Esc and the mouse to it
    let applyQueued = false
    let watching = false
    let preview: HTMLCanvasElement | undefined

    function changed() {
        saveSettings(s)
        if (preview) drawCrosshair(preview, s)
        const x = hooks.engine()
        if (!x || applyQueued) return
        applyQueued = true
        requestAnimationFrame(() => { applyQueued = false; applySettings(x, s) })
    }

    function row(label: string, ...ctl: Node[]) {
        return el('label', {className: 'set-row'}, el('span', {textContent: label}), el('span', {className: 'set-ctl'}, ...ctl))
    }

    function range(label: string, key: NumKey, min: number, max: number, step: number, fmt: (v: number) => string) {
        const out = el('output', {textContent: fmt(s[key])})
        const input = el('input', {type: 'range', min: String(min), max: String(max), step: String(step), value: String(s[key])})
        input.addEventListener('input', () => {
            s[key] = Number(input.value)
            out.textContent = fmt(s[key])
            changed()
        })
        return row(label, input, out)
    }

    function toggle(label: string, key: BoolKey) {
        const input = el('input', {type: 'checkbox', checked: s[key]})
        input.addEventListener('change', () => { s[key] = input.checked; changed() })
        return row(label, input)
    }

    function choice<K extends 'crossStyle' | 'crossClassicSize'>(label: string, key: K, options: [Settings[K], string][], rerender = false) {
        const sel = el('select')
        sel.dataset.id = key
        sel.append(...options.map(([v, l]) => new Option(l, v)))
        sel.value = s[key]
        sel.addEventListener('change', () => {
            s[key] = sel.value as Settings[K]
            changed()
            if (rerender) render(key)
        })
        return row(label, sel)
    }

    function remapRows() {
        const rows = ACTIONS.map(a => {
            const btn = el('button', {className: 'bind', textContent: capturing === a.id ? 'Press a button…' : keyLabel(s.pad[a.id])})
            btn.dataset.id = `bind-${a.id}`
            if (capturing === a.id) btn.classList.add('listening')
            btn.addEventListener('click', () => listen(a.id))
            return el('div', {className: 'set-row'}, el('span', {textContent: a.label}), el('span', {className: 'set-ctl'}, btn))
        })
        return [
            el('h3', {textContent: 'Buttons'}),
            el('p', {className: 'msg', textContent: 'Choose an action, then press the controller button you want for it. ' +
                    'Weapons on the floor are picked up by walking over them; drop yours first to swap. CS 1.6 has no sprint: you always run, and Walk makes your steps silent.'}),
            ...rows,
            button('Reset buttons to default', () => { s.pad = defaultPad(); changed(); render() }),
        ]
    }

    function listen(id: string) {
        capturing = id
        render(`bind-${id}`)
        watchPad(() => capturing === id, i => {
            const key = PAD_BUTTONS[i]?.key
            if (!key) return
            const other = ACTIONS.find(o => o.id !== id && s.pad[o.id] === key)
            if (other) s.pad[other.id] = s.pad[id] // swap so nothing is lost
            s.pad[id] = key
            capturing = undefined
            changed()
            render(`bind-${id}`)
        })
        setTimeout(() => { if (capturing === id) { capturing = undefined; render(`bind-${id}`) } }, 8000)
    }

    function crosshairRows(): Node[] {
        preview = el('canvas', {className: 'xhair-preview'})
        requestAnimationFrame(() => preview && drawCrosshair(preview, s))
        const color = el('input', {type: 'color', value: s.crossColor})
        color.addEventListener('input', () => { s.crossColor = color.value; changed() })
        const swatches = CROSS_COLORS.map(([name, hex]) => {
            const b = button('', () => { s.crossColor = color.value = hex; changed() }, 'swatch')
            b.style.background = hex
            b.title = b.ariaLabel = name
            return b
        })
        const custom = s.crossStyle === 'custom'
        return [
            preview,
            choice('Style', 'crossStyle', [['classic', 'Classic CS 1.6'], ['custom', 'Custom']], true),
            el('div', {className: 'set-row'}, el('span', {textContent: 'Color'}), el('span', {className: 'set-ctl swatches'}, ...swatches, color)),
            range('Opacity', 'crossAlpha', 40, 255, 5, v => `${Math.round(v / 255 * 100)}%`),
            ...(custom ? [
                range('Length', 'crossSize', 1, 15, 0.5, v => v.toFixed(1)),
                range('Gap', 'crossGap', -4, 10, 0.5, v => v.toFixed(1)),
                range('Thickness', 'crossThick', 0.5, 4, 0.5, v => v.toFixed(1)),
                toggle('Black outline', 'crossOutline'),
                toggle('Center dot', 'crossDot'),
                toggle('T shape (no top line)', 'crossT'),
            ] : [
                choice('Size', 'crossClassicSize', [['auto', 'Auto'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
            ]),
            toggle('Opens up when moving and shooting', 'crossDynamic'),
        ]
    }

    const TABS: [string, () => Node[]][] = [
        ['Controller', () => [
            range('Look speed (left / right)', 'lookX', 50, 600, 10, v => String(v)),
            range('Look speed (up / down)', 'lookY', 50, 600, 10, v => String(v)),
            toggle('Invert up / down', 'invertLook'),
            range('Stick deadzone', 'deadzone', 0, 40, 1, v => `${v}%`),
            toggle('Toggle crouch (press once instead of holding)', 'crouchToggle'),
            ...remapRows(),
        ]],
        ['Crosshair', crosshairRows],
        ['Mouse', () => [
            range('Mouse sensitivity', 'mouseSens', 0.5, 10, 0.1, v => v.toFixed(1)),
            toggle('Invert mouse', 'invertMouse'),
            el('p', {className: 'msg', textContent: 'Keyboard keys: Pause menu → Game menu → Configuration → Controls.'}),
        ]],
        ['Video & audio', () => [
            range('Brightness', 'brightness', 0, 2, 0.05, v => v.toFixed(2)),
            toggle('Show FPS', 'showFps'),
            range('Volume', 'volume', 0, 1, 0.05, v => `${Math.round(v * 100)}%`),
            range('Music volume', 'music', 0, 1, 0.05, v => `${Math.round(v * 100)}%`),
        ]],
    ]

    function hostRows(h: HostPanel): Node[] {
        const copy = button('Copy invite link', async () => {
            try {
                await navigator.clipboard.writeText(h.link)
                copy.textContent = 'Copied!'
            } catch {
                copy.replaceWith(el('input', {type: 'text', value: h.link, readOnly: true, className: 'invite-link'}))
            }
        })
        const map = el('select')
        map.dataset.id = 'host-map'
        map.append(...h.maps.map(m => new Option(m, m)))
        map.value = h.map
        const mode = el('select')
        mode.dataset.id = 'host-mode'
        mode.append(...h.modes.map(([id, label]) => new Option(label, id)))
        mode.value = h.mode
        return [
            el('div', {className: 'invite'},
                el('span', {}, 'Lobby code ', el('strong', {textContent: h.code}),
                    ` · ${h.guests} friend${h.guests === 1 ? '' : 's'} connected`),
                copy),
            el('div', {className: 'host-change'}, mode, map,
                button('Change map', () => { close(); h.change(map.value, mode.value) })),
        ]
    }

    function pauseButtons() {
        const inGame = !!hooks.engine()
        const host = inGame ? hooks.host() : undefined
        const items: [string, () => void][] = [
            ['Resume', close],
        ]
        if (inGame) items.push(['Quick menu: drop weapon, radio, chat', () => { close(false); hooks.openQuick() }])
        items.push(['Settings', () => { fromPause = true; show('settings') }])
        if (inGame) {
            items.push(['Change team', () => { close(); hooks.engine()?.Cmd_ExecuteString('chooseteam') }])
            if (hooks.touch()) {
                items.push(['Edit touch layout', () => { close(false); hooks.engine()?.Cmd_ExecuteString('touch_enableedit') }])
                if (document.fullscreenEnabled && !document.fullscreenElement) {
                    items.push(['Fullscreen', () => { hooks.enterFullscreen(); close(false) }])
                }
            }
            items.push(
                ['Game menu (advanced)', () => { gameMenuOpen = true; close(false); hooks.engine()?.Cmd_ExecuteString('togglemenu') }],
                [host ? 'Close the lobby and quit' : 'Quit to JOUCS home', () => { close(false); hooks.quitHome() }],
            )
        }
        return [
            ...(host ? hostRows(host) : []),
            el('div', {className: 'pause-list'}, ...items.map(([label, fn]) => button(label, fn))),
        ]
    }

    /** rebuild the current view; focusId re-focuses the control with that data-id */
    function render(focusId?: string) {
        preview = undefined
        if (view === 'settings') {
            title.textContent = 'Settings'
            tabs.replaceChildren(...TABS.map(([name], i) => {
                const b = button(name, () => { tab = i; render(); tabs.querySelectorAll('button')[i]?.focus() }, '')
                b.setAttribute('role', 'tab')
                b.setAttribute('aria-selected', String(i === tab))
                return b
            }))
            body.replaceChildren(...TABS[tab][1]())
            backBtn.textContent = fromPause ? 'Back' : 'Done'
            hint.textContent = 'A select · B back · D-pad move · ←/→ adjust · LB/RB tab'
        } else {
            title.textContent = 'Paused'
            tabs.replaceChildren()
            body.replaceChildren(...pauseButtons())
            backBtn.textContent = 'Resume'
            hint.textContent = 'A select · B resume · D-pad move'
        }
        if (focusId) body.querySelector<HTMLElement>(`[data-id="${focusId}"]`)?.focus()
    }

    function show(v: 'pause' | 'settings') {
        const opening = !view
        view = v
        render()
        root.hidden = false
        if (opening) {
            document.exitPointerLock?.()
            screenOpen(hooks.engine(), 'settings', true)
            if (!watching) {
                watching = true
                watchPad(() => {
                    if (!view) watching = false
                    return !!view
                }, onPad, onStick)
            }
        }
        focusables()[0]?.focus()
    }

    function close(relock = true) {
        if (!view) return
        view = undefined
        capturing = undefined
        preview = undefined
        root.hidden = true
        const x = hooks.engine()
        screenOpen(x, 'settings', false)
        if (x && relock) {
            // only works when this came from a click or key press; otherwise click the game
            try {
                Promise.resolve(document.getElementById('canvas')?.requestPointerLock?.()).catch(() => undefined)
            } catch { /* not allowed without a user gesture */ }
        }
    }

    function back() {
        if (capturing) { capturing = undefined; render(); return }
        if (view === 'settings' && fromPause) { fromPause = false; show('pause') }
        else close()
    }
    backBtn.addEventListener('click', back)

    // ---------- navigation: controller and keyboard ----------

    function focusables() {
        return [...root.querySelectorAll<HTMLElement>('button, input, select')].filter(e => e.offsetParent !== null)
    }

    function moveFocus(d: number) {
        const f = focusables()
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = f[Math.max(0, Math.min(f.length - 1, i < 0 ? 0 : i + d))]
        next?.focus()
        next?.scrollIntoView({block: 'nearest'})
    }

    function adjust(d: number) {
        const a = document.activeElement
        if (a instanceof HTMLInputElement && a.type === 'range') {
            if (d > 0) a.stepUp()
            else a.stepDown()
            a.dispatchEvent(new Event('input', {bubbles: true}))
        } else if (a instanceof HTMLInputElement && a.type === 'checkbox') {
            a.click()
        } else if (a instanceof HTMLSelectElement) {
            a.selectedIndex = Math.max(0, Math.min(a.length - 1, a.selectedIndex + d))
            a.dispatchEvent(new Event('change', {bubbles: true}))
        } else if (a?.getAttribute('role') === 'tab') {
            switchTab(d)
        } else {
            moveFocus(d) // rows of buttons (color swatches)
        }
    }

    function switchTab(d: number) {
        if (view !== 'settings') return
        tab = (tab + d + TABS.length) % TABS.length
        render()
        tabs.querySelectorAll('button')[tab]?.focus()
    }

    function onPad(b: number) {
        if (capturing) return // the press goes to the remap listener
        if (b === BTN.A) (document.activeElement as HTMLElement | null)?.click()
        else if (b === BTN.B) back()
        else if (b === BTN.START) close()
        else if (b === BTN.UP) moveFocus(-1)
        else if (b === BTN.DOWN) moveFocus(1)
        else if (b === BTN.LEFT) adjust(-1)
        else if (b === BTN.RIGHT) adjust(1)
        else if (b === BTN.LB) switchTab(-1)
        else if (b === BTN.RB) switchTab(1)
    }

    function onStick(dx: number, dy: number) {
        if (capturing) return
        if (dy) moveFocus(dy)
        else adjust(dx)
    }

    window.addEventListener('keydown', e => {
        if (!view) {
            // Esc in game opens this pause screen instead of the engine menu
            if (e.key === 'Escape' && hooks.engine() && !gameMenuOpen && !document.querySelector('#menu:not([hidden])')) {
                e.stopImmediatePropagation()
                e.preventDefault()
                show('pause')
            }
            return
        }
        e.stopImmediatePropagation() // the game must not see keys typed here
        if (e.key === 'Escape') { e.preventDefault(); back() }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (!(document.activeElement instanceof HTMLSelectElement)) {
                e.preventDefault()
                moveFocus(e.key === 'ArrowUp' ? -1 : 1)
            }
        }
    }, true)
    window.addEventListener('keyup', e => { if (view) e.stopImmediatePropagation() }, true)

    // losing the mouse in game (Esc, alt-tab) pauses, like most web games
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement) { gameMenuOpen = false; return }
        if (hooks.engine() && !view && !gameMenuOpen && !document.querySelector('#menu:not([hidden])')) show('pause')
    })

    return {
        isOpen: () => !!view,
        openSettings: () => { fromPause = false; show('settings') },
        openPause: () => show('pause'),
        onLine(line: string) {
            if (!line.includes('JOUCS_MENU pause')) return
            setTimeout(() => {
                if (view) close()
                else if (!document.querySelector('#menu:not([hidden])')) { gameMenuOpen = false; show('pause') }
            }, 0)
        },
    }
}
