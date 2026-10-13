import type Peer from 'peerjs'
import type {MediaConnection} from 'peerjs'

// Voice chat between the players of a lobby, browser to browser (WebRTC
// audio, with the browser's echo cancellation and noise suppression). The host
// tells everyone who has voice on; every such pair gets one audio call, placed
// by the side with the smaller peer id. The engine's own voice chat stays off:
// it can't send the host's voice.

export type VoicePlayer = { id: string; name: string }

export async function startVoice(peer: Peer, mode: 'push' | 'open', volume: number) {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
    })
    const mic = stream.getAudioTracks()[0]
    mic.enabled = mode === 'open'

    const calls = new Map<string, { call: MediaConnection; audio?: HTMLAudioElement }>()
    let roster: VoicePlayer[] = []

    function attach(call: MediaConnection) {
        const entry: { call: MediaConnection; audio?: HTMLAudioElement } = {call}
        calls.set(call.peer, entry)
        call.on('stream', remote => {
            entry.audio = new Audio()
            entry.audio.srcObject = remote
            entry.audio.volume = volume
            entry.audio.play().catch(() => undefined) // needs the click that started the game
        })
        const drop = () => {
            if (calls.get(call.peer)?.call !== call) return
            entry.audio?.pause()
            calls.delete(call.peer)
        }
        call.on('close', drop)
        call.on('error', drop)
    }

    const onCall = (call: MediaConnection) => {
        if (call.metadata !== 'joucs-voice' || !roster.some(p => p.id === call.peer)) return call.close()
        calls.get(call.peer)?.call.close()
        call.answer(stream)
        attach(call)
    }
    peer.on('call', onCall)

    return {
        /** everyone else in the lobby who has voice on */
        setRoster(players: VoicePlayer[]) {
            roster = players.filter(p => p.id !== peer.id)
            for (const [id, {call}] of calls) if (!roster.some(p => p.id === id)) call.close()
            for (const p of roster) {
                if (!calls.has(p.id) && peer.id < p.id) attach(peer.call(p.id, stream, {metadata: 'joucs-voice'}))
            }
        },
        talk(on: boolean) {
            if (mode === 'push') mic.enabled = on
        },
        talking: () => mic.enabled,
        /** names of the players whose voice is coming through right now */
        speaking(): string[] {
            return roster.filter(p => {
                const receiver = calls.get(p.id)?.call.peerConnection?.getReceivers().find(r => r.track.kind === 'audio')
                return (receiver?.getSynchronizationSources()[0]?.audioLevel ?? 0) > 0.02
            }).map(p => p.name)
        },
        stop() {
            peer.off('call', onCall)
            for (const {call} of calls.values()) call.close()
            for (const t of stream.getTracks()) t.stop()
        },
    }
}

export type Voice = Awaited<ReturnType<typeof startVoice>>
