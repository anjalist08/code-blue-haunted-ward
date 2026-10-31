import { Html, OrbitControls, useGLTF } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import * as THREE from "three"

import type { WardState } from "../../sim/types"
import { beatShape, type BeatClock } from "../beat"
import { useHeartModel, type HeartModel } from "../heartModel"

// The heart is the interface: rhythm drives the animation, a blocked RCA darkens the inferior
// wall, and tapping a region opens a teaching label. The room is deliberately minimal.

type Props = { state: WardState | null; clock: BeatClock }

export function HeartScene({ state, clock }: Props) {
    const model = useHeartModel()
    return (
        <Canvas camera={{ position: [0, 0.25, 5.6], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }}>
            <color attach="background" args={["#030605"]} />
            <fog attach="fog" args={["#06100c", 4.5, 13]} />
            <Lights state={state} />
            <Room />
            <group position={[0, 0.15, 0]} scale={0.9}>
                <HeartBoundary key={model?.url ?? "procedural"} fallback={<ProceduralHeart state={state} clock={clock} />}>
                    <Suspense fallback={<ProceduralHeart state={state} clock={clock} />}>
                        {model ? <GlbHeart model={model} state={state} clock={clock} /> : <ProceduralHeart state={state} clock={clock} />}
                    </Suspense>
                </HeartBoundary>
                <Coronary state={state} />
                <Hotspots state={state} />
            </group>
            <OrbitControls enablePan={false} minDistance={3} maxDistance={8} autoRotate autoRotateSpeed={0.35} maxPolarAngle={Math.PI * 0.62} />
        </Canvas>
    )
}

// --- Beat animation ------------------------------------------------------------------------

function useBeat(state: WardState | null, clock: BeatClock) {
    const pulse = useRef(0)
    useFrame(() => {
        pulse.current = state ? beatShape(state, clock, performance.now()) : 0
    })
    return pulse
}

function applyBeat(group: THREE.Group, state: WardState | null, pulse: number, t: number, base: number) {
    const rhythm = state?.vitals.rhythm ?? "sinus"
    if (rhythm === "vfib") {
        // Quivering: high-frequency jitter, no organized squeeze.
        const j = 0.018
        group.scale.set(base * (1 + Math.sin(t * 47) * j), base * (1 + Math.sin(t * 53 + 1) * j), base * (1 + Math.sin(t * 59 + 2) * j))
        group.rotation.z = Math.sin(t * 31) * 0.015
        return
    }
    group.rotation.z = 0
    const amp = rhythm === "vtach" ? 0.045 : rhythm === "asystole" ? 0 : 0.085
    const s = base * (1 - pulse * amp)
    group.scale.set(s * (1 + pulse * amp * 0.25), s, s * (1 + pulse * amp * 0.25))
}

function heartColor(state: WardState | null): THREE.Color {
    const v = state?.vitals
    if (!v) return new THREE.Color("#8d1a1a")
    const perf = state!.phys.perfusion
    if (v.rhythm === "asystole") return new THREE.Color("#3a2a2e")
    if (!v.pulse) return new THREE.Color("#5b1830")
    // Oxygenated red fades toward bruised purple as perfusion drops.
    return new THREE.Color().lerpColors(new THREE.Color("#4a1638"), new THREE.Color("#b3202a"), Math.min(1, Math.max(0, (perf - 0.15) / 0.75)))
}

// --- GLB heart (your downloaded model) -------------------------------------------------

