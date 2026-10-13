// Standard Gamepad API button indices (https://w3c.github.io/gamepad/#remapping)
export const BTN = {A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15} as const

export function pressedNow(): boolean[] {
    const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p)
    return pad ? pad.buttons.map(b => b.pressed) : []
}

/**
 * Edge-triggered controller buttons, plus a repeating left stick, for as long as
 * active() is true. Buttons already held when it starts are ignored until released
 * (e.g. the button that opened a menu).
 */
export function watchPad(active: () => boolean, onPress: (button: number) => void, onStick?: (dx: number, dy: number) => void) {
    let prev = pressedNow()
    let stickAt = 0
    const tick = (now: number) => {
        if (!active()) return
        const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p)
        if (pad) {
            const down = pad.buttons.map(b => b.pressed)
            down.forEach((d, i) => { if (d && !prev[i]) onPress(i) })
            prev = down
            const [ax = 0, ay = 0] = pad.axes
            if (onStick && Math.max(Math.abs(ax), Math.abs(ay)) > 0.6 && now - stickAt > 220) {
                stickAt = now
                if (Math.abs(ax) > Math.abs(ay)) onStick(Math.sign(ax), 0)
                else onStick(0, Math.sign(ay))
            }
        }
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
}

// ---------- what the game sees ----------
// The engine reads the controller through navigator.getGamepads(), so the
// right stick is shaped here: a round deadzone, then a response curve that
// makes small movements aim finely while full tilt still turns at full speed.
// Calls also report controller use, which switches aim assist on.

let stick = {deadzone: 0.12, curve: 2}
let lastButtons: boolean[] = []
let activity: (() => void) | undefined

export function shapeRightStick(deadzone: number, curve: number) {
    stick = {deadzone: Math.min(0.9, Math.max(0, deadzone)), curve: Math.max(1, curve)}
}

export function onPadActivity(fn: () => void) {
    activity = fn
}

/** right stick (x, y) after deadzone and curve; same direction, new length */
export function shapeStick(x: number, y: number, deadzone = stick.deadzone, curve = stick.curve): [number, number] {
    const m = Math.hypot(x, y)
    if (m <= deadzone) return [0, 0]
    const out = Math.pow(Math.min(1, (m - deadzone) / (1 - deadzone)), curve)
    return [x / m * out, y / m * out]
}

function shaped(p: Gamepad): Gamepad {
    const axes = [...p.axes]
    if (p.mapping === 'standard' && axes.length >= 4) [axes[2], axes[3]] = shapeStick(axes[2], axes[3])
    // a newly pressed button or a pushed stick (not one held down while using the mouse)
    const buttons = p.buttons.map(b => b.pressed)
    if (activity && (buttons.some((b, i) => b && !lastButtons[i]) || p.axes.some(a => Math.abs(a) > 0.3))) activity()
    lastButtons = buttons
    return {
        id: p.id, index: p.index, connected: p.connected, mapping: p.mapping, timestamp: p.timestamp,
        buttons: p.buttons, axes, vibrationActuator: p.vibrationActuator,
    } as unknown as Gamepad
}

const rawGetGamepads = navigator.getGamepads?.bind(navigator)
if (rawGetGamepads) {
    navigator.getGamepads = () => rawGetGamepads().map(p => p && shaped(p)) as ReturnType<Navigator['getGamepads']>
}

/** shake the controller: strong = big motor, weak = small motor (0..1), for ms */
export function rumble(strong: number, weak: number, ms: number) {
    for (const p of rawGetGamepads?.() ?? []) {
        const motor = (p as Gamepad & { vibrationActuator?: GamepadHapticActuator & { playEffect?: Function } })?.vibrationActuator
        motor?.playEffect?.('dual-rumble', {startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak)})
            ?.catch?.(() => undefined)
    }
}
