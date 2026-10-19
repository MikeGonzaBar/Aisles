# Aisles

A native Windows front end that presents your emulated console libraries as a
physical collection — glossy 3D consoles on a stage beside a 3D shelf of their
real media — and launches the correct emulator when you pick a game.

**Tagline:** *Walk the aisles of your collection.*

## Status

**Phase 0 complete — the native shell runs.** `Aisles.exe` opens a WinUI 3 window hosting WebView2, loads `consoles.json`, scans all eight platforms (47 games found) and drives a live host↔web message bridge. The 3D stage is not built yet, and the launch path is wired but not yet fired. Alongside the app, six console GLBs have prepared runtime copies and local comparison viewers, and a second workshop generates true-scale cases, discs and the DS cartridge procedurally. See `docs/model-preparation.md` and `docs/media-models.md`.

## Repository layout

| Path | What it is |
|---|---|
| `PLAN.md` | The plan: reference, locked decisions, verified facts, architecture, data contracts, visual design, phased roadmap, risks |
| `Aisles.slnx` | Solution, in the .NET 10 XML format |
| `src/Aisles.App/` | **The application.** WinUI 3 shell, WebView2 host, library scanner, emulator launcher, message bridge |
| `src/Aisles.App/consoles.json` | The editable platform catalog — copied beside the exe on build |
| `src/Aisles.App/wwwroot/` | The web layer, served to WebView2 over `https://aisles.local` |
| `docs/ui/ui-blockout3.png` | The agreed UI blockout (SVG source alongside); `ui-blockout2.png` is the earlier infinite-scroll draft |
| `prototype/model-preview.html` | Console workshop: original/prepared comparison, lighting, orbit controls, sample shelf and rendering counters |
| `prototype/media-preview.html` | Media workshop: true-scale procedural cases, optical discs and DS cartridge, with comparison and GLB export |
| `prototype/library-preview.html` | Collection workshop: emulator scan, per-asset online artwork fallback, saved choices and selectable 3D shelf |
| `assets/models/` | Six prepared GLBs, placement catalog and attribution records |
| `3d models/` | Original downloads; kept unchanged |
| `tools/prepare-models.cjs` | Reproducible texture resizing and GLB repacking |
| `docs/model-preparation.md` | Setup, preparation results and remaining visual checks |
| `docs/media-models.md` | Physical dimensions, procedural construction and artwork integration rules |
| `docs/library-workshop.md` | Current local scanner adapter, artwork route and native-host handoff |
| `tools/artwork-workshop.cjs` | Artwork resolver, bounded provider lookup, local cache and saved selections |
| `docs/artwork-endpoints.md` | Workshop API contracts, provider URLs, region mappings, errors and request limits |
| `docs/disc-cartridge-artwork-audit.md` | Inspected disc/cart samples, printed-code conflicts and preparation requirements |
| `docs/ds-cartridge-sticker-review.md` | Measured review of DS cartridge sticker extraction: source families, rect defects, detection limits and the proposed bake process |
| `docs/emulator-metadata-audit.md` | Verified local game metadata, artwork coverage and the recommended import hierarchy |
| `prototype/aisles-mood.html` | Visual mood board — an early AI-generated mock of the 3D rental-store look. **Reference only, not app code** (it loads Three.js from a CDN, hardcodes the library, and invents file paths) |
| `prototype/icon-concept-a.svg` | The flat vector mark, full detail (two spines + a case pulled off the shelf). Currently unused by the build — kept as a spare |
| `prototype/icon-concept-a-small.svg` | The flat vector mark, simplified single case. Source for 16/24/32/48 |
| `prototype/icon-concept-b.svg` | The rejected "A" monogram — reference only |
| `prototype/icon-rich-source.png` | The rich AI-generated mark, 1254×1254, transparent. Source for 64/128/256 |
| `prototype/icon-size-test.html` | Both flat marks at 256→16, on dark and light |
| `prototype/icon-compare.html` | Rich vs flat across all sizes, with the measured colour-band data |
| `assets/Aisles.ico` | Shippable multi-size Windows icon (16→256) |
| `assets/icon-preview.html` | The `.ico` decoded in context (taskbar, title bar) |
| `tools/build-icon.js` | Rebuilds `Aisles.ico` from both sources (`node tools/build-icon.js`) |
| `docs/` | Notes and decisions |

## Icon

Two marks, one file. The **rich** mark (three objects on a shelf, detailed and shaded) is the best
version of the logo from 64px up, but it needs pixels: measured on a scanline through the cases it
keeps 39 distinct colour bands at 64, drops to 33 by 48, and by 16 its rental yellow has drifted to
`#574400`. So **16/24/32/48 come from the flat vector mark**, which is drawn at the size it's
displayed and stays crisp all the way down.

`tools/build-icon.js` bakes the handoff into `assets/Aisles.ico`: six 32-bit DIB entries plus one
PNG-compressed 256, with per-pixel alpha for the rounded corners. The handoff point is the `PLAN`
array at the top of the script.

## Quick facts

- **Shell:** WinUI 3 — settled, it builds and runs unpackaged on .NET 10 against Windows App SDK 2.0.1, so the WPF fallback in `PLAN.md` §9 was not needed. **3D:** WebView2 + Three.js, **assets:** downloaded console GLBs plus procedural media
- **Emulators** live in `C:\Emulation`, **games** in `D:\Emulation`
- Console matrix, launch arguments and on-disk folder shapes: see `PLAN.md` §3
- Roadmap: Phase 0 skeleton → 1 discovery → 2 launching → 3 3D consoles → 4 3D shelf → 5 polish → 6 RetroAchievements (optional)

## Running the app

Needs the .NET 10 SDK and the Windows App SDK runtime, both already present here.

```powershell
dotnet build Aisles.slnx -c Debug
dotnet run --project src/Aisles.App
```

Do not pass `-p:Platform` when building the solution — it resolves x64 from the project, and passing it explicitly is rejected as an invalid solution configuration.

The window hosts WebView2. The page is served from `wwwroot` over a virtual host (`https://aisles.local`) rather than `file://`, so it stays a normal https origin with working module and fetch semantics. WebView2's data folder is redirected to `%LOCALAPPDATA%\Aisles\WebView2` so nothing is written beside the exe.

`consoles.json` sits next to the exe after a build and is the only file needed to add or change a platform.

## Console preview

Run `npm install`, then `npm run import:models`, `npm run prepare:models`, and `npm run preview`. Open http://127.0.0.1:8766/prototype/model-preview.html . Use `npm run check:models` to check the prepared files. Setup and verification limits are in `docs/model-preparation.md`.

## Name

**Aisles** — chosen after a naming audit; the plural avoids the live collisions on
the singular ("Aisle" is a dating app and a notable 1999 interactive-fiction game).
Full details in `PLAN.md` §0.
