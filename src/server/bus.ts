import { EventEmitter } from "node:events"

import { AgentRelay } from "@agent-relay/sdk"

import { config, readJson, writeJson } from "./config"

// The care team talks over Agent Relay: one channel per room (#ward-<code>), and agents
// address each other with @handles. A listen-only "scribe" agent sees every message,
// because Relay doesn't echo a sender's own messages back to it.
//
// If Relay can't be reached, we fall back to an in-process bus with the same interface,
// so the demo never goes dark. The UI shows which one is live.

export const AGENTS = ["nurse", "pharmacist", "lab-tech", "attending", "doctor", "scribe"] as const
export type AgentName = (typeof AGENTS)[number]

export type BusMeta = Record<string, string | number | boolean | null>

export type BusMessage = {
    id: string
    code: string
    from: AgentName
    text: string
    mentions: AgentName[]
    meta: BusMeta
    at: number
}

export type BusStatus = { mode: "relay" | "local"; detail: string; workspace?: string }

type Handler = (message: BusMessage) => void

export const channelFor = (code: string) => `ward-${code.toLowerCase()}`
const codeFromChannel = (name?: string) => (name?.startsWith("ward-") ? name.slice(5).toUpperCase() : null)

export function parseMentions(text: string): AgentName[] {
    const found = new Set<AgentName>()
    for (const m of text.matchAll(/@([a-z-]+)/g)) {
        if ((AGENTS as readonly string[]).includes(m[1]!)) found.add(m[1] as AgentName)
    }
    return [...found]
}

interface Bus {
    status(): BusStatus
    ensureRoom(code: string): Promise<void>
    send(from: AgentName, code: string, text: string, meta?: BusMeta): Promise<void>
    onMessage(handler: Handler): void
}

