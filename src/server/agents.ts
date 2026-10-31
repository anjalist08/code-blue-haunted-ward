import { CASE, CATALOG, catalogByKey, matchOrder, phaseKey, scriptedOptions, type CatalogItem } from "../sim/case"
import { hasPulse, label as rhythmLabel, scriptedDebrief } from "../sim/physiology"
import type { Category, FeedFrom, NextOption, WardState } from "../sim/types"
import * as bus from "./bus"
import { complete, completeJson } from "./llm"
import { getState, latestState, onStateChange, ward, watch } from "./rooms"

// The care team. Each agent is a small loop: it reacts to Relay messages that @mention it,
// calls the WardRoom actor, and replies over Relay. Orders flow:
//   doctor desk -> @nurse -> (@pharmacist | @lab-tech | @attending) -> @nurse -> actor -> @doctor
// Templated lines keep the hot path instant and cheap; the mini model adds the Attending's
// teaching, next-step options, free-text parsing, and the debrief.

const room = (code: string) => ward(code)

function stateSummary(s: WardState): string {
    const v = s.vitals
    const p = s.phys
    const mins = s.startedAt ? ((s.now - s.startedAt) / 60000).toFixed(1) : "0"
    return [
        `t=${mins} min. Rhythm: ${rhythmLabel(v.rhythm)}${v.pulse ? "" : " (NO PULSE)"}. HR ${v.hr}, BP ${v.sbp}/${v.dbp}, SpO2 ${v.spo2 ?? "--"}, RR ${v.rr}.`,
        `Given: ${[p.aspirin && "aspirin", p.heparin && "heparin", p.oxygen && "oxygen", p.sedated && "midazolam", p.amioUntil > s.now && "amiodarone", p.epiCount && `epi x${p.epiCount}`].filter(Boolean).join(", ") || "nothing yet"}.`,
        `12-lead done: ${p.ecgDone}. History taken: ${p.historyTaken}. Cath lab: ${p.pciDone ? "RCA opened" : p.cathEta ? "activated, en route" : "not activated"}.`,
        `Results: ${s.results.map(r => `${r.label}: ${r.value}`).join(" | ") || "none"}.`
    ].join("\n")
}

const ATTENDING_SYSTEM = `You are Dr. Vance, the night-shift attending in "Code Blue: Haunted Ward", a med-student training sim set in a spooky hospital at 3 AM.
Patient: ${CASE.patient.name}, ${CASE.patient.age}${CASE.patient.sex}. ${CASE.patient.complaint} ${CASE.patient.history} Hidden: ${CASE.patient.hidden}
The truth: inferior STEMI from an RCA occlusion with RV involvement. He deteriorates to V-tach and V-fib if untreated.
You teach Socratically: one or two short sentences, ask a pointed question, never lecture, never give the whole answer. Dry, slightly ominous humor is OK. Educational simulation, not medical advice.`

// --- Order routing ------------------------------------------------------------------------

export type PlacedOrder = { orderId: string; key: string; label: string }

export async function placeOrder(code: string, item: CatalogItem, by: string, text?: string): Promise<PlacedOrder> {
    await watch(code).catch(() => undefined)
    const order = await room(code).placeOrder({ key: item.key, label: item.label, by, text })
    const said = text && text.toLowerCase() !== item.label.toLowerCase() ? `“${text}” → ${item.label}` : item.label
    await bus.send("doctor", code, `@nurse ${by} orders: ${said}`, { kind: "order", orderId: order.id, key: item.key, by })
    return { orderId: order.id, key: item.key, label: item.label }
}

export async function askTeam(code: string, by: string, text: string) {
    await bus.send("doctor", code, `@nurse ${by} asks: ${text}`, { kind: "question", by, question: text })
}

export async function askPatient(code: string, by: string, text: string) {
    const s = await getState(code)
    await room(code).postFeed({ from: "doctor", text: `(to patient) ${text}`, by, via: "actor" })
    const answer = await patientReply(s, text)
    if (answer) await room(code).postFeed({ from: "patient", text: answer, via: "actor" })
}

