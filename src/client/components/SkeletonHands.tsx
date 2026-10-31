import { Html } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"

import { catalogByKey } from "../../sim/case"
import type { Order, WardState } from "../../sim/types"

// The skeleton crew: two bony hands that carry out each order on the patient as the care team does it.
// When the nurse gives aspirin, a hand feeds him the pill; when she pushes amiodarone, a hand pushes the
// syringe into the IV; when someone shocks him, two hands hold the paddles to his chest and jolt.
// They follow the live WardRoom state, so every screen sees the same hands do the same thing.

// --- Where things are on the patient (RoomScene world coords; head at -x, face up, his right = +z) --
const P = {
    mouth: new THREE.Vector3(-0.93, 1.02, 0.0),
    nose: new THREE.Vector3(-0.97, 1.0, 0.0),
    sternum: new THREE.Vector3(-0.44, 1.02, 0.0),
    rightChest: new THREE.Vector3(-0.62, 1.02, 0.14),
    apex: new THREE.Vector3(-0.3, 0.98, -0.2),
    neck: new THREE.Vector3(-0.83, 0.92, 0.07),
    shoulder: new THREE.Vector3(-0.68, 0.96, 0.27),
    ivSite: new THREE.Vector3(-0.12, 0.8, 0.27),
    wrist: new THREE.Vector3(0.12, 0.77, 0.27),
    ivBag: new THREE.Vector3(-1.32, 1.82, 0.62),
    leads: [new THREE.Vector3(-0.55, 1.0, 0.1), new THREE.Vector3(-0.55, 1.0, -0.14), new THREE.Vector3(-0.28, 0.98, -0.12)]
}

type Pose = { pos: THREE.Vector3; rot: THREE.Euler; curl: number }
type Prop = "none" | "pill" | "syringe" | "paddle" | "electrode" | "cannula" | "wire" | "stethoscope"
type Frame = { right: Pose; left: Pose; propR: Prop; propL: Prop; plunger?: number; jolt?: number }
type Action = { kind: string; caption: string; dur: number; frame: (t: number, dur: number) => Frame }

const DOWN_TO_HEAD = new THREE.Euler(0, -Math.PI / 2, 0) // palm down, fingers toward his head
const DOWN_ACROSS = new THREE.Euler(0, Math.PI, 0) // palm down, fingers across his body (toward -z)
const TILT = (x: number, y: number, z: number) => new THREE.Euler(x, y, z)
const at = (v: THREE.Vector3, dx = 0, dy = 0, dz = 0) => v.clone().add(new THREE.Vector3(dx, dy, dz))

const REST_R: Pose = { pos: new THREE.Vector3(-0.2, 1.32, 0.68), rot: TILT(0.25, Math.PI, 0), curl: 0.35 }
const REST_L: Pose = { pos: new THREE.Vector3(-0.62, 1.32, 0.68), rot: TILT(0.25, Math.PI, 0), curl: 0.35 }
const idle = (): Frame => ({ right: REST_R, left: REST_L, propR: "none", propL: "none" })

/** 0..1..0 envelope: reach in, work, pull back. */
const env = (t: number, dur: number) => Math.min(1, t / 0.7, (dur - t) / 0.6)

function hover(target: THREE.Vector3, rot: THREE.Euler, curl: number, t: number, dur: number, rest: Pose, lift = 0.0): Pose {
    const e = Math.max(0, env(t, dur))
    const k = e * e * (3 - 2 * e)
    return { pos: rest.pos.clone().lerp(at(target, 0, lift, 0), k), rot, curl: rest.curl + (curl - rest.curl) * k }
}

const A = (kind: string, caption: string, dur: number, frame: Action["frame"]): Action => ({ kind, caption, dur, frame })

