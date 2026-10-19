# Phase 1 discovery: titles and serials

Verified against the real 47-game library by reading the resolved payload out of the
running app (`artifacts/phase1/library.json`) and screenshotting each console.

## The finding that shaped the design

The name a person gave a folder beats anything stored inside the file. Measured on this
machine:

| Platform | What the file says | What the folder says | Better |
|---|---|---|---|
| PS1 | `SLUS_00650.CUE` | `A bugs life` | folder |
| DS | ROM header `COOKINGMAMA3` | `4309 - Cooking Mama 3 - Shop & Chop (US)` | folder |
| PS3 | `PARAM.SFO` TITLE `LittleBigPlanetT` | `LittleBigPlanet (USA) (En,…) (v02.00)` | folder |
| PS2 | `SAN_ANDREAS.ISO` | *(flat files, no folder)* | PCSX2 cache |

So emulator metadata is used to *replace* a derived name only where it is genuinely
authoritative — the PCSX2 game list cache — and to supply the serial wherever one exists.

## Resolution rules

| Scan shape | Title from | Serial from |
|---|---|---|
| `CuePerFolder` | containing folder name | — |
| `FileInFolder` | containing folder name | DS ROM header game code |
| `DiscFolders` | disc folder name | `PS3_GAME\PARAM.SFO` `TITLE_ID` |
| `FlatFiles` | file name | PCSX2 cache, when one sits beside the emulator |

`TitleNormalizer` then strips scene entry numbers (`2269 - `), region tags (`(USA)`, `(E)`),
language lists (`(En,Fr,Es)`), revisions (`(Rev 2)`), versions (`(v02.00)`) and `-patched`,
and turns an underscore followed by a space into a colon. `(Disc 1)` is never stripped,
because collapsing a two-disc set into one entry would be worse than the extra noise.

Entries using scene naming (`2269 - Iron Man (E)(SQUiRE)`) additionally drop leftover
release and dumper groups, which is how `(SQUiRE)` and `(XenoPhobia)` disappear.

## Result

47 games, 31 carrying a serial, every title either a cleaned name or an authoritative cache
title:

```
PS1   A bugs life · Harry Potter and The Sorcerer Stone · WWF War Zone        [name]
PS2   SLUS-20946  Grand Theft Auto - San Andreas                     [pcsx2-gamelist]
PS3   BCUS98148   LittleBigPlanet                                             [name]
Wii   Mario Kart Wii · New Super Mario Bros. Wii                               [name]
DS    B3CE        Cooking Mama 3 - Shop & Chop                                 [name]
```

![PlayStation 2](../artifacts/phase1/ps2.png)

Notes worth keeping:

- The cache also repairs names: `SusukiSuperBikesPS2.iso` resolves to "Suzuki TT
  Superbikes - Real Road Racing" (SLUS-20912), fixing a typo in the file name.
- The PCSX2 cache is read as evidence, never as a contract. It is parsed by walking
  length-prefixed string triples rather than assuming a fixed record layout, so a future
  PCSX2 format change makes it stop contributing instead of breaking the app.
- The `pcsx2-gamelist` / `name` chip on each row is provenance, not decoration. Titles are
  derived rather than catalogued, so the rule that produced each one stays visible.

## Still to do in Phase 1

- **Cover-art discovery.** `tools/artwork-workshop.cjs` already resolves artwork; porting it
  into the host is the rest of this phase.
- **Wii and PS1 serials.** A Wii disc ID needs the RVZ container header and a PS1 serial
  needs the disc's `SYSTEM.CNF`. Neither affects titles, so both are deferred.
