import { Html, useGLTF } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import * as THREE from "three"

import type { WardState } from "../../sim/types"
import { beatShape, type BeatClock } from "../beat"
import { useHeartModel, type HeartModel as HeartModelConfig } from "../heartModel"
import { CLOT_T, heartAssetFor, LANDMARKS, RCA_PATH, REGIONS, type HeartAsset } from "../three/heartAsset"
import { currentTarget, REGION_STYLE, regionLevels, type Target } from "../three/targets"

// The patient's heart: your GLB, beating to the live rhythm, with the anatomy painted on in colour,
// the culprit RCA drawn along the real surface, and the current order's target lit up.
// detail="or" adds the operating-room layer: catheter, stent, blood/drug flow, shock arcs, labels.

type Props = { state: WardState | null; clock: BeatClock; detail: "room" | "or"; anatomy?: boolean; labels?: boolean }

export function HeartModel(props: Props) {
    const model = useHeartModel()
    const fallback = <ProceduralHeart {...props} />
    if (!model) return fallback
    return (
        <HeartBoundary key={model.url} fallback={fallback}>
            <Suspense fallback={fallback}>
                <GlbHeart {...props} model={model} />
            </Suspense>
        </HeartBoundary>
    )
}

// --- Beat ------------------------------------------------------------------------------

/** Server time estimate between snapshots, for smooth countdowns. */
function useServerNow(state: WardState | null) {
    const at = useRef({ server: 0, local: 0 })
    useEffect(() => {
        if (state) at.current = { server: state.now, local: performance.now() }
    }, [state?.now])
    return () => at.current.server + (performance.now() - at.current.local)
}

function applyBeat(group: THREE.Group, state: WardState | null, pulse: number, t: number, serverNow: number) {
    const rhythm = state?.vitals.rhythm ?? "sinus"
    const cpr = state ? state.phys.cprUntil > serverNow && !state.vitals.pulse : false
    if (cpr) {
        const c = Math.max(0, Math.sin(t * Math.PI * 2 * 1.85)) ** 2
        group.scale.set(1 + c * 0.05, 1 - c * 0.14, 1 + c * 0.05)
        group.rotation.z = 0
        return
    }
    if (rhythm === "vfib") {
        const j = 0.02
        group.scale.set(1 + Math.sin(t * 47) * j, 1 + Math.sin(t * 53 + 1) * j, 1 + Math.sin(t * 59 + 2) * j)
        group.rotation.z = Math.sin(t * 31) * 0.018
        return
    }
    group.rotation.z = 0
    const amp = rhythm === "vtach" ? 0.05 : rhythm === "asystole" ? 0 : 0.09
    const s = 1 - pulse * amp
    group.scale.set(s * (1 + pulse * amp * 0.3), s, s * (1 + pulse * amp * 0.3))
}

// --- GLB heart -------------------------------------------------------------------------

const OVERLAY_VERT = /* glsl */ `
attribute vec4 rw0;
attribute vec4 rw1;
uniform vec3 colors[8];
uniform vec4 L0;
uniform vec4 L1;
varying vec3 vCol;
varying float vA;
varying float vRim;
void main() {
    vec4 k0 = rw0 * L0;
    vec4 k1 = rw1 * L1;
    float a = k0.x + k0.y + k0.z + k0.w + k1.x + k1.y + k1.z + k1.w;
    vec3 c = colors[0] * k0.x + colors[1] * k0.y + colors[2] * k0.z + colors[3] * k0.w
           + colors[4] * k1.x + colors[5] * k1.y + colors[6] * k1.z + colors[7] * k1.w;
    vCol = a > 0.001 ? c / a : vec3(0.0);
    vA = clamp(a, 0.0, 0.9);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vRim = pow(1.0 - abs(dot(n, normalize(-mv.xyz))), 1.6);
    gl_Position = projectionMatrix * mv;
}`