function actionFor(order: Order): Action | null {
    const label = order.label
    switch (order.key) {
        case "aspirin":
        case "nitro":
            return A("feed", `Skeleton crew: ${label} for Mr. Holloway`, 3.6, (t, d) => ({
                right: hover(P.mouth, TILT(0.6, -Math.PI / 2, 0), t > d * 0.55 ? 0.15 : 0.7, t, d, REST_R, 0.06 - Math.min(0.04, Math.max(0, t - 1.2) * 0.05)),
                left: REST_L,
                propR: t < d * 0.6 ? "pill" : "none",
                propL: "none"
            }))
        case "heparin":
        case "amiodarone":
        case "epinephrine":
        case "midazolam":
        case "morphine":
            return A("push", `Skeleton crew: pushing ${label} into the IV`, 3.8, (t, d) => ({
                right: hover(P.ivSite, DOWN_TO_HEAD, 0.75, t, d, REST_R, 0.13),
                left: hover(at(P.ivSite, 0.08, 0, 0), DOWN_TO_HEAD, 0.4, t, d, REST_L, 0.03),
                propR: "syringe",
                propL: "none",
                plunger: Math.min(1, Math.max(0, (t - 1.0) / 1.8))
            }))
        case "fluids":
            return A("bag", "Skeleton crew: squeezing the saline bag, wide open", 3.8, (t, d) => ({
                right: hover(P.ivBag, TILT(0, Math.PI / 2, Math.PI / 2), 0.35 + 0.45 * Math.max(0, Math.sin(t * 7)), t, d, REST_R, 0),
                left: REST_L,
                propR: "none",
                propL: "none"
            }))
        case "troponin":
        case "bmp":
            return A("draw", `Skeleton crew: drawing blood for the ${label.toLowerCase()}`, 3.6, (t, d) => ({
                right: hover(P.ivSite, DOWN_TO_HEAD, 0.75, t, d, REST_R, 0.13),
                left: hover(at(P.ivSite, 0.09, 0, 0), DOWN_TO_HEAD, 0.6, t, d, REST_L, 0.03),
                propR: "syringe",
                propL: "none",
                plunger: 1 - Math.min(1, Math.max(0, (t - 1.0) / 1.8))
            }))
        case "iv_access":
            return A("iv", "Skeleton crew: two large-bore IVs going in", 3.6, (t, d) => ({
                right: hover(at(P.ivSite, -0.04 + Math.min(0.04, Math.max(0, t - 1.2) * 0.04)), DOWN_TO_HEAD, 0.75, t, d, REST_R, 0.1),
                left: hover(at(P.ivSite, 0.1, 0, 0), DOWN_TO_HEAD, 0.55, t, d, REST_L, 0.03),
                propR: "syringe",
                propL: "none",
                plunger: 0
            }))
        case "ecg12":
        case "monitor": {
            const dur = 4.2
            return A("tap", order.key === "ecg12" ? "Skeleton crew: sticking on the 12-lead electrodes" : "Skeleton crew: pads and monitor on", dur, (t, d) => {
                const i = Math.min(2, Math.max(0, Math.floor((t - 0.7) / 0.95)))
                const tap = Math.abs(Math.sin(((t - 0.7) / 0.95) * Math.PI))
                return { right: hover(P.leads[i]!, DOWN_TO_HEAD, 0.55, t, d, REST_R, 0.03 + tap * 0.05), left: REST_L, propR: "electrode", propL: "none" }
            })
        }
        case "exam":
            return A("press", "Skeleton crew: feeling his chest, checking his neck veins", 4.0, (t, d) => {
                const neck = t > d * 0.5
                const press = Math.max(0, Math.sin(t * 6)) * 0.025
                return { right: hover(neck ? P.neck : P.sternum, DOWN_TO_HEAD, 0.15, t, d, REST_R, 0.04 - press), left: REST_L, propR: neck ? "none" : "stethoscope", propL: "none" }
            })
        case "ask_history":
            return A("pat", "Skeleton crew: a hand on his shoulder. “Any medications, sir?”", 3.6, (t, d) => ({
                right: hover(P.shoulder, DOWN_TO_HEAD, 0.25, t, d, REST_R, 0.05 + Math.max(0, Math.sin(t * 5)) * 0.03),
                left: REST_L,
                propR: "none",
                propL: "none"
            }))
        case "oxygen":
            return A("oxygen", "Skeleton crew: oxygen cannula on", 3.6, (t, d) => ({
                right: hover(at(P.nose, 0, 0, 0.11), TILT(0, -Math.PI / 2, -0.5), 0.5, t, d, REST_R, 0.05),
                left: hover(at(P.nose, 0, 0, -0.11), TILT(0, -Math.PI / 2, 0.5), 0.5, t, d, REST_L, 0.05),
                propR: "cannula",
                propL: "none"
            }))
        case "sync_cardioversion":
        case "defib":
            return A("paddles", order.key === "defib" ? "Skeleton crew: CLEAR! Unsynchronized 200 J" : "Skeleton crew: synchronizing… CLEAR! 100 J", 3.8, (t, d) => {
                const jolt = t > 1.6 && t < 1.95 ? 1 : 0
                return {
                    right: hover(P.rightChest, DOWN_TO_HEAD, 0.6, t, d, REST_R, 0.06 + jolt * 0.06),
                    left: hover(P.apex, DOWN_ACROSS, 0.6, t, d, REST_L, 0.06 + jolt * 0.06),
                    propR: "paddle",
                    propL: "paddle",
                    jolt
                }
            })
        case "cpr":
            return A("compress", "Skeleton crew: compressions, 110 a minute", 4.0, cprFrame)
        case "cath_lab":
            return A("cath", "Skeleton crew: radial access, threading the wire to the RCA", 4.2, (t, d) => ({
                right: hover(at(P.wrist, -Math.min(0.08, Math.max(0, t - 1.0) * 0.04)), DOWN_TO_HEAD, 0.7, t, d, REST_R, 0.06),
                left: hover(at(P.wrist, 0.1), DOWN_TO_HEAD, 0.5, t, d, REST_L, 0.03),
                propR: "wire",
                propL: "none"
            }))
        case "cxr":
            return A("xray", "Skeleton crew: sliding the X-ray plate under him", 3.6, (t, d) => ({
                right: hover(at(P.sternum, 0, -0.02, 0.24), TILT(0, Math.PI, 0), 0.2, t, d, REST_R, 0.0),
                left: hover(at(P.sternum, 0, -0.02, -0.24), TILT(0, 0, 0), 0.2, t, d, REST_L, 0.0),
                propR: "none",
                propL: "none"
            }))
        default:
            return null
    }
}