function GlbHeart({ model, state, clock }: { model: HeartModel; state: WardState | null; clock: BeatClock }) {
    const gltf = useGLTF(model.url)
    const group = useRef<THREE.Group>(null)
    const pulse = useBeat(state, clock)

    // Clone, center and normalize to a ~2.2-unit heart, whatever scale the file uses.
    const { scene, materials, base } = useMemo(() => {
        const scene = gltf.scene.clone(true)
        const box = new THREE.Box3().setFromObject(scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        scene.position.sub(center)
        const materials: THREE.MeshStandardMaterial[] = []
        scene.traverse(obj => {
            const mesh = obj as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = true
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            const cloned = list.map(m => {
                const c = m.clone() as THREE.MeshStandardMaterial
                if (model.color && "color" in c) c.color = new THREE.Color(model.color)
                if ("emissive" in c) materials.push(c)
                return c
            })
            mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!
        })
        const base = (2.2 / Math.max(size.x, size.y, size.z)) * (model.scale ?? 1)
        return { scene, materials, base }
    }, [gltf.scene, model.color, model.scale])

    useFrame(({ clock: c }) => {
        if (!group.current) return
        applyBeat(group.current, state, pulse.current, c.elapsedTime, base)
        const glow = heartColor(state)
        for (const m of materials) {
            m.emissive.copy(glow)
            m.emissiveIntensity = 0.18 + pulse.current * 0.35
        }
    })

    const r = model.rotation ?? [0, 0, 0]
    return (
        <group ref={group} rotation={[r[0], r[1], r[2]]}>
            <primitive object={scene} />
        </group>
    )
}

class HeartBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: unknown) {
        console.warn("Heart GLB failed to load, using the procedural heart.", error)
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}

// --- Procedural heart (no file needed) -------------------------------------------------

function ProceduralHeart({ state, clock }: { state: WardState | null; clock: BeatClock }) {
    const group = useRef<THREE.Group>(null)
    const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#a01c24", roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 }), [])
    const pulse = useBeat(state, clock)
    useFrame(({ clock: c }) => {
        if (!group.current) return
        applyBeat(group.current, state, pulse.current, c.elapsedTime, 1)
        const col = heartColor(state)
        material.color.copy(col)
        material.emissive.copy(col)
        material.emissiveIntensity = 0.15 + pulse.current * 0.45
    })
    return (
        <group ref={group} rotation={[0, 0, -0.35]}>
            {/* Left ventricle (bulk + apex) */}
            <mesh position={[0.18, -0.15, 0]} material={material} scale={[0.78, 0.98, 0.72]}>
                <sphereGeometry args={[0.8, 48, 48]} />
            </mesh>
            <mesh position={[0.3, -0.92, 0]} material={material} rotation={[0, 0, 0.3]}>
                <coneGeometry args={[0.42, 0.7, 32]} />
            </mesh>
            {/* Right ventricle */}
            <mesh position={[-0.38, -0.12, 0.18]} material={material} scale={[0.68, 0.85, 0.62]}>
                <sphereGeometry args={[0.72, 48, 48]} />
            </mesh>
            {/* Atria */}
            <mesh position={[-0.45, 0.58, -0.05]} material={material} scale={[0.55, 0.42, 0.5]}>
                <sphereGeometry args={[0.6, 32, 32]} />
            </mesh>
            <mesh position={[0.42, 0.55, -0.2]} material={material} scale={[0.5, 0.38, 0.45]}>
                <sphereGeometry args={[0.6, 32, 32]} />
            </mesh>
            {/* Aorta + pulmonary trunk */}
            <mesh position={[0.05, 1.0, -0.05]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[0.32, 0.13, 16, 32, Math.PI]} />
                <meshStandardMaterial color="#c0434a" roughness={0.5} />
            </mesh>
            <mesh position={[-0.12, 0.85, 0.22]} rotation={[0.25, 0, 0.2]}>
                <cylinderGeometry args={[0.13, 0.15, 0.6, 24]} />
                <meshStandardMaterial color="#5b6fb5" roughness={0.5} />
            </mesh>
        </group>
    )
}

// --- Coronary artery overlay (RCA) + ischemic inferior wall -----------------------------

