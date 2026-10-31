import { OrbitControls } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"

import type { WardState } from "../../sim/types"
import { ecgSample, type BeatClock } from "../beat"
import { HeartModel } from "./HeartModel"
import { SkeletonHands } from "./SkeletonHands"

// Bed 13 at 3 AM: the patient on the bed, translucent so the beating heart glows inside his chest,
// wired to a monitor that shows the live ECG. Haunted lighting, and a visitor at the foot of the bed.

const CHEST = new THREE.Vector3(-0.42, 0.86, -0.05)
// Heart frame (+y base, +z anterior, +x patient's left) -> supine patient, head toward -x:
// base toward the head (-x), anterior up (+y), patient's left = -z.
const HEART_IN_BODY = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)))

export function RoomScene({ state, clock, close = false }: { state: WardState | null; clock: BeatClock; close?: boolean }) {
    return (
        <>
            <color attach="background" args={["#030605"]} />
            <fog attach="fog" args={["#050b09", 6, 16]} />
            <RoomLights state={state} />
            <Room />
            <Bed />
            <Patient state={state} />
            <group position={CHEST} quaternion={HEART_IN_BODY}>
                <group scale={0.092}>
                    <HeartModel state={state} clock={clock} detail="room" anatomy={false} />
                </group>
                <HeartGlow state={state} />
            </group>
            <Monitor state={state} clock={clock} />
            <Leads />
            <IvPole />
            <CrashCart state={state} />
            <OrLamp />
            <Visitor state={state} />
            <SkeletonHands state={state} captions={close} />
            <OrbitControls target={close ? [-0.62, 0.92, 0.1] : [-0.2, 0.75, 0]} enablePan={false} minDistance={1.0} maxDistance={7} autoRotate={!close} autoRotateSpeed={0.25} maxPolarAngle={Math.PI * 0.49} />
        </>
    )
}

// --- Patient ---------------------------------------------------------------------------

function Patient({ state }: { state: WardState | null }) {
    const skin = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#cfeee4", transparent: true, opacity: 0.3, roughness: 0.35, depthWrite: false, side: THREE.DoubleSide, emissive: "#2f7a64", emissiveIntensity: 0.45 }), [])
    const chest = useRef<THREE.Group>(null)
    useFrame(({ clock }) => {
        // Breathing: faster and shallower as he gets sicker; nothing in arrest.
        const rr = state?.vitals.rr ?? 16
        const a = state && !state.vitals.pulse ? 0 : 0.025
        if (chest.current) chest.current.scale.y = 1 + Math.sin((clock.elapsedTime * Math.PI * 2 * rr) / 60) * a
    })
    const limb = (len: number, r: number) => <capsuleGeometry args={[r, len, 6, 12]} />
    return (
        <group>
            {/* head + neck */}
            <mesh position={[-1.0, 0.86, 0]} material={skin}>
                <sphereGeometry args={[0.12, 24, 24]} />
            </mesh>
            <mesh position={[-0.85, 0.82, 0]} rotation-z={Math.PI / 2} material={skin}>
                {limb(0.08, 0.05)}
            </mesh>
            {/* torso */}
            <group ref={chest}>
                <mesh position={[-0.44, 0.8, 0]} rotation-z={Math.PI / 2} scale={[1, 1, 0.62]} material={skin}>
                    {limb(0.42, 0.19)}
                </mesh>
            </group>
            <mesh position={[-0.02, 0.77, 0]} scale={[0.8, 0.55, 1]} material={skin}>
                <sphereGeometry args={[0.2, 20, 20]} />
            </mesh>
            {/* arms */}
            {[-1, 1].map(s => (
                <group key={s}>
                    <mesh position={[-0.42, 0.74, s * 0.26]} rotation-z={Math.PI / 2} material={skin}>
                        {limb(0.32, 0.045)}
                    </mesh>
                    <mesh position={[-0.05, 0.72, s * 0.27]} rotation-z={Math.PI / 2} material={skin}>
                        {limb(0.28, 0.04)}
                    </mesh>
                </group>
            ))}
            {/* blanket over the legs */}
            <mesh position={[0.55, 0.78, 0]}>
                <boxGeometry args={[1.05, 0.14, 0.62]} />
                <meshStandardMaterial color="#3d5a78" roughness={0.95} />
            </mesh>
            <mesh position={[0.55, 0.86, 0]}>
                <boxGeometry args={[1.0, 0.03, 0.6]} />
                <meshStandardMaterial color="#4a6b8c" roughness={0.95} />
            </mesh>
            {/* pillow */}
            <mesh position={[-1.08, 0.72, 0]}>
                <boxGeometry args={[0.36, 0.08, 0.5]} />
                <meshStandardMaterial color="#d8e4e0" roughness={1} />
            </mesh>
        </group>
    )
}

