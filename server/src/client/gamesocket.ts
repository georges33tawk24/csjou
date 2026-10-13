import {Net, Packet, Xash3D, Xash3DOptions} from "xash3d-fwgs"

/**
 * Game packets to the JOUCS server over a WebSocket (/game), one message per
 * packet. Goes through the host's HTTPS link, so hosting needs no router port
 * forwarding. The engine connects to 127.0.0.1:8080 as before.
 */
export class Xash3DGameSocket extends Xash3D {
    private ws?: WebSocket

    constructor(private gameServer: URL, opts?: Xash3DOptions) {
        super(opts)
        this.net = new Net(this)
    }

    async init() {
        await Promise.all([super.init(), this.connect()])
    }

    private connect() {
        return new Promise<void>((resolve, reject) => {
            const url = new URL("game", this.gameServer)
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
            const ws = new WebSocket(url)
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => resolve()
            ws.onerror = () => reject(new Error('Could not reach the game server'))
            ws.onmessage = e => (this.net as Net).incoming.enqueue({
                ip: [127, 0, 0, 1],
                port: 8080,
                data: new Int8Array(e.data as ArrayBuffer),
            })
            this.ws = ws
        })
    }

    sendto(packet: Packet) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(packet.data)
    }
}