class LocalBus implements Bus {
    private emitter = new EventEmitter()
    constructor(private reason: string) {}
    status(): BusStatus {
        return { mode: "local", detail: this.reason }
    }
    async ensureRoom() {}
    async send(from: AgentName, code: string, text: string, meta: BusMeta = {}) {
        const message: BusMessage = { id: `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, code, from, text, mentions: parseMentions(text), meta, at: Date.now() }
        setTimeout(() => this.emitter.emit("message", message), 120)
    }
    onMessage(handler: Handler) {
        this.emitter.on("message", handler)
    }
}

type RelayAgent = Awaited<ReturnType<AgentRelay["workspace"]["register"]>> extends infer T ? (T extends unknown[] ? never : T) : never
type SavedRelay = { baseUrl?: string; workspaceKey?: string; workspaceName?: string; tokens: Record<string, string> }

class RelayBus implements Bus {
    private handlers: Handler[] = []
    private seen = new Set<string>()
    private rooms = new Set<string>()
    constructor(
        private relay: AgentRelay,
        private agents: Map<AgentName, RelayAgent>,
        private workspace: string
    ) {
        relay.addListener("message.created", event => {
            const { message, envelope } = event as unknown as {
                message: { id: string; text: string; from?: { name?: string }; metadata?: BusMeta }
                envelope: { channel?: { name?: string }; from?: { name?: string } }
            }
            const code = codeFromChannel(envelope.channel?.name)
            if (!code || this.seen.has(message.id)) return
            this.seen.add(message.id)
            if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000))
            const from = (message.from?.name ?? envelope.from?.name ?? "scribe") as AgentName
            const out: BusMessage = { id: message.id, code, from, text: message.text, mentions: parseMentions(message.text), meta: message.metadata ?? {}, at: Date.now() }
            for (const h of this.handlers) h(out)
        })
    }
    status(): BusStatus {
        return { mode: "relay", detail: `Agent Relay${config.relayBaseUrl ? ` @ ${config.relayBaseUrl}` : " (hosted)"}`, workspace: this.workspace }
    }
    async ensureRoom(code: string) {
        if (this.rooms.has(code)) return
        const channel = channelFor(code)
        const nurse = this.agents.get("nurse")!
        await nurse.channels.create({ name: channel, topic: `Code Blue: Haunted Ward, room ${code}` }).catch(() => undefined)
        for (const [name, agent] of this.agents) {
            if (name === "nurse") continue
            await agent.channels.join(channel).catch(() => undefined)
        }
        this.rooms.add(code)
    }
    async send(from: AgentName, code: string, text: string, meta: BusMeta = {}) {
        await this.ensureRoom(code)
        const agent = this.agents.get(from)!
        await agent.sendMessage({ to: `#${channelFor(code)}`, text, metadata: meta })
    }
    onMessage(handler: Handler) {
        this.handlers.push(handler)
    }
}

async function connectRelay(): Promise<RelayBus> {
    const saved = readJson<SavedRelay>("relay.json", { tokens: {} })
    const baseUrl = config.relayBaseUrl
    const sameServer = (saved.baseUrl ?? "") === (baseUrl ?? "")
    let workspaceKey = config.relayWorkspaceKey ?? (sameServer ? saved.workspaceKey : undefined)
    let workspaceName = saved.workspaceName ?? "configured"
    let tokens = sameServer && workspaceKey === saved.workspaceKey ? saved.tokens : {}

    let relay: AgentRelay
    if (workspaceKey) {
        relay = new AgentRelay({ workspaceKey, baseUrl })
    } else {
        workspaceName = `haunted-ward-${Math.random().toString(36).slice(2, 8)}`
        relay = await AgentRelay.createWorkspace({ name: workspaceName, baseUrl })
        workspaceKey = relay.workspaceKey!
        tokens = {}
    }

    const agents = new Map<AgentName, RelayAgent>()
    for (const name of AGENTS) {
        let agent: RelayAgent | null = null
        if (tokens[name]) agent = (await relay.workspace.reconnect({ apiToken: tokens[name]! }).catch(() => null)) as RelayAgent | null
        if (!agent) {
            try {
                agent = (await relay.workspace.register({ name, type: "agent" })) as RelayAgent
            } catch (error) {
                if ((error as { code?: string }).code === "name_conflict") {
                    throw new Error(`Relay agent "${name}" already exists in this workspace and its token isn't in .ward/relay.json. Unset RELAY_WORKSPACE_KEY or delete .ward/relay.json to start a fresh workspace.`)
                }
                throw error
            }
        }
        agents.set(name, agent)
        tokens[name] = agent.token!
    }
    writeJson("relay.json", { baseUrl, workspaceKey, workspaceName, tokens } satisfies SavedRelay)
    // Give each agent's event stream a moment to attach before the first message.
    await new Promise(r => setTimeout(r, 800))
    return new RelayBus(relay, agents, workspaceName)
}

let bus: Bus = new LocalBus("starting")
const pending: Handler[] = []

export async function startBus(): Promise<BusStatus> {
    if (config.relayDisabled) {
        bus = new LocalBus("RELAY_DISABLED=1")
    } else {
        try {
            bus = await Promise.race([connectRelay(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out after 15s")), 15000))])
        } catch (error) {
            const reason = (error as Error).message
            console.warn(`[relay] falling back to the in-process bus: ${reason}`)
            bus = new LocalBus(`Relay unavailable: ${reason}`)
        }
    }
    for (const h of pending) bus.onMessage(h)
    return bus.status()
}

export const busStatus = () => bus.status()
export const ensureRoom = (code: string) => bus.ensureRoom(code).catch(e => console.warn(`[relay] ensureRoom ${code}: ${(e as Error).message}`))
export async function send(from: AgentName, code: string, text: string, meta: BusMeta = {}) {
    try {
        await bus.send(from, code, text, meta)
    } catch (error) {
        console.warn(`[relay] send failed (${from}): ${(error as Error).message}`)
    }
}
export function onMessage(handler: Handler) {
    pending.push(handler)
    bus.onMessage(handler)
}
