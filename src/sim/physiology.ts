import { CASE, catalogByKey, ecgReading, initialPhysiology, labValue, scriptedOptions } from "./case"
import type { FeedFrom, FeedItem, LabResult, Order, Physiology, Rhythm, TimelineEvent, Vitals, WardState } from "./types"

// Simplified perfusion model. A blocked RCA lowers perfusion, low perfusion raises irritability,
// irritability walks the rhythm sinus -> PVCs -> V-tach -> V-fib -> asystole.
// HR and BP are derived from rhythm + perfusion, never set by hand.
// Educational simulation, not medical advice.

export const TICK_MS = 2000
const FEED_CAP = 120
const TIMELINE_CAP = 400

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
let idCounter = 0
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(idCounter++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 5)}`

export function createWard(code: string, now: number): WardState {
    const phys = initialPhysiology(now)
    const state: WardState = {
        code,
        caseId: CASE.id,
        phase: "lobby",
        outcome: "ongoing",
        mode: "guided",
        createdAt: now,
        startedAt: 0,
        endedAt: 0,
        now,
        phys,
        vitals: deriveVitals(phys, "sinus", now, () => 0.5),
        orders: [],
        results: [],
        feed: [],
        timeline: [],
        options: [],
        optionsPhase: "",
        members: [],
        debrief: "",
        flicker: 0
    }
    state.options = scriptedOptions(state)
    return state
}

export function clone(state: WardState): WardState {
    return structuredClone(state)
}

export function pushFeed(state: WardState, from: FeedFrom, text: string, extra: Partial<FeedItem> = {}): FeedItem {
    const defined = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Partial<FeedItem>
    const item: FeedItem = { ...defined, id: extra.id ?? newId("f"), at: extra.at ?? state.now, from, text }
    if (state.feed.some(f => f.id === item.id)) return item
    state.feed = [...state.feed, item].slice(-FEED_CAP)
    return item
}

export function pushTimeline(state: WardState, kind: string, text: string) {
    const ev: TimelineEvent = { at: state.now, kind, text }
    state.timeline = [...state.timeline, ev].slice(-TIMELINE_CAP)
}

function setRhythm(state: WardState, rhythm: Rhythm, why: string) {
    if (state.vitals.rhythm === rhythm) return
    const from = state.vitals.rhythm
    state.vitals.rhythm = rhythm
    state.phys.rhythmSince = state.now
    if (rhythm === "vtach" || rhythm === "vfib" || rhythm === "asystole") state.flicker += 1
    pushTimeline(state, "rhythm", `${label(from)} → ${label(rhythm)} (${why})`)
    pushFeed(state, "system", `Monitor: ${label(rhythm).toUpperCase()}${rhythm === "vfib" || rhythm === "asystole" ? ". CODE BLUE, BED 13." : ""}`, { via: "actor" })
}

export function label(r: Rhythm): string {
    return { sinus: "sinus rhythm", pvc: "sinus with PVCs", vtach: "V-tach", vfib: "V-fib", asystole: "asystole" }[r]
}

export function hasPulse(r: Rhythm): boolean {
    return r === "sinus" || r === "pvc" || r === "vtach"
}

export function deriveVitals(p: Physiology, rhythm: Rhythm, now: number, rand: () => number): Vitals {
    const noise = (n: number) => (rand() - 0.5) * 2 * n
    const nitroDrop = p.nitroCrashUntil > now ? 38 : 0
    if (rhythm === "vfib" || rhythm === "asystole") {
        const cpr = p.cprUntil > now
        return { hr: 0, sbp: cpr ? Math.round(55 + noise(6)) : 0, dbp: cpr ? Math.round(20 + noise(4)) : 0, spo2: null, rr: cpr ? 10 : rhythm === "vfib" ? 4 : 0, pulse: false, rhythm }
    }
    if (rhythm === "vtach") {
        const sbp = Math.round(clamp(68 + p.perfusion * 22 + p.fluids * 0.5 - nitroDrop + noise(3), 45, 110))
        return { hr: Math.round(178 + noise(6)), sbp, dbp: Math.round(sbp * 0.6), spo2: Math.round(clamp(86 + p.perfusion * 6 + (p.oxygen ? 3 : 0), 70, 99)), rr: Math.round(26 + noise(2)), pulse: true, rhythm }
    }
    const hr = Math.round(clamp(76 + (1 - p.perfusion) * 48 - (p.sedated ? 4 : 0) + noise(2) + (nitroDrop ? 18 : 0), 50, 150))
    const sbp = Math.round(clamp(82 + p.perfusion * 58 - nitroDrop + p.fluids + noise(2), 50, 170))
    return {
        hr,
        sbp,
        dbp: Math.round(sbp * 0.63),
        spo2: Math.round(clamp(88 + p.perfusion * 8 + (p.oxygen ? 4 : 0) + noise(0.8), 75, 100)),
        rr: Math.round(clamp(14 + (1 - p.perfusion) * 14 + noise(1), 10, 34)),
        pulse: true,
        rhythm
    }
}

/** One physiology step. Mutates and returns a clone. */
export function tick(prev: WardState, now: number, rand: () => number = Math.random): WardState {
    const state = clone(prev)
    state.now = now
    if (state.phase !== "running") return state
    const p = state.phys
    const dt = TICK_MS / 1000
    const rhythm = state.vitals.rhythm
    const pulse = hasPulse(rhythm)

    // Cath lab arrives: only possible with a perfusing rhythm.
    if (p.cathEta && !p.pciDone && now >= p.cathEta) {
        if (pulse && rhythm !== "vtach") {
            p.pciDone = true
            p.rcaOpen = true
            pushTimeline(state, "pci", "Cath lab: RCA opened, stent placed")
            pushFeed(state, "attending", "Cath lab here. Proximal RCA 100% occluded. Wire across, balloon, stent. TIMI 3 flow. Nice work, team.", { via: "actor" })
        } else if (Math.floor(now / 10000) !== Math.floor((now - TICK_MS) / 10000)) {
            pushFeed(state, "attending", "Cath team is at the door but we can't move him until he has a stable rhythm.", { via: "actor" })
        }
    }

    // Perfusion.
    if (!p.rcaOpen) {
        let loss = 0.0042
        if (p.aspirin) loss *= 0.55
        if (p.heparin) loss *= 0.75
        if (!pulse) loss *= 2.2
        p.perfusion -= loss
    } else {
        p.perfusion += pulse ? 0.014 : 0
    }
    if (p.nitroCrashUntil > now) p.perfusion -= p.fluids > 0 ? 0.004 : 0.011
    if (p.oxygen && pulse) p.perfusion += 0.0006
    if (p.cprUntil > now && !pulse) p.perfusion += 0.004
    p.perfusion = clamp(p.perfusion, 0.04, 0.97)
    p.fluids = Math.max(0, p.fluids - 0.05)

    // Irritability chases a target set by perfusion.
    const target = clamp((0.74 - p.perfusion) * 1.7, 0, 1)
    p.irritability += (target - p.irritability) * 0.09
    if (p.amioUntil > now) p.irritability -= 0.012
    if (p.rcaOpen) p.irritability -= 0.012
    p.irritability = clamp(p.irritability, 0, 1)

    const inRhythm = (now - p.rhythmSince) / 1000
    switch (rhythm) {
        case "sinus":
            if (p.irritability > 0.36) setRhythm(state, "pvc", "ischemic irritability")
            break
        case "pvc":
            if (p.irritability > 0.6) setRhythm(state, "vtach", "R-on-T PVC")
            else if (p.irritability < 0.22) setRhythm(state, "sinus", "irritability settled")
            break
        case "vtach":
            if (p.amioUntil > now && rand() < 0.035) setRhythm(state, "sinus", "converted on amiodarone")
            else if (inRhythm > 48 || p.perfusion < 0.18) setRhythm(state, "vfib", "degenerated")
            break
        case "vfib": {
            const limit = p.cprUntil > now ? 150 : 70
            if (inRhythm > limit) setRhythm(state, "asystole", "no shock delivered in time")
            break
        }
        case "asystole":
            if (p.cprUntil > now && p.epiCount > 0 && rand() < 0.03) {
                setRhythm(state, "pvc", "ROSC after CPR + epinephrine")
                p.perfusion = Math.max(p.perfusion, 0.4)
            } else if (inRhythm > (p.cprUntil > now ? 180 : 60)) {
                endCase(state, "died")
            }
            break
    }

    if (p.rcaOpen && state.vitals.rhythm === "sinus" && p.perfusion > 0.82 && state.outcome === "ongoing") endCase(state, "stabilized")

    state.vitals = deriveVitals(p, state.vitals.rhythm, now, rand)
    return state
}

export function endCase(state: WardState, outcome: "died" | "stabilized") {
    if (state.outcome !== "ongoing") return
    state.outcome = outcome
    state.phase = "ended"
    state.endedAt = state.now
    pushTimeline(state, "outcome", outcome === "died" ? "Patient died" : "Patient stabilized")
    pushFeed(
        state,
        "system",
        outcome === "died" ? "Time of death 03:" + String(Math.floor((state.now - state.startedAt) / 60000)).padStart(2, "0") + ". The monitor flatlines. Somewhere down the hall, a door slams." : "Mr. Holloway is stable and on his way to the CCU. The lights stop flickering. For tonight.",
        { via: "actor" }
    )
    if (outcome === "died") state.flicker += 1
}

export function startCase(prev: WardState, now: number): WardState {
    const state = clone(prev)
    state.now = now
    if (state.phase === "running") return state
    const fresh = createWard(state.code, now)
    fresh.members = state.members
    fresh.mode = state.mode
    fresh.phase = "running"
    fresh.startedAt = now
    fresh.vitals = deriveVitals(fresh.phys, "sinus", now, Math.random)
    pushTimeline(fresh, "start", "Case started")
    pushFeed(fresh, "nurse", `Doctor, Bed 13. ${CASE.patient.name}, ${CASE.patient.age}${CASE.patient.sex}. ${CASE.patient.complaint} He says this is the third night he's woken at 3 AM like this.`, { via: "actor" })
    fresh.options = scriptedOptions(fresh)
    return fresh
}

