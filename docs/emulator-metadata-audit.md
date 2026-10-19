# Local emulator metadata audit

Snapshot: 2026-10-18. The inspection was read-only. Games are under `D:\Emulation`; emulator installations and some portable user data are under `C:\Emulation`. DuckStation, Dolphin and Citra also keep user data in the current Windows profile.

## What Aisles can reuse

| Platform | Games found | Stable metadata source | Local artwork | Result |
|---|---:|---|---|---|
| PlayStation | 8 | Disc serial embedded in each BIN, then `DuckStation\resources\gamedb.yaml` and `discdb.yaml` | 8/8 front covers in `Documents\DuckStation\covers` | Strong: canonical title, serial, region-specific release data, publisher, developer, genre, languages and cover |
| PlayStation 2 | 17 | Serial embedded in each ISO, then PCSX2 `resources\GameIndex.yaml` | 17/17 front covers in PCSX2 `covers` | Strong: canonical title, serial, region and cover |
| PlayStation 3 | 2 disc folders | Each game's `PS3_GAME\PARAM.SFO` | 2/2 `ICON0.PNG` and `PIC1.PNG` sets | Strong identity and presentation art; the icon is horizontal menu art rather than a box-cover scan |
| Wii | 8 RVZ files | `DolphinTool.exe header -i <game> -j` | No front-cover files found | Strong identity: game ID, internal title, country, region and revision; use generated case art until covers are added |
| Nintendo DS | 12 ROMs | Standard NDS header and banner embedded in each ROM | 1/12 external covers; every ROM has a built-in 32x32 icon | Strong identity, weak case art: game code, region code, internal/localized title and publisher text are available |
| Xbox 360 | 0 | Xenia Manager `games.json` is currently empty | None | Nothing to import until games are added |
| Nintendo 3DS | 0 | Citra has configuration only | None | Nothing to import until games are added |
| GameCube | 0 | Dolphin can use the same header command when games are added | None | Nothing to import until games are added |

The PS1 discs were directly checked for executable serials. Seven use the usual underscore-and-dot spelling (for example `SCUS_942.88`); Ridge Racer also exposes `SCUS-94300`. These normalize to the hyphenated database keys used by DuckStation.

PCSX2's local game-list cache currently maps all 17 ISO paths to serials and canonical titles. Its cover directory contains a matching cover for every current game, including title-named fallbacks for Cars and I-Ninja. DuckStation's eight covers are 500x500 square images. PCSX2's covers are portrait images, mostly 567x878, with several 512x736 images.

RPCS3's current disc registrations are `BCUS98148` (LittleBigPlanet) and `BCUS98245` (LittleBigPlanet 2). Aisles should read the `PARAM.SFO` and artwork from the original game folders on `D:` rather than installed updates and demos under RPCS3's `dev_hdd0`.

All eight Wii files returned valid JSON through Dolphin's supported command-line tool. The current IDs are `SW2E52`, `SXIE52`, `R6LEWR`, `RMCE01`, `SMNE01`, `RSBE01`, `RSPE01`, and `RZTE01`; all report `NTSC-U` / USA. Dolphin's binary `gamelist.cache` also contains localized titles and dates, but it is an internal version-dependent cache and should not be Aisles' primary interface.

## Import strategy

Aisles should derive the physical object from its platform configuration, because emulator metadata describes software identity and region rather than retail packaging dimensions:

| Platform | Aisles media preset |
|---|---|
| PS1 | Jewel case + 120 mm CD |
| PS2 | Black DVD keep case + 120 mm optical disc |
| PS3 | Short Blu-ray case + 120 mm optical disc |
| Wii | White DVD keep case + 120 mm optical disc |
| DS | DS case + cartridge |
| Xbox 360 | Green DVD keep case + 120 mm optical disc |

Recommended resolver order:

1. Scan the configured game path and read the game's stable embedded ID.
2. Enrich from the emulator's shipped text database or supported CLI.
3. Attach exact local artwork by serial/title.
4. Use embedded menu art or ROM icon as a fallback.
5. Generate a title/platform texture when no suitable artwork exists.

Do not make the PCSX2 or Dolphin binary `gamelist.cache` formats part of Aisles' persistent contract. They prove the emulators already resolved the libraries, but their layouts can change between emulator versions. Direct disc/ROM IDs plus the text databases are more durable. DeSmuME contains recent-file paths but no comparable rich game database. Xenia Manager currently has an empty game library.

## Proposed game record

```jsonc
{
  "platformId": "ps2",
  "launchPath": "D:\\Emulation\\PS2\\ISOs\\GranTurismo4PS2.iso",
  "title": "Gran Turismo 4",
  "gameId": "SCUS-97328",
  "region": "NTSC-U",
  "revision": null,
  "mediaPreset": "dvd-case-black",
  "coverPath": "C:\\Emulation\\PCSX2\\pcsx2-v1.7.4981-windows-x64-Qt\\covers\\SCUS-97328.png",
  "iconPath": null,
  "backgroundPath": null,
  "metadataSource": "pcsx2-game-index"
}
```

Store resolved records in an Aisles-owned cache keyed by platform, normalized game ID and source-file fingerprint. That avoids re-reading large disc images on every launch while allowing a rescan when the file size or modification time changes.