function HeartGlow({ state }: { state: WardState | null }) {
    const light = useRef<THREE.PointLight>(null)
    const sprite = useRef<THREE.Sprite>(null)
    const texture = useMemo(() => {
        const c = document.createElement("canvas")
        c.width = c.height = 128
        const g = c.getContext("2d")!
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
        grad.addColorStop(0, "rgba(255,70,70,0.95)")
        grad.addColorStop(0.35, "rgba(255,30,60,0.35)")
        grad.addColorStop(1, "rgba(255,0,40,0)")
        g.fillStyle = grad
        g.fillRect(0, 0, 128, 128)
        return new THREE.CanvasTexture(c)
    }, [])
    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        const crashing = state && (!state.vitals.pulse || state.vitals.rhythm === "vtach")
        const k = crashing ? 0.6 + Math.abs(Math.sin(t * 8)) * 0.6 : 0.7 + Math.sin(t * 2.5) * 0.15
        if (light.current) light.current.intensity = 2.2 * k
        if (sprite.current) sprite.current.scale.setScalar(0.42 + k * 0.12)
    })
    return (
        <>
            <pointLight ref={light} color="#ff3b4a" distance={1.4} intensity={2} />
            <sprite ref={sprite}>
                <spriteMaterial map={texture} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </sprite>
        </>
    )
}

// --- Furniture -------------------------------------------------------------------------

function Bed() {
    return (
        <group>
            <mesh position={[-0.05, 0.6, 0]}>
                <boxGeometry args={[2.3, 0.14, 0.95]} />
                <meshStandardMaterial color="#c9d6d2" roughness={0.9} />
            </mesh>
            <mesh position={[-0.05, 0.47, 0]}>
                <boxGeometry args={[2.4, 0.1, 1.0]} />
                <meshStandardMaterial color="#59666a" metalness={0.6} roughness={0.4} />
            </mesh>
            {[
                [-1.1, -0.42],
                [-1.1, 0.42],
                [1.0, -0.42],
                [1.0, 0.42]
            ].map(([x, z], i) => (
                <mesh key={i} position={[x!, 0.22, z!]}>
                    <cylinderGeometry args={[0.025, 0.025, 0.45, 8]} />
                    <meshStandardMaterial color="#8a9599" metalness={0.8} roughness={0.3} />
                </mesh>
            ))}
            {/* rails + headboard */}
            {[-0.5, 0.5].map(z => (
                <mesh key={z} position={[-0.3, 0.78, z]}>
                    <boxGeometry args={[1.0, 0.03, 0.02]} />
                    <meshStandardMaterial color="#9aa6aa" metalness={0.8} roughness={0.3} />
                </mesh>
            ))}
            <mesh position={[-1.24, 0.82, 0]}>
                <boxGeometry args={[0.06, 0.55, 1.0]} />
                <meshStandardMaterial color="#2c3b38" />
            </mesh>
        </group>
    )
}

