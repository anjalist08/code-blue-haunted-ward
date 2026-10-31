import { useEffect, useState } from "react"

// Drop your downloaded heart GLB(s) into public/models/ and list them in public/models/models.json.
// The first entry that loads is used; ?heart=<url> on the page URL overrides it.
// With no GLB available the app falls back to a procedural heart, so the demo never breaks.

export type HeartModel = {
    url: string
    name?: string
    credit?: string
    scale?: number
    rotation?: [number, number, number]
    color?: string | null
}

async function isGlb(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-3" } })
        if (!res.ok) return false
        const type = res.headers.get("content-type") ?? ""
        if (type.includes("text/html")) return false // Vite's SPA fallback for a missing file
        const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4)
        return String.fromCharCode(...head) === "glTF" || type.includes("gltf")
    } catch {
        return false
    }
}

let cached: Promise<HeartModel | null> | null = null

export function findHeartModel(): Promise<HeartModel | null> {
    if (cached) return cached
    cached = (async () => {
        const override = new URLSearchParams(location.search).get("heart")
        let models: HeartModel[] = []
        try {
            const res = await fetch("/models/models.json")
            if (res.ok && !(res.headers.get("content-type") ?? "").includes("text/html")) models = ((await res.json()) as { models?: HeartModel[] }).models ?? []
        } catch {
            /* no manifest */
        }
        if (override) models = [{ ...(models.find(m => m.url === override) ?? {}), url: override }, ...models]
        if (!models.length) models = [{ url: "/models/heart.glb", name: "Heart" }]
        for (const model of models) if (await isGlb(model.url)) return model
        return null
    })()
    return cached
}

export function useHeartModel(): HeartModel | null {
    const [model, setModel] = useState<HeartModel | null>(null)
    useEffect(() => {
        void findHeartModel().then(setModel)
    }, [])
    return model
}