function cprFrame(t: number, d: number): Frame {
    const push = Math.max(0, Math.sin(t * Math.PI * 2 * 1.85)) * 0.05
    return {
        right: hover(P.sternum, DOWN_TO_HEAD, 0.1, t, d, REST_R, 0.08 - push),
        left: hover(at(P.sternum, 0, 0.03, 0), DOWN_TO_HEAD, 0.4, t, d, REST_L, 0.06 - push),
        propR: "none",
        propL: "none"
    }
}

// --- Bones ---------------------------------------------------------------------------------

const BONE = new THREE.MeshStandardMaterial({ color: "#e9e1cc", roughness: 0.55, emissive: "#5cffb0", emissiveIntensity: 0.12 })

function Bone({ length, radius }: { length: number; radius: number }) {
    return (
        <group>
            <mesh position={[0, 0, length / 2]} rotation-x={Math.PI / 2} material={BONE}>
                <capsuleGeometry args={[radius, Math.max(0.001, length - radius * 2), 4, 8]} />
            </mesh>
            <mesh position={[0, 0, length]} material={BONE}>
                <sphereGeometry args={[radius * 1.35, 8, 8]} />
            </mesh>
        </group>
    )
}

type FingerSpec = { x: number; meta: number; phal: [number, number, number]; spread: number; thumb?: boolean }
const FINGERS: FingerSpec[] = [
    { x: 0.03, meta: 0.0, phal: [0.04, 0.028, 0.02], spread: -0.55, thumb: true },
    { x: 0.016, meta: 0.075, phal: [0.04, 0.025, 0.019], spread: -0.08 },
    { x: 0.004, meta: 0.078, phal: [0.045, 0.028, 0.02], spread: 0 },
    { x: -0.009, meta: 0.074, phal: [0.042, 0.026, 0.019], spread: 0.07 },
    { x: -0.021, meta: 0.066, phal: [0.033, 0.021, 0.017], spread: 0.16 }
]

