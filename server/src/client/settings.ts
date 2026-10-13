import type {Xash3D} from 'xash3d-fwgs'
import {BTN, watchPad} from './pad'

// JOUCS settings (controller, mouse, video, audio) and the pause screen.
// Settings live in localStorage and are applied as console commands on every
// launch and whenever they change in game.

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
    pad: Record<string, string> // action id -> engine key name ('' = none)
}

type Action = { id: string; label: string; cmd: string; key: string }

// cmd is what the key runs; key is the default button (engine key names)
const ACTIONS: Action[] = [
    {id: 'shoot', label: 'Shoot', cmd: '+attack', key: 'RTRIGGER'},
    {id: 'scope', label: 'Scope / alt fire', cmd: '+attack2', key: 'LTRIGGER'},
    {id: 'jump', label: 'Jump', cmd: '+jump', key: 'A_BUTTON'},
    {id: 'crouch', label: 'Crouch', cmd: '+duck', key: 'B_BUTTON'},
    {id: 'reload', label: 'Reload', cmd: '+reload', key: 'X_BUTTON'},
    {id: 'use', label: 'Use / defuse', cmd: '+use', key: 'Y_BUTTON'},
    {id: 'next', label: 'Next weapon', cmd: 'invnext', key: 'R1_BUTTON'},
    {id: 'prev', label: 'Previous weapon', cmd: 'invprev', key: 'L1_BUTTON'},
    {id: 'walk', label: 'Walk quietly', cmd: '+speed', key: 'STICK1'},
    {id: 'knife', label: 'Knife', cmd: 'slot3', key: 'STICK2'},
    {id: 'shop', label: 'Open the shop', cmd: 'buy', key: 'DPAD_UP'},
    {id: 'rebuy', label: 'Rebuy last round', cmd: 'rebuy', key: 'DPAD_DOWN'},
    {id: 'primary', label: 'Primary weapon', cmd: 'slot1', key: 'DPAD_LEFT'},
    {id: 'pistol', label: 'Pistol', cmd: 'slot2', key: 'DPAD_RIGHT'},
    {id: 'scores', label: 'Scoreboard', cmd: '+showscores', key: 'BACK'},
    {id: 'pause', label: 'Pause menu', cmd: 'joucs_pause', key: 'START'},
    {id: 'grenade', label: 'Grenades', cmd: 'slot4', key: ''},
    {id: 'drop', label: 'Drop weapon', cmd: 'drop', key: ''},
    {id: 'nvg', label: 'Night vision', cmd: 'nightvision', key: ''},
    {id: 'light', label: 'Flashlight', cmd: 'impulse 100', key: ''},
    {id: 'spray', label: 'Spray', cmd: 'impulse 201', key: ''},
    {id: 'voice', label: 'Voice chat (hold)', cmd: '+voicerecord', key: ''},
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
    lookX: 220, lookY: 160, invertLook: false, deadzone: 12, crouchToggle: false,
    mouseSens: 3, invertMouse: false, brightness: 0, showFps: false, volume: 0.7, music: 1,
}

export function loadSettings(): Settings {
    try {
        const saved = JSON.parse(localStorage.getItem('joucsSettings') ?? '{}')
        return {...DEFAULTS, ...saved, pad: {...defaultPad(), ...saved.pad}}
    } catch {
        return {...DEFAULTS, pad: defaultPad()}
    }
}

function saveSettings(s: Settings) {
    try { localStorage.setItem('joucsSettings', JSON.stringify(s)) } catch { /* settings just won't persist */ }
}

function engineCommands(s: Settings): string[] {
    const dz = Math.round(s.deadzone / 100 * 32767)
    return [
        `joy_yaw ${s.lookX}`,
        `joy_pitch ${s.invertLook ? -s.lookY : s.lookY}`,
        ...['forward', 'side', 'pitch', 'yaw'].map(axis => `joy_${axis}_deadzone ${dz}`),
        `sensitivity ${s.mouseSens}`,
        `m_pitch ${s.invertMouse ? -0.022 : 0.022}`,
        `brightness ${s.brightness}`,
        `cl_showfps ${s.showFps ? 1 : 0}`,
        `volume ${s.volume}`,
        `MP3Volume ${s.music}`,
        // toggle crouch: a non-"+" bind runs on press only, so the alias flips itself
        'alias joucs_crouch_on "+duck; alias joucs_crouch joucs_crouch_off"',
        'alias joucs_crouch_off "-duck; alias joucs_crouch joucs_crouch_on"',
        'alias joucs_crouch joucs_crouch_on',
        'alias joucs_pause "echo JOUCS_MENU pause"',
        ...PAD_BUTTONS.map(b => `unbind ${b.key}`),
        ...ACTIONS.filter(a => s.pad[a.id]).map(a =>
            `bind ${s.pad[a.id]} "${a.id === 'crouch' && s.crouchToggle ? 'joucs_crouch' : a.cmd}"`),
    ]
}

export function applySettings(x: Xash3D, s: Settings) {
    for (const cmd of engineCommands(s)) x.Cmd_ExecuteString(cmd)
}

function keyLabel(key: string) {
    return PAD_BUTTONS.find(b => b.key === key)?.label ?? 'Not set'
}

