import type JSZip from 'jszip'
import type {Xash3D} from 'xash3d-fwgs'

// JOUCS team / character / buy screens, drawn over the game.
//
// The CS client runs touch/<menu>.cfg whenever the server opens a VGUI menu
// (team select, class select, buy). We replace those files with one-line
// `echo JOUCS_MENU <kind>` scripts and open our own screen when that line
// shows up in the engine log. Loose files win over extras.pk3.

type Team = 't' | 'ct'
type Kind = 'team' | 'class_t' | 'class_ct' | 'buy'
type Card = { label: string; cmd: string; img?: string; price?: number; team?: Team }

const TEAM_CARDS: Card[] = [
    {label: 'Terrorists', img: 'terror', cmd: 'jointeam 1'},
    {label: 'Counter-Terrorists', img: 'urban', cmd: 'jointeam 2'},
    {label: 'Auto-select', cmd: 'jointeam 5'},
    {label: 'Spectate', cmd: 'jointeam 6'},
]

const CLASS_CARDS: Record<Team, Card[]> = {
    t: [
        {label: 'Phoenix Connexion', img: 'terror', cmd: 'joinclass 1'},
        {label: 'Elite Crew', img: 'leet', cmd: 'joinclass 2'},
        {label: 'Arctic Avengers', img: 'arctic', cmd: 'joinclass 3'},
        {label: 'Guerilla Warfare', img: 'guerilla', cmd: 'joinclass 4'},
        {label: 'Auto-select', img: 't_random', cmd: 'joinclass 5'},
    ],
    ct: [
        {label: 'SEAL Team 6', img: 'urban', cmd: 'joinclass 1'},
        {label: 'GSG-9', img: 'gsg9', cmd: 'joinclass 2'},
        {label: 'SAS', img: 'sas', cmd: 'joinclass 3'},
        {label: 'GIGN', img: 'gign', cmd: 'joinclass 4'},
        {label: 'Auto-select', img: 'ct_random', cmd: 'joinclass 5'},
    ],
}

// commands and prices from ReGameDLL (weapontype.cpp / weapontype.h)
const SHOP: { name: string; items: Card[] }[] = [
    {name: 'Pistols', items: [
        {label: 'Glock 18', img: 'glock18', cmd: 'glock', price: 400},
        {label: 'USP .45', img: 'usp45', cmd: 'usp', price: 500},
        {label: 'P228', img: 'p228', cmd: 'p228', price: 600},
        {label: 'Desert Eagle', img: 'deserteagle', cmd: 'deagle', price: 650},
        {label: 'Dual Elites', img: 'elites', cmd: 'elites', price: 800, team: 't'},
        {label: 'Five-SeveN', img: 'fiveseven', cmd: 'fn57', price: 750, team: 'ct'},
    ]},
    {name: 'Shotguns', items: [
        {label: 'M3 Super 90', img: 'm3', cmd: 'm3', price: 1700},
        {label: 'XM1014', img: 'xm1014', cmd: 'xm1014', price: 3000},
    ]},
    {name: 'SMGs', items: [
        {label: 'MAC-10', img: 'mac10', cmd: 'mac10', price: 1400, team: 't'},
        {label: 'TMP', img: 'tmp', cmd: 'tmp', price: 1250, team: 'ct'},
        {label: 'MP5 Navy', img: 'mp5', cmd: 'mp5', price: 1500},
        {label: 'UMP45', img: 'ump45', cmd: 'ump45', price: 1700},
        {label: 'P90', img: 'p90', cmd: 'p90', price: 2350},
    ]},
    {name: 'Rifles', items: [
        {label: 'Galil', img: 'galil', cmd: 'galil', price: 2000, team: 't'},
        {label: 'FAMAS', img: 'famas', cmd: 'famas', price: 2250, team: 'ct'},
        {label: 'AK-47', img: 'ak47', cmd: 'ak47', price: 2500, team: 't'},
        {label: 'M4A1', img: 'm4a1', cmd: 'm4a1', price: 3100, team: 'ct'},
        {label: 'Scout', img: 'scout', cmd: 'scout', price: 2750},
        {label: 'SG 552', img: 'sg552', cmd: 'sg552', price: 3500, team: 't'},
        {label: 'AUG', img: 'aug', cmd: 'aug', price: 3500, team: 'ct'},
        {label: 'AWP', img: 'awp', cmd: 'awp', price: 4750},
        {label: 'G3SG1', img: 'g3sg1', cmd: 'g3sg1', price: 5000, team: 't'},
        {label: 'SG 550', img: 'sg550', cmd: 'sg550', price: 4200, team: 'ct'},
    ]},
    {name: 'Machine gun', items: [
        {label: 'M249', img: 'm249', cmd: 'm249', price: 5750},
    ]},
    {name: 'Equipment', items: [
        {label: 'Kevlar', img: 'kevlar', cmd: 'vest', price: 650},
        {label: 'Kevlar + Helmet', img: 'kevlar_helmet', cmd: 'vesthelm', price: 1000},
        {label: 'Flashbang', img: 'flashbang', cmd: 'flash', price: 200},
        {label: 'HE Grenade', img: 'hegrenade', cmd: 'hegren', price: 300},
        {label: 'Smoke Grenade', img: 'smokegrenade', cmd: 'sgren', price: 300},
        {label: 'Defuse Kit', img: 'defuser', cmd: 'defuser', price: 200, team: 'ct'},
        {label: 'Night Vision', img: 'nightvision', cmd: 'nvgs', price: 1250},
        {label: 'Tactical Shield', img: 'shield', cmd: 'shield', price: 2200, team: 'ct'},
    ]},
    {name: 'Ammo', items: [
        {label: 'Primary ammo', cmd: 'primammo'},
        {label: 'Secondary ammo', cmd: 'secammo'},
    ]},
]