const OVERLAY_FRAG = /* glsl */ `
uniform float flash;
varying vec3 vCol;
varying float vA;
varying float vRim;
void main() {
    float a = vA * (0.45 + 0.55 * vRim);
    vec3 col = mix(vCol, vec3(0.85, 0.95, 1.0), flash);
    gl_FragColor = vec4(col, max(a, flash * 0.75));
}`

function makeOverlay() {
    return new THREE.ShaderMaterial({
        uniforms: {
            colors: { value: REGIONS.map(id => new THREE.Color(REGION_STYLE[id].color)) },
            L0: { value: new THREE.Vector4() },
            L1: { value: new THREE.Vector4() },
            flash: { value: 0 }
        },
        vertexShader: OVERLAY_VERT,
        fragmentShader: OVERLAY_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
    })
}

function GlbHeart({ model, state, clock, detail, anatomy = true, labels = true }: Props & { model: HeartModelConfig }) {
    const gltf = useGLTF(model.url)
    const asset = useMemo(() => heartAssetFor(gltf.scene, model), [gltf.scene, model])
    const group = useRef<THREE.Group>(null)
    const serverNow = useServerNow(state)
    const shock = useShockFlash(state)
    const target = currentTarget(state)
    const targetRef = useRef(target)
    targetRef.current = target

    const materials = useMemo(() => asset.parts.map(p => p.material.clone() as THREE.MeshStandardMaterial), [asset])
    const baseColors = useMemo(() => materials.map(m => (m.color ? m.color.clone() : new THREE.Color("#fff"))), [materials])
    const overlay = useMemo(makeOverlay, [])

    useFrame(({ clock: c }) => {
        const t = c.elapsedTime
        const now = performance.now()
        const pulse = state ? beatShape(state, clock, now) : 0
        if (group.current) applyBeat(group.current, state, pulse, t, serverNow())
        const v = state?.vitals
        const dead = v?.rhythm === "asystole" || state?.outcome === "died"
        const dusky = state && !state.phys.rcaOpen && state.phase !== "lobby" ? (1 - state.phys.perfusion) * 0.35 : 0
        materials.forEach((m, i) => {
            if (m.color) m.color.copy(baseColors[i]!).lerp(new THREE.Color(dead ? "#3b3540" : "#5a2a4a"), dead ? 0.6 : dusky)
            if (m.emissive) {
                m.emissive.set(v && !v.pulse ? "#401020" : "#b01818")
                m.emissiveIntensity = pulse * 0.25 + (detail === "room" ? 0.25 : 0.04)
            }
        })
        const levels = regionLevels(state, targetRef.current, anatomy, t)
        const tc = targetRef.current
        const colors = overlay.uniforms.colors!.value as THREE.Color[]
        REGIONS.forEach((id, i) => colors[i]!.set(tc && levels[id] > 0.4 && (tc.id === id || tc.id === "ventricles" || tc.id === "whole") ? tc.color : REGION_STYLE[id].color))
        ;(overlay.uniforms.L0!.value as THREE.Vector4).set(levels.lv, levels.rv, levels.inferior, levels.ra)
        ;(overlay.uniforms.L1!.value as THREE.Vector4).set(levels.la, levels.vessels, levels.apex, levels.septum)
        overlay.uniforms.flash!.value = shock.level()
    })

    return (
        <group ref={group}>
            {asset.parts.map((p, i) => (
                <group key={i}>
                    <mesh geometry={p.geometry} material={materials[i]} castShadow />
                    <mesh geometry={p.geometry} material={overlay} renderOrder={2} />
                </group>
            ))}
            <Coronary asset={asset} state={state} detail={detail} serverNow={serverNow} target={target} />
            <SaNode asset={asset} clock={clock} detail={detail} />
            {detail === "or" && (
                <>
                    <ShockArcs asset={asset} shock={shock} />
                    <TargetMarker asset={asset} target={target} label={labels} />
                    {labels && <Hotspots asset={asset} state={state} />}
                </>
            )}
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

// --- Coronary: RCA, clot/stent, catheter, flow -------------------------------------------

function subCurve(curve: THREE.Curve<THREE.Vector3>, t0: number, t1: number, n = 40) {
    const pts = Array.from({ length: n + 1 }, (_, i) => curve.getPointAt(t0 + ((t1 - t0) * i) / n))
    return new THREE.CatmullRomCurve3(pts)
}

function Coronary({ asset, state, detail, serverNow, target }: { asset: HeartAsset; state: WardState | null; detail: "room" | "or"; serverNow: () => number; target: Target | null }) {
    const open = state?.phys.rcaOpen ?? false
    const pci = state?.phys.pciDone ?? false
    const cathEta = state?.phys.cathEta ?? 0
    const radius = detail === "or" ? 0.032 : 0.045
    const { curve, proximal, distal, clot, clotTangent } = useMemo(() => {
        const pts = RCA_PATH.map(([y, th]) => asset.surface(y, th, 0.025))
        const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal")
        return { curve, proximal: subCurve(curve, 0, CLOT_T), distal: subCurve(curve, CLOT_T, 1), clot: curve.getPointAt(CLOT_T), clotTangent: curve.getTangentAt(CLOT_T) }
    }, [asset])
    const proxGeo = useMemo(() => new THREE.TubeGeometry(proximal, 40, radius, 10, false), [proximal, radius])
    const distGeo = useMemo(() => new THREE.TubeGeometry(distal, 100, radius * 0.9, 10, false), [distal, radius])

    // Catheter: from the aorta down into the RCA ostium, then up to the clot.
    const cath = useMemo(() => {
        const entry = [new THREE.Vector3(0.25, 2.3, 0.6), new THREE.Vector3(0.1, 1.4, 0.35), asset.surface(0.72, -5, 0.08), asset.surface(0.5, -8, 0.05)]
        const along = Array.from({ length: 12 }, (_, i) => curve.getPointAt((CLOT_T * (i + 1)) / 12))
        const c = new THREE.CatmullRomCurve3([...entry, ...along], false, "centripetal")
        return new THREE.TubeGeometry(c, 160, radius * 0.45, 8, false)
    }, [asset, curve, radius])
    const cathRef = useRef<THREE.Mesh>(null)

    const distMat = useRef<THREE.MeshStandardMaterial>(null)
    const clotRef = useRef<THREE.Mesh>(null)
    const flow = useRef<THREE.InstancedMesh>(null)
    const N = detail === "or" ? 18 : 10
    const dummy = useMemo(() => new THREE.Object3D(), [])
    const stentQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), clotTangent), [clotTangent])

    useFrame(({ clock }) => {
        const t = clock.elapsedTime
        if (distMat.current) {
            distMat.current.emissiveIntensity = open ? 0.8 + Math.sin(t * 6) * 0.3 : 0.08
        }
        if (clotRef.current) clotRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.08)
        if (cathRef.current) {
            const visible = cathEta > 0 && !pci
            cathRef.current.visible = visible
            if (visible) {
                const p = Math.min(1, Math.max(0.02, 1 - (cathEta - serverNow()) / 60000))
                const idx = cathRef.current.geometry.index!.count
                cathRef.current.geometry.setDrawRange(0, Math.floor((p * idx) / 6) * 6)
            }
        }
        if (flow.current) {
            const drug = target?.kind === "drug" && state && state.now - (state.orders.at(-1)?.at ?? 0) < 9000
            const span = open ? 1 : CLOT_T
            for (let i = 0; i < N; i++) {
                const u = ((t * (open ? 0.22 : 0.12) + i / N) % 1) * span
                dummy.position.copy(curve.getPointAt(Math.min(0.999, u)))
                const s = (detail === "or" ? 0.024 : 0.03) * (open ? 1 : 0.8 + 0.6 * (u / span))
                dummy.scale.setScalar(s / 0.02)
                dummy.updateMatrix()
                flow.current.setMatrixAt(i, dummy.matrix)
                flow.current.setColorAt(i, new THREE.Color(drug ? target!.color : open ? "#ff4040" : "#ff2a2a"))
            }
            flow.current.instanceMatrix.needsUpdate = true
            if (flow.current.instanceColor) flow.current.instanceColor.needsUpdate = true
        }
    })

    return (
        <group>
            <mesh geometry={proxGeo}>
                <meshStandardMaterial color="#ff3030" emissive="#ff1010" emissiveIntensity={0.5} roughness={0.35} />
            </mesh>
            <mesh geometry={distGeo}>
                <meshStandardMaterial ref={distMat} color={open ? "#ff3a3a" : "#3a1214"} emissive={open ? "#ff2020" : "#200000"} roughness={0.4} />
            </mesh>
            {!pci && (
                <mesh ref={clotRef} position={clot}>
                    <sphereGeometry args={[radius * 1.9, 18, 18]} />
                    <meshStandardMaterial color="#14060a" emissive="#5a0000" emissiveIntensity={0.7} roughness={0.95} />
                </mesh>
            )}
            {pci && (
                <mesh position={clot} quaternion={stentQuat}>
                    <cylinderGeometry args={[radius * 1.5, radius * 1.5, 0.22, 10, 4, true]} />
                    <meshStandardMaterial color="#dfe8ee" metalness={1} roughness={0.2} wireframe />
                </mesh>
            )}
            <mesh ref={cathRef} geometry={cath} visible={false}>
                <meshStandardMaterial color="#f2f7fa" emissive="#9cc8ff" emissiveIntensity={0.9} roughness={0.25} toneMapped={false} />
            </mesh>
            <instancedMesh ref={flow} args={[undefined, undefined, N]}>
                <sphereGeometry args={[0.02, 8, 8]} />
                <meshBasicMaterial toneMapped={false} />
            </instancedMesh>
        </group>
    )
}

