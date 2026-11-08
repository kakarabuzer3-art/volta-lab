# Volta Lab

An educational, browser-based 3D simulator of a battery, a DC-DC converter and a single-phase H-bridge inverter feeding two output cables.
**Simulation only**: it cannot generate, measure or deliver real electricity, and it must not be used to make real wiring or safety decisions.

Production: <https://volta-lab-sable.vercel.app/> (Vercel, auto-deploys from `main`).

## Run

```
npm ci
npm run dev        # development server
npm test           # Node tests: physics engine, design-token contrast, SEO files, Learning Hub
npm run build      # tsc --noEmit && vite build
npm run preview    # serve the production build on :4173
BASE_URL=http://localhost:4173/ node scripts/browser-check.cjs   # browser regression check (needs Playwright, installed separately)
```

Node 22.12 or newer is required (the tests run TypeScript directly).

## Layout

| Path | Purpose |
|---|---|
| `index.html` | Page shell: header, accessible HTML controls, Help dialog, SEO metadata and structured data |
| `src/entry.ts` | Entry point. Loads the stylesheet, then loads the 3D code as a separate chunk so the page shell paints first |
| `src/main.ts` | Three.js scene, input handling, camera modes, HUD (reads the engine's snapshot; computes no electrical values) |
| `src/sim/` | Deterministic electrical engine (battery, DC-DC, inverter, loads, protection, energy ledger). See `ELECTRICAL_MODEL.md` |
| `src/tokens.css` | Design tokens (palette, type scale, spacing, touch-target size). Shared by the simulator and the Learning Hub |
| `src/style.css` | Simulator UI styles |
| `public/` | Static files copied as-is: Learning Hub pages, `robots.txt`, `sitemap.xml`, icons, social image, web manifest |
| `scripts/generate-learn.mjs` | Regenerates `public/learn/**`, `public/learn/learn.css` (tokens + layout) and `public/sitemap.xml`. Run `node scripts/generate-learn.mjs` after editing a lesson |
| `scripts/browser-check.cjs` | Playwright regression check: interaction, camera, touch emulation, layout, accessibility, SEO endpoints |

## Design system

Semantic tokens live in `src/tokens.css` (`--surface`, `--surface-raised`, `--text-primary`, `--text-secondary`, `--primary`, `--success`, `--warning`, `--danger`, `--border`, `--border-control`, `--focus`).
Colour meaning: cyan = information and interaction, mint = active or healthy, amber = warning and limits, red = fault. State is never colour alone: each state also has a text label or symbol.
`src/site.test.ts` calculates the WCAG contrast ratio of every token pairing, so a palette change that breaks contrast fails `npm test`.

## Accessibility notes

* Every important action has an HTML control that stays synchronised with the 3D one: Main Power (switch), AC/DC (radio group), voltage (slider and presets), camera mode, detail view, touch/separate wire ends.
* Keyboard shortcuts are listed in the Help dialog (`?`). The dialog is a native `<dialog>`: focus is trapped, Escape closes it and focus returns to the Help button.
* `prefers-reduced-motion` is honoured in the 3D scene as well as in CSS: no camera inertia, no pulsing lights or rings, instant switch movement, steady (non-flickering) fault flash.
* This is a developer-run set of automated checks, not a complete WCAG audit or a screen-reader test.

## Learning Hub

Five original lessons under `/learn/`, each tagging claims as physical law, engineering approximation or illustrative assumption. `src/site.test.ts` checks that the model constants quoted in the lessons match the engine.
