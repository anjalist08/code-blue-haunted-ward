# Code Blue: Haunted Ward 🎃🫀

*Project plan for Haunted Hacks: Real-Time AI Edition, October 31, 2026, San Francisco*

A multiplayer, real-time hospital room simulator for med students. A patient deteriorates in real time with a 3D beating heart, and a team of AI agents (nurse, pharmacist, lab, attending) respond. The Halloween angle is a "haunted" hospital: the case is a spooky night-shift patient, and the lights flicker as vitals crash.

> Note: I haven't verified the Terse or Agent Relay APIs, so skim their quickstarts first (10 min, at the event). The plan assumes standard actor and messaging patterns.

## Why it can win

- **Durable Actors fit naturally.** The patient is a long-lived stateful actor with its own clock. It keeps deteriorating whether or not anyone acts, and it survives disconnects.
- **Agent Relay fits naturally.** The nurse, lab, pharmacy, and attending agents message each other directly, with no copy/paste through you.
- **Using both** earns the bonus points and puts you in contention for the YC interview, the iPhone Duo, and the Mac mini.
- **The demo is visual.** A 3D heart, a live ECG, and voice are easy for judges to grasp in 90 seconds.

## Architecture

| Piece | Role |
| --- | --- |
| **Patient Actor** (Terse) | Holds vitals, meds given, and the case timeline. An alarm tick every \~2s runs a simplified physiology model (HR, BP, SpO2, rhythm). |
| **Room Actor** (Terse) | One per session. Handles multiplayer: several students join, see the same state, and take turns ordering. |
| **Agents** (Agent Relay) | Nurse, Pharmacist, Lab Tech, Attending. They talk to each other and to the Patient Actor. E.g. you order troponin, Nurse relays to Lab, Lab replies after a delay, Attending comments. |
| **Voice** | OpenAI Realtime API for the patient and nurse. Students speak orders ("Give 324 mg aspirin"). |
| **Brain** | A mini-class OpenAI model for the agents. Realtime only where voice matters. |
| **Frontend** | React + react-three-fiber: the room, a bed, a monitor, and a heart. |
| **Supabase** | Case library plus saved debrief reports. Skip auth beyond a room code. |
| **Freestyle** | Hosting or sandboxes if the stack makes it easy. Don't force it. |

## Budget (the $100 OpenAI credit)

- Realtime voice is the expensive part. Put it on **one or two voices only**, keep sessions short, and cap demo sessions.
- Everything else runs on a cheap mini model.
- Set a hard spend limit in the dashboard and use cached or scripted responses for rehearsals.

## 3D, the cheap way

- **Heart:** a procedural beating heart is safest (a sphere/blob mesh with a pulse scale and a red emissive material, pulse rate tied to HR). If you find a free CC0 GLTF heart quickly, swap it in. Don't spend more than 15 min searching.
- **Room:** a bed, a monitor plane, and a light, all primitives. Haunted effects are flickering lights, fog, and a red emergency glow when vitals crash.
- **ECG:** a canvas waveform whose shape changes with rhythm (normal sinus, V-tach, V-fib, flatline).

## Timeline (hacking is 11:00–4:00)

| Time | Goal |
| --- | --- |
| 11:00–11:30 | Scaffold repo, read the Terse and Agent Relay quickstarts, deploy "hello actor." |
| 11:30–12:30 | Patient Actor with the physiology tick, plus a basic UI showing live vitals and the ECG. |
| 12:30–1:30 | 3D heart and room wired to actor state. Lunch at 1:00; keep coding. |
| 1:30–2:30 | Agent Relay: Nurse, Lab, Pharmacist, and Attending messaging each other and the actor. |
| 2:30–3:15 | Voice orders via Realtime, plus a second player joining the room. |
| 3:15–3:45 | Debrief screen: an AI-generated timeline ("You delayed aspirin 4 min"). Polish, flicker effects, and a case reset button. |
| 3:45–4:00 | Record a backup demo video, submit. **Submit before 4:00.** |

## Scope discipline

**Must have:**

- One case (e.g. chest pain → STEMI → V-tach if untreated).
- Live vitals, ECG, and the 3D heart.
- A couple of agents talking via Relay.
- Durable state.

**Nice to have:** voice, multiplayer, the debrief.

**Cut:** auth, multiple cases, perfect medical accuracy. Add an "educational simulation, not medical advice" label.

## 90-second demo script

1. "Meet Mr. Holloway. He's been dying every night at 3am." The room is dark and the heart is beating.
2. Open the page on two devices (multiplayer). Close one tab and reopen it to show the **patient kept deteriorating**, which demonstrates durability.
3. Speak an order: "Get a troponin and an ECG." Show the Nurse → Lab → Attending messages flowing on screen (Agent Relay).
4. Withhold treatment, and the rhythm goes V-tach and the lights flicker. Give the correct drug and the heart stabilizes.
5. Show the AI debrief and a one-line pitch: "Practice codes without risking patients, and scale to every med school."

For the "scale to millions" prize, mention that one actor per patient session scales horizontally.

## Prize strategy

- Pitch it as a **stateful app** first. The patient actor is the star, which targets the iPhone Duo.
- Make the Relay agent chatter **visible** in the UI (a live message feed) so judges clearly see the Mac mini criteria.
- Telling both stories in the demo is what gets you the bonus points.

## Next steps

Share your team size and stack, and the next pieces to write are the Patient Actor physiology loop and the react-three-fiber heart component.

## Free 3D assets

Licenses below come from the listing pages; double-check each one before you ship, and add a credit line for anything CC-BY.

| Asset | Source | License | Notes |
| --- | --- | --- | --- |
| Human heart (hero asset) | NIH 3D, "Human Heart 3d Model" (https://3d.nih.gov/entries/22787) | Public Domain | Downloads as heart.glb, so it drops straight into react-three-fiber. Drive a scale pulse from the heart-rate value. |
| Other hearts (valves, congenital cases) | NIH 3D | Check each entry | GLB available. Good for a second case later. |
| Hospital bed, IV stand, chair, monitor | Poly Pizza (https://poly.pizza) | CC0 or CC-BY, per model | Has a search API that returns direct GLB links. Search "hospital bed", "IV", "monitor", "chair". |
| Filler props (lamps, cabinets, furniture) | Quaternius and Kenney | CC0 | No attribution needed. |
| Plain bed | itch.io, "Low-Poly Bed" by floating-world | Free / pay-what-you-want | 18 kB GLB. A regular bed, easy to tint. |
| Hospital bed, gurney, IV stand, privacy curtain | The Pixel Lab free hospital room items pack | Free, no redistribution | OBJ files included, so convert to GLB. Needs a newsletter signup. Second choice. |
| Hospital bed | 3DCADBrowser, "Hospital Bed" | Royalty-free, commercial use allowed | OBJ, FBX or Blender only, so convert to GLB. |
| Patient monitor | Sketchfab "ICU Monitor" by Bouaraour | Unverified | I could not confirm that downloads are enabled or the license. Check before using. |

### Notes

- No clearly free, downloadable GLB patient monitor turned up. The safer plan is a plain box mesh with the live ECG canvas as its screen texture.
- Many hospital room scenes on Fab, Renderhub and similar sites are paid and heavy, so skip them.
- Run each GLB through gltf-transform optimize or Draco compression so the page loads fast on event Wi-Fi.
- Time-box the search to 15 minutes. If anything is missing, build it from primitives.