async function patientReply(s: WardState, question: string): Promise<string | null> {
    const v = s.vitals
    if (!v.pulse) return "(no response, he's unresponsive)"
    const condition = v.rhythm === "vtach" ? "You are barely conscious, dizzy, the room is going dark. Speak in fragments." : v.sbp < 90 ? "You feel faint and cold." : s.phys.rcaOpen ? "The pain is much better now." : "Crushing chest pain, sweaty, scared."
    const reply = await complete(
        `You are ${CASE.patient.name}, ${CASE.patient.age}, ${CASE.patient.job}, a patient in a hospital bed at 3 AM. ${CASE.patient.complaint} ${CASE.patient.history} Meds: ${CASE.patient.homeMeds} ${CASE.patient.allergies} ${CASE.patient.hidden} ${condition}
Answer the doctor in character in 1-2 short spoken sentences. You are a little spooked: you've woken at exactly 3 AM three nights in a row.`,
        question,
        90
    )
    return reply ?? (s.phys.historyTaken ? "It's my chest, Doc... like an elephant sitting on it." : "Please... it's crushing. Like something's sitting on my chest.")
}

/** Turn free text (typed or spoken) into orders, a patient question, or a team question. */
export async function interpret(text: string): Promise<{ kind: "orders"; items: CatalogItem[] } | { kind: "patient" | "team" }> {
    const parts = text
        .split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|\balso\b|\bplus\b)\s*/i)
        .map(p => p.trim())
        .filter(Boolean)
    const matched = parts.map(p => matchOrder(p)).filter((x): x is CatalogItem => Boolean(x))
    const unique = [...new Map(matched.map(i => [i.key, i])).values()]
    const looksLikeQuestion = /\?\s*$|^(how|what|when|where|why|do|does|did|are|is|can|have|any)\b/i.test(text.trim())
    if (looksLikeQuestion) {
        // "Do you take any meds?" is history-taking, the only way to learn about the sildenafil.
        if (unique.some(i => i.key === "ask_history")) return { kind: "orders", items: [catalogByKey.get("ask_history")!] }
    } else if (unique.length) {
        return { kind: "orders", items: unique }
    }

    const parsed = await completeJson<{ kind: "orders" | "patient" | "team"; keys?: string[] }>(
        `You route spoken words in an ER sim. Catalog keys: ${CATALOG.map(c => `${c.key} (${c.label})`).join("; ")}.
If the words are orders to the care team, return {"kind":"orders","keys":[...]} using only catalog keys.
If they are addressed to the patient (questions about symptoms, history, reassurance), return {"kind":"patient"}.
Otherwise (a question for the nurse/team), return {"kind":"team"}.`,
        text,
        120
    )
    if (parsed?.kind === "orders") {
        const items = (parsed.keys ?? []).map(k => catalogByKey.get(k)).filter((x): x is CatalogItem => Boolean(x))
        if (items.length) return { kind: "orders", items }
    }
    if (parsed?.kind === "team") return { kind: "team" }
    if (looksLikeQuestion || parsed?.kind === "patient") return { kind: "patient" }
    return { kind: "team" }
}

// --- Agent handlers --------------------------------------------------------------------

type Msg = bus.BusMessage
const str = (v: unknown) => (typeof v === "string" ? v : "")