// --- SA node: flashes on every beat ------------------------------------------------------

function SaNode({ asset, clock, detail }: { asset: HeartAsset; clock: BeatClock; detail: "room" | "or" }) {
    const pos = useMemo(() => asset.surface(...LANDMARKS.sa!, 0.03), [asset])
    const mat = useRef<THREE.MeshBasicMaterial>(null)
    const lastBeat = useRef(0)
    useEffect(() => {
        const off = clock.onBeat(b => (lastBeat.current = b.t))
        return () => void off()
    }, [clock])
    useFrame(() => {
        if (!mat.current) return
        const since = (performance.now() - lastBeat.current) / 1000
        mat.current.opacity = 0.35 + Math.max(0, 1 - since * 5) * 0.65
    })
    return (
        <mesh position={pos}>
            <sphereGeometry args={[detail === "or" ? 0.045 : 0.07, 14, 14]} />
            <meshBasicMaterial ref={mat} color="#ffe14d" transparent toneMapped={false} />
        </mesh>
    )
}

// --- Shocks: white-blue arcs between the pads + a flash on the surface overlay -------------

function useShockFlash(state: WardState | null) {
    const until = useRef(0)
    const seen = useRef<number | null>(null)
    useEffect(() => {
        if (!state) return
        const last = [...state.timeline].reverse().find(e => e.kind === "treatment" && /cardioversion|defibrillation/i.test(e.text))
        const at = last?.at ?? 0
        if (seen.current === null) seen.current = at // don't replay old shocks on load
        else if (at > seen.current) {
            seen.current = at
            until.current = performance.now() + 900
        }
    }, [state])
    return { level: () => Math.max(0, (until.current - performance.now()) / 900), active: () => performance.now() < until.current }
}