function Monitor({ state, clock }: { state: WardState | null; clock: BeatClock }) {
    const { canvas, texture } = useMemo(() => {
        const canvas = document.createElement("canvas")
        canvas.width = 512
        canvas.height = 300
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        return { canvas, texture }
    }, [])
    const stateRef = useRef(state)
    stateRef.current = state
    const x = useRef(0)
    const lastY = useRef<number | null>(null)
    const lastT = useRef(performance.now())
    useEffect(() => {
        const g = canvas.getContext("2d")!
        g.fillStyle = "#010806"
        g.fillRect(0, 0, 512, 300)
    }, [canvas])
    useFrame(() => {
        const g = canvas.getContext("2d")!
        const s = stateRef.current
        const now = performance.now()
        clock.update(s, now)
        const color = !s || s.vitals.pulse ? "#39ff88" : "#ff4d4d"
        g.lineWidth = 3
        g.strokeStyle = color
        const from = Math.max(lastT.current, now - 500)
        for (let t = from; t < now; t += 8) {
            const nx = x.current + 8 * (380 / 5000)
            g.fillStyle = "#010806"
            g.fillRect(nx, 0, 16, 200)
            const y = 120 - ecgSample(s, clock, t) * 70
            if (lastY.current !== null && nx > x.current) {
                g.beginPath()
                g.moveTo(x.current, lastY.current)
                g.lineTo(nx, y)
                g.stroke()
            }
            lastY.current = y
            x.current = nx
            if (x.current > 380) {
                x.current = 0
                lastY.current = null
            }
        }
        lastT.current = now
        // Numbers panel
        g.fillStyle = "#010806"
        g.fillRect(390, 0, 122, 300)
        g.fillRect(0, 200, 390, 100)
        g.font = "bold 54px monospace"
        g.fillStyle = color
        g.fillText(s ? (s.vitals.pulse ? String(s.vitals.hr) : "---") : "--", 398, 70)
        g.font = "bold 30px monospace"
        g.fillStyle = "#ff7a7a"
        g.fillText(s?.vitals.sbp ? `${s.vitals.sbp}/${s.vitals.dbp}` : "--/--", 10, 250)
        g.fillStyle = "#5fd3ff"
        g.fillText(`SpO2 ${s?.vitals.spo2 ?? "--"}`, 210, 250)
        g.font = "bold 22px monospace"
        g.fillStyle = color
        g.fillText((s?.vitals.rhythm ?? "").toUpperCase(), 398, 120)
        texture.needsUpdate = true
    })
    return (
        <group position={[-1.55, 1.5, -0.75]} rotation-y={0.75}>
            <mesh>
                <boxGeometry args={[0.66, 0.42, 0.06]} />
                <meshStandardMaterial color="#141818" />
            </mesh>
            <mesh position={[0, 0, 0.032]}>
                <planeGeometry args={[0.6, 0.35]} />
                <meshBasicMaterial map={texture} toneMapped={false} />
            </mesh>
            <mesh position={[0, -0.7, -0.05]}>
                <cylinderGeometry args={[0.025, 0.025, 1.0, 8]} />
                <meshStandardMaterial color="#4a5052" metalness={0.7} />
            </mesh>
        </group>
    )
}

function Leads() {
    const wires = useMemo(() => {
        const end = new THREE.Vector3(-1.48, 1.32, -0.68)
        return [
            ["#ffffff", new THREE.Vector3(-0.55, 0.98, 0.1)],
            ["#2a2a2a", new THREE.Vector3(-0.55, 0.98, -0.14)],
            ["#e33", new THREE.Vector3(-0.28, 0.96, -0.12)]
        ].map(([color, start]) => {
            const s = start as THREE.Vector3
            const mid = s.clone().lerp(end, 0.5).add(new THREE.Vector3(0, -0.25, 0))
            return { color: color as string, geo: new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(s, mid, end), 24, 0.006, 5, false), start: s }
        })
    }, [])
    return (
        <group>
            {wires.map((w, i) => (
                <group key={i}>
                    <mesh geometry={w.geo}>
                        <meshStandardMaterial color={w.color} />
                    </mesh>
                    <mesh position={w.start}>
                        <cylinderGeometry args={[0.025, 0.025, 0.01, 12]} />
                        <meshStandardMaterial color="#e8e8e8" />
                    </mesh>
                </group>
            ))}
        </group>
    )
}

function IvPole() {
    return (
        <group position={[-1.4, 0, 0.62]}>
            <mesh position={[0, 1.0, 0]}>
                <cylinderGeometry args={[0.018, 0.018, 2.0, 8]} />
                <meshStandardMaterial color="#9aa6aa" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0.08, 1.85, 0]}>
                <boxGeometry args={[0.14, 0.22, 0.05]} />
                <meshPhysicalMaterial color="#d9fff0" transparent opacity={0.55} roughness={0.1} />
            </mesh>
            <mesh position={[0, 0.02, 0]}>
                <cylinderGeometry args={[0.22, 0.22, 0.03, 5]} />
                <meshStandardMaterial color="#555" />
            </mesh>
        </group>
    )
}

