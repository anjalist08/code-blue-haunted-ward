# Heart models

`heart.glb` is "Human Heart 3D Model | Anatomy | Medical Project" by Mesh-Magnet on Sketchfab
(https://sketchfab.com/3d-models/human-heart-3d-model-anatomy-medical-project-5da08bb137014f0392c69f9997f777cd),
licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The texture was re-encoded from PNG to JPEG to cut the
file from 4.4 MB to 1.3 MB; nothing else was changed.

To swap in another model, put the `.glb` here and list it in `models.json`.
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

The coloured anatomy regions and the RCA path are tuned to this model's shape (upright, apex down, anterior facing +z).
A model in a different pose needs `rotation` in `models.json`, and possibly new landmarks in `src/client/three/heartAsset.ts`.
