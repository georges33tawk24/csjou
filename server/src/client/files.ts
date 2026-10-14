import JSZip, {loadAsync} from 'jszip'

// The game files (valve/ + cstrike/ from CS 1.6) are Valve's, so they are never
// published with JOUCS. A player either loads their own copy or receives the
// host's when joining a lobby; either way it is kept in the browser (Cache
// Storage, per site) so it only happens once.

const CACHE = 'joucs-game-files'
const ZIP_KEY = 'valve.zip'

async function cache(): Promise<Cache | undefined> {
    // Cache Storage only exists on https:// and localhost
    if (typeof caches === 'undefined') return undefined
    return caches.open(CACHE).catch(() => undefined)
}

// Blobs, not ArrayBuffers: the browser can keep 250 MB of them on disk
export async function savedGameFiles(): Promise<Blob | undefined> {
    const res = await (await cache())?.match(ZIP_KEY)
    return res?.blob()
}

/** false when this browser can't keep them (private window, no space) */
export async function saveGameFiles(data: Blob): Promise<boolean> {
    const c = await cache()
    return !!c && c.put(ZIP_KEY, new Response(data)).then(() => true, () => false)
}

/** valve/ and cstrike/ at the zip root, with at least one CS map */
export function checkGameFiles(zip: JSZip): string | undefined {
    const names = Object.keys(zip.files)
    if (!names.some(n => n.startsWith('valve/'))) return 'it has no valve/ folder at the top'
    if (!names.some(n => /^cstrike\/maps\/[^/]+\.bsp$/i.test(n))) return 'it has no cstrike/maps/*.bsp'
    return undefined
}

export async function openGameFiles(data: Blob): Promise<JSZip> {
    const zip = await loadAsync(data)
    const problem = checkGameFiles(zip)
    if (problem) throw new Error(`That zip is not a CS 1.6 game folder: ${problem}.`)
    return zip
}

export function mapsIn(zip: JSZip): string[] {
    return Object.keys(zip.files)
        .map(f => /^cstrike\/maps\/([a-z0-9_]+)\.bsp$/.exec(f)?.[1])
        .filter((m): m is string => !!m)
        .sort()
}

// Bot navigation meshes take ~30 s to build per map; keep them too.
export async function savedNav(map: string): Promise<ArrayBuffer | undefined> {
    return (await (await cache())?.match(`nav/${map}.nav`))?.arrayBuffer()
}

export async function saveNav(map: string, data: Uint8Array) {
    await (await cache())?.put(`nav/${map}.nav`, new Response(data as BlobPart)).catch(() => undefined)
}

// ---------- extra maps ----------
// Fan maps (aim_map, fy_snow, ...) loaded from the player's device: .bsp and
// .wad files, or a .zip of a map pack. Kept like the game files; a lobby host
// sends theirs to friends who don't have them.

export type Extra = { path: string; blob: Blob }

const EXTRA_BASE = () => new URL('__joucs_extra/', location.href).href
const EXTRA_RE = /^cstrike\/(maps\/[a-z0-9_.-]+\.(bsp|txt|res)|[a-z0-9_.-]+\.wad|(sound|models|sprites|gfx|overviews)\/[a-z0-9_./-]+\.(wav|mdl|spr|tga|bmp|txt))$/
const MAX_EXTRAS = 400e6

/** where a file from a map download belongs in the game folder, or nothing */
export function extraPath(name: string): string | undefined {
    let p = name.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, '')
    const i = p.indexOf('cstrike/')
    if (i >= 0) p = p.slice(i)
    else if (/^(maps|sound|models|sprites|gfx|overviews)\//.test(p)) p = 'cstrike/' + p
    else if (p.endsWith('.bsp')) p = 'cstrike/maps/' + p.split('/').pop()
    else if (p.endsWith('.wad')) p = 'cstrike/' + p.split('/').pop()
    return !p.includes('..') && EXTRA_RE.test(p) ? p : undefined
}

export async function savedExtras(): Promise<Extra[]> {
    const c = await cache()
    if (!c) return []
    const base = EXTRA_BASE()
    const keys = (await c.keys()).filter(r => r.url.startsWith(base))
    return Promise.all(keys.map(async r => ({path: decodeURIComponent(r.url.slice(base.length)), blob: await (await c.match(r))!.blob()})))
}

export async function saveExtra(e: Extra) {
    await (await cache())?.put(EXTRA_BASE() + encodeURIComponent(e.path), new Response(e.blob)).catch(() => undefined)
}

export async function clearExtras() {
    const c = await cache()
    if (!c) return
    const base = EXTRA_BASE()
    for (const r of await c.keys()) if (r.url.startsWith(base)) await c.delete(r)
}

/**
 * Files picked by the player -> extra files to keep. Paths the base game already
 * has are skipped (a lobby must play the same de_dust2 for everyone).
 */
export async function readExtras(files: File[], baseHas: (path: string) => boolean): Promise<Extra[]> {
    const out: Extra[] = []
    const add = (name: string, blob: Blob) => {
        const path = extraPath(name)
        if (path && !baseHas(path) && !out.some(e => e.path === path)) out.push({path, blob})
    }
    for (const f of files) {
        if (f.name.toLowerCase().endsWith('.zip')) {
            const z = await loadAsync(f)
            for (const [name, entry] of Object.entries(z.files)) {
                if (!entry.dir && extraPath(name)) add(name, await entry.async('blob'))
            }
        } else add(f.name, f)
    }
    if (out.reduce((n, e) => n + e.blob.size, 0) > MAX_EXTRAS) throw new Error('That is more than 400 MB of maps.')
    return out
}

export const extraMaps = (extras: Extra[]) => extras
    .map(e => /^cstrike\/maps\/([a-z0-9_.-]+)\.bsp$/.exec(e.path)?.[1])
    .filter((m): m is string => !!m)

/**
 * The next speed (bytes a second) for game files a friend downloads while
 * others play, from those players' ping samples (ms, oldest first, two a
 * second, the last minute). It backs off as soon as anyone's best recent ping
 * is 20 ms over their best of the minute (the files are filling the host's
 * upload), and otherwise speeds up by 16 KB/s every second. Tuned on a model
 * of a home upload in checks.ts.
 */
export function nextFileRate(rate: number, pings: number[][]): number {
    if (rate === Infinity) rate = 128 << 10
    // the lower of the last 2 samples ignores one-off jitter
    const added = pings.map(p => p.length < 4 ? undefined : Math.min(...p.slice(-2)) - Math.min(...p))
    if (added.includes(undefined)) return Math.min(rate, 128 << 10) // just joined: no measurement yet
    return Math.max(...added as number[]) > 20 ? Math.max(32 << 10, rate * 0.7) : rate + (8 << 10)
}
