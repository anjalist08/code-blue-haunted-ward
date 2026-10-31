// Shared types for the WardRoom actor, the agent service and the browser.
// Everything here is plain JSON so it survives @Persisted and the wire.

export type Rhythm = "sinus" | "pvc" | "vtach" | "vfib" | "asystole"
export type Category = "assess" | "order" | "treat" | "escalate"
export type Route = "bedside" | "pharmacy" | "lab" | "attending"
export type Role = "host" | "doctor" | "observer" | "agent"
export type Phase = "lobby" | "running" | "ended"
export type Outcome = "ongoing" | "stabilized" | "died"

export type Vitals = {
    hr: number
    sbp: number
    dbp: number
    spo2: number | null
    rr: number
    pulse: boolean
    rhythm: Rhythm
}

export type Physiology = {
    perfusion: number // 0..1, myocardial perfusion
    irritability: number // 0..1, drives rhythm changes
    rcaOpen: boolean
    rhythmSince: number // ms timestamp the current rhythm started
    aspirin: boolean
    heparin: boolean
    oxygen: boolean
    sedated: boolean
    fluids: number // mmHg of BP support from fluids
    nitroCrashUntil: number
    amioUntil: number
    cprUntil: number
    epiCount: number
    cathEta: number // 0 = not activated
    pciDone: boolean
    historyTaken: boolean
    ecgDone: boolean
    monitorOn: boolean
    ivAccess: boolean
}

export type FeedFrom = "nurse" | "pharmacist" | "lab-tech" | "attending" | "patient" | "doctor" | "system" | "scribe"

export type FeedItem = {
    id: string
    at: number
    from: FeedFrom
    text: string
    to?: string[]
    via?: "relay" | "local" | "actor"
    by?: string // human name, for doctor messages
}

export type OrderStatus = "requested" | "verifying" | "running" | "done" | "held" | "refused"

export type Order = {
    id: string
    at: number
    key: string
    label: string
    by: string
    text?: string
    status: OrderStatus
    note?: string
}

export type LabResult = { id: string; at: number; key: string; label: string; value: string; critical: boolean }

export type TimelineEvent = { at: number; kind: string; text: string }

export type NextOption = {
    id: string
    label: string
    category: Category
    why: string
    risk: "good" | "plausible" | "trap"
    orderKey: string
}

export type Member = { id: string; name: string; role: Role; connections: number }

export type WardState = {
    code: string
    caseId: string
    phase: Phase
    outcome: Outcome
    mode: "guided" | "exam"
    createdAt: number
    startedAt: number
    endedAt: number
    now: number
    phys: Physiology
    vitals: Vitals
    orders: Order[]
    results: LabResult[]
    feed: FeedItem[]
    timeline: TimelineEvent[]
    options: NextOption[]
    optionsPhase: string
    members: Member[]
    debrief: string
    flicker: number // increments when the lights should flicker
}

export type SocketMetadata = { id: string; name: string; role: Role }

export type Incoming = { type: "ping" } | { type: "hello" }
export type Outgoing = { type: "snapshot"; state: WardState }