async function nurse(m: Msg) {
    const code = m.code
    const kind = str(m.meta.kind)
    const orderId = str(m.meta.orderId)
    const key = str(m.meta.key)
    const item = catalogByKey.get(key)

    if (m.from === "doctor" && kind === "order" && item) {
        switch (item.route) {
            case "bedside": {
                await room(code).updateOrder(orderId, "running")
                const result = await room(code).treat(orderId, item.key)
                await bus.send("nurse", code, `@doctor ${result.ok ? "Done." : "Hold on."} ${result.text}`, { kind: result.ok ? "done" : "refused", orderId, key })
                return
            }
            case "pharmacy":
                await room(code).updateOrder(orderId, "verifying")
                await bus.send("nurse", code, `@pharmacist Please verify ${item.label} for Bed 13 (ordered by ${str(m.meta.by)}).`, { kind: "verify", orderId, key })
                return
            case "lab":
                await room(code).updateOrder(orderId, "running")
                await bus.send("nurse", code, `@lab-tech ${item.label} for Bed 13, stat please.`, { kind: "lab", orderId, key })
                return
            case "attending":
                await room(code).updateOrder(orderId, "verifying")
                await bus.send("nurse", code, `@attending ${str(m.meta.by)} wants to ${item.label.toLowerCase()}. Are you OK with that?`, { kind: "consult", orderId, key })
                return
        }
    }

    if (m.from === "doctor" && kind === "question") {
        const s = await getState(code)
        const answer =
            (await complete(
                `You are Nurse Okafor, an unflappable night-shift ER nurse in a spooky hospital at 3 AM. Answer the doctor's question in 1-2 short sentences using only the chart below. If they should order something, nudge, don't decide for them. Educational simulation.\n${stateSummary(s)}`,
                str(m.meta.question) || m.text,
                120
            )) ?? `Current vitals: HR ${s.vitals.hr}, BP ${s.vitals.sbp}/${s.vitals.dbp}, SpO2 ${s.vitals.spo2 ?? "--"}. What do you want to do, Doctor?`
        await bus.send("nurse", code, `@doctor ${answer}`, { kind: "answer" })
        return
    }

    if (m.from === "pharmacist" && (kind === "cleared" || kind === "held") && item) {
        if (kind === "held") {
            await room(code).updateOrder(orderId, "held", str(m.meta.reason))
            await bus.send("nurse", code, `@doctor Pharmacy is holding the ${item.label}. ${str(m.meta.reason)} Do you want something else?`, { kind: "held", orderId, key })
            return
        }
        await room(code).updateOrder(orderId, "running")
        const result = await room(code).treat(orderId, item.key)
        await bus.send("nurse", code, `@doctor ${result.ok ? "Given." : "Couldn't give it."} ${result.text}`, { kind: result.ok ? "done" : "refused", orderId, key })
        return
    }

    if (m.from === "lab-tech" && kind === "result" && item) {
        const value = str(m.meta.value)
        await bus.send("nurse", code, `@doctor @attending ${item.label} is back: ${value}`, { kind: "result", orderId, key, critical: Boolean(m.meta.critical) })
        return
    }

    if (m.from === "attending" && (kind === "approve" || kind === "decline") && item) {
        if (kind === "decline") {
            await room(code).updateOrder(orderId, "refused", str(m.meta.reason))
            await bus.send("nurse", code, `@doctor The attending wants more before ${item.label.toLowerCase()}.`, { kind: "refused", orderId, key })
            return
        }
        const result = await room(code).treat(orderId, item.key)
        await bus.send("nurse", code, `@doctor ${result.text}`, { kind: result.ok ? "done" : "refused", orderId, key })
    }
}

async function pharmacist(m: Msg) {
    if (str(m.meta.kind) !== "verify") return
    const code = m.code
    const key = str(m.meta.key)
    const orderId = str(m.meta.orderId)
    const s = await getState(code)
    const hold = (reason: string) => bus.send("pharmacist", code, `@nurse HOLD ${catalogByKey.get(key)?.label}. ${reason}`, { kind: "held", orderId, key, reason })
    const clear = (note: string) => bus.send("pharmacist", code, `@nurse Verified ${catalogByKey.get(key)?.label}. ${note}`, { kind: "cleared", orderId, key })

    switch (key) {
        case "nitro":
            return hold(
                s.phys.historyTaken
                    ? "He told us he took sildenafil at 22:00. PDE5 inhibitor within 24 h plus a nitrate = profound hypotension. Also inferior MI with RV involvement is preload-dependent."
                    : "Med reconciliation: his outpatient fill history shows sildenafil, and nobody has asked him about it yet. Nitrates within 24 h of a PDE5 inhibitor can drop his pressure off a cliff. Ask him."
            )
        case "aspirin":
            return s.phys.aspirin ? hold("He already had 324 mg.") : clear("No allergies, no active bleeding on the chart. 324 mg chewed.")
        case "heparin":
            return clear("Weight 92 kg: 5,500 unit bolus, then 12 U/kg/h. No bleeding history.")
        case "morphine":
            return clear(s.vitals.sbp < 95 ? `Careful, his systolic is ${s.vitals.sbp}. Morphine can drop it further.` : "2 mg IV, watch his pressure.")
        case "fluids":
            return clear("RV infarct pattern, so preload helps. 500 mL, reassess the lungs.")
        case "amiodarone":
            return clear(s.vitals.rhythm === "vtach" && s.vitals.sbp < 90 ? `Cleared, but he's unstable at ${s.vitals.sbp} systolic. Amio is slow; electricity is fast.` : "150 mg over 10 minutes. K+ and Mg2+ would help.")
        case "epinephrine":
            return clear(hasPulse(s.vitals.rhythm) ? "He has a pulse. Are you sure about a 1 mg arrest dose? Releasing it on your order." : "1 mg 1:10,000 IV push, flush 20 mL.")
        case "midazolam":
            return clear(s.vitals.sbp < 85 ? "Low pressure: consider 1 mg instead. Releasing 2 mg." : "2 mg IV for procedural sedation.")
        default:
            return clear("No interactions on file.")
    }
}

