# Aisles

A native Windows front end that presents emulated console libraries as a
Blockbuster-era pixel-art collection and launches the correct emulator when a
game is selected.

## Current interface

The active UI is one continuous pixel-art rental-store scene. Console sprites
sit on a floating shelf above a three-level game cabinet; selecting a case opens
its full-resolution box and disc or cartridge beside the rental-receipt details
panel.

![Aisles pixel-art shelf with a selected PlayStation 2 game](docs/screenshots/current-shelf-wide.jpg)

The layout also adapts to a smaller desktop window without switching to a
different visual language:

![Aisles compact pixel-art shelf and selected-game panel](docs/screenshots/current-shelf.jpg)

## Status

**Ready for use.** Aisles is a complete local Windows game-library front end and
emulator launcher. `Aisles.exe` opens its WinUI 3/WebView2 interface, loads the
configured console catalog, scans the available libraries, resolves artwork and
metadata, preserves play history and achievement data, and launches each game
with its configured emulator. The current installation manages eight platforms
and 49 games.

The console shelf and cabinet are rendered with HTML/CSS and pixel-art assets;
cover art is downsampled onto crisp canvases while the selected box and medium
remain full resolution. Cases use the real dimensions in `media-presets.js`, so
PS1 jewel cases, DVD/Blu-ray cases and compact DS/3DS cases keep their correct
proportions. Console changes and shelf pages use interruptible slide/fade motion,
the selected console gently floats, and reduced-motion preferences disable those
effects. Covers and List remain available as alternate library views.

The selected-game panel contains identity, emulator-owned play time,
achievements or trophies, readiness, and the single **Launch** / **Insert & Boot**
action. RetroAchievements supports PS1, PS2, GameCube, Wii and DS through the
configured RetroArch core; PS3 progress comes from RPCS3's local trophy files,
without a PSN account or network call. Earlier Three.js implementation records
and model workshops remain as historical evidence, not unfinished product work.

## Repository layout

| Path | What it is |
|---|---|
| `PLAN.md` | Original design record: decisions, verified facts, architecture, data contracts and risks |
| `Aisles.slnx` | Solution, in the .NET 10 XML format |
| `src/Aisles.App/` | **The application.** WinUI 3 shell, WebView2 host, library scanner, emulator launcher, message bridge |
| `src/Aisles.App/consoles.json` | The editable platform catalog — copied beside the exe on build |
| `src/Aisles.App/wwwroot/` | The web layer, served to WebView2 over `https://aisles.local` |
| `src/Aisles.App/wwwroot/pixel-ui.js` | Current console shelf, game cabinet, paging, pixel-cover rendering and transition lifecycle |
| `src/Aisles.App/wwwroot/art/pixel-ui/` | Current store background, console sprites, floating shelf, cabinet and bundled pixel font |
| `docs/screenshots/` | Current rendered desktop captures used by this README |
| `docs/ui/ui-blockout3.png` | Historical pre-pixel UI blockout; `ui-blockout2.png` is the earlier infinite-scroll draft |
| `docs/phase0-verification.md`, `docs/phase1-discovery.md` | Acceptance evidence for the first two phases, with screenshots under `artifacts/` |
| `prototype/model-preview.html` | Console workshop: original/prepared comparison, lighting, orbit controls, sample shelf and rendering counters |
| `prototype/media-preview.html` | Media workshop: true-scale procedural cases, optical discs and DS cartridge, with comparison and GLB export |
| `prototype/library-preview.html` | Collection workshop: emulator scan, per-asset online artwork fallback, saved choices and selectable 3D shelf |
| `assets/models/` | Legacy Three.js workshop GLBs, placement catalog and attribution records; retained for provenance |
| `3d models/` | Original downloads; kept unchanged |
| `tools/prepare-models.cjs` | Reproducible texture resizing and GLB repacking |
| `docs/model-preparation.md` | Setup, preparation results and remaining visual checks |
| `docs/media-models.md` | Physical dimensions, procedural construction and artwork integration rules |
| `docs/phase5-media.md` | Historical Three.js shelf/hero implementation; its physical-media and artwork decisions still inform the pixel UI |
| `docs/phase6-retroachievements.md` | Account linking, credential storage, title matching, API caching and the achievement rail states |
| `docs/phase7-ps3-trophies.md` | RPCS3 trophy files, TROPCONF/TROPUSR parsing, local PS3 progress, icon host and rail states |
| `docs/phase8-launch-deck.md` | Original selected-game checkout-card implementation and historical visual verification |
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

