# Aisles — Build Plan

A native Windows front end that presents your emulated libraries as a physical
collection: pick a console, see a **glossy 3D model of that console** on a stage
beside a **3D shelf of its games rendered as the real media** (cartridges, discs,
cases) with their **sticker/cover art**, and click a game to **launch the correct
emulator** with it loaded.

> Status: **asset preparation prototype.** Prepared console GLBs and a comparison viewer are available; native application implementation and visual acceptance remain pending. See `docs/model-preparation.md`.

---

## 0. Name & identity

**Aisles** — the store-aisle metaphor: you browse the rows of your collection the
way you'd walk the aisles of a rental shop. It pairs with the video-store visual
direction (§6) while describing what the app *is* (a browsable library), not an
emulator.

Chosen after a naming audit. The **plural** is what makes it safe:

| | |
|---|---|
| App / window title | **Aisles** |
| Executable | `Aisles.exe` |
| Solution / repo | `Aisles` |
| Package identity (if packaged) | `com.gonza.aisles` |
| Tagline | *Walk the aisles of your collection.* |
| Icon | Three cartridges seen spine-on, receding down a shelf — readable at 16px |

**Audit summary (plural, "aisles"):**
- GitHub: 73 repos containing the name, all **≤2★** and unrelated (supermarket
  shelf-scanning robots, receipt scanners) — no software product, no gaming project.
- Web: nothing notable — no app, game, or brand on the plural.
- Domains: `aisles.app` taken (parked on Cloudflare); `aisles.gg`, `aisles.dev`,
  `getaisles.com` resolve to nothing.

**Why not the singular:** "Aisle" is a consumer dating app (`aisle.co`) *and* the
title of Sam Barlow's landmark 1999 interactive-fiction game — both live
collisions. The plural sidesteps both.

**Not formally cleared:** trademark registries (USPTO/EUIPO class 9/41) and true
domain availability were *not* checked — worth doing before any public release.
For personal use, the name is free and clear.

*RetroShelf* survives only as an internal working description, never the product
name (the "Retro-" prefix is the most crowded in this space).

---

## 1. Reference & visual target

