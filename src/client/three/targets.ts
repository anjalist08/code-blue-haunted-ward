import type { WardState } from "../../sim/types"
import type { RegionId } from "./heartAsset"

// Colours for the anatomy, and which part of the heart each order is aimed at.
// The OR view lights the target up; the legend explains it.

export const REGION_STYLE: Record<RegionId, { color: string; label: string }> = {
    lv: { color: "#ff9a3c", label: "Left ventricle" },
    rv: { color: "#4da3ff", label: "Right ventricle" },
    inferior: { color: "#b04dff", label: "Inferior wall" },
    ra: { color: "#3fe0c5", label: "Right atrium" },
    la: { color: "#7be0ff", label: "Left atrium" },
    vessels: { color: "#ff6b9a", label: "Great vessels" },
    apex: { color: "#ffd84d", label: "Apex" },
    septum: { color: "#ffffff", label: "Septum" }
}

export type TargetId = RegionId | "rca" | "clot" | "ventricles" | "whole" | "sa"

export type Target = {
    id: TargetId
    label: string
    color: string
    kind: "clot" | "shock" | "drug" | "lead" | "volume" | "escalate" | "assess"
}

const T = (id: TargetId, color: string, kind: Target["kind"], label: string): Target => ({ id, color, kind, label })

export const ORDER_TARGETS: Record<string, Target> = {
    aspirin: T("clot", "#ffd84d", "drug", "Aspirin → platelets in the RCA clot"),
    heparin: T("clot", "#ffe08a", "drug", "Heparin → stops the RCA clot growing"),
    nitro: T("rca", "#c58bff", "drug", "Nitro → dilates coronaries… and every other vessel"),
    morphine: T("whole", "#9fb4ff", "drug", "Morphine → pain and preload"),
    fluids: T("rv", "#4da3ff", "volume", "Fluids → preload for the failing right ventricle"),
    oxygen: T("whole", "#7be0ff", "drug", "Oxygen → myocardial supply"),
    amiodarone: T("ventricles", "#ff9a3c", "drug", "Amiodarone → calms irritable ventricular muscle"),
    midazolam: T("whole", "#9fb4ff", "drug", "Midazolam → sedation before the shock"),
    epinephrine: T("whole", "#ff6b6b", "drug", "Epinephrine → coronary perfusion pressure"),
    sync_cardioversion: T("ventricles", "#5fd3ff", "shock", "Synchronized shock → timed on the R wave"),
    defib: T("ventricles", "#5fd3ff", "shock", "Defibrillation → depolarize every ventricular cell"),
    cpr: T("ventricles", "#ffcc4d", "shock", "Compressions → squeeze blood out of the ventricles"),
    cath_lab: T("clot", "#ff3b3b", "escalate", "Cath lab → wire, balloon and stent in the RCA"),
    ecg12: T("inferior", "#39ff88", "lead", "Leads II, III, aVF look straight at the inferior wall"),
    troponin: T("inferior", "#ffd84d", "assess", "Troponin leaking from the dying inferior wall"),
    exam: T("rv", "#4da3ff", "assess", "JVD + clear lungs → right ventricle"),
    ask_history: T("rca", "#c58bff", "assess", "Sildenafil + nitrates → profound hypotension"),
    monitor: T("sa", "#39ff88", "lead", "Continuous rhythm monitoring"),
    iv_access: T("whole", "#7be0ff", "assess", "Access for drugs and fluids")
}

/** The current target: the latest order in the last 25 s, else the culprit lesion. */
export function currentTarget(state: WardState | null): Target | null {
    if (!state || state.phase === "lobby") return state ? T("clot", "#ff3b3b", "clot", "Culprit: thrombus in the right coronary artery") : null
    const recent = [...state.orders].reverse().find(o => state.now - o.at < 25000 && ORDER_TARGETS[o.key])
    if (recent) return ORDER_TARGETS[recent.key]!
    if (!state.phys.rcaOpen) return T("clot", "#ff3b3b", "clot", "Culprit: thrombus in the right coronary artery")
    return null
}

/** Region intensities for the surface overlay. */
export function regionLevels(state: WardState | null, target: Target | null, anatomy: boolean, t: number): Record<RegionId, number> {
    const base = anatomy ? 0.3 : 0
    const levels: Record<RegionId, number> = { lv: base, rv: base, inferior: base, ra: base * 0.8, la: base * 0.8, vessels: base * 0.6, apex: 0, septum: 0 }
    if (state && !state.phys.rcaOpen && state.phase !== "lobby") levels.inferior = Math.max(levels.inferior, 0.25 + (1 - state.phys.perfusion) * 0.55 + Math.sin(t * 2) * 0.06)
    if (state?.phys.rcaOpen) levels.inferior = Math.max(base, 0.08)
    if (target) {
        const pulse = 0.55 + Math.sin(t * 5) * 0.2
        const ids: RegionId[] = target.id === "ventricles" ? ["lv", "rv", "inferior", "apex"] : target.id === "whole" ? ["lv", "rv", "ra", "la", "inferior"] : (["lv", "rv", "inferior", "ra", "la", "vessels", "apex"] as RegionId[]).includes(target.id as RegionId) ? [target.id as RegionId] : []
        for (const id of ids) levels[id] = Math.max(levels[id], pulse)
    }
    return levels
}
