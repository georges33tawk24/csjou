import Peer, {type DataConnection} from 'peerjs'
import {ErrNoLocation, Net, type Packet} from 'xash3d-fwgs'
import type {Extra} from './files'
import type {VoicePlayer} from './voice'

// Lobbies run in the host's browser: their engine is a listen server and each
// friend connects to it peer-to-peer (WebRTC). PeerJS's free public service
// introduces the two browsers; when a network blocks direct connections, the
// traffic goes through Cloudflare's relay (turn-worker/ hands out its passwords).
//
// Per friend there is one WebRTC connection with three channels:
//   PeerJS's JSON channel    lobby messages (info, join, welcome, reject, ...)
//   "game"                   engine packets: unordered, no retransmits, like UDP
//   "files"                  game files and extra maps the friend doesn't have yet

export type LobbyInfo = {
    name: string
    map: string
    mode: string
    players: number
    maxPlayers: number
    private: boolean
}

type FileItem = { path: string; size: number } // path '' = the game files (valve.zip)

type Msg =
    | ({ t: 'info' } & Partial<LobbyInfo>)
    | { t: 'join'; name: string; password: string; needFiles: boolean; have: string[]; resume?: string }
    | { t: 'welcome'; files: FileItem[]; token: string }
    | { t: 'reject'; reason: string }
    | { t: 'bye' } // the host closed the lobby
    | { t: 'voice'; on: boolean } // a friend turned voice chat on
    | { t: 'roster'; players: VoicePlayer[] } // who has voice chat on

const ID_PREFIX = 'joucs-'
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789' // no 0/o, 1/l/i
export const CODE_RE = /^[a-z0-9]{6}$/i

export function newLobbyCode() {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_CHARS[b % CODE_CHARS.length]).join('').toUpperCase()
}

const peerId = (code: string) => ID_PREFIX + code.toLowerCase()

// negotiated: both sides create them with the same id, no extra signaling
const GAME_CHANNEL: RTCDataChannelInit = {negotiated: true, id: 100, ordered: false, maxRetransmits: 0}
const FILES_CHANNEL: RTCDataChannelInit = {negotiated: true, id: 101, ordered: true}

function channels(conn: DataConnection) {
    const game = conn.peerConnection.createDataChannel('game', GAME_CHANNEL)
    const files = conn.peerConnection.createDataChannel('files', FILES_CHANNEL)
    game.binaryType = files.binaryType = 'arraybuffer'
    return {game, files}
}

// PeerJS's own relay servers shut down in 2023 and it still lists them, so
// always pass our own: STUN finds direct routes, the relay covers the rest.
const TURN_URL = 'https://joucs-turn.georges33tawk24.workers.dev'
const STUN: RTCIceServer[] = [{urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']}]

async function newPeer(id?: string) {
    let iceServers = STUN
    try {
        const r = await fetch(TURN_URL, {signal: AbortSignal.timeout(4000)})
        if (r.ok) iceServers = (await r.json()).iceServers
    } catch { /* relay unreachable: direct connections only */ }
    const options = {config: {iceServers}}
    return id ? new Peer(id, options) : new Peer(options)
}

/** "120 ms · direct": the round trip and route of a connection, from the browser's own stats */
export async function linkText(pc: RTCPeerConnection | undefined): Promise<string> {
    const stats = await pc?.getStats().catch(() => undefined)
    if (!stats) return ''
    let pair: RTCIceCandidatePairStats | undefined
    stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId) })
    stats.forEach(r => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r }) // Firefox
    if (!pair) return ''
    const relay = [pair.localCandidateId, pair.remoteCandidateId].some(id => stats.get(id)?.candidateType === 'relay')
    const ms = pair.currentRoundTripTime === undefined ? '' : `${Math.round(pair.currentRoundTripTime * 1000)} ms · `
    return ms + (relay ? 'through the relay' : 'direct')
}

