import type { Category, NextOption, Physiology, Rhythm, Route, WardState } from "./types"

// Case 1: Mr. Holloway. Inferior STEMI (RCA occlusion) that slides into V-tach, then V-fib, if untreated.
// Educational simulation, not medical advice.

export const CASE = {
    id: "holloway-stemi",
    title: "Mr. Holloway, Bed 13",
    patient: {
        name: "Elias Holloway",
        age: 58,
        sex: "M",
        job: "night watchman at the old Ravenwood hospital annex",
        complaint: "Crushing chest pain since 2:40 AM, radiating to the jaw, sweating, nauseous.",
        history: "Hypertension, 30 pack-year smoker, high cholesterol.",
        homeMeds: "Lisinopril 10 mg daily. Took sildenafil (\"the little blue pill\") at about 10 PM last night.",
        allergies: "No known drug allergies.",
        hidden: "Took sildenafil ~5 hours ago. Only admits it if asked about medications, drugs or erectile dysfunction."
    },
    startClock: "03:00"
}

export type CatalogItem = {
    key: string
    label: string
    category: Category
    route: Route
    synonyms: string[]
    labDelayMs?: number
}

export const CATALOG: CatalogItem[] = [
    { key: "ask_history", label: "Ask about history, meds & drugs", category: "assess", route: "bedside", synonyms: ["history", "medication", "meds", "drugs", "viagra", "sildenafil", "what do you take", "allerg"] },
    { key: "exam", label: "Focused cardiac exam", category: "assess", route: "bedside", synonyms: ["exam", "examine", "listen", "auscultate", "jvd", "lungs"] },
    { key: "monitor", label: "Monitor + defib pads on", category: "assess", route: "bedside", synonyms: ["monitor", "pads", "telemetry", "leads on"] },
    { key: "iv_access", label: "Two large-bore IVs", category: "assess", route: "bedside", synonyms: ["iv", "line", "access", "cannula"] },
    { key: "ecg12", label: "12-lead ECG", category: "order", route: "lab", synonyms: ["ecg", "ekg", "12 lead", "twelve lead", "12-lead"], labDelayMs: 7000 },
    { key: "troponin", label: "Point-of-care troponin", category: "order", route: "lab", synonyms: ["troponin", "trop", "cardiac enzymes"], labDelayMs: 22000 },
    { key: "bmp", label: "BMP + magnesium", category: "order", route: "lab", synonyms: ["bmp", "electrolytes", "potassium", "magnesium", "chem"], labDelayMs: 18000 },
    { key: "cxr", label: "Portable chest X-ray", category: "order", route: "lab", synonyms: ["x-ray", "xray", "cxr", "chest film"], labDelayMs: 26000 },
    { key: "aspirin", label: "Aspirin 324 mg chewed", category: "treat", route: "pharmacy", synonyms: ["aspirin", "asa"] },
    { key: "nitro", label: "Nitroglycerin 0.4 mg SL", category: "treat", route: "pharmacy", synonyms: ["nitro", "nitroglycerin", "gtn", "ntg"] },
    { key: "heparin", label: "Heparin 60 U/kg IV bolus", category: "treat", route: "pharmacy", synonyms: ["heparin", "anticoag"] },
    { key: "oxygen", label: "Oxygen via nasal cannula", category: "treat", route: "bedside", synonyms: ["oxygen", "o2", "nasal cannula", "non-rebreather"] },
    { key: "fluids", label: "Normal saline 500 mL bolus", category: "treat", route: "pharmacy", synonyms: ["fluid", "saline", "bolus", "normal saline", "lactated"] },
    { key: "morphine", label: "Morphine 2 mg IV", category: "treat", route: "pharmacy", synonyms: ["morphine", "pain", "fentanyl", "analgesi"] },
    { key: "amiodarone", label: "Amiodarone 150 mg IV", category: "treat", route: "pharmacy", synonyms: ["amiodarone", "amio", "antiarrhythmic", "lidocaine"] },
    { key: "midazolam", label: "Midazolam 2 mg IV (sedate)", category: "treat", route: "pharmacy", synonyms: ["midazolam", "sedate", "versed", "sedation"] },
    { key: "sync_cardioversion", label: "Synchronized cardioversion 100 J", category: "treat", route: "bedside", synonyms: ["synchronized", "cardiovert", "cardioversion", "sync"] },
    { key: "defib", label: "Unsynchronized defibrillation 200 J", category: "treat", route: "bedside", synonyms: ["defib", "shock", "unsynchronized", "200 j", "clear"] },
    { key: "cpr", label: "Start CPR", category: "treat", route: "bedside", synonyms: ["cpr", "compressions", "chest compressions"] },
    { key: "epinephrine", label: "Epinephrine 1 mg IV push", category: "treat", route: "pharmacy", synonyms: ["epi", "epinephrine", "adrenaline"] },
    { key: "cath_lab", label: "Activate the cath lab", category: "escalate", route: "attending", synonyms: ["cath", "pci", "cardiology", "interventional", "catheter"] }
]

