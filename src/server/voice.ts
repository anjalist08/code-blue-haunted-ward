import { CASE } from "../sim/case"
import { label as rhythmLabel } from "../sim/physiology"
import type { WardState } from "../sim/types"
import { config } from "./config"
import { realtimeClientSecret } from "./llm"

// OpenAI Realtime runs the patient's voice and hears the student's orders.
// The browser connects over WebRTC with a short-lived client secret minted here.
// When the student gives an order, the model calls `place_order`, and the browser sends it
// down the same path as a tapped option: backend -> doctor desk -> @nurse over Relay.

export function patientCondition(s: WardState): string {
    const v = s.vitals
    if (s.outcome === "died") return "You have died. Stay completely silent."
    if (!v.pulse) return "You are in cardiac arrest: unconscious, no pulse. Say nothing at all. Still call place_order for the team's orders."
    if (v.rhythm === "vtach") return `Your heart is racing at ${v.hr}; you're dizzy, grey, the room is going dark. Speak only in faint fragments.`
    if (s.phys.nitroCrashUntil > s.now) return "You suddenly feel faint and nauseous, the room is spinning."
    if (s.phys.rcaOpen) return "The crushing pain has eased a lot. You're exhausted, relieved, still a bit spooked."
    return `Crushing chest pain, sweaty, scared. HR ${v.hr}, BP ${v.sbp}/${v.dbp}. Rhythm: ${rhythmLabel(v.rhythm)}.`
}

export function instructions(s: WardState): string {
    return `You are ${CASE.patient.name}, ${CASE.patient.age}, ${CASE.patient.job}. You are the PATIENT in a hospital bed in Bed 13 at 3 AM in a medical training simulation.
${CASE.patient.complaint} ${CASE.patient.history} Home meds: ${CASE.patient.homeMeds} ${CASE.patient.allergies}
Secret: ${CASE.patient.hidden}
Spooky detail: this is the third night in a row you've woken at exactly 3 AM with a feeling that someone is standing at the foot of your bed.
Current condition: ${patientCondition(s)}

Rules:
- Speak ONLY as the patient. Short, natural, spoken sentences (max 2). Never give medical advice or tell the doctor what to order.
- The people talking to you are med-student doctors. Some of what they say is an ORDER to the care team (a drug, a test, oxygen, a shock, CPR, the cath lab, "get me a...", "give...", "start..."). For every order, call the place_order tool with their words, then react briefly as the patient (or stay silent if you're unconscious).
- Questions to you (symptoms, history, meds) are NOT orders: just answer in character.
- Speak English.`
}

export const voiceTools = [
    {
        type: "function",
        name: "place_order",
        description: "Send the doctor's spoken order to the care team (nurse, pharmacy, lab, attending). Use for any medication, test, procedure, shock, CPR or escalation.",
        parameters: {
            type: "object",
            properties: { text: { type: "string", description: "The order in the doctor's own words, e.g. 'give 324 mg aspirin' or 'get a troponin and an ECG'" } },
            required: ["text"]
        }
    }
]

export async function mintVoiceSession(s: WardState) {
    const secret = await realtimeClientSecret(instructions(s), voiceTools)
    if (!secret) return null
    return { clientSecret: secret.value, expiresAt: secret.expiresAt, model: config.realtimeModel, maxSeconds: config.voiceMaxSeconds }
}
