# Local collection workshop

Open <http://127.0.0.1:8766/prototype/library-preview.html> while `npm run preview` is running. This is a browser-only proof of the scanner, artwork fallback and shelf decisions; it does not launch emulators or replace the future native host. Build badge: `library-workshop-6`. Restart the server once after upgrading from the previous workshop to load the new artwork API.

## What it scans

The `/api/library` endpoint uses a read-only local adapter in `tools/library-workshop.cjs`.

| Platform | Identity source | Artwork handling |
|---|---|---|
| PS1 | BIN executable serial + DuckStation game database | Local DuckStation front cover |
| PS2 | PCSX2's resolved local game-list cache | Local PCSX2 front cover |
| PS3 | `PS3_GAME/PARAM.SFO` | Keeps `ICON0.PNG` as menu art; generates a correctly shaped case front |
| Wii | DolphinTool `header -j` | Uses a sidecar `<game>.cover.png` first, then Dolphin's `Cache/GameCovers/<GameID>.png`; otherwise generates a case front |
| DS | NDS header | Uses a local `- Cover` file when present, otherwise generates a case front |
| Xbox 360 | Xenia Manager has no games yet | No entries until games are added |

Existing artwork is served in place through a narrow localhost route that permits only the known cover roots for PS1, PS2, PS3, Wii, DS and Wii sidecars. Downloaded artwork uses the separate ignored Aisles cache. The browser cannot request arbitrary local files.

For Wii, enable Dolphin's **Download Game Covers from GameTDB.com for Use in Grid Mode** option. Dolphin writes its downloaded PNGs to `C:\Users\gonza\AppData\Roaming\Dolphin Emulator\Cache\GameCovers`, named by Game ID. The local scanner reads that cache on its next rescan; the separate artwork resolver can fetch missing images into Aisles' own cache.

The endpoint caches scan results for two minutes to avoid repeatedly reading disc metadata. The **Rescan local library** button requests a deliberate refresh.

## Artwork lookup controls

**Look online for missing artwork** is enabled by default for the selected game.
It looks up missing assets once, then reuses the persisted result. Uncheck it for
local-only browsing. **Find selected game's missing artwork** explicitly retries
a game after a failure or unavailable match. On load, the workshop also starts a
background fetch for every missing box front and optical-disc label; **Fetch
missing box and disc artwork** starts that job manually. DS cartridge stickers
are excluded because generic full-cartridge images need preparation.

Each game has independent **Box front**, **Disc label** or **Cartridge sticker**
controls. Source and match reason are visible. Choose an alternative to preview
it, then use **Use selected artwork** to save it. Known serial/edition mismatches
are shown. **Automatic lookup order** clears a manual override; **Use generated
artwork** persists an explicit generated fallback. Choices survive rescans and
server restarts. Emulator originals are not changed.

The resolver follows `PLAN.md` §3.3.1: manual → suitable emulator/local asset →
exact online ID → title + platform + region → generated. It uses the first
usable provider/result candidate for box fronts and optical-disc labels.
Unknown regions are not guessed. Network errors
are displayed and leave the existing/generated artwork usable.

### Current provider support

- GameTDB: exact-ID cover/disc lookup for PS3 and Wii. A provider image keyed by
  ID is an identity lookup, not an assurance that its printed product code was
  independently verified. Files smaller than 384 pixels on either axis require
  review; the LittleBigPlanet GameTDB disc sample was only 160 × 160.
- LaunchBox: title search filtered by exact normalized title, platform and region.
  Up to two matching game records and three candidates per missing asset type
  are downloaded. For missing box fronts and optical-disc labels, the first
  usable result in provider/result order applies automatically. The two audited DS cartridge image IDs
  (Mario Kart DS AMCE and Cooking Mama 3 B3CE) have verified printed codes and
  prototype UV crops; other full-cart images need preparation before use.
- LaunchBox uses its currently accessible HTML galleries, **not a verified JSON
  API**. Site markup changes can break discovery; failures appear in the panel.
  GameTDB has short request timeouts and uses the direct artwork host. Requests
  are serialized, bounded to 12 MiB and cached locally. No per-frame requests.
- LibRetro/OPL are not yet integrated. Xbox 360 uses the same title fallback when
  games are detected; the current scanner has no Xbox entries. The API handles
  all six workshop platform IDs, but source coverage is not guaranteed.

`tools/artwork-workshop.cjs` owns resolution and `.cache/artwork/index.json`.
Images are decoded/validated with sharp and cached as PNGs, served only through
the filename-whitelisted `/artwork-cache/<hash>.png` route. Search/select POSTs
accept a known library key; the browser cannot supply arbitrary file paths or
download URLs. Only the selected candidate's UV rectangle is sampled for the
two reviewed DS stickers; crop alignment still needs visual acceptance in the
workshop. The disc mesh retains its own real center hole.

For the native app, this cache is required startup data rather than an optional
browser convenience. The native scanner must read persisted downloaded box and
media paths before sending the library to WebView2, and commit each newly
downloaded image plus its selection metadata before asking the shelf to refresh.
The next frontend launch must therefore use local cached textures with no
provider request required for artwork already downloaded.

Focused checks: `node --test tools/artwork-workshop.test.cjs`.

Full local API and external provider request specifications, JSON examples,
image routes, status codes, locale mappings and limits are in
[Artwork endpoints](artwork-endpoints.md).

## Purpose and handoff

This workshop tests the most uncertain parts of the eventual native implementation now: game identification, local cover matching, shelf capacity, case proportions and fallback artwork. It will be replaced by a native `LibraryScanner` and an Aisles-owned cache, while retaining the same game-record fields and media presets documented in `docs/emulator-metadata-audit.md`.