/** One skeletal hand. Local frame: wrist at origin, fingers along +z, palm facing -y, thumb at +x. */
function Hand({ curlRef }: { curlRef: React.RefObject<number> }) {
    const joints = useRef<THREE.Group[]>([])
    useFrame(() => {
        const c = curlRef.current ?? 0
        joints.current.forEach((g, i) => {
            if (!g) return
            const level = i % 3
            g.rotation.x = c * (level === 0 ? 0.9 : level === 1 ? 1.15 : 0.8)
        })
    })
    let jointIndex = 0
    const reg = (g: THREE.Group | null) => {
        if (g) joints.current[jointIndex++] = g
    }
    joints.current = []
    return (
        <group>
            {/* forearm: radius + ulna */}
            <group position={[0.012, 0, -0.26]}>
                <Bone length={0.25} radius={0.009} />
            </group>
            <group position={[-0.014, 0, -0.26]}>
                <Bone length={0.25} radius={0.008} />
            </group>
            {/* carpals */}
            {[
                [0.014, 0, 0.004],
                [0.0, 0.002, 0.008],
                [-0.014, 0, 0.004],
                [0.008, -0.002, 0.022],
                [-0.008, 0, 0.022],
                [0.022, -0.002, 0.02]
            ].map((p, i) => (
                <mesh key={i} position={p as [number, number, number]} material={BONE}>
                    <sphereGeometry args={[0.009, 8, 8]} />
                </mesh>
            ))}
            {FINGERS.map((f, i) => (
                <group key={i} position={[f.x, 0, 0.026]} rotation={[0, f.thumb ? -0.9 : f.spread * 0.6, f.thumb ? -0.5 : 0]}>
                    {f.meta > 0 && <Bone length={f.meta} radius={0.0055} />}
                    <group position={[0, 0, f.thumb ? 0.03 : f.meta]}>
                        <group ref={reg} rotation-y={f.spread * 0.3}>
                            <Bone length={f.phal[0]} radius={0.005} />
                            <group position={[0, 0, f.phal[0]]}>
                                <group ref={reg}>
                                    <Bone length={f.phal[1]} radius={0.0045} />
                                    <group position={[0, 0, f.phal[1]]}>
                                        <group ref={reg}>
                                            <Bone length={f.phal[2]} radius={0.004} />
                                        </group>
                                    </group>
                                </group>
                            </group>
                        </group>
                    </group>
                </group>
            ))}
        </group>
    )
}

// --- Props held in the hand (hand-local coords) -------------------------------------------