export function addOrder(state: WardState, order: Order) {
    state.orders = [...state.orders, order].slice(-200)
    pushTimeline(state, "order", `${order.by} ordered ${order.label}`)
}

export function updateOrder(state: WardState, id: string, status: Order["status"], note?: string) {
    state.orders = state.orders.map(o => (o.id === id ? { ...o, status, note: note ?? o.note } : o))
}

export type ApplyResult = { ok: boolean; text: string; patient?: string }

/** Apply a cleared treatment or bedside action. Returns the nurse's report. */
export function applyTreatment(state: WardState, key: string, rand: () => number = Math.random): ApplyResult {
    const p = state.phys
    const now = state.now
    const r = state.vitals.rhythm
    const pulse = hasPulse(r)
    const item = catalogByKey.get(key)
    const name = item?.label ?? key
    const done = (text: string, patient?: string): ApplyResult => {
        pushTimeline(state, "treatment", name)
        return { ok: true, text, patient }
    }
    const refuse = (text: string): ApplyResult => {
        pushTimeline(state, "refused", `${name}: ${text}`)
        return { ok: false, text }
    }
    switch (key) {
        case "ask_history":
            p.historyTaken = true
            return done("History taken.", pulse && r !== "vtach" ? "Blood pressure pills... lisinopril. And, uh... I took one of those little blue pills around ten. Is that bad, Doc?" : undefined)
        case "exam":
            return done(pulse ? "Diaphoretic, pale. JVD up to the jaw, lungs clear. Looks like a right-sided picture." : "Unresponsive, no pulse.")
        case "monitor":
            p.monitorOn = true
            return done("Pads and monitor on.")
        case "iv_access":
            p.ivAccess = true
            return done("Two 18-gauge IVs in, labs drawn.")
        case "aspirin":
            if (p.aspirin) return refuse("Already given.")
            if (!pulse || r === "vtach") return refuse("He can't chew anything right now.")
            p.aspirin = true
            return done("Aspirin 324 mg chewed.")
        case "heparin":
            if (p.heparin) return refuse("Heparin already running.")
            p.heparin = true
            return done("Heparin bolus in, drip started.")
        case "nitro":
            // Only reached if the Pharmacist was overridden. Sildenafil + nitrate = crash.
            p.nitroCrashUntil = now + 24000
            state.flicker += 1
            return done("Nitro 0.4 mg given.", pulse ? "Whoa... Doc, the room's spinning..." : undefined)
        case "oxygen":
            p.oxygen = true
            return done("Oxygen 2 L nasal cannula on.")
        case "fluids":
            p.fluids = Math.min(24, p.fluids + 12)
            if (p.nitroCrashUntil > now) p.nitroCrashUntil = Math.max(now, p.nitroCrashUntil - 10000)
            return done("500 mL saline bolus running wide open.")
        case "morphine":
            return done("Morphine 2 mg IV in.", pulse ? "That... takes the edge off." : undefined)
        case "amiodarone":
            p.amioUntil = now + 120000
            p.irritability = clamp(p.irritability - 0.14, 0, 1)
            return done("Amiodarone 150 mg running over 10 minutes.")
        case "midazolam":
            p.sedated = true
            return done("Midazolam 2 mg in. He's drowsy.")
        case "sync_cardioversion":
            if (r === "vfib") return refuse("Sync can't find an R wave in V-fib. No shock delivered! Switch to unsynchronized.")
            if (r !== "vtach") return refuse(`He's in ${label(r)}. I'm not shocking that.`)
            if (rand() < 0.88) {
                setRhythm(state, "sinus", "synchronized cardioversion")
                p.irritability = clamp(p.irritability - 0.32, 0, 1)
                p.perfusion = Math.max(p.perfusion, 0.42)
                return done(`Synchronized 100 J delivered. Back in sinus.${p.sedated ? "" : " He was awake for that, Doctor."}`, p.sedated ? undefined : "AAAGH! What was that?!")
            }
            return done("Shock delivered, still in V-tach. Charge again?")
        case "defib":
            if (r === "vtach" && pulse) {
                setRhythm(state, "vfib", "unsynchronized shock on a perfusing rhythm (R-on-T)")
                return done("Unsynchronized 200 J delivered... he's gone into V-fib! He had a pulse, Doctor.")
            }
            if (r === "vfib") {
                if (rand() < 0.72) {
                    setRhythm(state, "pvc", "defibrillation")
                    p.irritability = clamp(p.irritability - 0.3, 0, 1)
                    p.perfusion = Math.max(p.perfusion, 0.36)
                    p.cprUntil = 0
                    return done("200 J delivered. Organized rhythm, I have a pulse!")
                }
                return done("200 J delivered. Still V-fib. Resume compressions.")
            }
            if (r === "asystole") return refuse("Asystole isn't shockable. Compressions and epi.")
            return refuse(`He's in ${label(r)} with a pulse. I'm not defibrillating.`)
        case "cpr":
            if (pulse) return refuse("He has a pulse. No compressions.")
            p.cprUntil = now + 120000
            return done("Compressions started, 110 a minute, switching every 2 minutes.")
        case "epinephrine":
            if (pulse) {
                p.irritability = clamp(p.irritability + 0.12, 0, 1)
                return done("1 mg epi pushed. Heart rate's climbing, Doctor. That wasn't an arrest dose situation.")
            }
            p.epiCount += 1
            p.perfusion = clamp(p.perfusion + 0.03, 0, 1)
            return done(`Epi 1 mg in (dose ${p.epiCount}). Flush. Next one in 3-5.`)
        case "cath_lab":
            if (p.cathEta) return refuse("Cath lab already activated.")
            p.cathEta = now + 60000
            return done("Cath lab activated. Team ETA ~60 seconds of sim time.")
        default:
            return refuse("Not sure what you want me to do there, Doctor.")
    }
}