async function labTech(m: Msg) {
    if (str(m.meta.kind) !== "lab") return
    const code = m.code
    const key = str(m.meta.key)
    const orderId = str(m.meta.orderId)
    const item = catalogByKey.get(key)
    const delay = item?.labDelayMs ?? 15000
    await bus.send("lab-tech", code, `@nurse On it. ${item?.label} in about ${Math.round(delay / 1000)} s.`, { kind: "ack", orderId, key })
    setTimeout(async () => {
        try {
            const result = await room(code).addResult(orderId, key)
            if (!result) return
            await bus.send("lab-tech", code, `@nurse ${result.label}: ${result.value}${result.critical ? " (CRITICAL)" : ""}`, { kind: "result", orderId, key, value: result.value, critical: result.critical })
        } catch (error) {
            console.warn(`[lab-tech] ${(error as Error).message}`)
        }
    }, delay)
}

const lastTeach = new Map<string, number>()

async function attending(m: Msg) {
    const code = m.code
    const kind = str(m.meta.kind)
    const key = str(m.meta.key)
    const orderId = str(m.meta.orderId)
    const s = await getState(code)

    if (kind === "consult" && key === "cath_lab") {
        if (!s.phys.ecgDone) {
            await bus.send("attending", code, "@nurse @doctor Activate the cath lab on what evidence? Show me a 12-lead first. It takes thirty seconds.", { kind: "decline", orderId, key, reason: "No 12-lead yet" })
            return
        }
        await bus.send("attending", code, "@nurse ST elevation in II, III, aVF. That's a STEMI. Activate the cath lab, I'll call interventional. Doctor, what else does he need before he rolls?", { kind: "approve", orderId, key })
        return
    }

    if (kind === "result") {
        const now = Date.now()
        if (now - (lastTeach.get(code) ?? 0) < 8000) return
        lastTeach.set(code, now)
        const fallback = key === "ecg12" ? "Inferior leads. Which artery, and what does V4R add?" : key === "troponin" ? "Positive troponin. But did you need it to decide anything here?" : "Noted. How does that change your next move?"
        const text = (await complete(ATTENDING_SYSTEM, `${stateSummary(s)}\nThe nurse just reported: ${m.text}\nSay one Socratic line to the student.`, 90)) ?? fallback
        await bus.send("attending", code, `@doctor ${text}`, { kind: "teach" })
    }
}

// --- Next-step options (Attending) -----------------------------------------------------

const optionsCache = new Map<string, NextOption[]>()
const inflight = new Set<string>()