function HandProp({ kind, plunger }: { kind: Prop; plunger: React.RefObject<number> }) {
    const plungerRef = useRef<THREE.Group>(null)
    const fill = useRef<THREE.Mesh>(null)
    useFrame(() => {
        const p = plunger.current ?? 0
        if (plungerRef.current) plungerRef.current.position.y = 0.075 - p * 0.05
        if (fill.current) fill.current.scale.y = Math.max(0.05, 1 - p)
    })
    switch (kind) {
        case "pill":
            return (
                <mesh position={[0.012, -0.02, 0.135]} rotation-z={Math.PI / 2}>
                    <capsuleGeometry args={[0.008, 0.016, 4, 8]} />
                    <meshStandardMaterial color="#fff6e8" emissive="#ffffff" emissiveIntensity={0.3} />
                </mesh>
            )
        case "syringe":
            return (
                <group position={[0.0, -0.035, 0.08]}>
                    <mesh>
                        <cylinderGeometry args={[0.011, 0.011, 0.1, 12]} />
                        <meshPhysicalMaterial color="#e8f6ff" transparent opacity={0.45} roughness={0.1} />
                    </mesh>
                    <mesh ref={fill} position={[0, -0.02, 0]}>
                        <cylinderGeometry args={[0.009, 0.009, 0.05, 10]} />
                        <meshStandardMaterial color="#ffd84d" emissive="#ffb000" emissiveIntensity={0.4} transparent opacity={0.8} />
                    </mesh>
                    <mesh position={[0, -0.075, 0]}>
                        <cylinderGeometry args={[0.0015, 0.0015, 0.05, 6]} />
                        <meshStandardMaterial color="#cfd8dc" metalness={0.9} roughness={0.2} />
                    </mesh>
                    <group ref={plungerRef} position={[0, 0.075, 0]}>
                        <mesh>
                            <cylinderGeometry args={[0.003, 0.003, 0.06, 6]} />
                            <meshStandardMaterial color="#ddd" />
                        </mesh>
                        <mesh position={[0, 0.03, 0]}>
                            <cylinderGeometry args={[0.014, 0.014, 0.004, 12]} />
                            <meshStandardMaterial color="#ddd" />
                        </mesh>
                    </group>
                </group>
            )
        case "paddle":
            return (
                <group position={[0, -0.04, 0.06]}>
                    <mesh>
                        <boxGeometry args={[0.09, 0.02, 0.11]} />
                        <meshStandardMaterial color="#2a2a2a" />
                    </mesh>
                    <mesh position={[0, -0.011, 0]}>
                        <boxGeometry args={[0.085, 0.003, 0.105]} />
                        <meshStandardMaterial color="#bfe9ff" emissive="#5fd3ff" emissiveIntensity={0.8} toneMapped={false} />
                    </mesh>
                    <mesh position={[0, 0.03, -0.02]}>
                        <boxGeometry args={[0.03, 0.04, 0.05]} />
                        <meshStandardMaterial color="#e3e014" />
                    </mesh>
                </group>
            )
        case "electrode":
            return (
                <mesh position={[0.0, -0.025, 0.13]} rotation-x={Math.PI / 2}>
                    <cylinderGeometry args={[0.018, 0.018, 0.004, 16]} />
                    <meshStandardMaterial color="#f4f4f4" emissive="#ffffff" emissiveIntensity={0.15} />
                </mesh>
            )
        case "cannula":
            return (
                <mesh position={[-0.05, -0.02, 0.12]} rotation-y={Math.PI / 2}>
                    <torusGeometry args={[0.07, 0.004, 6, 24, Math.PI]} />
                    <meshStandardMaterial color="#bfe9ff" transparent opacity={0.8} />
                </mesh>
            )
        case "wire":
            return (
                <mesh position={[0, -0.025, 0.14]} rotation-x={Math.PI / 2}>
                    <cylinderGeometry args={[0.002, 0.002, 0.16, 6]} />
                    <meshStandardMaterial color="#e6eef2" emissive="#9cc8ff" emissiveIntensity={0.6} />
                </mesh>
            )
        case "stethoscope":
            return (
                <mesh position={[0, -0.03, 0.08]}>
                    <cylinderGeometry args={[0.022, 0.022, 0.012, 16]} />
                    <meshStandardMaterial color="#c0c8cc" metalness={0.9} roughness={0.25} />
                </mesh>
            )
        default:
            return null
    }
}

// --- The crew ------------------------------------------------------------------------------

type Queued = { order: Order; action: Action }

