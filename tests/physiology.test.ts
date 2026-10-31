import { expect, test } from "bun:test"

import { matchOrder } from "../src/sim/case"
import * as sim from "../src/sim/physiology"

function run(fn?: (s: ReturnType<typeof sim.createWard>, t: number) => void, maxMin = 25) {
    let t = 1_000_000
    let s = sim.startCase(sim.createWard("T", t), t)
    const seen: string[] = []
    let i = 0
    const rand = () => ((i = (i * 9301 + 49297) % 233280) / 233280)
    while (s.phase === "running" && t < 1_000_000 + maxMin * 60000) {
        t += sim.TICK_MS
        s = sim.tick(s, t, rand)
        if (seen.at(-1) !== s.vitals.rhythm) seen.push(s.vitals.rhythm)
        fn?.(s, t - 1_000_000)
    }
    return { s, seen, minutes: (t - 1_000_000) / 60000 }
}

test("untreated patient deteriorates to V-tach, V-fib, asystole and dies", () => {
    const { s, seen, minutes } = run()
    expect(seen).toEqual(["sinus", "pvc", "vtach", "vfib", "asystole"])
    expect(s.outcome).toBe("died")
    expect(minutes).toBeGreaterThan(3)
    expect(minutes).toBeLessThan(12)
})

test("aspirin + cath lab early stabilizes him", () => {
    const { s } = run((s, t) => {
        if (t === 20000) sim.applyTreatment(s, "aspirin")
        if (t === 30000) sim.applyTreatment(s, "cath_lab")
    })
    expect(s.outcome).toBe("stabilized")
})

test("unsynchronized shock on V-tach with a pulse causes V-fib", () => {
    let fired = false
    const { seen } = run((s) => {
        if (!fired && s.vitals.rhythm === "vtach") {
            fired = true
            sim.applyTreatment(s, "defib")
        }
    })
    expect(seen.slice(0, 4)).toEqual(["sinus", "pvc", "vtach", "vfib"])
})

test("keyword order matcher", () => {
    expect(matchOrder("give 324 of aspirin")?.key).toBe("aspirin")
    expect(matchOrder("synchronized cardioversion at 100 joules")?.key).toBe("sync_cardioversion")
    expect(matchOrder("unsynchronized shock now")?.key).toBe("defib")
    expect(matchOrder("get a troponin and an ECG")?.key).toBeDefined()
    expect(matchOrder("call the cath lab")?.key).toBe("cath_lab")
    expect(matchOrder("hello there")).toBeNull()
})

test("feed items without ids are not deduped", () => {
    const s = sim.createWard("T", 0)
    sim.pushFeed(s, "patient", "one", { id: undefined, via: "actor" })
    sim.pushFeed(s, "patient", "two", { id: undefined, via: "actor" })
    sim.pushFeed(s, "nurse", "relay", { id: "m1" })
    sim.pushFeed(s, "nurse", "relay dup", { id: "m1" })
    expect(s.feed.map(f => f.text)).toEqual(["one", "two", "relay"])
})
