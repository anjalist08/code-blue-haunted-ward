import { OrbitControls } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useRef } from "react"
import * as THREE from "three"

import type { WardState } from "../../sim/types"
import type { BeatClock } from "../beat"
import { HeartModel } from "./HeartModel"

// The zoomed-in "we're operating on it" view: the heart under surgical lights, anatomy in colour,
// the current target ringed, and the procedure (catheter, stent, shocks, drugs) shown on the heart.

export function OperatingScene({ state, clock, anatomy, labels }: { state: WardState | null; clock: BeatClock; anatomy: boolean; labels: boolean }) {
    return (
        <>
            <color attach="background" args={["#020807"]} />
            <fog attach="fog" args={["#020807", 9, 18]} />
            <OrLights state={state} />
            <Field />
            <HeartModel state={state} clock={clock} detail="or" anatomy={anatomy} labels={labels} />
            <OrbitControls target={labels ? [0, -0.45, 0] : [0, 0, 0]} enablePan={false} minDistance={2.4} maxDistance={8} autoRotate autoRotateSpeed={0.5} />
        </>
    )
}

/** A dark surgical field ring under the heart, so it reads as "on the table". */
function Field() {
    return (
        <group position={[0, -1.35, 0]}>
            <mesh rotation-x={-Math.PI / 2}>
                <circleGeometry args={[2.2, 64]} />
                <meshStandardMaterial color="#0b3a33" roughness={0.9} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}>
                <ringGeometry args={[1.15, 1.2, 64]} />
                <meshBasicMaterial color="#1f7a66" transparent opacity={0.6} />
            </mesh>
        </group>
    )
}

function OrLights({ state }: { state: WardState | null }) {
    const alarm = useRef<THREE.PointLight>(null)
    useFrame(({ clock }) => {
        const v = state?.vitals
        const crashing = v ? !v.pulse || v.rhythm === "vtach" : false
        if (alarm.current) alarm.current.intensity = crashing ? (Math.sin(clock.elapsedTime * 7) > 0 ? 18 : 2) : 0
    })
    return (
        <>
            <ambientLight intensity={0.5} color="#b8d8cc" />
            <spotLight position={[0, 5, 3]} angle={0.5} penumbra={0.7} intensity={70} color="#fff8e6" />
            <directionalLight position={[-3, 2, 2]} intensity={1.1} color="#cfe8ff" />
            <directionalLight position={[3, 1, -2]} intensity={0.6} color="#ffb0b0" />
            <pointLight ref={alarm} position={[2, 2, 2]} color="#ff1a1a" distance={8} intensity={0} />
        </>
    )
}
