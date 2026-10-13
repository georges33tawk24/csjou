// Standard Gamepad API button indices (https://w3c.github.io/gamepad/#remapping)
export const BTN = {A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15} as const

function pressedNow(): boolean[] {
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