function CrashCart({ state }: { state: WardState | null }) {
    const led = useRef<THREE.MeshBasicMaterial>(null)
    useFrame(({ clock }) => {
        const crashing = state && (!state.vitals.pulse || state.vitals.rhythm === "vtach")
        if (led.current) led.current.color.set(crashing && Math.sin(clock.elapsedTime * 10) > 0 ? "#ff2020" : "#3a0a0a")
    })
    return (
        <group position={[1.35, 0, -1.0]}>
            <mesh position={[0, 0.48, 0]}>
                <boxGeometry args={[0.55, 0.9, 0.45]} />
                <meshStandardMaterial color="#a81e22" roughness={0.6} />
            </mesh>
            {[0.2, 0.42, 0.64].map(y => (
                <mesh key={y} position={[0, y, 0.228]}>
                    <boxGeometry args={[0.5, 0.012, 0.01]} />
                    <meshStandardMaterial color="#e0e0e0" />
                </mesh>
            ))}
            <mesh position={[0, 1.02, 0]}>
                <boxGeometry args={[0.4, 0.18, 0.3]} />
                <meshStandardMaterial color="#e3e014" roughness={0.5} />
            </mesh>
            <mesh position={[0.1, 1.12, 0.1]}>
                <sphereGeometry args={[0.025, 8, 8]} />
                <meshBasicMaterial ref={led} color="#3a0a0a" />
            </mesh>
        </group>
    )
}

function OrLamp() {
    const target = useMemo(() => {
        const o = new THREE.Object3D()
        o.position.copy(CHEST)
        return o
    }, [])
    return (
        <group>
            <mesh position={[-0.42, 2.45, 0]}>
                <cylinderGeometry args={[0.35, 0.42, 0.12, 32]} />
                <meshStandardMaterial color="#cfd8d6" metalness={0.4} roughness={0.4} />
            </mesh>
            <mesh position={[-0.42, 2.38, 0]} rotation-x={Math.PI / 2}>
                <circleGeometry args={[0.32, 32]} />
                <meshBasicMaterial color="#fffbe8" toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[-0.42, 2.9, 0]}>
                <cylinderGeometry args={[0.02, 0.02, 0.9, 8]} />
                <meshStandardMaterial color="#888" />
            </mesh>
            <primitive object={target} />
            <spotLight position={[-0.42, 2.35, 0]} target={target} angle={0.38} penumbra={0.6} intensity={18} distance={5} color="#fff6dc" />
        </group>
    )
}

function Room() {
    const floorTex = useMemo(() => {
        const c = document.createElement("canvas")
        c.width = c.height = 256
        const g = c.getContext("2d")!
        g.fillStyle = "#16201d"
        g.fillRect(0, 0, 256, 256)
        g.strokeStyle = "#0b1210"
        g.lineWidth = 4
        for (let i = 0; i <= 256; i += 64) {
            g.beginPath()
            g.moveTo(i, 0)
            g.lineTo(i, 256)
            g.moveTo(0, i)
            g.lineTo(256, i)
            g.stroke()
        }
        const t = new THREE.CanvasTexture(c)
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(6, 6)
        t.colorSpace = THREE.SRGBColorSpace
        return t
    }, [])
    return (
        <group>
            <mesh rotation-x={-Math.PI / 2}>
                <planeGeometry args={[12, 12]} />
                <meshStandardMaterial map={floorTex} roughness={0.85} />
            </mesh>
            {/* back wall + window with the moon */}
            <mesh position={[0, 1.6, -2.4]}>
                <planeGeometry args={[12, 3.2]} />
                <meshStandardMaterial color="#14211d" roughness={1} />
            </mesh>
            <mesh position={[0.9, 1.75, -2.39]}>
                <planeGeometry args={[1.3, 1.1]} />
                <meshBasicMaterial color="#0a1424" />
            </mesh>
            <mesh position={[1.2, 1.95, -2.38]}>
                <circleGeometry args={[0.14, 32]} />
                <meshBasicMaterial color="#e8f0ff" toneMapped={false} />
            </mesh>
            {[0.9].map(x => (
                <group key={x}>
                    <mesh position={[x, 1.75, -2.37]}>
                        <boxGeometry args={[0.03, 1.1, 0.02]} />
                        <meshStandardMaterial color="#2a3532" />
                    </mesh>
                    <mesh position={[x, 1.75, -2.37]}>
                        <boxGeometry args={[1.3, 0.03, 0.02]} />
                        <meshStandardMaterial color="#2a3532" />
                    </mesh>
                </group>
            ))}
            {/* side wall with a door */}
            <mesh position={[-2.6, 1.6, 0]} rotation-y={Math.PI / 2}>
                <planeGeometry args={[6, 3.2]} />
                <meshStandardMaterial color="#111b18" roughness={1} />
            </mesh>
            <mesh position={[-2.58, 1.05, 1.2]} rotation-y={Math.PI / 2}>
                <planeGeometry args={[0.9, 2.1]} />
                <meshStandardMaterial color="#2a2522" roughness={0.9} />
            </mesh>
            <mesh position={[-2.57, 1.55, 1.2]} rotation-y={Math.PI / 2}>
                <planeGeometry args={[0.3, 0.35]} />
                <meshBasicMaterial color="#334c44" />
            </mesh>
            {/* privacy curtain */}
            <mesh position={[1.9, 1.3, 0.2]} rotation-y={-Math.PI / 2}>
                <planeGeometry args={[2.4, 2.2, 24, 1]} />
                <meshStandardMaterial color="#5e7d74" transparent opacity={0.55} side={THREE.DoubleSide} roughness={1} />
            </mesh>
        </group>
    )
}

