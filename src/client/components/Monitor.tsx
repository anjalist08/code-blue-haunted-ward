import type { WardState } from "../../sim/types"
import { type BeatClock } from "../beat"
import { Ecg } from "./Ecg"

const RHYTHM_LABEL = { sinus: "SINUS", pvc: "SINUS + PVCs", vtach: "V-TACH", vfib: "V-FIB", asystole: "ASYSTOLE" } as const

export function Monitor({ state, clock, compact }: { state: WardState | null; clock: BeatClock; compact?: boolean }) {
    const v = state?.vitals
    const alarm = v && (!v.pulse || v.rhythm === "vtach")
    const low = (n: number | null | undefined, lim: number) => (n !== null && n !== undefined && n < lim ? " warn" : "")
    return (
        <section className={`monitor${alarm ? " alarm" : ""}`}>
            <div className="monitor-head">
                <span className="rhythm">{v ? RHYTHM_LABEL[v.rhythm] : "--"}</span>
                {state?.phys.cprUntil && state.phys.cprUntil > state.now && !v?.pulse ? <span className="badge cpr">CPR</span> : null}
                {state?.phys.cathEta && !state.phys.pciDone ? <CathCountdown state={state} /> : null}
                {state?.phys.pciDone ? <span className="badge ok">RCA OPEN</span> : null}
            </div>
            <Ecg state={state} clock={clock} height={compact ? 80 : 110} />
            <div className="vitals">
                <div className={`vital hr${v && (v.hr > 120 || !v.pulse) ? " warn" : ""}`}>
                    <label>HR</label>
                    <b>{v ? (v.pulse ? v.hr : "---") : "--"}</b>
                </div>
                <div className={`vital bp${low(v?.sbp, 90)}`}>
                    <label>NIBP</label>
                    <b>{v ? (v.sbp ? `${v.sbp}/${v.dbp}` : "--/--") : "--"}</b>
                </div>
                <div className={`vital spo2${low(v?.spo2, 92)}`}>
                    <label>SpO₂</label>
                    <b>{v?.spo2 ?? "--"}</b>
                </div>
                <div className="vital rr">
                    <label>RR</label>
                    <b>{v ? v.rr : "--"}</b>
                </div>
            </div>
        </section>
    )
}

function CathCountdown({ state }: { state: WardState }) {
    const left = Math.max(0, Math.round((state.phys.cathEta - state.now) / 1000))
    return <span className="badge cath">CATH LAB {left > 0 ? `${left}s` : "AT DOOR"}</span>
}
