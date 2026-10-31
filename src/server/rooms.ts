import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { actors } from "../../generated/index.js"
import type { Role, WardState } from "../sim/types"
import { config, readJson, writeJson } from "./config"

// Room codes, join tokens, and one backend "watcher" socket per active room so the
// agents can react to state changes (new rhythm, new phase) the way a browser would.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
type RoomRecord = { code: string; createdAt: number; host: string }
const rooms = new Map<string, RoomRecord>(Object.entries(readJson<Record<string, RoomRecord>>("rooms.json", {})))

export const ward = (code: string) => actors.WardRoom.get(code)

export function normalizeCode(code: string) {
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
}

export function roomExists(code: string) {
    return rooms.has(normalizeCode(code))
}

export async function createRoom(host: string): Promise<string> {
    let code = ""
    do code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("")
    while (rooms.has(code))
    rooms.set(code, { code, createdAt: Date.now(), host })
    writeJson("rooms.json", Object.fromEntries(rooms))
    await ward(code).init(code)
    return code
}

// --- Join tokens: stateless HMAC so they survive backend restarts. ---------------------

export type Identity = { id: string; code: string; name: string; role: Role }

export function issueToken(code: string, name: string, role: Role): { token: string; identity: Identity } {
    const identity: Identity = { id: randomUUID().slice(0, 8), code, name: name.trim().slice(0, 32) || "Doctor", role }
    const body = Buffer.from(JSON.stringify(identity)).toString("base64url")
    return { token: `${body}.${sign(body)}`, identity }
}

export function verifyToken(token: string | undefined, code: string): Identity | null {
    if (!token) return null
    const [body, sig] = token.split(".")
    if (!body || !sig) return null
    const expected = sign(body)
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    const identity = JSON.parse(Buffer.from(body, "base64url").toString()) as Identity
    return identity.code === normalizeCode(code) ? identity : null
}

const sign = (body: string) => createHmac("sha256", config.secret).update(body).digest("base64url")

export const canOrder = (who: Identity) => who.role === "host" || who.role === "doctor"

// --- Watchers ---------------------------------------------------------------------------

type Listener = (prev: WardState | null, next: WardState) => void
const latest = new Map<string, WardState>()
const watchers = new Map<string, WebSocket>()
const listeners: Listener[] = []
const touched = new Map<string, number>()

export const latestState = (code: string) => latest.get(code) ?? null
export const onStateChange = (fn: Listener) => listeners.push(fn)

export async function getState(code: string): Promise<WardState> {
    const cached = latest.get(code)
    if (cached && watchers.get(code)?.readyState === WebSocket.OPEN) return cached
    const fresh = await ward(code).getState()
    latest.set(code, fresh)
    return fresh
}

export async function watch(code: string, opts: { reconnect?: boolean } = {}): Promise<void> {
    if (!opts.reconnect) touched.set(code, Date.now())
    const existing = watchers.get(code)
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return
    const grant = await actors.WardRoom.prepareWebsocket({ actorId: code, metadata: { id: "agents", name: "Care team", role: "agent" } })
    const socket = new WebSocket(grant.websocketUrl)
    watchers.set(code, socket)
    socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as { type: string; state: WardState }
        if (message.type !== "snapshot") return
        const prev = latest.get(code) ?? null
        latest.set(code, message.state)
        for (const fn of listeners) {
            try {
                fn(prev, message.state)
            } catch (error) {
                console.warn(`[watch] listener: ${(error as Error).message}`)
            }
        }
    }
    socket.onclose = () => {
        if (watchers.get(code) === socket) watchers.delete(code)
        // Reconnect while the room is in use (touched in the last 45 min). Grants are single-use.
        if (Date.now() - (touched.get(code) ?? 0) < 45 * 60000) setTimeout(() => void watch(code, { reconnect: true }).catch(() => undefined), 3000)
    }
}

/** After a backend restart, re-attach the agents to every recent room whose case is still running. */
export async function rewatchRunningRooms(): Promise<string[]> {
    const recent = [...rooms.values()].filter(r => Date.now() - r.createdAt < 12 * 3600_000)
    const running: string[] = []
    for (const r of recent) {
        try {
            const s = await ward(r.code).getState()
            if (s.phase === "running") {
                running.push(r.code)
                await watch(r.code)
            }
        } catch {
            /* actor runtime not up yet; rooms re-watch on the next request */
        }
    }
    return running
}

export async function grantFor(code: string, identity: Identity) {
    touched.set(code, Date.now())
    const grant = await actors.WardRoom.prepareWebsocket({ actorId: code, metadata: { id: identity.id, name: identity.name, role: identity.role } })
    const url = new URL(grant.websocketUrl)
    // Browsers connect through our own origin (Vite proxies /v1/socket to the actor gateway),
    // so phones on the Wi-Fi never need to reach 127.0.0.1:7100.
    return { path: `${url.pathname}${url.search}`, connectByMs: grant.connectByMs }
}