The app embeds this icon in `Aisles.exe` and assigns it to the native window for
the title bar and taskbar. The web header shows the mark beside AISLES, and its
favicon uses the same `.ico`. The project links the branding assets into
`wwwroot/branding` when building or publishing.

## Quick facts

- **Product state:** ready for daily local use as a library browser and emulator launcher
- **Shell:** WinUI 3 on .NET 10 and Windows App SDK 2.0.1. **UI:** WebView2 with HTML/CSS, canvas cover downsampling and pixel-art assets. **Physical media:** one shared JavaScript preset table in millimetres
- **Emulators** live in `C:\Emulation`, **games** in `D:\Emulation`
- Console matrix, launch arguments and on-disk folder shapes: see `PLAN.md` §3

## Running the app

Needs the .NET 10 SDK and the Windows App SDK runtime, both already present here.

```powershell
dotnet build Aisles.slnx -c Debug
dotnet run --project src/Aisles.App
```

Every build form lands in the same place, `src/Aisles.App/bin/Debug/net10.0-windows10.0.19041.0/`, because the project sets `AppendPlatformToOutputPath` to false. Without that, a solution build and a `-p:Platform=x64` build disagree about the output folder.

The window hosts WebView2. The page is served from `wwwroot` over a virtual host (`https://aisles.local`) rather than `file://`, so it stays a normal https origin with working module and fetch semantics. WebView2's data folder is redirected to `%LOCALAPPDATA%\Aisles\WebView2` so nothing is written beside the exe.

`consoles.json` sits next to the exe after a build and is the only file needed to add or change a platform.

Use **Settings** in the app header to change a console's games folder, emulator
executable, optional RetroArch core, or optional artwork folder. Aisles stores these path overrides in
`%LOCALAPPDATA%\Aisles\settings.json`; `consoles.json` remains the default catalog,
so rebuilding the app does not erase local choices. Saving rescans the library
without restarting the app. Each console uses a consistent short-name badge in
the editor, so platforms with and without prepared 3D models receive the same UI.

Nintendo DS is configured for `C:\RetroArch-Win64\retroarch.exe` with the
`melondsds_libretro.dll` core. Games remain in `D:\Emulation\Nintendo DS\Games`;
Aisles passes the selected ROM to RetroArch with `-L`, reads its `.lrtl` runtime
log, and enables DS RetroAchievements only for a compatible configured core.

The same dialog has a **RetroAchievements** account page. Enter the username and
the web API key from your RetroAchievements control panel, then use **Test
connection** before saving. Aisles keeps the account in
`%LOCALAPPDATA%\Aisles\retroachievements.json`; the key is never returned to the
web layer, logged, or written into the repository. **Unlink** clears both the
saved file and the rail's linked state. See
`docs/phase6-retroachievements.md` for matching and caching details.

PS3 trophies need no account. When RPCS3 has registered a game's trophy set,
Aisles reads `TROPCONF.SFM` and `TROPUSR.DAT` from `dev_hdd0` and shows
*N of M trophies* with up to three recent and three locked icons. A disc that
has not been launched yet falls back to its `TROPHY.TRP` package for definitions.
See `docs/phase7-ps3-trophies.md`.

## Releases

Every commit pushed to `main` runs the release workflow. It tests the app,
publishes a self-contained x64 build, packages it as an `Aisles-Setup-*.exe`
installer, and creates a GitHub Release with the installer plus an attached
`changes.md` generated from commits since the previous release. The installer
does not include games, emulator executables, or local settings.

## Legacy 3D workshop

Run `npm install`, then `npm run import:models`, `npm run prepare:models`, and `npm run preview`. Open http://127.0.0.1:8766/prototype/model-preview.html . Use `npm run check:models` to check the prepared files. Setup and verification limits are in `docs/model-preparation.md`.

## Name

**Aisles** — chosen after a naming audit; the plural avoids the live collisions on
the singular ("Aisle" is a dating app and a notable 1999 interactive-fiction game).
Full details in `PLAN.md` §0.