export function SkeletonHands({ state, captions }: { state: WardState | null; captions: boolean }) {
    const right = useRef<THREE.Group>(null)
    const left = useRef<THREE.Group>(null)
    const curlR = useRef(0.35)
    const curlL = useRef(0.35)
    const plunger = useRef(0)
    const [props, setProps] = useState<{ r: Prop; l: Prop }>({ r: "none", l: "none" })
    const [caption, setCaption] = useState<string | null>(null)
    const queue = useRef<Queued[]>([])
    const current = useRef<{ q: Queued; startedAt: number } | null>(null)
    const seen = useRef<Set<string> | null>(null)
    const stateRef = useRef(state)
    stateRef.current = state
    const cpr = useMemo(() => actionFor({ key: "cpr", label: "CPR" } as Order)!, [])

    // Turn orders into actions as the care team carries them out.
    useEffect(() => {
        if (!state) return
        const firstLoad = seen.current === null
        seen.current ??= new Set()
        for (const o of state.orders) {
            if (seen.current.has(o.id)) continue
            const route = catalogByKey.get(o.key)?.route
            const go = route === "lab" ? o.status === "running" || o.status === "done" : o.status === "done"
            if (o.status === "held" || o.status === "refused") seen.current.add(o.id)
            if (!go) continue
            seen.current.add(o.id)
            if (firstLoad) continue // don't replay history when a screen joins mid-case
            const action = actionFor(o)
            if (action) queue.current.push({ order: o, action })
        }
        if (queue.current.length > 3) queue.current = queue.current.slice(-3)
    }, [state])

    const tmpQ = useMemo(() => new THREE.Quaternion(), [])
    useFrame(({ clock }, dt) => {
        const s = stateRef.current
        const now = clock.elapsedTime
        // CPR overrides everything while it's running and he has no pulse.
        const cprOn = s ? s.phys.cprUntil > s.now && !s.vitals.pulse : false
        let frame: Frame
        let label: string | null = null
        if (!current.current && queue.current.length) current.current = { q: queue.current.shift()!, startedAt: now }
        if (current.current && now - current.current.startedAt > current.current.q.action.dur) current.current = null
        if (cprOn && !current.current) {
            frame = cprFrame(((now % 4) + 1) as number, 1e9)
            label = cpr.caption
        } else if (current.current) {
            const t = now - current.current.startedAt
            frame = current.current.q.action.frame(t, current.current.q.action.dur)
            label = current.current.q.action.caption
        } else {
            frame = idle()
            // Idle: drift and flex, like something waiting.
            frame.right = { ...frame.right, pos: at(frame.right.pos, 0, Math.sin(now * 1.1) * 0.02, 0), curl: 0.3 + Math.sin(now * 1.7) * 0.15 }
            frame.left = { ...frame.left, pos: at(frame.left.pos, 0, Math.sin(now * 1.1 + 1.3) * 0.02, 0), curl: 0.3 + Math.sin(now * 1.7 + 2) * 0.15 }
        }
        const k = 1 - Math.exp(-dt * 9)
        for (const [ref, pose] of [
            [right, frame.right],
            [left, frame.left]
        ] as const) {
            const g = ref.current
            if (!g) continue
            g.position.lerp(pose.pos, k)
            tmpQ.setFromEuler(pose.rot)
            g.quaternion.slerp(tmpQ, k)
        }
        curlR.current += (frame.right.curl - curlR.current) * k
        curlL.current += (frame.left.curl - curlL.current) * k
        plunger.current = frame.plunger ?? 0
        BONE.emissive.set(frame.jolt ? "#bfe9ff" : "#5cffb0")
        BONE.emissiveIntensity = frame.jolt ? 1.4 : 0.12 + (current.current || cprOn ? 0.1 : 0)
        if (frame.propR !== props.r || frame.propL !== props.l) setProps({ r: frame.propR, l: frame.propL })
        if (label !== caption) setCaption(label)
    })

    return (
        <group>
            <group ref={right} position={REST_R.pos}>
                <group scale={1.5}>
                    <Hand curlRef={curlR} />
                    <HandProp kind={props.r} plunger={plunger} />
                </group>
                {captions && caption && (
                    <Html position={[0, 0.16, 0]} center zIndexRange={[20, 0]}>
                        <div className="crew-caption">🦴 {caption}</div>
                    </Html>
                )}
            </group>
            <group ref={left} position={REST_L.pos}>
                {/* mirror for the left hand: thumb on the other side */}
                <group scale={[-1.5, 1.5, 1.5]}>
                    <Hand curlRef={curlL} />
                    <HandProp kind={props.l} plunger={plunger} />
                </group>
            </group>
        </group>
    )
}
