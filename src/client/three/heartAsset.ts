import * as THREE from "three"

import type { HeartModel } from "../heartModel"

// Turns any heart GLB into a canonical asset shared by the room view and the OR view:
//   - geometry baked into one normalized frame: centered, ~2.2 units tall,
//     +y = base (great vessels), -y = apex, +z = anterior, +x = patient's LEFT
//   - per-vertex region weights (rw0, rw1) so we can paint target areas onto the real surface
//   - surface(): project a (height, azimuth) onto the mesh, for the RCA, markers and labels

export const REGIONS = ["lv", "rv", "inferior", "ra", "la", "vessels", "apex", "septum"] as const
export type RegionId = (typeof REGIONS)[number]

export type HeartPart = { geometry: THREE.BufferGeometry; material: THREE.Material }

export type HeartAsset = {
    parts: HeartPart[]
    surface: (y: number, thetaDeg: number, lift?: number) => THREE.Vector3
    normalAt: (y: number, thetaDeg: number) => THREE.Vector3
}

const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
}

/** Soft membership of a normalized point in each region (0..1). Tuned on the Sketchfab heart. */
export function regionWeights(x: number, y: number, z: number): number[] {
    const below = (v: number, edge: number, soft = 0.08) => 1 - smooth(edge - soft, edge + soft, v)
    const above = (v: number, edge: number, soft = 0.08) => smooth(edge - soft, edge + soft, v)
    const ventricles = below(y, 0.12)
    const lv = ventricles * above(x, 0.08)
    const rv = ventricles * below(x, 0.0) * above(z, -0.05)
    const inferior = below(y, -0.28, 0.1) * below(z, 0.1, 0.12)
    const ra = below(x, -0.28) * above(y, -0.3) * below(y, 0.45)
    const la = below(z, -0.12) * above(y, 0.02) * below(y, 0.45) * above(x, -0.3)
    const vessels = above(y, 0.45, 0.06)
    const apex = below(y, -0.82, 0.08)
    const septum = ventricles * (1 - Math.min(1, Math.abs(x - 0.04) / 0.1)) * above(z, 0.1)
    return [lv, rv, inferior, ra, la, vessels, apex, septum]
}

export function buildHeartAsset(scene: THREE.Object3D, model: HeartModel): HeartAsset {
    const root = scene.clone(true)
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = (2.2 / Math.max(size.x, size.y, size.z)) * (model.scale ?? 1)
    const r = model.rotation ?? [0, 0, 0]
    const norm = new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2]))
        .multiply(new THREE.Matrix4().makeScale(s, s, s))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))

    const parts: HeartPart[] = []
    root.traverse(obj => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        const geometry = mesh.geometry.clone()
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, mesh.matrixWorld))
        if (!geometry.attributes.normal) geometry.computeVertexNormals()
        const pos = geometry.attributes.position!
        const rw0 = new Float32Array(pos.count * 4)
        const rw1 = new Float32Array(pos.count * 4)
        for (let i = 0; i < pos.count; i++) {
            const w = regionWeights(pos.getX(i), pos.getY(i), pos.getZ(i))
            rw0.set(w.slice(0, 4), i * 4)
            rw1.set(w.slice(4, 8), i * 4)
        }
        geometry.setAttribute("rw0", new THREE.BufferAttribute(rw0, 4))
        geometry.setAttribute("rw1", new THREE.BufferAttribute(rw1, 4))
        geometry.computeBoundingSphere()
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)!.clone()
        if (model.color && "color" in material) (material as THREE.MeshStandardMaterial).color = new THREE.Color(model.color)
        parts.push({ geometry, material })
    })

    // Raycast target for surface projection.
    const probe = new THREE.Group()
    for (const p of parts) probe.add(new THREE.Mesh(p.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))
    probe.updateMatrixWorld(true)
    const ray = new THREE.Raycaster()
    const hit = (y: number, thetaDeg: number) => {
        const th = (thetaDeg * Math.PI) / 180
        const origin = new THREE.Vector3(Math.sin(th) * 3, y, Math.cos(th) * 3)
        ray.set(origin, new THREE.Vector3(-Math.sin(th), 0, -Math.cos(th)))
        return ray.intersectObject(probe, true)[0]
    }
    const surface = (y: number, thetaDeg: number, lift = 0.02) => {
        const h = hit(y, thetaDeg)
        const th = (thetaDeg * Math.PI) / 180
        if (!h) return new THREE.Vector3(Math.sin(th) * 0.5, y, Math.cos(th) * 0.45)
        const n = h.face ? h.face.normal.clone() : new THREE.Vector3(Math.sin(th), 0, Math.cos(th))
        return h.point.clone().addScaledVector(n.normalize(), lift)
    }
    const normalAt = (y: number, thetaDeg: number) => {
        const h = hit(y, thetaDeg)
        const th = (thetaDeg * Math.PI) / 180
        return h?.face ? h.face.normal.clone().normalize() : new THREE.Vector3(Math.sin(th), 0, Math.cos(th))
    }
    return { parts, surface, normalAt }
}

const cache = new WeakMap<object, HeartAsset>()
export function heartAssetFor(scene: THREE.Object3D, model: HeartModel): HeartAsset {
    let asset = cache.get(scene)
    if (!asset) {
        asset = buildHeartAsset(scene, model)
        cache.set(scene, asset)
    }
    return asset
}

// --- Anatomy landmarks as (height, azimuth°) on the normalized heart. -------------------
// azimuth 0 = anterior (+z), +90 = patient's left (+x), -90 = patient's right, 180 = posterior.

/** Right coronary artery: aortic root -> right AV groove -> crux -> posterior descending. */
export const RCA_PATH: Array<[number, number]> = [
    [0.4, -12],
    [0.3, -35],
    [0.14, -58],
    [-0.04, -80],
    [-0.22, -102],
    [-0.4, -126],
    [-0.54, -150],
    [-0.62, -175],
    [-0.74, 168],
    [-0.88, 160]
]
/** Index along RCA_PATH (fraction 0..1) where the thrombus sits: proximal-mid RCA. */
export const CLOT_T = 0.24

export const LANDMARKS: Record<string, [number, number]> = {
    sa: [0.44, -70],
    inferior: [-0.62, 180],
    rv: [-0.25, -25],
    lv: [-0.3, 75],
    apex: [-0.92, 20],
    aorta: [0.78, 0],
    ra: [0.12, -85],
    la: [0.25, 160]
}