function ShockArcs({ asset, shock }: { asset: HeartAsset; shock: ReturnType<typeof useShockFlash> }) {
    const [a, b] = useMemo(() => [asset.surface(0.55, -75, 0.45), asset.surface(-0.65, 110, 0.45)], [asset])
    const lines = useMemo(
        () =>
            Array.from({ length: 4 }, () => {
                const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3))
                return new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#bfe9ff", transparent: true, toneMapped: false }))
            }),
        []
    )
    const pads = useRef<THREE.Group>(null)
    const light = useRef<THREE.PointLight>(null)
    useFrame(() => {
        const on = shock.active()
        const lvl = shock.level()
        if (pads.current) pads.current.visible = on
        if (light.current) light.current.intensity = on ? 40 * lvl : 0
        for (const line of lines) {
            line.visible = on
            if (!on) continue
            const pos = line.geometry.attributes.position as THREE.BufferAttribute
            for (let i = 0; i < 24; i++) {
                const p = a.clone().lerp(b, i / 23)
                const j = i === 0 || i === 23 ? 0 : 0.18
                p.add(new THREE.Vector3((Math.random() - 0.5) * j, (Math.random() - 0.5) * j, (Math.random() - 0.5) * j))
                pos.setXYZ(i, p.x, p.y, p.z)
            }
            pos.needsUpdate = true
            ;(line.material as THREE.LineBasicMaterial).opacity = lvl
        }
    })
    return (
        <group>
            {lines.map((l, i) => (
                <primitive key={i} object={l} />
            ))}
            <group ref={pads} visible={false}>
                {[a, b].map((p, i) => (
                    <mesh key={i} position={p}>
                        <boxGeometry args={[0.32, 0.22, 0.04]} />
                        <meshStandardMaterial color="#222" emissive="#5fd3ff" emissiveIntensity={0.6} />
                    </mesh>
                ))}
            </group>
            <pointLight ref={light} position={[0, 0, 1]} color="#bfe9ff" intensity={0} distance={6} />
        </group>
    )
}

