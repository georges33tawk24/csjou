// Hands JOUCS players relay (TURN) passwords that last a day, so friends whose
// network blocks direct connections (mobile data, carrier NAT) can still join a
// lobby. The relay is Cloudflare Realtime TURN: 1,000 GB a month free.
//
// Secrets (Cloudflare dashboard → Realtime → TURN Server → Create, then
// `npx wrangler secret put TURN_KEY_ID` and `... TURN_KEY_API_TOKEN`).

const ORIGINS = ['https://georges33tawk24.github.io', 'http://localhost:8099']

export default {
    async fetch(req, env) {
        const origin = req.headers.get('Origin') ?? ''
        // ponytail: Origin only stops other websites, not scripts; add rate limiting if the free allowance ever gets eaten
        if (!ORIGINS.includes(origin)) return new Response('forbidden', {status: 403})
        const headers = {'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store', 'Content-Type': 'application/json'}
        if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return new Response('{"error":"not set up"}', {status: 503, headers})

        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({ttl: 86400}),
        })
        if (!r.ok) return new Response(JSON.stringify({error: `turn ${r.status}`}), {status: 502, headers})
        const {iceServers} = await r.json()
        // browsers block port 53, and waiting for it to time out slows connecting down
        for (const s of iceServers) s.urls = [].concat(s.urls).filter(u => !/:53\b/.test(u))
        return new Response(JSON.stringify({iceServers}), {headers})
    },
}