function Coronary({ state }: { state: WardState | null }) {
    const open = state?.phys.rcaOpen ?? false
    const tube = useMemo(() => {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.05, 0.62, 0.72),
            new THREE.Vector3(-0.55, 0.42, 0.78),
            new THREE.Vector3(-0.92, 0.0, 0.55),
            new THREE.Vector3(-0.88, -0.48, 0.25),
            new THREE.Vector3(-0.45, -0.88, 0.1),
            new THREE.Vector3(0.1, -1.05, -0.1)
        ])
        return new THREE.TubeGeometry(curve, 80, 0.045, 10, false)
    }, [])
    const mat = useRef<THREE.MeshStandardMaterial>(null)
    const zone = useRef<THREE.MeshStandardMaterial>(null)
    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        if (mat.current) mat.current.emissiveIntensity = open ? 0.9 + Math.sin(t * 6) * 0.3 : 0.15
        if (zone.current) {
            const perf = state?.phys.perfusion ?? 0.7
            zone.current.opacity = open ? Math.max(0, zone.current.opacity - 0.004) : 0.18 + (1 - perf) * 0.45 + Math.sin(t * 2) * 0.04
        }
    })
    return (
        <group>
            <mesh geometry={tube}>
                <meshStandardMaterial ref={mat} color={open ? "#ff4040" : "#4a1a1a"} emissive={open ? "#ff2020" : "#220000"} roughness={0.35} />
            </mesh>
            {!open && (
                <mesh position={[-0.9, -0.1, 0.52]}>
                    <sphereGeometry args={[0.085, 16, 16]} />
                    <meshStandardMaterial color="#120708" emissive="#3b0000" emissiveIntensity={0.6} roughness={0.9} />
                </mesh>
            )}
            {/* Inferior wall territory: tints dark as perfusion falls, clears after PCI. */}
            <mesh position={[-0.1, -0.78, 0.15]} scale={[1.05, 0.42, 0.85]}>
                <sphereGeometry args={[0.8, 32, 32]} />
                <meshStandardMaterial ref={zone} color="#25062e" transparent opacity={0.3} depthWrite={false} roughness={1} />
            </mesh>
        </group>
    )
}

const REGIONS = [
    { id: "rca", pos: [-0.92, 0.05, 0.62], label: "Right coronary artery", text: (s: WardState | null) => (s?.phys.rcaOpen ? "Re-opened and stented. TIMI 3 flow." : "Occluded by a thrombus. It feeds the inferior wall, the RV, and in most people the AV node.") },
    { id: "inferior", pos: [-0.1, -1.05, 0.5], label: "Inferior wall", text: (s: WardState | null) => (s?.phys.rcaOpen ? "Reperfused. Contracting again." : "Ischemic. Leads II, III and aVF are looking right at it.") },
    { id: "rv", pos: [-0.75, -0.2, 0.62], label: "Right ventricle", text: () => "RV infarct = preload-dependent. Nitrates and diuretics can crash the pressure; fluids help." },
    { id: "lv", pos: [0.62, -0.2, 0.5], label: "Left ventricle", text: () => "The main pump. Irritable ischemic muscle is where V-tach and V-fib start." },
    { id: "av", pos: [0.05, 0.7, 0.55], label: "Aortic valve", text: () => "Coronary arteries fill from the aortic root during diastole. Low diastolic pressure = less coronary flow." },
    { id: "sa", pos: [-0.6, 0.8, 0.35], label: "SA node", text: (s: WardState | null) => `Pacemaker. Current rhythm: ${s?.vitals.rhythm ?? "sinus"}.` }
] as const

function Hotspots({ state }: { state: WardState | null }) {
    const [active, setActive] = useState<string | null>(null)
    return (
        <group>
            {REGIONS.map(r => (
                <group key={r.id} position={r.pos as unknown as [number, number, number]}>
                    <mesh
                        onClick={e => {
                            e.stopPropagation()
                            setActive(active === r.id ? null : r.id)
                        }}
                        onPointerOver={() => (document.body.style.cursor = "pointer")}
                        onPointerOut={() => (document.body.style.cursor = "")}
                    >
                        <sphereGeometry args={[0.035, 12, 12]} />
                        <meshBasicMaterial color={active === r.id ? "#9dffb0" : "#4dffa0"} transparent opacity={0.85} />
                    </mesh>
                    {active === r.id && (
                        <Html distanceFactor={6} center position={[0, 0.28, 0]}>
                            <div className="hotspot" onClick={() => setActive(null)}>
                                <strong>{r.label}</strong>
                                <span>{r.text(state)}</span>
                            </div>
                        </Html>
                    )}
                </group>
            ))}
        </group>
    )
}

// --- Room + haunted lighting -----------------------------------------------------------