// --- Target marker + teaching labels (OR view) ---------------------------------------------

function targetPoint(asset: HeartAsset, target: Target): THREE.Vector3 {
    const curve = new THREE.CatmullRomCurve3(RCA_PATH.map(([y, th]) => asset.surface(y, th, 0.025)), false, "centripetal")
    switch (target.id) {
        case "clot":
            return curve.getPointAt(CLOT_T)
        case "rca":
            return curve.getPointAt(0.45)
        case "ventricles":
            return asset.surface(-0.45, 10, 0.03)
        case "whole":
            return asset.surface(0.0, 20, 0.03)
        default:
            return asset.surface(...(LANDMARKS[target.id] ?? LANDMARKS.lv!), 0.03)
    }
}

function TargetMarker({ asset, target, label }: { asset: HeartAsset; target: Target | null; label: boolean }) {
    const ring = useRef<THREE.Mesh>(null)
    const placed = useMemo(() => {
        if (!target) return null
        const p = targetPoint(asset, target)
        const n = p.clone().setY(p.y * 0.3).normalize()
        return { p, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n), label: p.clone().addScaledVector(n, 0.2).add(new THREE.Vector3(0, 0.42, 0)) }
    }, [asset, target?.id])
    useFrame(({ clock }) => {
        if (ring.current) ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5) * 0.15)
    })
    if (!target || !placed) return null
    return (
        <group>
            <mesh ref={ring} position={placed.p} quaternion={placed.q}>
                <torusGeometry args={[0.15, 0.014, 10, 48]} />
                <meshBasicMaterial color={target.color} toneMapped={false} />
            </mesh>
            <mesh position={placed.p} quaternion={placed.q}>
                <torusGeometry args={[0.24, 0.006, 8, 48]} />
                <meshBasicMaterial color={target.color} transparent opacity={0.5} toneMapped={false} />
            </mesh>
            {label && (
                <Html position={placed.label} center zIndexRange={[20, 0]}>
                    <div className="target-tag" style={{ borderColor: target.color, color: target.color }}>
                        🎯 {target.label.split(" → ")[0]}
                    </div>
                </Html>
            )}
        </group>
    )
}

