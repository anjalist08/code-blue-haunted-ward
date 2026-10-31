import { Canvas } from "@react-three/fiber"
import { useState } from "react"

import type { WardState } from "../../sim/types"
import type { BeatClock } from "../beat"
import { currentTarget, REGION_STYLE } from "../three/targets"
import { OperatingScene } from "./OperatingScene"
import { RoomScene } from "./RoomScene"

// Two live 3D views of the same patient:
//   ROOM  - Bed 13: the patient on the bed with his heart glowing inside his chest
//   OR    - zoomed in on the heart we're operating on, with coloured targets
// One fills the background, the other sits in a picture-in-picture window. Swap with ⇄.

type View = "room" | "or"

export function SceneViews({ state, clock }: { state: WardState | null; clock: BeatClock }) {
    const [main, setMain] = useState<View>("room")
    const [anatomy, setAnatomy] = useState(true)
    const inset: View = main === "room" ? "or" : "room"
    const target = currentTarget(state)

    const scene = (view: View, isMain: boolean) =>
        view === "room" ? <RoomScene state={state} clock={clock} close={isMain} /> : <OperatingScene state={state} clock={clock} anatomy={anatomy} labels={isMain} />

    return (
        <>
            <div className="scene">
                <Canvas key={`main-${main}`} camera={main === "room" ? { position: [-0.6, 2.0, 2.05], fov: 45 } : { position: [0, 0.3, 6.2], fov: 40 }} dpr={[1, 2]}>
                    {scene(main, true)}
                </Canvas>
            </div>
            <div className={`inset ${inset}`}>
                <div className="inset-head">
                    <span>{inset === "or" ? "🫀 OR VIEW · operating on the heart" : "🛏️ BED 13 · room view"}</span>
                    <button onClick={() => setMain(inset)} title="Swap the views">
                        ⇄
                    </button>
                </div>
                <Canvas key={`inset-${inset}`} camera={inset === "room" ? { position: [2.0, 1.9, 2.2], fov: 45 } : { position: [0, 0.15, 4.6], fov: 42 }} dpr={[1, 1.5]}>
                    {scene(inset, false)}
                </Canvas>
            </div>
            <div className="legend">
                {target && (
                    <div className="legend-target" style={{ borderColor: target.color }}>
                        <span className="dot ring" style={{ borderColor: target.color }} />
                        <span>
                            <b style={{ color: target.color }}>TARGET</b> {target.label}
                        </span>
                    </div>
                )}
                <div className="legend-row">
                    <span className="dot" style={{ background: "#ff3030" }} /> RCA {state?.phys.pciDone ? "stented, open" : state?.phys.cathEta ? "catheter going in" : "occluded"}
                </div>
                <div className="legend-row">
                    <span className="dot" style={{ background: REGION_STYLE.inferior.color }} /> Inferior wall {state?.phys.rcaOpen ? "reperfused" : "ischemic"}
                </div>
                {anatomy && (
                    <>
                        <div className="legend-row">
                            <span className="dot" style={{ background: REGION_STYLE.rv.color }} /> Right ventricle
                        </div>
                        <div className="legend-row">
                            <span className="dot" style={{ background: REGION_STYLE.lv.color }} /> Left ventricle
                        </div>
                        <div className="legend-row">
                            <span className="dot" style={{ background: REGION_STYLE.ra.color }} /> Atria
                        </div>
                    </>
                )}
                <div className="legend-row">
                    <span className="dot" style={{ background: "#ffe14d" }} /> SA node (flashes each beat)
                </div>
                <button className="legend-toggle" onClick={() => setAnatomy(!anatomy)}>
                    {anatomy ? "Hide" : "Show"} anatomy colours
                </button>
            </div>
        </>
    )
}