export const catalogByKey = new Map(CATALOG.map(item => [item.key, item]))

/** Cheap keyword matcher. The LLM parser is only used when this returns null. */
export function matchOrder(text: string): CatalogItem | null {
    const t = text.toLowerCase()
    // Order matters: "synchronized" must win over "shock", "unsynchronized" over "synchronized".
    if (/unsync|defib/.test(t)) return catalogByKey.get("defib")!
    if (/\bsync|cardiover/.test(t)) return catalogByKey.get("sync_cardioversion")!
    let best: { item: CatalogItem; len: number } | null = null
    for (const item of CATALOG) {
        for (const s of item.synonyms) {
            const re = new RegExp(`(^|[^a-z])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
            if (re.test(t) && (!best || s.length > best.len)) best = { item, len: s.length }
        }
    }
    return best?.item ?? null
}

/** Phase key used to cache Attending suggestions: only recompute options when this changes. */
export function phaseKey(state: Pick<WardState, "phys" | "vitals" | "outcome">): string {
    const p = state.phys
    return [
        state.outcome,
        state.vitals.rhythm,
        state.vitals.pulse ? "pulse" : "nopulse",
        p.ecgDone ? "ecg" : "noecg",
        p.aspirin ? "asa" : "noasa",
        p.cathEta ? (p.pciDone ? "pci" : "cath") : "nocath",
        p.historyTaken ? "hx" : "nohx"
    ].join("|")
}

const opt = (orderKey: string, risk: NextOption["risk"], why: string, label?: string): NextOption => {
    const item = catalogByKey.get(orderKey)!
    return { id: `${orderKey}-${risk}`, orderKey, label: label ?? item.label, category: item.category, why, risk }
}

/** Scripted fallback options per phase, so a model failure never blanks the panel. */
export function scriptedOptions(state: Pick<WardState, "phys" | "vitals" | "outcome">): NextOption[] {
    const { phys: p, vitals: v } = state
    if (state.outcome === "stabilized") {
        return [opt("heparin", "good", "Continue anticoagulation after PCI."), opt("bmp", "plausible", "Check K+ and Mg2+ after the arrhythmia."), opt("nitro", "trap", "Still contraindicated: sildenafil was taken within 24 h.")]
    }
    if (v.rhythm === "vfib" || (v.rhythm === "vtach" && !v.pulse)) {
        return [opt("defib", "good", "Pulseless shockable rhythm: shock first, then resume CPR."), opt("cpr", "good", "High-quality compressions between shocks."), opt("epinephrine", "plausible", "Epi after the second shock, every 3-5 min."), opt("sync_cardioversion", "trap", "Sync mode can't find an R wave in V-fib. No shock delivered.")]
    }
    if (v.rhythm === "asystole") {
        return [opt("cpr", "good", "Asystole: CPR is the treatment."), opt("epinephrine", "good", "Epinephrine as soon as possible in non-shockable arrest."), opt("defib", "trap", "Asystole is not a shockable rhythm.")]
    }
    if (v.rhythm === "vtach") {
        return [
            opt("sync_cardioversion", "good", "Unstable V-tach with a pulse: synchronized cardioversion."),
            opt("midazolam", "good", "Sedate first if there's time; he's awake."),
            opt("amiodarone", "plausible", "Reasonable for stable VT, but too slow when he's hypotensive."),
            opt("defib", "trap", "Unsynchronized shock with a pulse risks R-on-T and V-fib.")
        ]
    }
    if (!p.ecgDone) {
        return [opt("ecg12", "good", "Chest pain: 12-lead ECG within 10 minutes of arrival."), opt("aspirin", "good", "Chew aspirin early for suspected ACS."), opt("troponin", "plausible", "Useful, but must not delay the ECG."), opt("nitro", "trap", "Ask about PDE5 inhibitors (sildenafil) before nitrates.")]
    }
    if (!p.cathEta) {
        return [
            opt(p.aspirin ? "heparin" : "aspirin", "good", p.aspirin ? "Anticoagulate en route to the cath lab." : "Aspirin 324 mg chewed, now."),
            opt("cath_lab", "good", "STEMI: door-to-balloon time is everything."),
            opt("troponin", "plausible", "Reasonable, but never wait on troponin to activate the cath lab in STEMI."),
            opt("nitro", "trap", "He took sildenafil: nitrates can crash his pressure. Inferior MI is preload-dependent too.")
        ]
    }
    return [
        opt("fluids", v.sbp < 95 ? "good" : "plausible", "Inferior MI often involves the RV: preload-dependent, small fluid boluses."),
        opt(p.ivAccess ? "monitor" : "iv_access", "good", "Prepare for the cath lab and possible arrest."),
        opt("ask_history", p.historyTaken ? "plausible" : "good", "Med history matters before any vasodilator."),
        opt("nitro", "trap", "Sildenafil + nitrates = profound hypotension.")
    ]
}

export function initialPhysiology(now: number): Physiology {
    return {
        perfusion: 0.68,
        irritability: 0.12,
        rcaOpen: false,
        rhythmSince: now,
        aspirin: false,
        heparin: false,
        oxygen: false,
        sedated: false,
        fluids: 0,
        nitroCrashUntil: 0,
        amioUntil: 0,
        cprUntil: 0,
        epiCount: 0,
        cathEta: 0,
        pciDone: false,
        historyTaken: false,
        ecgDone: false,
        monitorOn: false,
        ivAccess: false
    }
}

export function ecgReading(rhythm: Rhythm, rcaOpen: boolean): string {
    if (rhythm === "vfib") return "Ventricular fibrillation. No organized complexes."
    if (rhythm === "asystole") return "Asystole. Confirm in two leads."
    if (rhythm === "vtach") return "Wide-complex tachycardia ~180 bpm, monomorphic V-tach."
    if (rcaOpen) return "Sinus rhythm, resolving ST elevation in II, III, aVF. Reperfusion."
    return `${rhythm === "pvc" ? "Sinus with frequent PVCs" : "Sinus tachycardia"}. ST elevation in II, III, aVF with reciprocal depression in I and aVL. ST elevation in V4R. INFERIOR STEMI with RV involvement.`
}

export function labValue(key: string, state: Pick<WardState, "phys" | "startedAt" | "now">): { value: string; critical: boolean } {
    const minutes = Math.max(1, (state.now - state.startedAt) / 60000)
    switch (key) {
        case "troponin": {
            const value = (0.4 + minutes * 0.35).toFixed(2)
            return { value: `hs-Troponin I ${value} ng/mL (ref < 0.04)`, critical: true }
        }
        case "bmp":
            return { value: "Na 138, K 3.3 (low), Cl 101, HCO3 22, Cr 1.0, Glu 168, Mg 1.5 (low)", critical: true }
        case "cxr":
            return { value: "No pulmonary edema. Normal mediastinum. No pneumothorax.", critical: false }
        case "ecg12":
            return { value: "", critical: false }
        default:
            return { value: "Pending", critical: false }
    }
}
