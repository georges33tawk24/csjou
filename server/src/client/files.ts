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