const PEER_ERRORS: Record<string, string> = {
    'peer-unavailable': 'No lobby with that code is open right now.',
    'unavailable-id': 'This lobby is already open in another tab or window.',
    'browser-incompatible': 'This browser cannot connect to lobbies.',
    'network': 'Could not reach the lobby service. Check your internet connection.',
    'server-error': 'Could not reach the lobby service. Try again in a moment.',
    'socket-error': 'Could not reach the lobby service. Check your internet connection.',
}
const peerError = (e: { type?: string; message?: string }): string => PEER_ERRORS[e.type ?? ''] ?? e.message ?? 'Connection failed.'

const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('The lobby did not answer. Check the code and try again.')), ms))])

/** the peer is registered with the lobby service */
const peerReady = (peer: Peer) => within(new Promise<void>((resolve, reject) => {
    peer.once('open', () => resolve())
    peer.once('error', e => reject(new Error(peerError(e))))
}), 20_000)

/** the connection to the other browser is up; an unknown lobby code fails on the peer */
const connReady = (peer: Peer, conn: DataConnection) => within(new Promise<void>((resolve, reject) => {
    conn.once('open', () => resolve())
    conn.once('error', e => reject(new Error(peerError(e))))
    peer.once('error', e => reject(new Error(peerError(e))))
}), 20_000)

// ---------- host ----------

// The engine's server socket. The page's fake network has one packet queue for
// every socket, so only this one may read from it; otherwise the host's own
// client socket would swallow friends' packets.
const SERVER_PORT = 27015 // engine default hostport
const GUEST_PORT = 27005
const RESUME_MS = 30_000 // a friend who drops out keeps their place this long

class HostNet extends Net {
    recvfrom(fd: number, bufPtr: number, bufLen: number, flags: number, sockaddrPtr: number, socklenPtr: number) {
        if (this.sockets.get(fd)?.addr?.port !== SERVER_PORT) {
            this.em!.setValue(ErrNoLocation(this.em!), 73, 'i32') // same "no packet" errno as Net.recvfrom
            return -1
        }
        return super.recvfrom(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr)
    }
}

type Guest = {
    conn: DataConnection; game: RTCDataChannel; files: RTCDataChannel; ip: Packet['ip']
    joined: boolean; name: string; voice: boolean; token: string; kicked?: boolean
}

export type HostOptions = {
    code: string
    password: string // '' = public
    info: () => Omit<LobbyInfo, 'players' | 'private'> & { bots: number }
    gameFiles: () => Promise<Blob>
    extras: () => Promise<Extra[]>
    /** a friend dropped out and did not come back */
    onLeft: (name: string) => void
}

