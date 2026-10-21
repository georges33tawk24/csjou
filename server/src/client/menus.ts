import type JSZip from 'jszip'
import type {Xash3D} from 'xash3d-fwgs'
import {BTN, watchPad} from './pad'
import {screenOpen} from './settings'
import {summaryOpen} from './stats'

// JOUCS team / character / buy screens and the quick menu, drawn over the game.
//
// The CS client runs touch/<menu>.cfg whenever the server opens a VGUI menu
// (team select, class select, buy). We replace those files with one-line
// `echo JOUCS_MENU <kind>` scripts and open our own screen when that line
// shows up in the engine log. Loose files win over extras.pk3.

type Team = 't' | 'ct'
type Kind = 'team' | 'class_t' | 'class_ct' | 'buy' | 'quick'
type Card = { label: string; cmd: string; img?: string; price?: number; team?: Team }
type Category = { name: string; items: Card[] }

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
const SHOP: Category[] = [
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

// everything else a keyboard player has a key for; radio commands are ReGameDLL's
const QUICK: Category[] = [
    {name: 'Actions', items: [
        {label: 'Drop weapon', cmd: 'drop'},
        {label: 'Last used weapon', cmd: 'lastinv'},
        {label: 'Grenades', cmd: 'slot4'},
        {label: 'C4 bomb', cmd: 'slot5'},
        {label: 'Knife', cmd: 'slot3'},
        {label: 'Buy primary ammo', cmd: 'buyammo1'},
        {label: 'Buy pistol ammo', cmd: 'buyammo2'},
        {label: 'Rebuy last round', cmd: 'rebuy'},
        {label: 'Auto-buy', cmd: 'autobuy'},
        {label: 'Flashlight', cmd: 'impulse 100'},
        {label: 'Night vision', cmd: 'nightvision'},
        {label: 'Spray logo', cmd: 'impulse 201'},
        {label: 'Change team', cmd: 'chooseteam'},
    ]},
    {name: 'Radio: orders', items: [
        {label: 'Cover me', cmd: 'coverme'},
        {label: 'You take the point', cmd: 'takepoint'},
        {label: 'Hold this position', cmd: 'holdpos'},
        {label: 'Regroup team', cmd: 'regroup'},
        {label: 'Follow me', cmd: 'followme'},
        {label: 'Taking fire, need assistance', cmd: 'takingfire'},
        {label: 'Go go go!', cmd: 'go'},
        {label: 'Team, fall back', cmd: 'fallback'},
        {label: 'Stick together, team', cmd: 'sticktog'},
        {label: 'Get in position', cmd: 'getinpos'},
        {label: 'Storm the front', cmd: 'stormfront'},
        {label: 'Report in, team', cmd: 'report'},
    ]},
    {name: 'Radio: replies', items: [
        {label: 'Affirmative', cmd: 'roger'},
        {label: 'Negative', cmd: 'negative'},
        {label: 'Enemy spotted', cmd: 'enemyspot'},
        {label: 'Need backup', cmd: 'needbackup'},
        {label: 'Sector clear', cmd: 'sectorclear'},
        {label: "I'm in position", cmd: 'inposition'},
        {label: 'Reporting in', cmd: 'reportingin'},
        {label: 'Get out of there!', cmd: 'getout'},
        {label: 'Enemy down', cmd: 'enemydown'},
    ]},
    {name: 'Chat', items: ['gg', 'Nice shot!', 'Thanks!', 'Sorry!', 'Wait for me', 'Rush B!', 'Rush A!', 'Need help', 'lol']
        .map(text => ({label: text, cmd: `say "${text}"`}))},
]

/** chat text as a console argument: no quotes, separators or line breaks */
const chatText = (t: string) => t.replace(/["\\;\u0000-\u001f]/g, '').trim().slice(0, 120)

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

/** CS 1.6's menu background, put together from its 800x600 tiles */
export async function menuBackground(zip: JSZip): Promise<string> {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const g = canvas.getContext('2d')!
    let found = false
    for (const [row, y] of [[1, 0], [2, 256], [3, 512]] as const) {
        for (const [col, x] of [['a', 0], ['b', 256], ['c', 512], ['d', 768]] as const) {
            const file = zip.file(`cstrike/resource/background/800_${row}_${col}_loading.tga`)
            const img = file && decodeTga(await file.async('uint8array'))
            if (img) { g.putImageData(img, x, y); found = true }
        }
    }
    return found ? canvas.toDataURL('image/jpeg', 0.85) : ''
}

// ---------- the overlay ----------

const $ = (id: string) => document.getElementById(id) as HTMLElement

export function initMenus(x: Xash3D, zip: JSZip) {
    const root = $('menu')
    const title = $('menuTitle')
    const tabs = $('menuTabs')
    const grid = $('menuGrid')
    const actions = $('menuActions')
    const chat = $('menuChat') as HTMLFormElement
    const chatInput = $('menuChatText') as HTMLInputElement
    const hint = $('menuHint')

    let kind: Kind | undefined
    let team: Team | undefined // learned from the character menu the server opens
    const categoryTab = {buy: 0, quick: 0}
    let selected = 0
    let cards: Card[] = []
    let coop = false // friends vs bots: humans are always Counter-Terrorists
    let refused: ReturnType<typeof setTimeout> | undefined

    for (const [file, menu] of Object.entries(menuScripts())) {
        x.em!.FS.mkdirTree('/rodir/cstrike/touch')
        x.em!.FS.writeFile(`/rodir/cstrike/touch/${file}.cfg`, `echo JOUCS_MENU ${menu}\n`)
    }

    const categories = (): Category[] | undefined => kind === 'buy' ? SHOP : kind === 'quick' ? QUICK : undefined

    function render() {
        const cats = categories()
        if (cats && (kind === 'buy' || kind === 'quick')) {
            const t = categoryTab[kind]
            cards = cats[t].items.filter(c => !team || !c.team || c.team === team)
            title.textContent = kind === 'buy' ? 'Buy menu' : 'Quick menu'
            tabs.replaceChildren(...cats.map((cat, i) => {
                const b = document.createElement('button')
                b.textContent = cat.name
                b.setAttribute('aria-selected', String(i === t))
                b.addEventListener('click', () => setTab(i))
                return b
            }))
            hint.textContent = kind === 'buy' ? 'A buy · B close · LB/RB category · X auto-buy · Y rebuy · keys 1–9'
                : cats[t].name === 'Chat' ? 'A send · Y type a message · B close · LB/RB category'
                : 'A select · B close · LB/RB category · keys 1–9'
        } else {
            cards = kind !== 'team' ? CLASS_CARDS[kind === 'class_t' ? 't' : 'ct']
                : coop ? TEAM_CARDS.filter(c => c.cmd === 'jointeam 2' || c.cmd === 'jointeam 6') : TEAM_CARDS
            title.textContent = kind === 'team' ? 'Choose your team' : 'Choose your character'
            tabs.replaceChildren()
            hint.textContent = 'A select · D-pad move · keys 1–9'
        }
        actions.hidden = kind !== 'buy'
        chat.hidden = !(kind === 'quick' && QUICK[categoryTab.quick].name === 'Chat')
        root.dataset.kind = kind
        selected = Math.max(0, Math.min(selected, cards.length - 1))

        grid.replaceChildren(...cards.map((card, i) => {
            const el = document.createElement('button')
            el.className = 'card'
            el.setAttribute('aria-selected', String(i === selected))
            el.append(Object.assign(document.createElement('kbd'), {textContent: String(i + 1)}))
            if (kind !== 'quick') {
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
                el.append(pic)
            }
            el.append(Object.assign(document.createElement('span'), {className: 'name', textContent: card.label}))
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
        if (kind === 'team' && card.cmd !== 'jointeam 6') {
            // stay open: the server answers with the character menu, or with nothing at all when
            // that team is full or already has more players (bots count), which left people spectating
            clearTimeout(refused)
            refused = setTimeout(() => {
                if (kind === 'team') hint.textContent = 'That team is full right now. Pick the other team or Auto-select.'
            }, 2500)
            return
        }
        if (kind !== 'buy') return close() // the server opens the next character menu itself
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

    chat.addEventListener('submit', e => {
        e.preventDefault()
        const text = chatText(chatInput.value)
        const toTeam = (e.submitter as HTMLButtonElement | null)?.value === 'team'
        if (text) x.Cmd_ExecuteString(`${toTeam ? 'say_team' : 'say'} "${text}"`)
        chatInput.value = ''
        close()
    })

    function open(k: Kind) {
        if (k === 'quick' && kind && kind !== 'quick') return // never covers the team or buy screens
        clearTimeout(refused)
        if (k === 'class_t') team = 't'
        if (k === 'class_ct') team = 'ct'
        if (kind !== k) selected = 0
        const opening = !kind
        kind = k
        render()
        root.hidden = false
        document.exitPointerLock?.()
        if (opening) screenOpen(x, 'menu', true)
        if (!watching) {
            watching = true
            watchPad(() => {
                if (!kind) watching = false
                return !!kind
            }, onPad, (dx, dy) => move(dx, dy))
        }
    }

    function close() {
        if (!kind) return
        kind = undefined
        root.hidden = true
        chatInput.blur()
        screenOpen(x, 'menu', false)
    }

    function columns() {
        return getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1
    }

    function move(dx: number, dy: number) {
        select(selected + dx + dy * columns())
    }

    function setTab(i: number) {
        if (kind !== 'buy' && kind !== 'quick') return
        categoryTab[kind] = i
        selected = 0
        render()
    }

    function switchTab(d: number) {
        const cats = categories()
        if (cats && (kind === 'buy' || kind === 'quick')) setTab((categoryTab[kind] + d + cats.length) % cats.length)
    }

    function back() {
        if (kind === 'buy' || kind === 'quick') close() // team/character must be picked, like in CS
    }

    // keyboard: swallow everything while open so the game doesn't see it
    window.addEventListener('keydown', e => {
        if (!kind) return
        e.stopImmediatePropagation()
        if (e.target === chatInput) { // typing a chat message
            if (e.key === 'Escape') close()
            return
        }
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
        else if (k === 't' || k === 'T') { if (!chat.hidden) chatInput.focus() }
        else if (/^[1-9]$/.test(k)) activate(Number(k) - 1)
    }, true)
    window.addEventListener('keyup', e => {
        if (!kind) return
        e.stopImmediatePropagation()
        if (e.target !== chatInput) e.preventDefault()
    }, true)

    let watching = false
    function onPad(b: number) {
        if (summaryOpen()) return // the match summary is on top
        if (document.activeElement === chatInput && b !== BTN.B) return
        if (b === BTN.A) activate(selected)
        else if (b === BTN.B || b === BTN.START) back()
        else if (b === BTN.X && kind === 'buy') run('autobuy')
        else if (b === BTN.Y && kind === 'buy') run('rebuy')
        else if (b === BTN.Y && !chat.hidden) chatInput.focus() // brings up the on-screen keyboard where there is one
        else if (b === BTN.LB) switchTab(-1)
        else if (b === BTN.RB) switchTab(1)
        else if (b === BTN.UP) move(0, -1)
        else if (b === BTN.DOWN) move(0, 1)
        else if (b === BTN.LEFT) move(-1, 0)
        else if (b === BTN.RIGHT) move(1, 0)
    }

    return {
        isOpen: () => !!kind,
        openQuick: () => open('quick'),
        setCoop(on: boolean) { coop = on },
        /** feed every engine console line here */
        onLine(line: string) {
            const m = /JOUCS_MENU (team|class_t|class_ct|buy|quick)/.exec(line)
            // after the engine's echo returns: open() runs console commands itself
            if (m) setTimeout(() => open(m[1] as Kind), 0)
        },
    }
}
