import { useState } from "react"

import { CATALOG } from "../../sim/case"
import type { Category, NextOption, WardState } from "../../sim/types"

const CAT_LABEL: Record<Category, string> = { assess: "Assess", order: "Order", treat: "Treat", escalate: "Escalate" }

/** "What do you do next?" Guided mode shows the Attending's 4 options; exam mode is a flat menu with no hints. */
export function Options({ state, canOrder, onOrder }: { state: WardState | null; canOrder: boolean; onOrder: (key: string) => Promise<void> }) {
    const [chosen, setChosen] = useState<NextOption | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    if (!state) return null
    const running = state.phase === "running"

    async function pick(key: string, option?: NextOption) {
        if (!canOrder || !running) return
        setBusy(key)
        if (option) setChosen(option)
        try {
            await onOrder(key)
        } finally {
            setBusy(null)
        }
    }

    if (state.mode === "exam") {
        return (
            <section className="options exam">
                <h3>Orders</h3>
                <div className="menu">
                    {(Object.keys(CAT_LABEL) as Category[]).map(cat => (
                        <div key={cat} className="menu-col">
                            <span className={`chip ${cat}`}>{CAT_LABEL[cat]}</span>
                            {CATALOG.filter(c => c.category === cat).map(c => (
                                <button key={c.key} disabled={!canOrder || !running || busy === c.key} onClick={() => pick(c.key)}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </section>
        )
    }

    return (
        <section className="options">
            <h3>What do you do next?</h3>
            <div className="option-row">
                {state.options.map(o => (
                    <button key={o.id} className={`option ${chosen?.id === o.id ? `chosen ${o.risk}` : ""}`} disabled={!canOrder || !running || busy !== null} onClick={() => pick(o.orderKey, o)}>
                        <span className={`chip ${o.category}`}>{CAT_LABEL[o.category]}</span>
                        <span className="option-label">{o.label}</span>
                    </button>
                ))}
            </div>
            {chosen && (
                <p className={`why ${chosen.risk}`} onClick={() => setChosen(null)}>
                    {chosen.risk === "good" ? "✅" : chosen.risk === "trap" ? "⚠️ Trap:" : "🤔"} {chosen.why}
                </p>
            )}
        </section>
    )
}
