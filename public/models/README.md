# Heart models

Put your downloaded heart `.glb` files here, then list them in `models.json`.
The first entry that loads is used. To try another one, open the room with
`?heart=/models/<file>.glb` on the URL.

| Field | Meaning |
| --- | --- |
| `url` | Path under `public/`, e.g. `/models/heart.glb` |
| `scale` | Extra scale after auto-fit (the model is auto-centered and fit to ~2.2 units) |
| `rotation` | `[x, y, z]` radians, to point the apex down-left and the RCA toward the camera |
| `color` | Force a base color (e.g. `"#a01c24"`) for grey/white medical scans; `null` keeps the file's materials |
| `credit` | Shown in the corner of the screen. Add one for anything CC-BY |

Suggested sources (check each license before you ship):

- NIH 3D, "Human Heart 3d Model": https://3d.nih.gov/entries/3DPX-022787 (public domain)
- Other NIH 3D hearts (valves, congenital cases): check each entry

Big files load slowly on event Wi-Fi. Shrink them first:

```bash
npx @gltf-transform/cli optimize heart-raw.glb heart.glb --compress draco --texture-compress webp
```

If no GLB is found, the app uses a procedural heart, so the demo still works.