export async function hostLobby(opts: HostOptions) {
    const guests = new Map<string, Guest>() // by fake ip
    // friends whose connection dropped: token -> their address, kept for RESUME_MS
    const departed = new Map<string, { ip: Packet['ip']; timer?: ReturnType<typeof setTimeout> }>()
    let nextGuest = 1

    const net = new HostNet({
        sendto(p: Packet) {
            const g = guests.get(p.ip.join('.'))
            // copy: the data is a view into engine memory that the next packet reuses
            if (g?.joined && g.game.readyState === 'open') g.game.send(p.data.slice())
        },
    }, {maxPackets: 1024})

    const joined = () => [...guests.entries()].filter(([, g]) => g.joined)

    /** a friend reconnects before we noticed their old connection drop: hand its place over */
    function takeOver(token: string) {
        const old = joined().find(([, g]) => g.token === token)
        if (!old) return undefined
        const [oldKey, g] = old
        g.kicked = true // not "departed": it's coming straight back
        guests.delete(oldKey)
        g.conn.close()
        return {ip: g.ip, timer: undefined}
    }
    const joinedCount = () => joined().length
    const info = (): LobbyInfo => {
        const {bots, ...rest} = opts.info()
        return {...rest, players: 1 + joinedCount() + bots, private: !!opts.password}
    }

    const peer = await newPeer(peerId(opts.code))
    await peerReady(peer)
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect() }, 2000))
    peer.on('error', () => undefined) // lost contact with the lobby service: 'disconnected' reconnects

    peer.on('connection', conn => {
        const n = nextGuest++
        // a reconnecting friend gets their old address back, so the game carries on
        let ip: Packet['ip'] = [10, 7, (n >> 8) & 255, n & 255]
        let key = ip.join('.')
        let guest: Guest | undefined

        conn.on('open', () => {
            const {game, files} = channels(conn)
            guest = {conn, game, files, ip, joined: false, name: '', voice: false, token: crypto.randomUUID()}
            guests.set(key, guest)
            game.onmessage = e => {
                if (guest?.joined) net.incoming.enqueue({ip, port: GUEST_PORT, data: new Int8Array(e.data as ArrayBuffer)})
            }
        })
        conn.on('data', async raw => {
            const msg = raw as Msg
            if (!guest) return
            if (msg.t === 'info') conn.send({t: 'info', ...info()} satisfies Msg)
            if (msg.t === 'voice' && guest.joined) {
                guest.voice = msg.on
                sendRoster()
            }
            if (msg.t !== 'join' || guest.joined) return
            const back = msg.resume ? departed.get(msg.resume) ?? takeOver(msg.resume) : undefined
            const i = info()
            const reason = opts.password && msg.password !== opts.password ? 'Wrong lobby password.'
                : !back && i.players >= i.maxPlayers ? 'This lobby is full.'
                : ''
            if (reason) {
                conn.send({t: 'reject', reason} satisfies Msg)
                return
            }
            if (back) {
                clearTimeout(back.timer)
                departed.delete(msg.resume!)
                guests.delete(key)
                guest.ip = ip = back.ip
                key = ip.join('.')
                guest.token = msg.resume!
                guests.set(key, guest)
            }
            guest.joined = true
            guest.name = String(msg.name).slice(0, 32)
            const base = msg.needFiles ? await opts.gameFiles() : undefined
            const extras = (await opts.extras()).filter(e => !msg.have?.includes(e.path))
            const items = [...base ? [{path: '', blob: base}] : [], ...extras]
            conn.send({t: 'welcome', files: items.map(e => ({path: e.path, size: e.blob.size})), token: guest.token} satisfies Msg)
            ;(async () => { for (const e of items) await sendFile(guest!.files, e.blob) })().catch(() => conn.close())
        })
        conn.on('close', () => {
            if (guests.get(key)?.conn !== conn) return
            guests.delete(key)
            sendRoster()
            if (!guest?.joined || guest.kicked) return
            const {token, name} = guest
            departed.set(token, {ip, timer: setTimeout(() => { departed.delete(token); opts.onLeft(name) }, RESUME_MS)})
        })
        conn.on('error', () => conn.close())
    })

    // voice chat: who has it on, for everyone (the host included)
    let hostVoice: VoicePlayer | undefined
    let onRoster = (_players: VoicePlayer[]) => undefined as void
    const roster = (): VoicePlayer[] => [
        ...hostVoice ? [hostVoice] : [],
        ...joined().filter(([, g]) => g.voice).map(([, g]) => ({id: g.conn.peer, name: g.name})),
    ]
    function sendRoster() {
        const players = roster()
        for (const [, g] of joined()) g.conn.send({t: 'roster', players} satisfies Msg)
        onRoster(players)
    }

    window.addEventListener('pagehide', () => peer.destroy())
    return {
        net,
        peer,
        /** tell everyone the lobby is closing, then close it */
        async close() {
            for (const [, g] of joined()) g.conn.send({t: 'bye'} satisfies Msg)
            await new Promise(r => setTimeout(r, 300))
            peer.destroy()
        },
        guests: joinedCount,
        players: () => joined().map(([key, g]) => ({key, name: g.name, link: () => linkText(g.conn.peerConnection)})),
        /** tell friends' lobby screens about a new map or mode */
        broadcastInfo() {
            for (const [, g] of joined()) g.conn.send({t: 'info', ...info()} satisfies Msg)
        },
        /** the host's own voice chat */
        voice(name: string, fn: (players: VoicePlayer[]) => void) {
            hostVoice = {id: peer.id, name}
            onRoster = fn
            sendRoster()
        },
        kick(key: string) {
            const g = guests.get(key)
            if (!g) return
            g.kicked = true
            g.conn.send({t: 'reject', reason: 'The host removed you from the lobby.'} satisfies Msg)
            setTimeout(() => g.conn.close(), 500)
        },
    }
}