// ---------- DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    Object.assign(e, props)
    e.append(...kids)
    return e
}

type Hooks = {
    engine: () => Xash3D | undefined // undefined on the homepage
    quitHome: () => void
    touch: () => boolean
    enterFullscreen: () => void
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

    function changed() {
        saveSettings(s)
        const x = hooks.engine()
        if (!x || applyQueued) return
        applyQueued = true
        requestAnimationFrame(() => { applyQueued = false; applySettings(x, s) })
    }

    function range(label: string, key: 'lookX' | 'lookY' | 'deadzone' | 'mouseSens' | 'brightness' | 'volume' | 'music',
                   min: number, max: number, step: number, fmt: (v: number) => string) {
        const out = el('output', {textContent: fmt(s[key])})
        const input = el('input', {type: 'range', min: String(min), max: String(max), step: String(step), value: String(s[key])})
        input.addEventListener('input', () => {
            s[key] = Number(input.value)
            out.textContent = fmt(s[key])
            changed()
        })
        return el('label', {className: 'set-row'}, el('span', {textContent: label}), el('span', {className: 'set-ctl'}, input, out))
    }

    function toggle(label: string, key: 'invertLook' | 'crouchToggle' | 'invertMouse' | 'showFps') {
        const input = el('input', {type: 'checkbox', checked: s[key]})
        input.addEventListener('change', () => { s[key] = input.checked; changed() })
        return el('label', {className: 'set-row'}, el('span', {textContent: label}), el('span', {className: 'set-ctl'}, input))
    }

    function remapRows() {
        const rows = ACTIONS.map(a => {
            const btn = el('button', {className: 'bind', textContent: capturing === a.id ? 'Press a button…' : keyLabel(s.pad[a.id])})
            if (capturing === a.id) btn.classList.add('listening')
            btn.addEventListener('click', () => listen(a.id))
            return el('div', {className: 'set-row'}, el('span', {textContent: a.label}), el('span', {className: 'set-ctl'}, btn))
        })
        const reset = el('button', {className: 'secondary', textContent: 'Reset buttons to default'})
        reset.addEventListener('click', () => { s.pad = defaultPad(); changed(); render() })
        return [el('h3', {textContent: 'Buttons'}), el('p', {className: 'msg', textContent: 'Choose an action, then press the controller button you want for it.'}), ...rows, reset]
    }

    function listen(id: string) {
        capturing = id
        render(id)
        watchPad(() => capturing === id, i => {
            const key = PAD_BUTTONS[i]?.key
            if (!key) return
            const other = ACTIONS.find(o => o.id !== id && s.pad[o.id] === key)
            if (other) s.pad[other.id] = s.pad[id] // swap so nothing is lost
            s.pad[id] = key
            capturing = undefined
            changed()
            render(id)
        })
        setTimeout(() => { if (capturing === id) { capturing = undefined; render(id) } }, 8000)
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

    function pauseButtons() {
        const inGame = !!hooks.engine()
        const items: [string, () => void][] = [
            ['Resume', close],
            ['Settings', () => { fromPause = true; show('settings') }],
        ]
        if (inGame) {
            items.push(
                ['Change team', () => { close(); hooks.engine()?.Cmd_ExecuteString('chooseteam') }],
            )
            if (hooks.touch()) {
                items.push(['Edit touch layout', () => { close(false); hooks.engine()?.Cmd_ExecuteString('touch_enableedit') }])
                if (document.fullscreenEnabled && !document.fullscreenElement) {
                    items.push(['Fullscreen', () => { hooks.enterFullscreen(); close(false) }])
                }
            }
            items.push(
                ['Game menu (advanced)', () => { gameMenuOpen = true; close(false); hooks.engine()?.Cmd_ExecuteString('togglemenu') }],
                ['Quit to JOUCS home', () => { close(false); hooks.quitHome() }],
            )
        }
        return [el('div', {className: 'pause-list'}, ...items.map(([label, fn]) => {
            const b = el('button', {className: 'secondary', textContent: label})
            b.addEventListener('click', fn)
            return b
        }))]
    }

    /** rebuild the current view; keepFocus re-focuses the remap button for that action */
    function render(keepFocus?: string) {
        if (view === 'settings') {
            title.textContent = 'Settings'
            tabs.replaceChildren(...TABS.map(([name], i) => {
                const b = el('button', {textContent: name})
                b.setAttribute('role', 'tab')
                b.setAttribute('aria-selected', String(i === tab))
                b.addEventListener('click', () => { tab = i; render(); tabs.querySelectorAll('button')[i]?.focus() })
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
        if (keepFocus) {
            const i = ACTIONS.findIndex(a => a.id === keepFocus)
            body.querySelectorAll<HTMLElement>('button.bind')[i]?.focus()
        }
    }

    function show(v: 'pause' | 'settings') {
        const opening = !view
        view = v
        render()
        root.hidden = false
        if (opening) {
            document.exitPointerLock?.()
            hooks.engine()?.Cmd_ExecuteString('joy_enable 0') // keep the player still while navigating
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
        root.hidden = true
        const x = hooks.engine()
        x?.Cmd_ExecuteString('joy_enable 1')
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
        } else if (a?.getAttribute('role') === 'tab') {
            switchTab(d)
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
