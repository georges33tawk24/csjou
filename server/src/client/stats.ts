import {BTN, watchPad} from './pad'

// Match stats from the game's kill lines (cl_dll/death.cpp prints them to the
// console): kills, deaths and headshots per player, Gun Game levels, the MVP.
// Shown when a map ends, from the pause menu, and on the homepage afterwards,
// with all-time totals for this device.

export type Row = { name: string; kills: number; deaths: number; headshots: number; level?: number }
export type Summary = { map: string; mode: string; rows: Row[]; mvp?: string; winner?: string; me: string }

const TOTALS = 'joucsTotals'
const LAST = 'joucsLastMatch'

type Totals = { kills: number; deaths: number; headshots: number; matches: number }

export function loadTotals(): Totals {
    try { return {kills: 0, deaths: 0, headshots: 0, matches: 0, ...JSON.parse(localStorage.getItem(TOTALS) ?? '{}')} }
    catch { return {kills: 0, deaths: 0, headshots: 0, matches: 0} }
}

export function lastMatch(): Summary | undefined {
    try { return JSON.parse(localStorage.getItem(LAST) ?? 'null') ?? undefined } catch { return undefined }
}

/** one console line -> what happened, or nothing */
export function parseKill(line: string): { killer?: string; victim: string; headshot: boolean } | undefined {
    const l = line.replace(/^\[\d\d:\d\d:\d\d\] /, '').trimEnd()
    if (l.includes(' : ')) return undefined // chat
    let m = /^(.+?) died$/.exec(l) ?? /^(.+?) killed self\b/.exec(l)
    if (m) return {victim: m[1], headshot: false}
    if ((m = /^(.+?) killed his teammate (.+)$/.exec(l))) return {victim: m[2], headshot: false}
    m = /^(\*\*\* )?(.+?) killed (.+?)( with (a headshot from )?\S+)?( \*\*\*)?$/.exec(l)
    if (!m || (!m[4] && m[3].startsWith('a '))) return undefined // "killed a hostage" and the like
    return {killer: m[2], victim: m[3], headshot: !!m[1] || !!m[5]}
}

export function createStats(me: () => string) {
    const players = new Map<string, Row>()
    let winner: string | undefined
    let counted = false
    const row = (name: string) => {
        let r = players.get(name)
        if (!r) players.set(name, r = {name, kills: 0, deaths: 0, headshots: 0})
        return r
    }

    function rows() {
        return [...players.values()].sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || b.kills - a.kills || a.deaths - b.deaths)
    }

    return {
        onLine(line: string) {
            let m = /JOUCS_GUNGAME (\d+) (.+)$/.exec(line)
            if (m) { row(m[2].trim()).level = Number(m[1]); return }
            if ((m = /JOUCS_GUNGAME_WIN (.+)$/.exec(line))) { winner = m[1].trim(); return }
            const k = parseKill(line)
            if (!k) return
            row(k.victim).deaths++
            if (k.killer) {
                const r = row(k.killer)
                r.kills++
                if (k.headshot) r.headshots++
            }
        },
        summary(map: string, mode: string): Summary {
            const list = rows()
            const best = list.find(r => r.kills > 0)
            return {map, mode, rows: list, mvp: winner ?? best?.name, winner, me: me()}
        },
        /** the map is over: remember it for the homepage and add it to this device's totals */
        finish(map: string, mode: string) {
            const s = this.summary(map, mode)
            if (!s.rows.length) return s
            try {
                localStorage.setItem(LAST, JSON.stringify(s))
                if (!counted) {
                    const mine = s.rows.find(r => r.name === s.me)
                    const t = loadTotals()
                    localStorage.setItem(TOTALS, JSON.stringify({
                        kills: t.kills + (mine?.kills ?? 0), deaths: t.deaths + (mine?.deaths ?? 0),
                        headshots: t.headshots + (mine?.headshots ?? 0), matches: t.matches + 1,
                    }))
                }
            } catch { /* stats just won't persist */ }
            counted = true
            return s
        },
        reset() {
            players.clear()
            winner = undefined
            counted = false
        },
    }
}

// ---------- the summary screen ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
    const e = document.createElement(tag)
    Object.assign(e, props)
    e.append(...kids)
    return e
}

export function summaryTable(s: Summary): HTMLElement {
    const gungame = s.rows.some(r => r.level !== undefined)
    const head = ['Player', ...gungame ? ['Level'] : [], 'Kills', 'Deaths', 'Headshots']
    return el('table', {className: 'stats'},
        el('thead', {}, el('tr', {}, ...head.map(h => el('th', {textContent: h})))),
        el('tbody', {}, ...s.rows.map(r => {
            const tr = el('tr', {},
                el('td', {textContent: r.name + (r.name === s.mvp ? '  ★' : '')}),
                ...gungame ? [el('td', {textContent: String(r.level ?? 1)})] : [],
                el('td', {textContent: String(r.kills)}),
                el('td', {textContent: String(r.deaths)}),
                el('td', {textContent: String(r.headshots)}))
            if (r.name === s.me) tr.className = 'me'
            return tr
        })))
}

/** shows a summary over the game until A / Enter / Esc / click; onOpen(true/false) frees the controller */
export function showSummary(s: Summary, onOpen: (open: boolean) => void) {
    const root = document.getElementById('summary')!
    const done = el('button', {className: 'secondary', textContent: 'Continue'})
    const title = s.winner ? `${s.winner} wins Gun Game!` : `Match over · ${s.map}`
    root.replaceChildren(el('div', {className: 'menu-panel'},
        el('header', {className: 'menu-head'}, el('h2', {textContent: title}),
            el('p', {className: 'msg', textContent: `${s.mode}${s.mvp ? ` · MVP: ${s.mvp}` : ''}`})),
        el('div', {className: 'settings-body'}, s.rows.length ? summaryTable(s) : el('p', {className: 'msg', textContent: 'No kills yet.'})),
        el('footer', {className: 'menu-foot'}, done, el('span', {textContent: 'A / Enter: continue'}))))
    root.hidden = false
    document.exitPointerLock?.()
    onOpen(true)
    let open = true
    const close = () => {
        if (!open) return
        open = false
        root.hidden = true
        window.removeEventListener('keydown', onKey, true)
        onOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
        e.stopImmediatePropagation()
        if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); close() }
    }
    window.addEventListener('keydown', onKey, true)
    done.addEventListener('click', close)
    watchPad(() => open, b => { if (b === BTN.A || b === BTN.B || b === BTN.START) close() })
    done.focus()
}

export const summaryOpen = () => !document.getElementById('summary')?.hidden