/** touch/*.cfg names the CS client executes for each server menu */
function menuScripts(): Record<string, string> {
    const files: Record<string, string> = {chooseteam: 'team', chooseteam_tr: 'class_t', chooseteam_ct: 'class_ct', buy: 'buy'}
    for (const cat of ['pistol', 'shotgun', 'rifle', 'submachinegun', 'machinegun', 'item']) {
        files[`buy_${cat}_t`] = 'buy'
        files[`buy_${cat}_ct`] = 'buy'
    }
    return files
}

// ---------- images (from the player's own valve.zip) ----------

/** CS VGUI images are uncompressed 32-bit TGA, bottom-up unless descriptor bit 5 is set */
function decodeTga(b: Uint8Array): ImageData | null {
    const w = b[12] | (b[13] << 8)
    const h = b[14] | (b[15] << 8)
    const px = b[16] / 8
    if (b[2] !== 2 || (px !== 3 && px !== 4) || !w || !h) return null
    const start = 18 + b[0] + (b[1] ? (b[5] | (b[6] << 8)) * (b[7] >> 3) : 0)
    if (b.length < start + w * h * px) return null
    const out = new ImageData(w, h)
    const topDown = (b[17] & 0x20) !== 0
    for (let y = 0; y < h; y++) {
        const row = topDown ? y : h - 1 - y
        for (let x = 0; x < w; x++) {
            const s = start + (y * w + x) * px
            const d = (row * w + x) * 4
            out.data[d] = b[s + 2]
            out.data[d + 1] = b[s + 1]
            out.data[d + 2] = b[s]
            out.data[d + 3] = px === 4 ? b[s + 3] : 255
        }
    }
    return out
}

const images = new Map<string, Promise<string>>()

function vguiImage(zip: JSZip, name: string): Promise<string> {
    let url = images.get(name)
    if (!url) {
        url = (async () => {
            const file = zip.file(`cstrike/gfx/vgui/${name}.tga`)
            const data = file && decodeTga(await file.async('uint8array'))
            if (!data) return ''
            const canvas = document.createElement('canvas')
            canvas.width = data.width
            canvas.height = data.height
            canvas.getContext('2d')!.putImageData(data, 0, 0)
            return canvas.toDataURL()
        })()
        images.set(name, url)
    }
    return url
}