async function refreshOptions(code: string, s: WardState) {
    const phase = phaseKey(s)
    if (s.optionsPhase === phase || inflight.has(code)) return
    inflight.add(code)
    try {
        let options = optionsCache.get(phase)
        // Arrhythmias and arrests get the scripted, ACLS-correct options: no model creativity there.
        const critical = !s.vitals.pulse || s.vitals.rhythm === "vtach" || s.outcome !== "ongoing"
        if (critical) options = scriptedOptions(s)
        if (!options) {
            const generated = await completeJson<{ options: Array<{ label: string; category: Category; why: string; risk: NextOption["risk"]; orderKey: string }> }>(
                `${ATTENDING_SYSTEM}\nGenerate the student's "What do you do next?" options. Exactly 4 options: one clearly good, one or two plausible, one tempting trap. Use only these orderKeys: ${CATALOG.map(c => c.key).join(", ")}.
Return {"options":[{"label","category":"assess|order|treat|escalate","why","risk":"good|plausible|trap","orderKey"}]}. "why" is one sentence shown after they choose. Labels are short imperative orders.`,
                stateSummary(s),
                450
            )
            const valid = (generated?.options ?? [])
                .filter(o => catalogByKey.has(o.orderKey) && ["good", "plausible", "trap"].includes(o.risk))
                .slice(0, 4)
                .map((o, i) => ({ id: `${o.orderKey}-${i}`, orderKey: o.orderKey, label: o.label || catalogByKey.get(o.orderKey)!.label, category: catalogByKey.get(o.orderKey)!.category, why: o.why, risk: o.risk }))
            // The model's "good" pick must match one the case file agrees is correct.
            const correct = new Set(scriptedOptions(s).filter(o => o.risk === "good").map(o => o.orderKey))
            options = valid.length >= 3 && valid.some(o => o.risk === "good" && correct.has(o.orderKey)) ? valid : scriptedOptions(s)
            optionsCache.set(phase, options)
        }
        // Shuffle so the good option isn't always first.
        const shuffled = [...options].sort(() => Math.random() - 0.5)
        await room(code).setOptions(phase, shuffled)
    } catch (error) {
        console.warn(`[attending] options: ${(error as Error).message}`)
    } finally {
        inflight.delete(code)
    }
}

const RHYTHM_CALLOUTS: Record<string, string> = {
    pvc: "@doctor PVCs, and they're getting closer together. His myocardium is irritable. Why?",
    vtach: "@doctor Wide and fast. Is he stable or unstable? That decides everything.",
    vfib: "@doctor @nurse V-fib! No pulse. You know what this rhythm wants.",
    asystole: "@doctor Flatline. Check your leads, then: shockable or not?"
}

function onState(prev: WardState | null, next: WardState) {
    if (!prev) return
    if (next.phase === "running" && prev.vitals.rhythm !== next.vitals.rhythm && RHYTHM_CALLOUTS[next.vitals.rhythm]) {
        void bus.send("attending", next.code, RHYTHM_CALLOUTS[next.vitals.rhythm]!, { kind: "callout" })
    }
    if (next.phase !== "lobby") void refreshOptions(next.code, next)
}

// --- Bridge + wiring -------------------------------------------------------------------

const HANDLERS: Partial<Record<bus.AgentName, (m: Msg) => Promise<void>>> = {
    nurse,
    pharmacist,
    "lab-tech": labTech,
    attending
}

export function startAgents() {
    bus.onMessage(m => {
        // Mirror every Relay message into the room's chatter feed so judges can watch it live.
        const from: FeedFrom = m.from === "scribe" ? "system" : m.from
        void room(m.code)
            .postFeed({ from, text: m.text.replace(/^(@[a-z-]+\s*)+/, ""), id: m.id, to: m.mentions, via: bus.busStatus().mode, by: str(m.meta.by) || undefined })
            .catch(e => console.warn(`[bridge] ${(e as Error).message}`))
        for (const target of m.mentions) {
            if (target === m.from) continue
            const handler = HANDLERS[target]
            if (handler) void handler(m).catch(e => console.warn(`[${target}] ${(e as Error).message}`))
        }
    })
    onStateChange(onState)
}

export async function debrief(code: string): Promise<string> {
    const s = await getState(code)
    const base = scriptedDebrief(s)
    const t0 = s.startedAt || s.createdAt
    const timeline = s.timeline.map(e => `${((e.at - t0) / 60000).toFixed(1)}m ${e.kind}: ${e.text}`).join("\n")
    const ai = await complete(
        `${ATTENDING_SYSTEM}\nWrite the post-code debrief for the students: 5-7 bullet points, each starting with a timestamp where possible ("You gave aspirin at 1.2 min, good."). Call out delays, the nitroglycerin/sildenafil trap, rhythm management, and one thing to practice. End with a one-line spooky sign-off.`,
        `Outcome: ${s.outcome}\nKey metrics:\n${base}\nFull timeline:\n${timeline}`,
        500
    )
    const text = ai ? `${ai}\n\n---\n${base}` : base
    await room(code).setDebrief(text)
    return text
}

export { latestState }
