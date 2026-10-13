import Peer, {type DataConnection} from 'peerjs'
import {ErrNoLocation, Net, type Packet} from 'xash3d-fwgs'
import type {VoicePlayer} from './voice'

// Lobbies run in the host's browser: their engine is a listen server and each
// friend connects to it peer-to-peer (WebRTC). PeerJS's free public service
// introduces the two browsers (and relays traffic when a network blocks direct
// connections); after that nothing goes through any server of ours.
//
// Per friend there is one WebRTC connection with three channels:
//   PeerJS's JSON channel    lobby messages (info, join, welcome, reject)
//   "game"                   engine packets: unordered, no retransmits, like UDP
//   "files"                  the game files, for friends who don't have them yet

export type LobbyInfo = {
    name: string
    map: string
    mode: string
    players: number
    maxPlayers: number
    private: boolean
}

type Msg =
    | ({ t: 'info' } & Partial<LobbyInfo>)
    | { t: 'join'; name: string; password: string; needFiles: boolean }
    | { t: 'welcome'; fileSize: number }
    | { t: 'reject'; reason: string }
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

class HostNet extends Net {
    recvfrom(fd: number, bufPtr: number, bufLen: number, flags: number, sockaddrPtr: number, socklenPtr: number) {
        if (this.sockets.get(fd)?.addr?.port !== SERVER_PORT) {
            this.em!.setValue(ErrNoLocation(this.em!), 73, 'i32') // same "no packet" errno as Net.recvfrom
            return -1
        }
        return super.recvfrom(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr)
    }
}

type Guest = { conn: DataConnection; game: RTCDataChannel; files: RTCDataChannel; ip: Packet['ip']; joined: boolean; name: string; voice: boolean }

export type HostOptions = {
    code: string
    password: string // '' = public
    info: () => Omit<LobbyInfo, 'players' | 'private'> & { bots: number }
    gameFiles: () => Promise<Blob>
}

export async function hostLobby(opts: HostOptions) {
    const guests = new Map<string, Guest>() // by fake ip
    let nextGuest = 1

    const net = new HostNet({
        sendto(p: Packet) {
            const g = guests.get(p.ip.join('.'))
            // copy: the data is a view into engine memory that the next packet reuses
            if (g?.joined && g.game.readyState === 'open') g.game.send(p.data.slice())
        },
    }, {maxPackets: 1024})

    const joinedCount = () => [...guests.values()].filter(g => g.joined).length
    const info = (): LobbyInfo => {
        const {bots, ...rest} = opts.info()
        return {...rest, players: 1 + joinedCount() + bots, private: !!opts.password}
    }

    const peer = new Peer(peerId(opts.code))
    await peerReady(peer)
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect() }, 2000))
    peer.on('error', () => undefined) // lost contact with the lobby service: 'disconnected' reconnects

    peer.on('connection', conn => {
        const n = nextGuest++
        const ip: Packet['ip'] = [10, 7, (n >> 8) & 255, n & 255]
        const key = ip.join('.')
        let guest: Guest | undefined

        conn.on('open', () => {
            const {game, files} = channels(conn)
            guest = {conn, game, files, ip, joined: false, name: '', voice: false}
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
            const i = info()
            const reason = opts.password && msg.password !== opts.password ? 'Wrong lobby password.'
                : i.players >= i.maxPlayers ? 'This lobby is full.'
                : ''
            if (reason) {
                conn.send({t: 'reject', reason} satisfies Msg)
                return
            }
            guest.joined = true
            guest.name = String(msg.name).slice(0, 32)
            const data = msg.needFiles ? await opts.gameFiles() : undefined
            conn.send({t: 'welcome', fileSize: data?.size ?? 0} satisfies Msg)
            if (data) sendFile(guest.files, data).catch(() => conn.close())
        })
        conn.on('close', () => {
            if (guests.get(key)?.conn !== conn) return
            guests.delete(key)
            sendRoster()
        })
        conn.on('error', () => conn.close())
    })

    const joined = () => [...guests.entries()].filter(([, g]) => g.joined)

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
    const close = () => peer.destroy()
    window.addEventListener('pagehide', close)
    return {
        net,
        peer,
        close,
        guests: joinedCount,
        players: () => joined().map(([key, g]) => ({key, name: g.name})),
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
            g.conn.send({t: 'reject', reason: 'The host removed you from the lobby.'} satisfies Msg)
            guests.delete(key)
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

export type JoinResult = { net: Net; files?: Blob }

export async function findLobby(code: string) {
    const peer = new Peer()
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

    // a host that just vanishes (closed tab, lost network) may never close the
    // channel cleanly, so watch the connection itself as well
    let closedHandler = (_reason?: string) => undefined as void
    let infoHandler = (_info: LobbyInfo) => undefined as void
    let rosterHandler = (_players: VoicePlayer[]) => undefined as void
    let joined = false
    conn.on('close', () => closedHandler())
    game.addEventListener('close', () => closedHandler())
    conn.peerConnection.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed'].includes(conn.peerConnection.connectionState)) closedHandler()
    })
    // while playing: the host removed us, or changed the map or mode
    listeners.add(m => {
        if (!joined) return
        if (m.t === 'reject') closedHandler(m.reason)
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

        async join(name: string, password: string, needFiles: boolean, progress: (got: number, total: number) => void): Promise<JoinResult> {
            const reply = next('welcome', 'reject')
            conn.send({t: 'join', name, password, needFiles} satisfies Msg)
            const m = await reply
            if (m.t === 'reject') throw new Error(m.reason)
            joined = true

            let blob: Blob | undefined
            if (m.fileSize) {
                blob = await new Promise<Blob>((resolve, reject) => {
                    const parts: ArrayBuffer[] = []
                    let got = 0
                    files.onmessage = e => {
                        parts.push(e.data as ArrayBuffer)
                        got += (e.data as ArrayBuffer).byteLength
                        progress(got, m.fileSize)
                        if (got >= m.fileSize) resolve(new Blob(parts))
                    }
                    conn.once('close', () => reject(new Error('The host closed the lobby before the game files arrived.')))
                })
            }

            const net = new Net({
                sendto(p: Packet) {
                    if (game.readyState === 'open') game.send(p.data.slice())
                },
            }, {maxPackets: 1024})
            // the engine connects to 127.0.0.1:8080; everything from the host comes "from" there
            game.onmessage = e => net.incoming.enqueue({ip: [127, 0, 0, 1], port: 8080, data: new Int8Array(e.data as ArrayBuffer)})
            return {net, files: blob}
        },

        onClose(fn: (reason?: string) => void) { closedHandler = fn },
        onInfo(fn: (info: LobbyInfo) => void) { infoHandler = fn },
        /** turn our voice chat on; fn gets everyone with voice on, now and on every change */
        voice(fn: (players: VoicePlayer[]) => void) {
            rosterHandler = fn
            conn.send({t: 'voice', on: true} satisfies Msg)
        },
        peer,
        close() { peer.destroy() },
    }
}

export type Lobby = Awaited<ReturnType<typeof findLobby>>
