# CAD to Chicken Scratch

> *"Go from a beautiful CAD rendering to what your chicken scratch sketch of it would have looked like."*

Built at [Sundai x ink.ai Hack](https://partiful.com/e/Gd1AQgv5cqEZYAvKATtd) — MIT Stata Center, March 29 2026.

[Project card on Sundai Club](https://www.sundai.club/projects/9c72d82c-3031-44dc-a2f2-7909887df779) · [Demo video](https://drive.google.com/file/d/1oWnMS18ctkJlfz5IV57ypH4E4zjAmHph/view?usp=sharing)

---

## What it does

Upload any CAD file — SVG, DXF, STL, or OBJ — and watch it animate as if someone is drawing it by hand on the ink.ai canvas. Paths draw themselves stroke by stroke with real pen-pressure timing and a little jitter so it looks genuinely hand-sketched rather than mechanically plotted.

After the sketch animates, a fal.ai image generation model renders a photorealistic (or stylized) image alongside it — bringing the sketch to life the same way ink.ai demos its core handwriting intelligence.

---

## How it works

```
CAD File (SVG / DXF / STL / OBJ)
        │
        ▼
  Format Parser
  ┌───────┬──────────┬─────────────┐
  SVG     DXF        STL           OBJ
  │       │          │             │
  DOM     Line-by-   Three.js      Three.js
  path    line       STLLoader     OBJLoader
  API     parser     │             │
  │       │          └── Hidden-line removal ──┘
  │       │              (front-face classification,
  │       │               silhouette + sharp edges only)
  └───────┴──────────────────────┘
                  │
                  ▼
        GeometryPrimitive[]
        (x,y point arrays + path lengths)
                  │
                  ▼
        geometryToStrokes()
        · Sort longest paths first (outer contours before details)
        · Add ±1.5px jitter per point
        · Assign timeMillis offsets (12ms/point, 100ms gap between strokes)
                  │
                  ▼
        CadSketchElement
        · strokes[] — pre-computed ink strokes
        · strokeTimings[] — when each stroke starts
        · animationStartTime — Date.now() at render
                  │
                  ▼
        Canvas renderer
        · elapsed = Date.now() - animationStartTime
        · Draws only the visible portion of each stroke
        · hasActiveCadAnimations() keeps rAF loop alive
                  │
                  ▼ (on completion + 1.2s)
        fal.ai sketch-to-image
        · Rasterize strokes to 512×512 PNG
        · Send to fal.ai refinement pipeline
        · Place AI image element next to sketch on canvas
```

### 3D files: hidden-line removal

Naively projecting all edges from a 3D mesh produces dark blobs — hidden back-face edges overlap the front-face lines. Instead:

1. Iterate every triangle, compute its normal, classify front- vs back-facing relative to the isometric camera
2. Build a position-keyed edge map tracking which faces share each edge
3. Keep only:
   - **Silhouette edges** — one face front, one back (always visible)
   - **Sharp feature edges** — both faces front, dihedral angle > 45°
   - **Boundary edges** — one face only, front-facing
4. Project surviving edges → 2D screen coordinates
5. Chain collinear adjacent segments into long smooth strokes

---

## Stack

| Layer | Tech |
|-------|------|
| Canvas / ink engine | [ink.ai](https://ink.ai) React canvas |
| 3D loading | Three.js + STLLoader + OBJLoader |
| SVG sampling | Browser DOM `pathEl.getPointAtLength()` |
| AI image | [fal.ai](https://fal.ai) sketch-to-image |
| Build | Vite + TypeScript + React |

---

## Running locally

```bash
cd ink-ai-hack-playground
npm install
cp .env.example .env.local   # add your INK_FAL_AI_API_KEY
npm run dev                  # http://localhost:5173
```

### Environment variables (`.env.local`)

```
INK_RECOGNITION_API_URL=<handwriting recognition endpoint>
INK_OPENROUTER_API_KEY=<openrouter key for LLM inference>
INK_FAL_AI_API_KEY=<fal.ai key for sketch-to-image>   # optional — falls back to mock
INK_GEMINI_API_KEY=<gemini key>                        # optional alternative to fal.ai
```

---

## Test assets

`test-assets/` includes a curated set of mechanical/engineering files:

| File | Type | Description |
|------|------|-------------|
| `spur_gear_18t.svg` | SVG | 18-tooth spur gear |
| `gear_pump_assembly.svg` | SVG | Gear pump cross-section |
| `jet_engine_section.svg` | SVG | Jet engine cutaway |
| `bevel_gear_assembly.svg` | SVG | Bevel gear pair |
| `piston_pump_exploded.svg` | SVG | Exploded piston pump |
| `test-cube.stl` | STL | Simple reference cube |
| `gear_3d_20t.stl` | STL | 3D spur gear |
| `nasa_wrench.stl` | STL | NASA ISS 3D-printed wrench |
| `bolt_m3.stl` | STL | M3 bolt |
| `teapot.obj` | OBJ | Utah teapot |
| `rocker_arm.obj` | OBJ | Engine rocker arm |
| `fandisk.obj` | OBJ | Fandisk (HLR benchmark) |
| `chess_knight.obj` | OBJ | Chess knight piece |

---

## Project structure

```
src/
  parsers/
    SvgParser.ts          SVG → sampled point paths
    DxfParser.ts          DXF → point paths (LINE/ARC/CIRCLE/LWPOLYLINE/SPLINE)
    GeometryToStrokes.ts  GeometryPrimitive[] → timed Stroke[]
    ThreeDToGeometry.ts   STL/OBJ → hidden-line edges → GeometryPrimitive[]
  elements/
    cadsketch/
      types.ts            CadSketchElement type definition
      renderer.ts         Frame-by-frame animation renderer
      index.ts            Plugin self-registration
  components/
    CadViewer3D.tsx       Three.js 3D viewer modal (isometric + "Sketch This View")
```

---

## Acknowledgements

Built by [Quilee Simeon](https://github.com/qsimeon) at the Sundai x ink.ai hackathon.
Thanks to Rich Miner and the ink.ai team for the platform and the inspiring event.