// ---------- the overlay ----------

const $ = (id: string) => document.getElementById(id) as HTMLElement

export function initMenus(x: Xash3D, zip: JSZip) {
    const root = $('menu')
    const title = $('menuTitle')
    const tabs = $('menuTabs')
    const grid = $('menuGrid')
    const actions = $('menuActions')
    const hint = $('menuHint')

    let kind: Kind | undefined
    let team: Team | undefined // learned from the character menu the server opens
    let tab = 0
    let selected = 0
    let cards: Card[] = []

    for (const [file, menu] of Object.entries(menuScripts())) {
        x.em!.FS.mkdirTree('/rodir/cstrike/touch')
        x.em!.FS.writeFile(`/rodir/cstrike/touch/${file}.cfg`, `echo JOUCS_MENU ${menu}\n`)
    }

    function render() {
        if (kind === 'buy') {
            cards = SHOP[tab].items.filter(c => !team || !c.team || c.team === team)
            title.textContent = 'Buy menu'
            tabs.replaceChildren(...SHOP.map((cat, i) => {
                const b = document.createElement('button')
                b.textContent = cat.name
                b.setAttribute('aria-selected', String(i === tab))
                b.addEventListener('click', () => { tab = i; selected = 0; render() })
                return b
            }))
            hint.textContent = 'A buy · B close · LB/RB category · X auto-buy · Y rebuy · keys 1–9'
        } else {
            cards = kind === 'team' ? TEAM_CARDS : CLASS_CARDS[kind === 'class_t' ? 't' : 'ct']
            title.textContent = kind === 'team' ? 'Choose your team' : 'Choose your character'
            tabs.replaceChildren()
            hint.textContent = 'A select · D-pad move · keys 1–9'
        }
        actions.hidden = kind !== 'buy'
        root.dataset.kind = kind
        selected = Math.min(selected, cards.length - 1)

        grid.replaceChildren(...cards.map((card, i) => {
            const el = document.createElement('button')
            el.className = 'card'
            el.setAttribute('aria-selected', String(i === selected))
            const pic = document.createElement('div')
            pic.className = 'pic'
            if (card.img) {
                const img = document.createElement('img')
                img.alt = ''
                vguiImage(zip, card.img).then(src => { if (src) img.src = src })
                pic.append(img)
            } else {
                pic.textContent = card.label === 'Spectate' ? '👁' : '?'
            }
            const name = document.createElement('span')
            name.className = 'name'
            name.textContent = card.label
            el.append(Object.assign(document.createElement('kbd'), {textContent: String(i + 1)}), pic, name)
            if (card.price) el.append(Object.assign(document.createElement('span'), {className: 'price', textContent: `$${card.price}`}))
            if (card.team && !team) el.append(Object.assign(document.createElement('span'), {className: 'team', textContent: card.team.toUpperCase()}))
            el.addEventListener('mouseenter', () => select(i))
            el.addEventListener('click', () => activate(i))
            return el
        }))
    }

    function select(i: number) {
        selected = Math.max(0, Math.min(cards.length - 1, i))
        grid.querySelectorAll('.card').forEach((el, j) => el.setAttribute('aria-selected', String(j === selected)))
        grid.children[selected]?.scrollIntoView({block: 'nearest'})
    }

    function activate(i: number) {
        const card = cards[i]
        if (!card) return
        x.Cmd_ExecuteString(card.cmd)
        if (kind !== 'buy') return close() // the server opens the next menu itself
        const el = grid.children[i] as HTMLElement
        el.classList.remove('bought')
        void el.offsetWidth // restart the flash animation
        el.classList.add('bought')
    }

    function run(cmd: string) {
        x.Cmd_ExecuteString(cmd)
        if (cmd === 'chooseteam') close()
    }
    for (const b of actions.querySelectorAll<HTMLButtonElement>('button[data-cmd]')) {
        b.addEventListener('click', () => run(b.dataset.cmd!))
    }

    function open(k: Kind) {
        if (k === 'class_t') team = 't'
        if (k === 'class_ct') team = 'ct'
        if (kind !== k) { selected = 0; tab = k === 'buy' ? tab : 0 }
        kind = k
        render()
        root.hidden = false
        document.exitPointerLock?.()
        x.Cmd_ExecuteString('joy_enable 0') // the engine would also move the player
        padSeen = false
        requestAnimationFrame(pollPad)
    }

    function close() {
        if (!kind) return
        kind = undefined
        root.hidden = true
        x.Cmd_ExecuteString('joy_enable 1')
    }

    function columns() {
        return getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1
    }

    function move(dx: number, dy: number) {
        select(selected + dx + dy * columns())
    }

    function switchTab(d: number) {
        if (kind !== 'buy') return
        tab = (tab + d + SHOP.length) % SHOP.length
        selected = 0
        render()
    }

    function back() {
        if (kind === 'buy') close() // team/character must be picked, like in CS
    }

    // keyboard: swallow everything while open so the game doesn't see it
    window.addEventListener('keydown', e => {
        if (!kind) return
        e.stopImmediatePropagation()
        e.preventDefault()
        const k = e.key
        if (k === 'ArrowLeft') move(-1, 0)
        else if (k === 'ArrowRight') move(1, 0)
        else if (k === 'ArrowUp') move(0, -1)
        else if (k === 'ArrowDown') move(0, 1)
        else if (k === 'Enter' || k === ' ') activate(selected)
        else if (k === 'Escape' || k === 'Backspace' || k === 'b' || k === 'B') back()
        else if (k === 'q' || k === 'Q' || (k === 'Tab' && e.shiftKey)) switchTab(-1)
        else if (k === 'e' || k === 'E' || k === 'Tab') switchTab(1)
        else if (/^[1-9]$/.test(k)) activate(Number(k) - 1)
    }, true)
    window.addEventListener('keyup', e => {
        if (!kind) return
        e.stopImmediatePropagation()
        e.preventDefault()
    }, true)

    // controller: standard mapping, edge-triggered; the stick repeats while held
    let prev: boolean[] = []
    let padSeen = false
    let stickAt = 0
    function pollPad(now: number) {
        if (!kind) return
        const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p)
        if (pad) {
            const down = pad.buttons.map(b => b.pressed)
            // ignore whatever was held when the menu opened (e.g. the D-pad press)
            const pressed = (i: number) => padSeen && down[i] && !prev[i]
            if (pressed(0)) activate(selected)
            if (pressed(1) || pressed(9)) back()
            if (pressed(2) && kind === 'buy') run('autobuy')
            if (pressed(3) && kind === 'buy') run('rebuy')
            if (pressed(4)) switchTab(-1)
            if (pressed(5)) switchTab(1)
            if (pressed(12)) move(0, -1)
            if (pressed(13)) move(0, 1)
            if (pressed(14)) move(-1, 0)
            if (pressed(15)) move(1, 0)
            const [ax = 0, ay = 0] = pad.axes
            if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.6 && now - stickAt > 220) {
                stickAt = now
                if (Math.abs(ax) > Math.abs(ay)) move(Math.sign(ax), 0)
                else move(0, Math.sign(ay))
            }
            prev = down
            padSeen = true
        }
        requestAnimationFrame(pollPad)
    }

    return {
        isOpen: () => !!kind,
        /** feed every engine console line here */
        onLine(line: string) {
            const m = /JOUCS_MENU (team|class_t|class_ct|buy)/.exec(line)
            // after the engine's echo returns: open() runs console commands itself
            if (m) setTimeout(() => open(m[1] as Kind), 0)
        },
    }
}