export function addResult(state: WardState, key: string): LabResult {
    const item = catalogByKey.get(key)
    const base = labValue(key, state)
    let value = base.value
    let critical = base.critical
    if (key === "ecg12") {
        value = ecgReading(state.vitals.rhythm, state.phys.rcaOpen)
        critical = !state.phys.rcaOpen || !hasPulse(state.vitals.rhythm)
        state.phys.ecgDone = true
    }
    const result: LabResult = { id: newId("r"), at: state.now, key, label: item?.label ?? key, value, critical }
    state.results = [...state.results, result].slice(-50)
    pushTimeline(state, "result", `${result.label}: ${value}`)
    return result
}

/** Deterministic debrief used when the model is unavailable. */
export function scriptedDebrief(state: WardState): string {
    const t0 = state.startedAt || state.createdAt
    const first = (kind: string, needle: string) => state.timeline.find(e => e.kind === kind && e.text.toLowerCase().includes(needle))
    const mins = (e?: TimelineEvent) => (e ? `${((e.at - t0) / 60000).toFixed(1)} min` : "never")
    const ecg = first("result", "12-lead")
    const asa = first("treatment", "aspirin")
    const cath = first("treatment", "cath lab")
    const nitroOrdered = state.orders.find(o => o.key === "nitro")
    const lines = [
        `Outcome: ${state.outcome === "stabilized" ? "STABILIZED ✅" : state.outcome === "died" ? "DIED 💀" : "still in progress"}`,
        `12-lead ECG: ${mins(ecg)} (goal < 10 min from arrival)`,
        `Aspirin: ${mins(asa)}`,
        `Cath lab activation: ${mins(cath)}`,
        nitroOrdered ? `Nitroglycerin ordered at ${((nitroOrdered.at - t0) / 60000).toFixed(1)} min. ${nitroOrdered.status === "held" ? "Pharmacist held it: sildenafil within 24 h." : "It was given, and his pressure crashed."}` : "Avoided the nitroglycerin trap.",
        ...state.timeline.filter(e => e.kind === "rhythm" || e.kind === "refused").map(e => `• ${((e.at - t0) / 60000).toFixed(1)} min: ${e.text}`)
    ]
    return lines.join("\n")
}