Reference: **"Cartridge"** front end (YouTube: *"Cartridge: Now Available on
Windows!"*, channel `@CartridgeFrontend`). Its identity is:

- Glossy, physically-plausible 3D **cartridges and discs with original sticker art**
- **Per-platform 3D models** (each console looks like itself, each medium looks like itself)
- Media insertion, lid and tray animations are excluded from Aisles' scope.
- Rich lighting: soft shadows, plastic sheen, environment reflections

This target requires PBR materials, real-time shadows and reflections —
which is why the rendering stack below was chosen.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Shell | **WinUI 3** (native window / `.exe`), settled in §9 |
| 3D rendering | **WebView2 + Three.js** (PBR, shadows, reflections, animation) |
| 3D assets | **Downloaded console GLBs** with optimized runtime copies and attribution; procedural media meshes. GameCube/3DS assets remain missing. |
| Library presentation | **3D shelf** of the platform's real media |
| Click behaviour | Single click **selects**; double-click / PLAY button **launches** |
| RetroAchievements | **Deferred to Phase 6** |
| Empty consoles | **Shown**, with a "drop games in &lt;folder&gt;" hint |
| Platform switching | **3D console lineup** in the stage; the top bar is configuration only |
| Console selection cue | **Lift + spotlight + yellow name**; scale capped ~1.25×, never scale alone (§6) |
| Camera | **Fixed** with a gentle idle drift; the shelf owns wheel and drag — no free orbit/zoom in v1 |
| Shelf | **Paged bays** — 18 games per bay; moving between bays slides sideways (~400 ms) |
| Played stats | Shown where the emulator records them (PS2, Wii today); muted `—` elsewhere (§3.5) |

## 3. Verified facts the design depends on

### 3.1 Game folder shapes (drive `D:\Emulation`)
Four distinct layouts → the scanner needs four strategies.

| Console | On-disk shape | Launch target |
|---|---|---|
| PS1 | `<folder>/<file>.cue` + `.bin` | the `.cue` |
| PS2 | flat `*.iso` | the `.iso` |
| PS3 | nested disc folders containing `PS3_DISC.SFB` (2 games found) | the **folder** |
| Wii | flat `*.rvz` | the `.rvz` |
| DS | `<folder>/<file>.nds`, some contain `- Cover.png` | the `.nds` |
| GameCube / 3DS / Xbox 360 | empty currently | — |

Two scanning traps found while verifying the counts:

- **PS3 decoy `PARAM.SFO`.** The drive contains **4** files named `PARAM.SFO` but
  only **2** games — `PS3_EXTRA\PARAM.SFO` and `PS3_GAME\PKGDIR\PARAM.SFO` are not
  disc roots. Match the disc root by `PS3_DISC.SFB` (or by `PS3_GAME\PARAM.SFO`
  and take its parent folder); never match the filename alone.
- **Xbox 360 archives in the games tree.** `D:\Emulation\XBOX 360\Games` holds only
  `game-patches-main.zip`, and `D:\Emulation\XBOX 360` also holds
  `xenia_canary.zip`. Neither is a game. The 360 scanner must accept only extracted
  formats and must never treat an archive as a title.

Library total at time of writing: **47 games** (PS1 8, PS2 17, PS3 2, Wii 8, DS 12).
GameCube and 3DS have no games folder on `D:\Emulation` at all.

### 3.2 Emulators (all portable, in `C:\Emulation`)
| Console | Emulator | Arguments |
|---|---|---|
| PS1 | DuckStation `duckstation-qt-x64-ReleaseLTCG.exe` | `"{game}"` |
| PS2 | PCSX2 `pcsx2-qt.exe` | `"{game}"` |
| PS3 | RPCS3 `rpcs3.exe` | `"{game}"` (folder) |
| GC / Wii | Dolphin `Dolphin.exe` | `-b -e "{game}"` |
| DS | DeSmuME `DeSmuME_0.9.13_x64.exe` | `"{game}"` |
| 3DS | Citra `citra-qt.exe` | `"{game}"` |
| Xbox 360 | Xenia Canary `xenia_canary.exe` | `"{game}"` |

### 3.3 Local metadata and artwork

The installed emulators and game files already provide most discovery metadata
without an internet service. The verified extraction sources and current artwork
coverage are recorded in `docs/emulator-metadata-audit.md`.

| Console | Identity/metadata source | Current local artwork |
|---|---|---|
| PS1 | embedded disc serial + DuckStation YAML databases | front covers 8/8 |
| PS2 | embedded disc serial + PCSX2 `GameIndex.yaml` | front covers 17/17 |
| PS3 | `PS3_GAME/PARAM.SFO` | `ICON0.PNG` and `PIC1.PNG` 2/2 |
| Wii | `DolphinTool.exe header --json` | no front covers |
| DS | embedded ROM header/banner | one front cover; 12/12 embedded icons |
| Xbox 360 / 3DS / GameCube | no games currently | none |

The native layer owns adapters for these sources and writes an Aisles-owned
metadata cache. Emulator binary caches are useful evidence, but are not a stable
persistence contract.

`prototype/library-preview.html` is the browser workshop for this contract.
Game/emulator discovery is read-only. Optional artwork lookup downloads selected
assets into an Aisles-owned cache and persists artwork choices before the native
`LibraryScanner` is built; it does not launch games or become the production host.

### 3.3.1 Artwork lookup and fallback policy

Resolve **each asset independently**: `frontCover`, `discLabel`, and
`cartridgeLabel`. A cover does not count as a disc/cartridge label, a PS3 menu
icon does not count as a physical case front, and a gameplay screenshot does
not count as disc art.

Lookup precedence:

1. A saved manual selection (including a deliberate generated-art choice).
2. Suitable artwork already available from the emulator or local game folder.
3. Online artwork addressed by the exact platform/game ID or serial, where a
   provider supports that lookup.
4. Normalized game title **plus platform plus region**, preferring the same
   edition and disc number. Example: if a PS2 SLUS/SLES serial has no suitable
   image, use the PS2 title + North America/Europe rather than stopping there.
5. Generated artwork when no suitable match is available.

For box fronts and optical-disc labels, an automatic title fallback uses the
first usable candidate in provider/result order. Unknown region, conflicting
printed serials or editions, and cartridge photos needing sticker extraction
remain generated until reviewed or prepared. A different printed serial can be
selected manually with its mismatch visible; never silently claim it is an exact
match. Provider-ID matching identifies how an image was looked up; it does not
prove the printed serial has been visually checked.

The workshop currently uses GameTDB exact-ID lookup for PS3/Wii and LaunchBox
title/platform/region search for the six workshop platforms. Missing artwork is
looked up when a game is selected, not during rendering; a checkbox disables
online lookup. A background job also fetches missing box fronts and optical-disc
labels across the library, with a per-game retry button remaining available.
Existing emulator covers are preserved and network failures retain generated labels. LibRetro and OPL
adapters remain future additions, not implemented providers. LibRetro's
`Named_Snaps` and `Named_Titles` are screenshots, not disc labels.

Downloaded box fronts, disc labels, cartridge labels, provenance, candidate
choices, and manual selections persist under `.cache/artwork/` for reuse across
rescans/restarts. No emulator artwork is overwritten. A matching result stores
source/provider, image ID/URL, asset type, region, lookup ID where available,
match reason, dimensions, preparation details, and any known conflict. In the
native app this is a startup invariant: the scanner resolves the persisted
local asset paths before it supplies the library to WebView2, so the frontend
opens with previously downloaded textures already assigned and does not need a
network request to render them. Newly fetched assets are downloaded into the
Aisles application-data cache and committed with their metadata before the
frontend is told to refresh. The native implementation must retain this policy
and move cache/state ownership into its application-data directory.

See `docs/library-workshop.md` for implemented controls and limitations, and
`docs/disc-cartridge-artwork-audit.md` for the sample/edition audit.
Exact local API routes, POST request/response fields, provider URL templates,
region mappings, status codes and request limits are specified in
`docs/artwork-endpoints.md`.

### 3.4 RetroAchievements reality check (drives Phase 6 scope)
| Emulator | RA support |
|---|---|
| DuckStation (PS1), PCSX2 (PS2), Dolphin (GC/Wii) | ✅ Yes |
| DeSmuME standalone (DS), Citra (3DS), RPCS3 (PS3), Xenia (360) | ❌ No |

Only **PS1 / PS2 / GC / Wii** can ever show RA progress. DS would need switching to
melonDS to gain RA support.

### 3.5 Play-time and achievement-state sources (drives the details rail)

Checked against the actual installs on this machine rather than assumed:

| Console | Source | Total time | Last played |
|---|---|---|---|
| PS2 | PCSX2 `inis\playtime.dat` | ✅ seconds | ✅ Unix timestamp |
| Wii / GC | Dolphin `Config\TimePlayed.ini` | ✅ hex, unit unconfirmed | ❌ |
| PS1 | DuckStation | ❌ not stored | ❌ |
| PS3 | RPCS3 `config\games.yml` | ❌ serial → path only | ❌ |
| DS | DeSmuME | ❌ not stored | ❌ |
| Xbox 360 | Xenia | ❌ not stored | ❌ |

`playtime.dat` is fixed-width — `SLUS-21151    32387    1765476533` is serial,
**seconds played**, **last-played Unix timestamp**. Dolphin's `TimePlayed.ini` is
`[TimePlayed]` → `GAMEID = 0x…`; confirm seconds vs milliseconds against one real
session before displaying it.

Consequences: **played time exists on 2 of 6 platforms.** The details rail always
renders the row and shows a muted `—` naming the reason on the other four, so the
rail keeps a stable height instead of reflowing per platform. Both files are
emulator binary caches — read once, keep an Aisles-owned copy, never treat them as
the source of truth (§3.3).

Achievement state has **three** values, not two: *supported, not linked* ·
*not supported on this platform* (DS/PS3/360, §3.4) · *linked + progress*. The
rail ships all three from the start so the layout does not move when Phase 6 lands.

## 4. Architecture

```
┌──────────────────────────── Native .exe (WinUI 3) ────────────────────────────┐
│  Shell        window chrome, console lineup host, details rail, status bar    │
│  Domain       ConsoleCatalog (JSON) → LibraryScanner → GameEntry[]            │
│  Action       EmulatorLauncher (Process.Start + per-console args)             │
│  Bridge       WebView2 message channel (host ⇄ web)                           │
├──────────────────────────── WebView2 (Three.js) ──────────────────────────────┤
│  Scene        stage, lights, shadows, environment map                         │
│  Models       downloaded console GLBs + procedural media meshes               │
│  Labels       sticker/cover textures (cover art or generated)                  │
│  Interaction  fixed camera, hover, select, launch                              │
└───────────────────────────────────────────────────────────────────────────────┘
```

Separation of concerns:
- The **native layer** owns filesystem, config and processes (things a browser can't do).
- The **web layer** owns everything visual and interactive.
- They communicate only through a small, explicit message protocol (§5.2).

## 5. Data contracts

### 5.1 `consoles.json` (user-editable, sits next to the exe)

```jsonc
{
  "consoles": [
    {
      "id": "ps1",
      "name": "PlayStation",
      "shortName": "PS1",
      "manufacturer": "Sony",
      "year": "1994",
      "media": "JewelCase",            // JewelCase | DvdCase | BluRayCase | MiniDiscCase | CartridgeCase
      "scan": "CuePerFolder",          // FlatFiles | CuePerFolder | FileInFolder | DiscFolders
      "scanMarker": "PS3_DISC.SFB",    // DiscFolders only: the file that marks a disc root
      "gamesPath": "D:\\Emulation\\PS1\\Games",
      "extensions": [".cue"],          // launch targets only, one per game
      "emulatorPath": "C:\\Emulation\\Duckstation\\duckstation-qt-x64-ReleaseLTCG.exe",
      "arguments": "\"{0}\"",
      "accentColor": "#4A4F5A",
      "bodyColor": "#C9CBD0"
    }
  ]
}
```

Adding a new platform = editing this file, no recompile.

`scanMarker` is required by `DiscFolders` only, and the launch target is the
folder *holding* the marker, never the marker itself — anchoring on it is what
keeps the PS3 decoy `PARAM.SFO` files from being counted as games (§3.1).
`extensions` lists launch targets only, not companion files: a PS1 entry lists
`.cue` and never `.bin` or `.chd`, or one game would appear three times.

### 5.2 Host ⇄ Web message protocol

| Direction | Message | Payload |
|---|---|---|
| web → host | `ready` | — |
| host → web | `library` | full console list incl. resolved games |
| host → web | `selectConsole` | `consoleId` |
| web → host | `selectGame` | `gameId` |
| host → web | `gameDetails` | `{ gameId, playTime?, lastPlayed?, achievements }` — drives the details rail (§3.5) |
| web → host | `launchGame` | `gameId` (on double-click / LAUNCH) |
| host → web | `launchResult` | `{ gameId, started, message }` — outcome of a launch attempt, including "emulator not found" |
| web → host | `revealGame` | `gameId` |
| web → host | `openSettings` | — (top-bar settings) |
| host → web | `scanResult` | refreshed games for a console |

Messages are JSON over `CoreWebView2.PostWebMessageAsJson` /
`window.chrome.webview.postMessage`.

### 5.3 Assets
- **Three.js bundled locally** (no CDN) so the app works fully offline.
- **Cover art** served to the web layer through WebView2
  `SetVirtualHostNameToFolderMapping` (one hostname per games folder), so the
  page can just use `<img src="https://games-nds/.../cover.png">` instead of
  shipping megabytes of base64.
- Artwork records keep separate resolved `frontCover`, `discLabel`, and
  `cartridgeLabel` references, candidate lists and match reasons. A stable local
  library key binds saved choices to platform + launch target. Source files are
  referenced in place; downloaded assets are served from Aisles' local cache.
- **Console models ship in two tiers**: a decimated lineup LOD (small per-console
  atlas) and the full model used only for the selected slot (§6). The lineup never
  loads a full-quality model. GameCube and 3DS are still unmodelled.

## 6. Visual design

Agreed blockout: `docs/ui/ui-blockout3.png` (1280×720; SVG source alongside).
`ui-blockout2.png` is the earlier infinite-scroll draft, kept for reference. The
window is one **stage** with a fixed camera and five regions:

| Region | Content |
|---|---|
| Top bar | wordmark · search · settings · scan status. **Configuration only** — no platform tabs. |
| Console lineup | every console in `consoles.json` on one floor line, short name beneath each. **This is the platform switcher.** |
| Shelf (left) | the selected platform's media as **paged bays**. A bay is a complete piece of furniture — cornice, side panels, plinth, complete tiers — holding **18 games** (3 tiers × 6). A library longer than 18 opens further bays. |
| Game hero (right) | selected game's box → its medium → title + **LAUNCH** |
| Details rail | **information** · **played** · **achievements**, three stacked sections |

**Console selection cue — light leads, size follows.** The selected console is
raised on a plinth, given a warm spotlight and its name in rental yellow; scale is
a secondary cue capped at **~1.25×**. Scale alone cannot work here: a PS2 lies flat
(30 × 7.8 × 18.2 cm) and can never out-size a standing Wii (21.5 × 4.5 × 15.7 cm)
without reading wrong. The lineup is always visible, because it is the only way to
change platform.

**Camera — fixed**, with a gentle idle drift. The **shelf owns wheel, drag and
arrow keys**; all three mean the same thing — next or previous bay. There is no
vertical scroll anywhere. No free orbit and no zoom in v1, which keeps the shelf
deterministic and hit-testing simple.

**Shelf bays and the slide.** Only the bay moves; the console lineup and the game
hero stay fixed. Parallax comes from the bay's own receding tiers, so the camera
never has to. Paging snaps to a bay centre over **~400 ms ease-out**, with the
incoming bay pre-rendered and no overshoot. Each bay carries **visible side
panels** — without them a sideways slide is indistinguishable from a scroll, and
the whole point is lost. The cornice and plinth are always visible so the shelf
reads as furniture rather than a viewport.

A bay fills left-to-right, top-to-bottom, so the final bay of a library is partly
empty, as a real shelf would be. The pager beneath the shelf reads *"Shelf 1 of 1
· 17 games"* and doubles as the arrow-key affordance.

**Selection outlives the view.** The selected game keeps its empty slot, its place
in the hero and its details rail entry while the user pages to other bays. Because
a game can sit several shelves away, top-bar search is how it is found, and picking
a search result pages the shelf to that game's bay.

**Stage**: dark floor with subtle reflection, radial-gradient backdrop, three
lights (key + fill + rim), soft contact shadows, mild bloom.

**Console models** (downloaded GLBs, prepared and attributed): PS1 grey lid, PS2
black console, PS3 glossy with slot, Wii white slot, DS Lite clamshell, black Xbox
360. **GameCube and 3DS still need models**; until then the lineup shows
placeholders in those two slots. Every model visible in the lineup is a resident
GLB, so the lineup uses a **low-LOD** variant (decimated mesh, one small atlas per
console) and the full-quality model is loaded only for the selected slot. The PS2
model alone is 42 MB / ~469 MiB of textures, so this is not optional.

**Media models** shaped per platform: square CD jewel case (PS1), DVD case
(PS2/Wii/360), Blu-ray case (PS3), mini-disc case (GC), small cartridge case
(DS/3DS). Disc-based media get a visible **disc face**; cartridge media get a
**cartridge shell with a notch**. The hero's medium renders in its **real shape** —
a circle only for optical discs.

**Labels**: follow the per-asset fallback policy in §3.3.1. Render printed
covers/stickers without scene-light overexposure; keep plastic and metallic
geometry lit. Full-cartridge photos require sticker extraction, and disc scans
must align to the mesh's own outer circle and center hole. Menu art and ROM icons
remain metadata/preview assets when unsuitable for physical packaging.

**Interaction**: hover lift, single click **selects**, double-click / LAUNCH
**launches**, wheel / horizontal drag / arrow keys **page** between bays. Selecting
a game empties its slot on the shelf — the case is "in your hands" — and fills the
hero and details rail. The bay slide is the only transition in scope; lid, tray and
media-insertion animations remain excluded.

## 7. Phased roadmap

| # | Phase | Deliverable | Est. |
|---|---|---|---|
| 0 | Skeleton ✅ | WinUI 3 window + WebView2 + message bridge + `consoles.json` loading | done |
| 1 | Discovery | Correct scanning of all four shapes, clean titles, cover-art discovery | ½–1 day |
| 2 | **Launching** | Select a game (2D list first) → emulator opens it → **usable app** | ½ day |
| 3 | 3D consoles | Three.js stage + fixed camera + console lineup (low-LOD pipeline) + lighting | 1–2 days |
| 4 | 3D shelf | Paged shelf bays (18 per bay, ~400 ms slide), procedural media models, sticker textures, hit-testing, select-vs-launch wiring | 1–2 days |
| 5 | Polish | Details rail (information / played / achievements), transitions, settings, error states, icon | 1–2 days |
| 6 | *(optional)* RA | Achievement progress on media (PS1/PS2/GC/Wii only) | 2–4 days |

Phases 0→2 produce a genuinely useful launcher; 3→5 deliver the showcase.
Total for 0–5: **~1–1.5 weeks** of focused work.

**Milestone checkpoints** (for review): after Phase 0 (window + bridge),
after Phase 2 (working launcher), after Phase 3 (**look sign-off on one console
before integrating the rest**), after Phase 4 (full shelf).

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 3D look is subjective | Build **one** console (PS2) + one media type first; get sign-off before scaling to all 8 |
| WinUI 3 CLI scaffolding/Windows App SDK setup can be fiddly | Resolved — WinUI 3 builds and runs unpackaged on .NET 10 (§9); the WPF fallback went unused |
| WebView2 runtime absent on older Windows | Detect and offer the evergreen bootstrapper; Windows 11 ships it |
| Emulator CLI flags differ / change | Per-console `arguments` in config; smoke-test each emulator in Phase 2 |
| Large libraries overwhelm a 3D shelf | **Paged bays** — only the current bay and its immediate neighbours are resident; a 2D grid mode stays an option |
| All 8 console GLBs resident at once (PS2 alone is 42 MB / ~469 MiB of textures) | Low-LOD lineup variant; the full model loads only for the selected slot (§6) |
| GameCube and 3DS have no console model | Placeholder silhouette in the lineup; never block the lineup on a missing model |
| Played stats absent on 4 of 6 platforms | Rail keeps a stable row and names the reason (§3.5); never imply data that isn't there |
| Shelf paging and camera gestures collide | Wheel, drag and arrows all page the shelf; camera is fixed with idle drift only (§6) |
| Many cover images hurting startup | Virtual-host mapping + lazy texture loading |
| RA file→game hash matching (Phase 6) | Defer; start with filename matching, add `rcheevos` hashing only if needed |

## 9. Shell choice: WinUI 3 (settled)

The 3D lives in WebView2, so the shell only provides window chrome and host duties
(scanning, launching, settings, the WebView2 bridge). **Settled in Phase 0: WinUI 3.**

It builds and runs unpackaged on .NET 10 against Windows App SDK 2.0.1 with zero
warnings, so the WPF fallback was never needed. Two things to remember about this
combination:

- The WinUI 3 build references the **CsWinRT projection** of WebView2
  (`Microsoft.Web.WebView2.Core.Projection.dll`), whose API differs from the classic
  .NET library. `CoreWebView2Environment.CreateAsync` cannot be called the usual way,
  so the control builds its own environment and `WEBVIEW2_USER_DATA_FOLDER` redirects
  it to `%LOCALAPPDATA%\Aisles\WebView2`.
- Build the solution with `dotnet build Aisles.slnx -c Debug`. Passing
  `-p:Platform=x64` is rejected as an invalid solution configuration; the `.slnx`
  resolves x64 from the project.

## 10. Explicitly out of scope for v1

RetroAchievements, gamepad/controller navigation, general internet metadata enrichment,
emulator/BIOS management, a multi-console "room", lid/tray/media-insertion animations, and any cloud/sync features.

Optional artwork fetching is in scope under §3.3.1; general metadata enrichment
remains deferred.