// The host's engine keeps the page busy, so read big blocks and queue many
// messages per turn instead of one small read per frame.
async function sendFile(ch: RTCDataChannel, blob: Blob) {
    const MESSAGE = 64 * 1024
    const BLOCK = 4 << 20
    ch.bufferedAmountLowThreshold = 2 << 20
    for (let off = 0; off < blob.size; off += BLOCK) {
        const block = new Uint8Array(await blob.slice(off, off + BLOCK).arrayBuffer())
        // browsers cap a channel's send queue at 16 MB
        if (ch.bufferedAmount > 8 << 20) await new Promise(r => ch.addEventListener('bufferedamountlow', r, {once: true}))
        for (let i = 0; i < block.length; i += MESSAGE) {
            if (ch.readyState !== 'open') throw new Error('closed')
            ch.send(block.subarray(i, i + MESSAGE))
        }
    }
}

// ---------- guest ----------

/** the engine's network for a friend; the game channel changes when reconnecting */
export function guestNet() {
    let game: RTCDataChannel | undefined
    const net = new Net({
        sendto(p: Packet) {
            if (game?.readyState === 'open') game.send(p.data.slice())
        },
    }, {maxPackets: 1024})
    return {
        net,
        attach(ch: RTCDataChannel) {
            game = ch
            // the engine connects to 127.0.0.1:8080; everything from the host comes "from" there
            ch.onmessage = e => net.incoming.enqueue({ip: [127, 0, 0, 1], port: 8080, data: new Int8Array(e.data as ArrayBuffer)})
        },
    }
}

export type JoinOptions = {
    name: string
    password: string
    needFiles: boolean
    have: string[] // extra map files already here
    resume?: string // token from an earlier join, to get our place back
    progress?: (got: number, total: number) => void
}
export type JoinResult = { game: RTCDataChannel; files?: Blob; extras: Extra[]; token: string }