function Room() {
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]} receiveShadow>
                <planeGeometry args={[30, 30]} />
                <meshStandardMaterial color="#0b1311" roughness={0.95} />
            </mesh>
            {/* Bed */}
            <group position={[0, -1.25, -1.6]}>
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[3.2, 0.25, 1.4]} />
                    <meshStandardMaterial color="#1c2a27" />
                </mesh>
                <mesh position={[0, 0.2, 0]}>
                    <boxGeometry args={[3.0, 0.18, 1.25]} />
                    <meshStandardMaterial color="#2c3b38" roughness={0.9} />
                </mesh>
                <mesh position={[-1.25, 0.38, 0]}>
                    <boxGeometry args={[0.5, 0.16, 0.9]} />
                    <meshStandardMaterial color="#4b5b57" />
                </mesh>
            </group>
            {/* IV pole */}
            <group position={[2.0, -1.6, -1.2]}>
                <mesh position={[0, 1.3, 0]}>
                    <cylinderGeometry args={[0.025, 0.025, 2.6, 8]} />
                    <meshStandardMaterial color="#6d7774" metalness={0.8} roughness={0.3} />
                </mesh>
                <mesh position={[0.12, 2.35, 0]}>
                    <boxGeometry args={[0.18, 0.3, 0.06]} />
                    <meshStandardMaterial color="#9fd7c4" transparent opacity={0.5} />
                </mesh>
            </group>
            {/* Monitor stand (the live ECG is on the HUD) */}
            <group position={[-2.3, -0.2, -1.4]} rotation={[0, 0.5, 0]}>
                <mesh>
                    <boxGeometry args={[0.9, 0.6, 0.08]} />
                    <meshStandardMaterial color="#111" />
                </mesh>
                <mesh position={[0, 0, 0.045]}>
                    <planeGeometry args={[0.8, 0.5]} />
                    <meshBasicMaterial color="#062a14" />
                </mesh>
                <mesh position={[0, -0.9, 0]}>
                    <cylinderGeometry args={[0.03, 0.03, 1.4, 8]} />
                    <meshStandardMaterial color="#333" />
                </mesh>
            </group>
            {/* Back wall + window */}
            <mesh position={[0, 1.5, -3.2]}>
                <planeGeometry args={[30, 7]} />
                <meshStandardMaterial color="#0a1210" roughness={1} />
            </mesh>
            <mesh position={[2.6, 1.4, -3.15]}>
                <planeGeometry args={[1.4, 1.8]} />
                <meshBasicMaterial color="#0e1a2a" />
            </mesh>
        </group>
    )
}

function Lights({ state }: { state: WardState | null }) {
    const key = useRef<THREE.PointLight>(null)
    const alarm = useRef<THREE.PointLight>(null)
    const flickerUntil = useRef(0)
    const lastFlicker = useRef(state?.flicker ?? 0)
    const moon = useRef<THREE.DirectionalLight>(null)

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
        // Random ambient flicker even when stable: it's a haunted ward.
        const ghost = Math.random() < 0.004 ? 0.25 : 1
        if (key.current) key.current.intensity = (flickering ? (Math.random() < 0.45 ? 0.05 : 1.6) : crashing ? 0.7 : 1.4) * ghost * 18
        if (alarm.current) alarm.current.intensity = crashing ? (Math.sin(t * 7) > 0 ? 26 : 2) : state?.outcome === "died" ? 4 : 0
        if (moon.current) moon.current.intensity = 0.35 + Math.sin(t * 0.3) * 0.05
    })

    return (
        <>
            <ambientLight intensity={0.22} color="#4d7a6a" />
            <directionalLight ref={moon} position={[3, 4, -2]} intensity={0.35} color="#7aa3ff" />
            <pointLight ref={key} position={[0.5, 2.6, 2.2]} intensity={25} color="#d9fff0" distance={12} decay={1.6} />
            <pointLight ref={alarm} position={[-1.8, 1.8, 0.8]} intensity={0} color="#ff1a1a" distance={10} decay={1.4} />
            <pointLight position={[1.6, -0.6, 1.8]} intensity={4} color="#ff7a5c" distance={6} />
        </>
    )
}