const HOTSPOTS: Array<{ id: keyof typeof LANDMARKS; label: string; text: (s: WardState | null) => string }> = [
    { id: "inferior", label: "Inferior wall", text: s => (s?.phys.rcaOpen ? "Reperfused. Contracting again." : "Ischemic. Leads II, III and aVF look right at it.") },
    { id: "rv", label: "Right ventricle", text: () => "RV infarct = preload-dependent. Nitrates can crash the pressure; fluids help." },
    { id: "lv", label: "Left ventricle", text: () => "The main pump. Irritable ischemic muscle is where V-tach and V-fib start." },
    { id: "sa", label: "SA node", text: s => `Pacemaker. Fed by the RCA in ~60% of people. Rhythm now: ${s?.vitals.rhythm ?? "sinus"}.` },
    { id: "aorta", label: "Aortic root", text: () => "The coronaries fill from here during diastole. Low diastolic pressure = less coronary flow." }
]

function Hotspots({ asset, state }: { asset: HeartAsset; state: WardState | null }) {
    const [active, setActive] = useState<string | null>(null)
    const spots = useMemo(() => HOTSPOTS.map(h => ({ ...h, pos: asset.surface(...LANDMARKS[h.id]!, 0.04) })), [asset])
    return (
        <group>
            {spots.map(h => (
                <group key={h.id} position={h.pos}>
                    <mesh
                        onClick={e => {
                            e.stopPropagation()
                            setActive(active === h.id ? null : h.id)
                        }}
                        onPointerOver={() => (document.body.style.cursor = "pointer")}
                        onPointerOut={() => (document.body.style.cursor = "")}
                    >
                        <sphereGeometry args={[0.035, 12, 12]} />
                        <meshBasicMaterial color={active === h.id ? "#ffffff" : "#4dffa0"} transparent opacity={0.9} toneMapped={false} />
                    </mesh>
                    {active === h.id && (
                        <Html center position={[0, 0.25, 0]}>
                            <div className="hotspot" onClick={() => setActive(null)}>
                                <strong>{h.label}</strong>
                                <span>{h.text(state)}</span>
                            </div>
                        </Html>
                    )}
                </group>
            ))}
        </group>
    )
}

// --- Procedural fallback (no GLB) ----------------------------------------------------------

function ProceduralHeart({ state, clock }: Props) {
    const group = useRef<THREE.Group>(null)
    const material = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#a01c24", roughness: 0.42, clearcoat: 0.6 }), [])
    useFrame(({ clock: c }) => {
        const pulse = state ? beatShape(state, clock, performance.now()) : 0
        if (group.current) applyBeat(group.current, state, pulse, c.elapsedTime, state?.now ?? 0)
        material.emissive.set("#b3202a")
        material.emissiveIntensity = 0.12 + pulse * 0.4
    })
    return (
        <group ref={group} rotation={[0, 0, -0.35]}>
            <mesh position={[0.18, -0.15, 0]} scale={[0.78, 0.98, 0.72]} material={material}>
                <sphereGeometry args={[0.8, 48, 48]} />
            </mesh>
            <mesh position={[0.3, -0.92, 0]} rotation={[0, 0, 0.3]} material={material}>
                <coneGeometry args={[0.42, 0.7, 32]} />
            </mesh>
            <mesh position={[-0.38, -0.12, 0.18]} scale={[0.68, 0.85, 0.62]} material={material}>
                <sphereGeometry args={[0.72, 48, 48]} />
            </mesh>
            <mesh position={[-0.45, 0.58, -0.05]} scale={[0.55, 0.42, 0.5]} material={material}>
                <sphereGeometry args={[0.6, 32, 32]} />
            </mesh>
            <mesh position={[0.42, 0.55, -0.2]} scale={[0.5, 0.38, 0.45]} material={material}>
                <sphereGeometry args={[0.6, 32, 32]} />
            </mesh>
            <mesh position={[0.05, 1.0, -0.05]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[0.32, 0.13, 16, 32, Math.PI]} />
                <meshStandardMaterial color="#c0434a" roughness={0.5} />
            </mesh>
        </group>
    )
}