export async function findLobby(code: string) {
    const peer = await newPeer()
    await peerReady(peer)
    const conn = peer.connect(peerId(code), {serialization: 'json', reliable: true})
    await connReady(peer, conn).catch(e => { peer.destroy(); throw e })
    const {game, files} = channels(conn)

    const listeners = new Set<(m: Msg) => void>()
    conn.on('data', raw => listeners.forEach(l => l(raw as Msg)))
    const next = <T extends Msg['t']>(...types: T[]) => new Promise<Extract<Msg, { t: T }>>((resolve, reject) => {
        const l = (m: Msg) => {
            if (!(types as string[]).includes(m.t)) return
            listeners.delete(l)
            resolve(m as Extract<Msg, { t: T }>)
        }
        listeners.add(l)
        conn.once('close', () => reject(new Error('The host closed the lobby.')))
    })

    // The host may vanish without closing anything (closed tab, lost network),
    // so watch the connection itself too. A reason means it's final (removed,
    // lobby closed); without one, reconnecting may work.
    let closedHandler = (_reason?: string) => undefined as void
    let infoHandler = (_info: LobbyInfo) => undefined as void
    let rosterHandler = (_players: VoicePlayer[]) => undefined as void
    let joined = false
    let lost: ReturnType<typeof setTimeout> | undefined
    conn.on('close', () => closedHandler())
    game.addEventListener('close', () => closedHandler())
    conn.peerConnection.addEventListener('connectionstatechange', () => {
        const state = conn.peerConnection.connectionState
        clearTimeout(lost)
        if (state === 'failed' || state === 'closed') closedHandler()
        if (state === 'disconnected') lost = setTimeout(() => closedHandler(), 4000)
    })
    listeners.add(m => {
        if (!joined) return
        if (m.t === 'reject') closedHandler(m.reason)
        if (m.t === 'bye') closedHandler('The host closed the lobby.')
        if (m.t === 'info') infoHandler(m as unknown as LobbyInfo)
        if (m.t === 'roster') rosterHandler(m.players)
    })
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect() })

    return {
        async info(): Promise<LobbyInfo> {
            const reply = next('info')
            conn.send({t: 'info'} satisfies Msg)
            return await reply as unknown as LobbyInfo
        },

        async join(o: JoinOptions): Promise<JoinResult> {
            const reply = next('welcome', 'reject')
            conn.send({t: 'join', name: o.name, password: o.password, needFiles: o.needFiles, have: o.have, resume: o.resume} satisfies Msg)
            const m = await reply
            if (m.t === 'reject') throw new Error(m.reason)
            joined = true

            // the files arrive one after another on the files channel; messages never span two
            const total = m.files.reduce((n, f) => n + f.size, 0)
            const blobs: Blob[] = []
            if (total) {
                await new Promise<void>((resolve, reject) => {
                    let item = 0, got = 0, all = 0
                    let parts: ArrayBuffer[] = []
                    const skipEmpty = () => { while (item < m.files.length && m.files[item].size === 0) { blobs.push(new Blob()); item++ } }
                    skipEmpty()
                    files.onmessage = e => {
                        const data = e.data as ArrayBuffer
                        parts.push(data)
                        got += data.byteLength
                        all += data.byteLength
                        o.progress?.(all, total)
                        if (got < m.files[item].size) return
                        blobs.push(new Blob(parts))
                        parts = []
                        got = 0
                        item++
                        skipEmpty()
                        if (item >= m.files.length) resolve()
                    }
                    conn.once('close', () => reject(new Error('The host closed the lobby before the files arrived.')))
                })
            } else m.files.forEach(() => blobs.push(new Blob()))

            const base = m.files.findIndex(f => f.path === '')
            return {
                game,
                files: base >= 0 ? blobs[base] : undefined,
                extras: m.files.flatMap((f, i) => f.path ? [{path: f.path, blob: blobs[i]}] : []),
                token: m.token,
            }
        },

        onClose(fn: (reason?: string) => void) { closedHandler = fn },
        onInfo(fn: (info: LobbyInfo) => void) { infoHandler = fn },
        /** turn our voice chat on; fn gets everyone with voice on, now and on every change */
        voice(fn: (players: VoicePlayer[]) => void) {
            rosterHandler = fn
            conn.send({t: 'voice', on: true} satisfies Msg)
        },
        peer,
        link: () => linkText(conn.peerConnection),
        close() { peer.destroy() },
    }
}

export type Lobby = Awaited<ReturnType<typeof findLobby>>

/** which of these lobbies are open right now, and what they're playing */
export async function probeLobbies(codes: string[]): Promise<Map<string, LobbyInfo | undefined>> {
    const result = new Map<string, LobbyInfo | undefined>()
    if (!codes.length) return result
    const peer = await newPeer()
    try { await peerReady(peer) } catch { return result }
    await Promise.all(codes.map(code => new Promise<void>(resolve => {
        const conn = peer.connect(peerId(code), {serialization: 'json', reliable: true})
        let settled = false
        const done = (info?: LobbyInfo) => {
            if (settled) return
            settled = true
            result.set(code, info)
            clearTimeout(timer)
            conn.close()
            resolve()
        }
        const timer = setTimeout(() => done(), 8000)
        conn.on('open', () => conn.send({t: 'info'} satisfies Msg))
        conn.on('data', m => { if ((m as Msg).t === 'info') done(m as unknown as LobbyInfo) })
        peer.on('error', e => { if (e.message?.includes(peerId(code))) done() })
    })))
    peer.destroy()
    return result
}