/** Something at the foot of the bed. Only visible when the lights flicker, or when he dies. */
function Visitor({ state }: { state: WardState | null }) {
    const mat = useRef<THREE.MeshBasicMaterial>(null)
    const until = useRef(0)
    const last = useRef(state?.flicker ?? 0)
    useEffect(() => {
        if (state && state.flicker !== last.current) {
            last.current = state.flicker
            until.current = performance.now() + 2600
        }
    }, [state?.flicker])
    useFrame(({ clock }) => {
        if (!mat.current) return
        const on = performance.now() < until.current || state?.outcome === "died"
        mat.current.opacity = on ? 0.12 + Math.random() * 0.1 + Math.sin(clock.elapsedTime * 3) * 0.03 : Math.max(0, mat.current.opacity - 0.01)
    })
    return (
        <group position={[1.6, 0, 0.9]}>
            <mesh position={[0, 0.85, 0]}>
                <capsuleGeometry args={[0.2, 1.1, 6, 12]} />
                <meshBasicMaterial ref={mat} color="#dff6ff" transparent opacity={0} depthWrite={false} />
            </mesh>
        </group>
    )
}

function RoomLights({ state }: { state: WardState | null }) {
    const key = useRef<THREE.PointLight>(null)
    const alarm = useRef<THREE.PointLight>(null)
    const flickerUntil = useRef(0)
    const lastFlicker = useRef(state?.flicker ?? 0)
    useEffect(() => {
        if (state && state.flicker !== lastFlicker.current) {
            lastFlicker.current = state.flicker
            flickerUntil.current = performance.now() + 2600
        }
    }, [state?.flicker])
    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        const v = state?.vitals
        const crashing = v ? !v.pulse || v.rhythm === "vtach" : false
        const flickering = performance.now() < flickerUntil.current
        const ghost = Math.random() < 0.004 ? 0.25 : 1
        if (key.current) key.current.intensity = (flickering ? (Math.random() < 0.45 ? 0.05 : 1.6) : crashing ? 0.6 : 1.2) * ghost * 9
        if (alarm.current) alarm.current.intensity = crashing ? (Math.sin(t * 7) > 0 ? 14 : 1) : state?.outcome === "died" ? 3 : 0
    })
    return (
        <>
            <ambientLight intensity={0.35} color="#4d7a6a" />
            <directionalLight position={[2, 3, -3]} intensity={0.4} color="#7aa3ff" />
            <pointLight ref={key} position={[0.5, 2.6, 1.5]} intensity={10} color="#d9fff0" distance={9} decay={1.5} />
            <pointLight ref={alarm} position={[-2.0, 2.2, -1.5]} intensity={0} color="#ff1a1a" distance={8} decay={1.3} />
        </>
    )
}
