import { Actor, type ActorSocket, Persisted } from "durable-actors"

import { scriptedOptions } from "./sim/case"
import * as sim from "./sim/physiology"
import type { FeedItem, Incoming, LabResult, NextOption, Order, Outgoing, SocketMetadata, WardState } from "./sim/types"

type Socket = ActorSocket<SocketMetadata, Outgoing>

type NewOrder = { key: string; label: string; by: string; text?: string }
type FeedInput = { from: FeedItem["from"]; text: string; id?: string; to?: string[]; via?: "relay" | "local" | "actor"; by?: string }
type TreatResult = { ok: boolean; text: string; patient?: string }

/**
 * One WardRoom per room code. Holds the patient (vitals, rhythm, meds, orders, timeline)
 * and the room (members, agent chatter feed, next-step options).
 *
 * The physiology runs on the actor's durable alarm every 2 s, so Mr. Holloway keeps
 * deteriorating while every browser is closed, and after the runtime restarts.
 *
 * Terse rules: every method must be async, no accessors, and nested mutations of a
 * @Persisted field are not saved. So each change clones the state and reassigns `ward`.
 */
export class WardRoom extends Actor<SocketMetadata, Incoming, Outgoing> {
    @Persisted ward: WardState | null = null

    async init(code: string): Promise<WardState> {
        if (this.ward) return this.ward
        return commit(this, sim.createWard(code, Date.now()), m => this.broadcast(m))
    }

    async getState(): Promise<WardState> {
        return cur(this, this.id)
    }

    async start(): Promise<WardState> {
        const next = sim.startCase(cur(this, this.id), Date.now())
        this.alarm.set(Date.now() + sim.TICK_MS)
        return commit(this, next, m => this.broadcast(m))
    }

    async reset(): Promise<WardState> {
        const old = cur(this, this.id)
        const fresh = sim.createWard(old.code, Date.now())
        fresh.members = old.members
        fresh.mode = old.mode
        return commit(this, fresh, m => this.broadcast(m))
    }

    async setMode(mode: "guided" | "exam"): Promise<WardState> {
        return mutate(this, this.id, m => this.broadcast(m), s => {
            s.mode = mode
        })
    }

    async onAlarm(): Promise<void> {
        const s = cur(this, this.id)
        if (s.phase !== "running") return
        const next = sim.tick(s, Date.now())
        if (next.phase === "running") this.alarm.set(Date.now() + sim.TICK_MS)
        commit(this, next, m => this.broadcast(m))
    }

    async placeOrder(input: NewOrder): Promise<Order> {
        const order: Order = { id: sim.newId("o"), at: Date.now(), key: input.key, label: input.label, by: input.by, status: "requested" }
        if (input.text) order.text = input.text
        // The order shows up in the feed when the doctor's desk posts it to the Nurse over Relay.
        mutate(this, this.id, m => this.broadcast(m), s => sim.addOrder(s, order))
        return order
    }

    async updateOrder(id: string, status: Order["status"], note?: string): Promise<WardState> {
        return mutate(this, this.id, m => this.broadcast(m), s => sim.updateOrder(s, id, status, note))
    }

    async treat(orderId: string, key: string): Promise<TreatResult> {
        let result: TreatResult = { ok: false, text: "The case isn't running." }
        mutate(this, this.id, m => this.broadcast(m), s => {
            if (s.phase !== "running") return
            const applied = sim.applyTreatment(s, key)
            result = { ok: applied.ok, text: applied.text, patient: applied.patient }
            sim.updateOrder(s, orderId, applied.ok ? "done" : "refused", applied.text)
            if (applied.patient) sim.pushFeed(s, "patient", applied.patient, { via: "actor" })
            s.vitals = sim.deriveVitals(s.phys, s.vitals.rhythm, s.now, Math.random)
        })
        return JSON.parse(JSON.stringify(result)) as TreatResult
    }

    async addResult(orderId: string, key: string): Promise<LabResult | null> {
        let result: LabResult | null = null
        mutate(this, this.id, m => this.broadcast(m), s => {
            if (s.phase === "lobby") return
            const added = sim.addResult(s, key)
            result = added
            sim.updateOrder(s, orderId, "done", added.value)
        })
        return result
    }

    async postFeed(input: FeedInput): Promise<FeedItem | null> {
        let item: FeedItem | null = null
        mutate(this, this.id, m => this.broadcast(m), s => {
            item = sim.pushFeed(s, input.from, input.text, { id: input.id, to: input.to, via: input.via ?? "relay", by: input.by })
        })
        return item ? (JSON.parse(JSON.stringify(item)) as FeedItem) : null
    }

    async setOptions(phase: string, options: NextOption[]): Promise<WardState> {
        return mutate(this, this.id, m => this.broadcast(m), s => {
            s.optionsPhase = phase
            s.options = options.length ? options : scriptedOptions(s)
        })
    }

    async setDebrief(text: string): Promise<WardState> {
        return mutate(this, this.id, m => this.broadcast(m), s => {
            s.debrief = text
        })
    }

    async onConnect(socket: Socket): Promise<void> {
        const meta = socket.metadata
        socket.setTags(meta.role)
        if (meta.role !== "agent") {
            mutate(this, this.id, m => this.broadcast(m), s => {
                const existing = s.members.find(m => m.id === meta.id)
                s.members = existing
                    ? s.members.map(m => (m.id === meta.id ? { ...m, name: meta.name, role: meta.role, connections: m.connections + 1 } : m))
                    : [...s.members, { id: meta.id, name: meta.name, role: meta.role, connections: 1 }]
            })
        }
        socket.send({ type: "snapshot", state: cur(this, this.id) })
        // Self-heal: if the case is running but the alarm was lost, re-arm it.
        if (cur(this, this.id).phase === "running") this.alarm.set(Date.now() + sim.TICK_MS)
    }

    async onMessage(socket: Socket, _message: Incoming): Promise<void> {
        socket.send({ type: "snapshot", state: cur(this, this.id) })
    }

    async onDisconnect(socket: Socket): Promise<void> {
        const meta = socket.metadata
        if (meta.role === "agent") return
        mutate(this, this.id, m => this.broadcast(m), s => {
            s.members = s.members.map(m => (m.id === meta.id ? { ...m, connections: Math.max(0, m.connections - 1) } : m)).filter(m => m.connections > 0)
        })
    }
}

type Send = (message: Outgoing) => void

function cur(self: WardRoom, id: string): WardState {
    if (!self.ward) self.ward = sim.createWard(id, Date.now())
    return self.ward
}

function commit(self: WardRoom, raw: WardState, send: Send): WardState {
    // JSON round-trip drops `undefined` fields, which Terse rejects on the wire.
    const next = JSON.parse(JSON.stringify(raw)) as WardState
    self.ward = next
    send({ type: "snapshot", state: next })
    return next
}

function mutate(self: WardRoom, id: string, send: Send, fn: (draft: WardState) => void): WardState {
    const draft = sim.clone(cur(self, id))
    draft.now = Date.now()
    fn(draft)
    return commit(self, draft, send)
}
